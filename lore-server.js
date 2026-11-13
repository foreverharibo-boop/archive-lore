// Archive Lore © 2026 foreverharibo-boop — AGPL-3.0-only
import {fitFocusedInjection} from './lore-focus-injection.js';
import { makeId } from './lore-api.js';
import { normalizeSettings,matchesRange,sourceRange } from './lore-core.js';
import { automaticReady } from './lore-automation.js';
import { withAbort } from './lore-cancellation.js';
import { waitForServerPoll } from './lore-poll-wait.js';
export function serverChatSnapshot(context) {
    // Keep the complete current message text and fingerprint fields, excluding
    // old swipes, translations, reasoning and unrelated extension payloads.
    return {...context,messages:context.messages.map(m=>Object.fromEntries(
        ['name','mes','send_date','is_user','is_system','original_avatar'].filter(k=>k in m).map(k=>[k,m[k]])))};
}
export async function profileTemplate(context,profileId,proxies=[]) {
    const id=profileId || context.extensionSettings?.connectionManager?.selectedProfile;
    if(!id)throw Error('수집·검색에 사용할 연결 프로필을 선택해 줘. 임베딩만 할 때는 필요 없어.');
    const service=context.ConnectionManagerRequestService,profile=service?.getProfile(id),mapping=service?.validateProfile(profile);
    if(mapping?.selected!=='openai'||!mapping.source)throw Error('서버 수집에는 Chat Completion 연결 프로필이 필요해.');
    const proxy=proxies.find(p=>p.name===profile.proxy);
    const overrides={stream:false,messages:[],model:profile.model,chat_completion_source:mapping.source,secret_id:profile['secret-id'],custom_url:profile['api-url'],vertexai_region:profile['api-url'],zai_endpoint:profile['api-url'],siliconflow_endpoint:profile['api-url'],minimax_endpoint:profile['api-url'],pollinations_endpoint:profile['api-url'],reverse_proxy:proxy?.url,proxy_password:proxy?.password,custom_prompt_post_processing:profile['prompt-post-processing'],temperature:.2,max_tokens:6000};
    const preset=profile.preset?context.getPresetManager?.('openai')?.getCompletionPresetByName(profile.preset):null;
    if(profile.preset&&!preset)throw Error('연결 프로필의 프리셋을 찾을 수 없어. 프로필을 다시 저장해 줘.');
    if(!context.ChatCompletionService?.createRequestData)throw Error('실리태번 Chat Completion API를 찾을 수 없어. 업데이트를 확인해 줘.');
    const payload=preset?await context.ChatCompletionService.presetToGeneratePayload(preset,{},overrides):context.ChatCompletionService.createRequestData(overrides);
    delete payload.messages;return payload;
}
export function createServerClient({headers,request=fetch}) {
    return async function call(route,body={},options={}) {
        const timeoutMs=route==='/connection-test'?190000:route==='/logs/export'?120000:route.startsWith('/embedding')?70000:route==='/jobs/get'?60000:30000;
        const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
        signal.throwIfAborted();
        let response;
        try{response=await request('/api/plugins/archive-lore-server'+route,{method:'POST',headers:headers(),body:JSON.stringify(body),signal});}
        catch(cause){
            options.signal?.throwIfAborted();
            const timedOut=signal.aborted || cause?.name==='TimeoutError';
            const detail=timedOut?`서버 응답 대기 시간(${timeoutMs/1000}초)을 초과했습니다.`:'실리 서버에 요청을 전달하지 못했습니다. 연결 상태를 확인해 주세요.';
            throw Object.assign(new Error(`${detail} [${route}]`,{cause}),{code:timedOut?'SERVER_TIMEOUT':'SERVER_NETWORK',route});
        }
        if(response.status===404)throw Object.assign(Error('서버 기능을 찾을 수 없어. 아카이브 로어 서버 플러그인을 설치·업데이트하고 실리 서버를 재시작해 줘.'),{status:404});
        if(options.blob&&response.ok){const data=await response.blob();signal.throwIfAborted();return data;}
        let data;try{data=await response.json();}catch{throw Error('서버 플러그인 응답을 읽을 수 없어. 서버 버전과 로그인 상태를 확인해 줘.');}
        signal.throwIfAborted();
        if(!response.ok||data.error)throw Object.assign(Error(data.error || `서버 오류 (${response.status})`),{status:response.status,diagnostic:data.diagnostic,category:data.diagnostic?.error?.category});return data;
    };
}
export function serverVectorStore({local,call,enabled}) {
    const cache=new Map();let cacheBytes=0;
    const cost=(key,vector)=>key.length*2+vector.length*8;
    const remember=(key,vector)=>{
        if(cache.has(key)){cacheBytes-=cost(key,cache.get(key));cache.delete(key);}
        const bytes=cost(key,vector);if(bytes>4*1024*1024)return;
        cache.set(key,vector);cacheBytes+=bytes;
        while(cache.size>128||cacheBytes>4*1024*1024){const oldest=cache.keys().next().value;cacheBytes-=cost(oldest,cache.get(oldest));cache.delete(oldest);}
    };
    return {
        clear:()=>{cache.clear();cacheBytes=0;},
        async peekMany(keys,{signal}={}){
            if(!enabled())return local.hasMany?local.hasMany(keys):Promise.all(keys.map(async key=>!!await local.get(key)));
            const found=[];
            for(let start=0;start<keys.length;start+=64){
                signal?.throwIfAborted();
                const batch=keys.slice(start,start+64);
                // Counting must never download or migrate vectors, even on an older plugin.
                const {present}=await call('/vectors/has',{keys:batch},{signal});
                if(!Array.isArray(present)||present.length!==batch.length||!present.every(v=>typeof v==='boolean'))throw Error('임베딩 상태 응답이 올바르지 않아. 서버 플러그인을 업데이트해 줘.');
                found.push(...present);
            }
            return found;
        },
        async get(key){if(!enabled())return local.get(key);if(cache.has(key)){const vector=cache.get(key);remember(key,vector);return vector;}let vector=(await call('/vectors/get',{key})).vector;
            if(!vector){vector=await local.get(key);if(vector)await call('/vectors/put',{key,vector});}
            if(vector)remember(key,vector);return vector;},
        async hasMany(keys,{signal}={}){
            if(!enabled())return local.hasMany?local.hasMany(keys):Promise.all(keys.map(async key=>!!await local.get(key)));
            const found=[];
            for(let start=0;start<keys.length;start+=64){
                signal?.throwIfAborted();
                const batch=keys.slice(start,start+64);let present;
                try{present=(await call('/vectors/has',{keys:batch},{signal})).present;}
                catch(error){if(error.status!==404)throw error;present=null;}
                if(present && (present.length!==batch.length||!present.every(v=>typeof v==='boolean')))throw Error('임베딩 상태 응답이 올바르지 않아. 서버 플러그인을 업데이트해 줘.');
                for(let offset=0;offset<batch.length;offset+=8){
                    const values=await Promise.all(batch.slice(offset,offset+8).map(async(key,i)=>{
                        signal?.throwIfAborted();
                        if(!present){const vector=(await call('/vectors/get',{key},{signal})).vector;if(vector)return true;}
                        if(present?.[offset+i])return true;
                        const vector=await local.get(key);if(!vector)return false;
                        signal?.throwIfAborted();await this.put(key,vector,{signal});return true;
                    }));found.push(...values);
                }
            }
            return found;
        },
        async put(key,vector,{signal}={}){signal?.throwIfAborted();if(!enabled())return local.put(key,vector);await call('/vectors/put',{key,vector},{signal});remember(key,vector);},
    };
}
export function createServerController({local,enabled,settings,context,input,call,sync,changed,countTokens,generating=()=>false,wait=waitForServerPoll,cancelBackground=()=>{}}) {
    let current=null,view=[],status='',lastRecall=null,poll=null,detached=0,lastList=0;
    const applied=new Set(),pendingDrafts=new Map(),applying=new Map();
    let pollingRun=false,restoring=null,activeRun=null,cancelEpoch=0;
    const canceledIds=new Set();
    const active=job=>['queued','running'].includes(job.status);
    async function getJob(id,signal){
        const epoch=detached,key=context().key;
        for(let attempt=0;;attempt++){
            signal?.throwIfAborted();
            if(epoch!==detached||key!==context().key)throw new DOMException('채팅방 변경 · 서버 작업은 유지됩니다.','AbortError');
            try{return await withAbort(()=>call('/jobs/get',{id},{signal}),signal);}
            catch(error){
                if(!['SERVER_TIMEOUT','SERVER_NETWORK'].includes(error.code)||attempt>=2)throw error;
                status=`서버 상태 확인 재시도 중 · ${attempt+1}/2`;changed?.();
                await withAbort(()=>wait(1000*(attempt+1),signal),signal);
            }
        }
    }
    async function finish(job){
        if(job.status!=='completed'||applied.has(job.id)||canceledIds.has(job.id))return;
        // Historical results can outlive a renamed/deleted source chat. Never replay them.
        if(job.sourceChatMissing){applied.add(job.id);return;}
        if(applying.has(job.id))return applying.get(job.id);
        const pending=Promise.resolve().then(()=>sync(job)).then(()=>applied.add(job.id));
        applying.set(job.id,pending);
        try{await pending;}finally{applying.delete(job.id);}
    }
    async function restore(force=false,notify=true){
        if(!enabled() || !context().key){clearTimeout(poll);view=[];current=null;lastList=0;return view;}
        const epoch=detached,key=context().key;
        if(restoring?.epoch===epoch&&restoring.key===key)return restoring.promise;
        const task={epoch,key,promise:null};
        task.promise=restoreOnce(force,notify).finally(()=>{if(restoring===task)restoring=null;});
        restoring=task;return task.promise;
    }
    async function restoreOnce(force,notify){if(!force&&Date.now()-lastList<2500)return view;
        const key=context().key,epoch=cancelEpoch,chatEpoch=detached;const jobs=(await call('/jobs/list',{chatKey:key})).filter(job=>job.chatKey===key);if(key!==context().key||epoch!==cancelEpoch||chatEpoch!==detached)return view;
        view=jobs;lastList=Date.now();current=jobs.find(active)||null;
        for(const job of jobs.filter(j=>j.status==='completed'&&['collect','index','applyMaintenance'].includes(j.kind)&&!applied.has(j.id)).slice(-1)){const fresh=await getJob(job.id);if(key!==context().key)break;await finish(fresh);}
        const background=jobs.filter(j=>j.kind==='recall'&&j.backgroundReply&&j.status==='completed').at(-1);
        if(background && !applied.has(background.id) && !generating()){
            const fresh=await getJob(background.id);
            if(key===context().key && fresh.result?.lastRecall){lastRecall=fresh.result.lastRecall;applied.add(background.id);}
        }
        if(current){status=current.message;scheduleRestore();}else status=jobs.at(-1)?.message || status;
        if(notify)changed?.();return view;
    }
    function scheduleRestore(){clearTimeout(poll);if(pollingRun)return;poll=setTimeout(()=>void restore(true).catch(error=>{status=error.message;changed?.();}),1500);}
    async function run(kind,options={},externalTrace=null) {
        if(!enabled())return kind==='index'?local.index(options.force):local[kind](options);
        if(activeRun)throw Error('서버 작업이 진행 중이야. 내역에서 완료를 기다리거나 중지해 줘.');
        const started=Date.now();
        const clientStages={};
        const measured=async(name,fn)=>{
            const start=Date.now();
            try{return await fn();}finally{clientStages[name]=(clientStages[name]||0)+Date.now()-start;}
        };
        const epoch=detached,key=context().key;
        const runState={abort:new AbortController(),requestId:makeId(),submitted:false};activeRun=runState;
        local.invalidateEmbeddingCounts?.();
        const signal=runState.abort.signal;
        const check=()=>{signal.throwIfAborted();if(epoch!==detached||key!==context().key)throw new DOMException('채팅방 변경 · 서버 작업은 유지됩니다.','AbortError');};
        try{
            await measured('restoreMs',()=>withAbort(()=>restore(true),signal));check();
            if(current&&active(current))throw Error('서버 작업이 진행 중이야. 내역에서 완료를 기다리거나 중지해 줘.');
            clearTimeout(poll);pollingRun=true;
            status='서버 작업 접수 중';current={status:'queued',message:status};changed?.();
            if(kind==='index'){await withAbort(()=>local.prepareEmbedding?.(signal),signal);check();}
            const payload=await measured('inputMs',()=>withAbort(()=>input(kind,options,async(stage,elapsedMs)=>{
                await externalTrace?.event('server.input-stage',{stage,elapsedMs});
            }),signal));check();
            runState.submitted=true;
            const job=await measured('submitMs',()=>withAbort(()=>call('/jobs',{kind,input:payload,requestId:runState.requestId},{signal}),signal));check();current=job;
            await externalTrace?.event('server.accepted',{id:job.id,kind});
            while(true){
                check();
                if(epoch!==detached||key!==context().key)throw new DOMException('다른 채팅방으로 이동했어. 서버 작업은 계속돼.','AbortError');
                const value=await measured('pollMs',()=>getJob(job.id,signal));check();
                if(epoch!==detached||key!==context().key)throw new DOMException('채팅방 변경 · 서버 작업은 유지됨','AbortError');
                current=value;status=value.message;changed?.();
                if(!active(value)){
                    current=null;view=[...view.filter(j=>j.id!==value.id),value];
                    if(value.status!=='completed')throw Error(value.message);
                    await externalTrace?.event('server.result-received',{id:value.id,serverStarted:value.started,serverFinished:value.finished,clientStages:{...clientStages}});
                    await measured('syncMs',()=>finish(value));check();let result=value.result;
                    if(kind==='recall'){
                        const validationStarted=Date.now();
                        const messages=payload.context.messages;if(messages.length!==context().messages.length || (messages.length&&!matchesRange(sourceRange(messages,0,messages.length-1),context().messages)))throw Error('검색 중 대화가 바뀌어서 주입하지 않았어. 다시 시도해 줘.');
                        clientStages.validationMs=Date.now()-validationStarted;
                        const config=normalizeSettings(settings()),requested=normalizeSettings(payload.settings||config);
                        if(config.mode!==requested.mode || config.generousRecall!==requested.generousRecall || JSON.stringify(config.selectionFocus)!==JSON.stringify(requested.selectionFocus) || JSON.stringify(config.excludedSidePromptKeys)!==JSON.stringify(requested.excludedSidePromptKeys))throw Error('검색 중 기억 선별 설정이 바뀌어서 주입하지 않았어. 다시 시도해 줘.');
                        const fitted=await measured('fitMs',()=>fitFocusedInjection(result.lastRecall.units,config,countTokens));
                        check();
                        lastRecall={...result.lastRecall,...fitted,timings:{...result.lastRecall.timings,clientTotalMs:Date.now()-started,clientStages:{...clientStages}},records:result.lastRecall.records.filter(r=>r.entry.constant || fitted.units.some(u=>u.entryId===r.id))};result={...result,...fitted,selected:new Set(fitted.units.map(u=>u.entryId))};
                        await externalTrace?.event('server.recall',{id:value.id,core:result.core,...fitted,timings:lastRecall.timings});await externalTrace?.finish('success');
                    }
                    check();
                    if(kind==='prepareMaintenance')pendingDrafts.set(result.token,value.id);
                    if(epoch!==detached||key!==context().key)throw new DOMException('채팅방 변경 · 서버 작업은 유지됨','AbortError');
                    return result;
                }
                const sleepStarted=Date.now();
                const woke=await measured('pollSleepMs',()=>withAbort(()=>wait(900,signal),signal));
                if(Date.now()-sleepStarted>5000||woke?.wakeReason&&woke.wakeReason!=='timer')await externalTrace?.event('server.poll-delay',{elapsedMs:Date.now()-sleepStarted,...woke});
            }
        }catch(error){
            if(epoch===detached&&key===context().key)status=error.message;
            throw error;
        }finally{
            local.invalidateEmbeddingCounts?.();
            if(activeRun===runState)activeRun=null;
            if(epoch===detached){
                pollingRun=false;
                // Keep the accepted job cancellable after a lost status response.
                // Never automatically submit a replacement job or loop retries forever.
                if(!current?.id||!active(current))current=null;
            }
            changed?.();
        }
    }
    return {
        acceptBackgroundRecall(job){if(job.chatKey===context().key && job.status==='completed' && job.result?.lastRecall){lastRecall=job.result.lastRecall;applied.add(job.id);changed?.();}},
        markInjected:elapsedMs=>{if(!enabled())return local.markInjected(elapsedMs);if(lastRecall){lastRecall.timings={...lastRecall.timings,injectionMs:elapsedMs};changed?.();}},
        collect:options=>run('collect',options),index:force=>run('index',{force:!!force}),
        recall:options=>enabled()?run('recall',{generationType:options?.generationType},options?.trace):local.recall(options),
        prepareMaintenance:options=>run('prepareMaintenance',options),
        applyMaintenance:options=>run('applyMaintenance',{...options,draftJobId:options.draftJobId||pendingDrafts.get(options.token)}),
        discardDraft:()=>{if(!enabled())local.discardDraft();},
        clearRecall:()=>{lastRecall=null;local.clearRecall();},
        cancel:()=>{
            cancelBackground();
            local.cancel();
            if(!enabled())return;
            cancelEpoch++;
            const run=activeRun,id=current?.id;
            if(id)canceledIds.add(id);
            run?.abort.abort(new DOMException('작업 중지됨','AbortError'));
            clearTimeout(poll);lastRecall=null;status='작업 중지됨';
            if(id || run?.submitted){
                const epoch=detached;
                void call('/jobs/cancel',id?{id}:{requestId:run.requestId}).then(job=>{
                    if(epoch!==detached)return;
                    if(job.id)canceledIds.add(job.id);
                    // Do not let an old cancel response replace a newer request.
                    if((id && current?.id===id) || (!current?.id && activeRun===run))current=job.id?job:null;
                    changed?.();
                }).catch(error=>{if(epoch===detached){status=error.message;changed?.();}});
            }
            changed?.();
        },
        detach:()=>{detached++;activeRun?.abort.abort(new DOMException('채팅방 변경 · 서버 작업은 유지됩니다.','AbortError'));activeRun=null;clearTimeout(poll);pollingRun=false;current=null;view=[];lastList=0;lastRecall=null;local.cancel();},
        state:()=>enabled()?{busy:!!activeRun || !!current&&active(current),status:status||'서버 모드 · 준비됨',lastRecall}:local.state(),
        async dashboard(){if(enabled())await restore(false,false);return local.dashboard();},
        embeddingCounts:()=>local.embeddingCounts(),
        cachedEmbeddingCounts:()=>local.cachedEmbeddingCounts(),
        invalidateEmbeddingCounts:()=>local.invalidateEmbeddingCounts(),
        async maybeAutoCollect(){if(!enabled())return local.maybeAutoCollect();if(!normalizeSettings(settings()).enabled||current||generating())return false;const key=context().key;const dashboard=await local.dashboard();if(key!==context().key||generating())return false;if(automaticReady(normalizeSettings(settings()),context().messages,dashboard.next)){await run('collect');return true;}return false;},
        restore,jobs:()=>view,
        async getDraft(id){const job=await call('/jobs/get',{id});if(job.kind!=='prepareMaintenance'||job.status!=='completed'||job.draftAvailable===false||job.chatKey!==context().key)throw Error('이 채팅방에서 사용할 수 있는 초안이 아니야.');return job.result;},
    };
}
