// Archive Lore © 2026 foreverharibo-boop — AGPL-3.0-only
import { makeId } from './lore-api.js';
import { normalizeSettings,fitInjection,matchesRange,sourceRange } from './lore-core.js';
import { automaticReady } from './lore-automation.js';
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
    return async function call(route,body={}) {
        let response;try{response=await request('/api/plugins/archive-lore-server'+route,{method:'POST',headers:headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(route.startsWith('/embedding')?70000:30000)});}catch{throw Error('실리 서버 연결이 끊겼어. 접속 후 서버 작업 내역을 확인해 줘. 이미 접수된 작업은 서버에서 계속돼.');}
        if(response.status===404)throw Object.assign(Error('서버 기능을 찾을 수 없어. 아카이브 로어 서버 플러그인을 설치·업데이트하고 실리 서버를 재시작해 줘.'),{status:404});
        let data;try{data=await response.json();}catch{throw Error('서버 플러그인 응답을 읽을 수 없어. 서버 버전과 로그인 상태를 확인해 줘.');}
        if(!response.ok||data.error)throw Error(data.error || `서버 오류 (${response.status})`);return data;
    };
}
export function serverVectorStore({local,call,enabled}) {
    const cache=new Map();return {
        clear:()=>cache.clear(),
        async get(key){if(!enabled())return local.get(key);if(cache.has(key))return cache.get(key);let vector=(await call('/vectors/get',{key})).vector;
            if(!vector){vector=await local.get(key);if(vector)await call('/vectors/put',{key,vector});}
            if(vector)cache.set(key,vector);return vector;},
        async hasMany(keys){
            if(!enabled())return Promise.all(keys.map(async key=>!!await local.get(key)));
            const found=[];
            for(let start=0;start<keys.length;start+=64){
                const batch=keys.slice(start,start+64);let present;
                try{present=(await call('/vectors/has',{keys:batch})).present;}
                catch(error){if(error.status!==404)throw error;present=null;}
                if(present && (present.length!==batch.length||!present.every(v=>typeof v==='boolean')))throw Error('임베딩 상태 응답이 올바르지 않아. 서버 플러그인을 업데이트해 줘.');
                for(let offset=0;offset<batch.length;offset+=8){
                    const values=await Promise.all(batch.slice(offset,offset+8).map(async(key,i)=>{
                        if(!present)return !!await this.get(key);
                        if(present[offset+i])return true;
                        const vector=await local.get(key);if(!vector)return false;
                        await this.put(key,vector);return true;
                    }));found.push(...values);
                }
            }
            return found;
        },
        async put(key,vector){if(!enabled())return local.put(key,vector);await call('/vectors/put',{key,vector});cache.set(key,vector);},
    };
}
export function createServerController({local,enabled,settings,context,input,call,sync,changed,countTokens,generating=()=>false}) {
    let current=null,view=[],status='',lastRecall=null,poll=null,detached=0,lastList=0;
    const applied=new Set(),pendingDrafts=new Map();
    const active=job=>['queued','running'].includes(job.status);
    async function finish(job){if(job.status!=='completed'||applied.has(job.id))return;await sync(job);applied.add(job.id);}
    async function restore(force=false,notify=true){if(!enabled())return [];if(!force&&Date.now()-lastList<2500)return view;
        const key=context().key;const jobs=await call('/jobs/list',{chatKey:key});if(key!==context().key)return view;
        view=jobs;lastList=Date.now();current=jobs.find(active)||null;
        for(const job of jobs.filter(j=>j.status==='completed'&&['collect','index','applyMaintenance'].includes(j.kind)&&!applied.has(j.id)).slice(-1)){const fresh=await call('/jobs/get',{id:job.id});if(key!==context().key)break;await finish(fresh);}
        if(current){status=current.message;scheduleRestore();}else status=jobs.at(-1)?.message || status;
        if(notify)changed?.();return view;
    }
    function scheduleRestore(){clearTimeout(poll);poll=setTimeout(()=>void restore(true).catch(error=>{status=error.message;changed?.();}),1500);}
    async function run(kind,options={},externalTrace=null) {
        if(!enabled())return kind==='index'?local.index(options.force):local[kind](options);
        const initialKey=context().key;await restore(true);if(initialKey!==context().key)throw Error('채팅방이 바뀌어서 접수하지 않았어.');
        if(current&&active(current))throw Error('서버 작업이 진행 중이야. 내역에서 완료를 기다리거나 중지해 줘.');
        const epoch=detached,key=context().key;
        status='서버 작업 접수 중';current={status:'queued',message:status};changed?.();
        try{
            const payload=await input(kind,options);if(key!==context().key)throw Error('채팅방이 바뀌어서 접수하지 않았어.');
            const job=await call('/jobs',{kind,input:payload,requestId:makeId()});current=job;
            await externalTrace?.event('server.accepted',{id:job.id,kind});
            while(true){
                if(epoch!==detached||key!==context().key)throw new DOMException('다른 채팅방으로 이동했어. 서버 작업은 계속돼.','AbortError');
                const value=await call('/jobs/get',{id:job.id});
                if(epoch!==detached||key!==context().key)throw new DOMException('채팅방 변경 · 서버 작업은 유지됨','AbortError');
                current=value;status=value.message;changed?.();
                if(!active(value)){
                    current=null;view=[...view.filter(j=>j.id!==value.id),value];
                    if(value.status!=='completed')throw Error(value.message);
                    await finish(value);let result=value.result;
                    if(kind==='recall'){
                        const messages=payload.context.messages;if(messages.length!==context().messages.length || (messages.length&&!matchesRange(sourceRange(messages,0,messages.length-1),context().messages)))throw Error('검색 중 대화가 바뀌어서 주입하지 않았어. 다시 시도해 줘.');
                        const fitted=await fitInjection(result.lastRecall.units,normalizeSettings(settings()).injectionTokens,countTokens);
                        lastRecall={...result.lastRecall,...fitted,records:result.lastRecall.records.filter(r=>r.entry.constant || fitted.units.some(u=>u.entryId===r.id))};result={...result,...fitted,selected:new Set(fitted.units.map(u=>u.entryId))};
                        await externalTrace?.event('server.recall',{id:value.id,core:result.core,...fitted});await externalTrace?.finish('success');
                    }
                    if(kind==='prepareMaintenance')pendingDrafts.set(result.token,value.id);
                    if(epoch!==detached||key!==context().key)throw new DOMException('채팅방 변경 · 서버 작업은 유지됨','AbortError');
                    return result;
                }
                await new Promise(resolve=>setTimeout(resolve,900));
            }
        }finally{if(epoch===detached)current=null;changed?.();}
    }
    return {
        collect:options=>run('collect',options),index:force=>run('index',{force:!!force}),
        recall:options=>enabled()?run('recall',{},options?.trace):local.recall(options),
        prepareMaintenance:options=>run('prepareMaintenance',options),
        applyMaintenance:options=>run('applyMaintenance',{...options,draftJobId:options.draftJobId||pendingDrafts.get(options.token)}),
        discardDraft:()=>{if(!enabled())local.discardDraft();},
        clearRecall:()=>{lastRecall=null;local.clearRecall();},
        cancel:()=>{if(!enabled())return local.cancel();if(current?.id)void call('/jobs/cancel',{id:current.id}).then(()=>restore(true)).catch(error=>{status=error.message;changed?.();});},
        detach:()=>{detached++;clearTimeout(poll);current=null;view=[];lastList=0;lastRecall=null;local.cancel();},
        state:()=>enabled()?{busy:!!current&&active(current),status:status||'서버 모드 · 준비됨',lastRecall}:local.state(),
        async dashboard(){if(enabled())await restore(false,false);return local.dashboard();},
        async maybeAutoCollect(){if(!enabled())return local.maybeAutoCollect();if(!normalizeSettings(settings()).enabled||current||generating())return false;const key=context().key;const dashboard=await local.dashboard();if(key!==context().key||generating())return false;if(automaticReady(normalizeSettings(settings()),context().messages,dashboard.next)){await run('collect');return true;}return false;},
        restore,jobs:()=>view,
        async getDraft(id){const job=await call('/jobs/get',{id});if(job.kind!=='prepareMaintenance'||job.status!=='completed'||job.draftAvailable===false||job.chatKey!==context().key)throw Error('이 채팅방에서 사용할 수 있는 초안이 아니야.');return job.result;},
    };
}
