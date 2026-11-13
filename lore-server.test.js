// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {profileTemplate,serverVectorStore,createServerClient,createServerController} from './lore-server.js';
import {embeddingKey} from './lore-api.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('diagnostic download consumes a Blob without parsing the full server JSON in browser memory',async()=>{
    const blob=new Blob(['[{"events":[1,2,3]}]']);
    const call=createServerClient({headers:()=>({}),request:async(url,options)=>{
        assert.equal(url,'/api/plugins/archive-lore-server/logs/export');
        assert.deepEqual(JSON.parse(options.body),{chatKey:'chat',mode:'questions'});
        return {ok:true,status:200,blob:async()=>blob,json:()=>assert.fail('must not parse event bodies')};
    }});
    const result=await call('/logs/export',{chatKey:'chat',mode:'questions'},{blob:true});
    assert.equal(result,blob);
    const combined=new Blob(['local\n===== SERVER JOB DIAGNOSTICS =====\n',result]);
    assert.match(await combined.text(),/\[\{"events":\[1,2,3\]\}\]$/);
    const missing=createServerClient({headers:()=>({}),request:async()=>({status:404,ok:false})});
    await assert.rejects(missing('/logs/export',{}, {blob:true}),e=>e.status===404);
});
test('105 count lookups only query presence and never read local vectors or upload them',async()=>{
    const routes=[];const store=serverVectorStore({enabled:()=>true,local:{get:()=>assert.fail('no local reads')},call:async(route,body)=>{
        routes.push(route);assert.equal(route,'/vectors/has');return {present:body.keys.map(()=>false)};
    }});
    assert.deepEqual(await store.peekMany(Array(105).fill('key')),Array(105).fill(false));assert.equal(routes.length,2);
    const old=serverVectorStore({enabled:()=>true,local:{get:()=>assert.fail()},call:async()=>{throw Object.assign(Error('update server'),{status:404});}});
    await assert.rejects(old.peekMany(['key']),/update server/);
});
test('dedicated counts bypass job restore; server indexing migrates existing browser vectors before submission',async()=>{
    const order=[];const local={embeddingCounts:async()=>({embedded:1,pending:2}),cachedEmbeddingCounts:()=>({embedded:1,pending:2}),prepareEmbedding:async signal=>{assert(!signal.aborted);order.push('migrate');}};
    const controller=createServerController({local,enabled:()=>true,context:()=>({key:'chat'}),input:async()=>({}),sync:async()=>{},call:async route=>{
        order.push(route);if(route==='/jobs/list')return [];if(route==='/jobs')return {id:'job',status:'queued'};if(route==='/jobs/get')return {id:'job',status:'completed',result:{}};
    }});
    assert.deepEqual(await controller.embeddingCounts(),{embedded:1,pending:2});assert.equal(order.length,0);
    assert.deepEqual(controller.cachedEmbeddingCounts(),{embedded:1,pending:2});
    await controller.index();assert(order.indexOf('migrate')<order.indexOf('/jobs'));
});
test('explicit abort reaches server fetch without becoming a retryable network failure',async()=>{
    const abort=new AbortController(),entered=deferred();let transportSignal;
    const call=createServerClient({headers:()=>({}),request:async(_url,{signal})=>{
        transportSignal=signal;entered.resolve();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    }});
    const result=call('/embedding',{}, {signal:abort.signal});await entered.promise;abort.abort();
    await assert.rejects(result,e=>e.name==='AbortError'&&!e.code?.startsWith?.('SERVER_'));assert(transportSignal.aborted);
});
for(const phase of ['restore','input','submit','poll','fit'])test(`cancel during ${phase} releases recall and rejects late completion`,async()=>{
    const entered=deferred(),gate=deferred(),calls=[];let synced=0;
    const hold=async()=>{entered.resolve();await gate.promise;};
    const messages=[{mes:'hello',is_user:true}];
    const controller=createServerController({local:{cancel(){},clearRecall(){}},enabled:()=>true,settings:()=>({}),context:()=>({key:'chat',messages}),
        input:async()=>{if(phase==='input')await hold();return {context:{key:'chat',messages}};},sync:async()=>synced++,
        countTokens:async()=>{if(phase==='fit')await hold();return 1;},
        call:async(route,body)=>{
            calls.push({route,body});
            if(route==='/jobs/list'){if(phase==='restore')await hold();return [];}
            if(route==='/jobs'){if(phase==='submit')await hold();return {id:'accepted',status:'queued'};}
            if(route==='/jobs/get'){if(phase==='poll')await hold();return {id:'accepted',status:'completed',result:{core:'',lastRecall:{units:[{id:'u0',entryId:'e',text:'Fact',priority:3}],records:[]}}};}
            if(route==='/jobs/cancel')return {id:body.id,status:'canceled'};
            throw Error(route);
        }});
    const result=controller.recall();const rejected=assert.rejects(result,e=>e.name==='AbortError');
    await entered.promise;controller.cancel();
    // Token counting is local work; its result is guarded before it can be installed.
    if(phase==='fit')gate.resolve();
    await rejected;gate.resolve();await new Promise(r=>setImmediate(r));
    assert.equal(controller.state().lastRecall,null);
    const cancel=calls.find(c=>c.route==='/jobs/cancel');
    if(['restore','input'].includes(phase)){assert(!cancel);assert(!calls.some(c=>c.route==='/jobs'));}
    else {assert(cancel);if(phase==='submit')assert.equal(cancel.body.requestId,calls.find(c=>c.route==='/jobs').body.requestId);}
    if(phase!=='fit')assert.equal(synced,0);
    controller.detach();
});
test('profile preparation preserves selected provider, secret ID, proxy and preset without sending an AI request',async()=>{
    const profile={model:'chosen-model',preset:'chosen-preset',proxy:'P','secret-id':'secret-choice','api-url':'https://provider.example/v1','prompt-post-processing':'strict'};
    let presetUsed;const context={extensionSettings:{connectionManager:{selectedProfile:'p'}},ConnectionManagerRequestService:{getProfile:id=>{assert.equal(id,'p');return profile;},validateProfile:()=>({selected:'openai',source:'custom'})},getPresetManager:()=>({getCompletionPresetByName:name=>({name})}),ChatCompletionService:{createRequestData:v=>v,presetToGeneratePayload:async(preset,_extra,override)=>{presetUsed=preset;return {reasoning_effort:'low',...override};}}};
    const result=await profileTemplate(context,'',[{name:'P',url:'https://proxy.example',password:'secret-password'}]);
    assert.equal(result.model,'chosen-model');assert.equal(result.secret_id,'secret-choice');assert.equal(result.custom_url,'https://provider.example/v1');assert.equal(result.proxy_password,'secret-password');assert.equal(result.reasoning_effort,'low');assert.equal(presetUsed.name,'chosen-preset');assert(!('messages' in result));
});
test('vector keys do not change between browser and server crypto environments; old local vectors migrate without API work',async()=>{
    const key=await embeddingKey({cacheNamespace:'n',embeddingProvider:'gemini',embeddingModel:'gemini-embedding-001'},'id','content');assert(key.startsWith('embedding-v2:'));
    const calls=[],store=serverVectorStore({local:{get:async()=>[1,2]},enabled:()=>true,call:async(route,body)=>{calls.push({route,body});return {vector:null};}});
    assert.deepEqual(await store.get(key),[1,2]);assert.equal(calls.length,2);assert.equal(calls[1].route,'/vectors/put');await store.get(key);assert.equal(calls.length,2);
});
test('missing plugin and structured server errors remain visible',async()=>{
    const missing=createServerClient({headers:()=>({}),request:async()=>({status:404})});await assert.rejects(missing('/status'),/플러그인을 설치/);
    const error=createServerClient({headers:()=>({}),request:async()=>({status:400,ok:false,json:async()=>({error:'specific failure'})})});await assert.rejects(error('/jobs'),/specific failure/);
});
test('changing chat while a completed server result is in flight never returns stale injection',async()=>{
    let key='old',gets=0;const messages=[{mes:'hello'}];const controller=createServerController({local:{cancel(){},clearRecall(){}},enabled:()=>true,settings:()=>({}),context:()=>({key,messages}),input:async()=>({context:{key,messages}}),sync:async()=>{},countTokens:async()=>1,call:async route=>{
        if(route==='/jobs/list')return [];if(route==='/jobs')return {id:'id',status:'queued'};
        if(route==='/jobs/get'){gets++;key='new';return {id:'id',status:'completed',result:{core:'stale'}};}
    }});
    await assert.rejects(controller.recall(),e=>e.name==='AbortError');assert.equal(gets,1);
});
test('disabled extension never starts automatic server collection',async()=>{
    const controller=createServerController({local:{dashboard:async()=>{throw Error('must not collect');}},enabled:()=>true,settings:()=>({enabled:false,autoCollect:true})});
    assert.equal(await controller.maybeAutoCollect(),false);
});

test('Vertex vector cache isolates project and location without changing AI Studio cache keys',async()=>{
    const config={cacheNamespace:'n',embeddingProvider:'vertex',embeddingModel:'gemini-embedding-001',embeddingVertexProjectId:'one'};
    const key=await embeddingKey(config,'id','content');
    assert.notEqual(key,await embeddingKey({...config,embeddingVertexProjectId:'two'},'id','content'));
    assert.notEqual(key,await embeddingKey({...config,embeddingVertexRegion:'us-central1'},'id','content'));
    assert.equal(await embeddingKey({...config,embeddingProvider:'gemini'},'id','content'),'embedding-v2:'+JSON.stringify(['n','gemini','','gemini-embedding-001','id','content']));
});

test('105 missing vectors are checked in two batches, and newly saved server vectors are not hidden by a negative cache',async()=>{
    let ready=false;const calls=[];
    const store=serverVectorStore({enabled:()=>true,local:{get:async()=>null},call:async(route,body)=>{calls.push(route);assert.equal(route,'/vectors/has');return {present:body.keys.map(()=>ready)};}});
    const keys=Array.from({length:105},(_,i)=>'key'+i);
    assert.deepEqual(await store.hasMany(keys),keys.map(()=>false));assert.equal(calls.length,2);
    ready=true;assert.deepEqual(await store.hasMany(keys),keys.map(()=>true));assert.equal(calls.length,4);
});
test('older server falls back with at most eight concurrent vector requests',async()=>{
    let active=0,peak=0;const store=serverVectorStore({enabled:()=>true,local:{get:async()=>null},call:async(route)=>{
        if(route==='/vectors/has')throw Object.assign(Error('old plugin'),{status:404});
        peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,1));active--;return {vector:null};
    }});
    assert.equal((await store.hasMany(Array.from({length:105},(_,i)=>String(i)))).filter(Boolean).length,0);assert(peak<=8);
});
test('dashboard restore does not recursively request another dashboard render',async()=>{
    let notifications=0;const controller=createServerController({local:{dashboard:async()=>({records:[]})},enabled:()=>true,context:()=>({key:'chat'}),call:async()=>[],changed:()=>notifications++});
    await controller.dashboard();assert.equal(notifications,0);
});
test('overlapping refreshes finish the current render and perform only one trailing refresh',async()=>{
    const {coalesceRefresh}=await import('./lore-ui.js');let release,count=0,concurrent=0,peak=0;
    const gate=new Promise(r=>release=r);const refresh=coalesceRefresh(async()=>{count++;peak=Math.max(peak,++concurrent);if(count===1)await gate;concurrent--;});
    const first=refresh();await Promise.resolve();const burst=Array.from({length:105},()=>refresh());release();await Promise.all([first,...burst]);assert.equal(count,2);assert.equal(peak,1);
});


test('server timeout and network failures identify the route without claiming migration continues',async()=>{
    for(const [name,code,pattern] of [['TimeoutError','SERVER_TIMEOUT',/30초/],['TypeError','SERVER_NETWORK',/연결 상태/]]){
        const call=createServerClient({headers:()=>({}),request:async()=>{throw Object.assign(Error('private transport details'),{name});}});
        await assert.rejects(call('/vectors/put'),error=>{
            assert.equal(error.code,code);assert.equal(error.route,'/vectors/put');
            assert.match(error.message,pattern);assert.match(error.message,/vectors\/put/);
            assert(!error.message.includes('계속'));assert(!error.message.includes('private transport details'));return true;
        });
    }
});

test('concurrent restores share requests and apply a completed job exactly once',async()=>{
    let lists=0,gets=0,syncs=0,release;
    const gate=new Promise(r=>release=r);
    const controller=createServerController({local:{},enabled:()=>true,context:()=>({key:'chat'}),call:async route=>{
        if(route==='/jobs/list'){lists++;await gate;return [{id:'finished',chatKey:'chat',kind:'index',status:'completed'}];}
        if(route==='/jobs/get'){gets++;return {id:'finished',chatKey:'chat',kind:'index',status:'completed'};}
        throw Error(route);
    },sync:async()=>{syncs++;}});
    const requests=Array.from({length:20},()=>controller.restore(true));release();await Promise.all(requests);
    assert.equal(lists,1);assert.equal(gets,1);assert.equal(syncs,1);
    await controller.restore(true);assert.equal(gets,1);assert.equal(syncs,1);
});

test('transient status failures retry the same accepted job, without submitting twice',async()=>{
    let submissions=0,gets=0,syncs=0;const ids=[],delays=[];
    const controller=createServerController({local:{},enabled:()=>true,context:()=>({key:'chat'}),input:async()=>({}),sync:async()=>syncs++,wait:async ms=>delays.push(ms),call:async(route,body)=>{
        if(route==='/jobs/list')return [];
        if(route==='/jobs'){submissions++;return {id:'accepted',kind:'index',status:'queued'};}
        if(route==='/jobs/get'){ids.push(body.id);if(++gets<3)throw Object.assign(Error('temporary'),{code:'SERVER_TIMEOUT'});return {id:'accepted',kind:'index',status:'completed',result:7};}
    }});
    assert.equal(await controller.index(),7);assert.equal(submissions,1);assert.equal(syncs,1);
    assert.deepEqual(ids,['accepted','accepted','accepted']);assert.deepEqual(delays,[1000,2000]);assert.equal(controller.state().busy,false);
});
test('exhausted status retries retain a cancellable job; chat change prevents stale retry',async()=>{
    let key='chat',gets=0,canceled=null,change=false;
    const controller=createServerController({local:{cancel(){}},enabled:()=>true,context:()=>({key}),input:async()=>({}),wait:async()=>{if(change)key='other';},call:async(route,body)=>{
        if(route==='/jobs/list')return [];
        if(route==='/jobs')return {id:'accepted',status:'queued'};
        if(route==='/jobs/get'){gets++;throw Object.assign(Error('temporary'),{code:'SERVER_NETWORK'});}
        if(route==='/jobs/cancel'){canceled=body.id;return {};}
    }});
    await assert.rejects(controller.index(),/temporary/);assert.equal(gets,3);assert.equal(controller.state().busy,true);
    controller.cancel();await new Promise(r=>setImmediate(r));assert.equal(canceled,'accepted');
    controller.detach();change=true;gets=0;await assert.rejects(controller.index(),e=>e.name==='AbortError');assert.equal(gets,1);
    controller.detach();
});
test('permanent status errors are not retried',async()=>{
    let gets=0;const controller=createServerController({local:{},enabled:()=>true,context:()=>({key:'chat'}),input:async()=>({}),wait:async()=>assert.fail('no retry'),call:async route=>{
        if(route==='/jobs/list')return [];if(route==='/jobs')return {id:'id',status:'queued'};
        if(route==='/jobs/get'){gets++;throw Error('missing job');}
    }});
    await assert.rejects(controller.index(),/missing job/);assert.equal(gets,1);
});

test('recall diagnostics distinguish result receipt, synchronization and client token fitting',async()=>{
    const events=[],messages=[{is_user:true,mes:'Remember the drill?'}];let polls=0;
    const controller=createServerController({local:{},enabled:()=>true,settings:()=>({}),context:()=>({key:'chat',messages}),
        input:async()=>({context:{key:'chat',messages}}),sync:async()=>{
            assert(events.some(e=>e.stage==='server.result-received'));
            await new Promise(r=>setTimeout(r,5));
        },countTokens:async()=>{await new Promise(r=>setTimeout(r,5));return 100;},wait:async()=>{},
        call:async route=>{
            if(route==='/jobs/list')return [];
            if(route==='/jobs')return {id:'accepted',status:'queued'};
            if(route==='/jobs/get'){
                if(++polls===1)return {id:'accepted',status:'running'};
                return {id:'accepted',kind:'recall',status:'completed',started:'2031-01-01T00:00:00Z',finished:'2031-01-01T00:00:01Z',
                    result:{core:'',lastRecall:{units:[{id:'u0',entryId:'entry',title:'Training',text:'The drill lasted fifteen minutes.',index:0,priority:3}],records:[],timings:{totalMs:1000}}}};
            }
            throw Error(route);
        }});
    await controller.recall({trace:{event:async(stage,data)=>events.push({stage,data}),finish:async()=>{}}});
    const stages=controller.state().lastRecall.timings.clientStages;
    for(const key of ['restoreMs','inputMs','submitMs','pollMs','pollSleepMs','syncMs','validationMs','fitMs'])assert(Number.isFinite(stages[key])&&stages[key]>=0,key);
    assert(stages.syncMs>0);assert(stages.fitMs>0);
    assert.equal(events.find(e=>e.stage==='server.result-received').data.serverFinished,'2031-01-01T00:00:01Z');
    assert.deepEqual(events.find(e=>e.stage==='server.recall').data.timings.clientStages,stages);
});

for(const mode of ['dialogue','questions','embedding'])for(const focus of [[],['affection'],['details']])test(`server client refits separate guidance with the actual tokenizer for ${mode}, ${focus}`,async()=>{
    const settings={mode,selectionFocus:focus,injectionTokens:500};
    const messages=[{is_user:true,mes:'What happened at the hospital?'}];
    const units=[{id:'u0',entryId:'visit',title:'Hospital',text:'She thanked him for staying.',index:0,priority:3}];
    const controller=createServerController({local:{},enabled:()=>true,settings:()=>settings,context:()=>({key:'chat',messages}),
        input:async()=>({settings:structuredClone(settings),context:{messages}}),sync:async()=>{},countTokens:async text=>Math.ceil(text.length/3),
        call:async route=>route==='/jobs/list'?[]:route==='/jobs'?{id:'job',status:'queued'}:{id:'job',kind:'recall',status:'completed',result:{core:'',lastRecall:{units,records:[],timings:{}}}}});
    const result=await controller.recall();assert(result.text.includes('thanked'));assert.match(result.guidance,/Do not recap retrieved events/);assert(result.tokens<=500);
    assert.equal(controller.state().lastRecall.guidance,result.guidance);assert(result.tokens>result.memoryTokens);
    if(mode==='embedding'||!focus.length)assert(!result.guidance.includes('Let expressed feelings'));
});
test('server client rejects a result from categories changed after submission',async()=>{
    let settings={selectionFocus:['affection']};const messages=[{is_user:true,mes:'Remember?'}];
    const controller=createServerController({local:{},enabled:()=>true,settings:()=>settings,context:()=>({key:'chat',messages}),
        input:async()=>({settings:structuredClone(settings),context:{messages}}),sync:async()=>{},countTokens:async()=>1,
        call:async route=>{if(route==='/jobs/list')return [];if(route==='/jobs')return {id:'job',status:'queued'};settings={selectionFocus:[]};return {id:'job',kind:'recall',status:'completed',result:{lastRecall:{units:[],records:[]}}};}});
    await assert.rejects(controller.recall(),/설정이 바뀌/);assert.equal(controller.state().lastRecall,null);
});

test('home screen never restores global history or opens an old completed chat',async()=>{
    let calls=0;
    const controller=createServerController({local:{},enabled:()=>true,context:()=>({key:''}),call:async route=>{
        calls++;if(route==='/jobs/list')return [{id:'old',chatKey:'old-chat',kind:'index',status:'completed'}];
        throw Object.assign(Error('ENOENT: old imported chat no longer exists'),{code:'ENOENT'});
    },sync:async()=>assert.fail('must not sync on home screen')});
    await controller.restore(true);await controller.restore(true);
    assert.equal(calls,0);assert.deepEqual(controller.jobs(),[]);assert.equal(controller.state().busy,false);
});
test('restore only opens completed jobs belonging to the currently selected chat',async()=>{
    const gets=[],synced=[];
    const jobs=[{id:'mine',chatKey:'chat',kind:'index',status:'completed'},{id:'old',chatKey:'old-chat',kind:'index',status:'completed'}];
    const controller=createServerController({local:{},enabled:()=>true,context:()=>({key:'chat'}),call:async(route,body)=>{
        if(route==='/jobs/list')return jobs;gets.push(body.id);return jobs.find(j=>j.id===body.id);
    },sync:async job=>synced.push(job.id)});
    await controller.restore(true);assert.deepEqual(gets,['mine']);assert.deepEqual(synced,['mine']);assert.deepEqual(controller.jobs().map(j=>j.id),['mine']);
});
test('completed job with a missing source chat is not synchronized or repeatedly reopened',async()=>{
    let gets=0,syncs=0;const job={id:'old',chatKey:'chat',kind:'collect',status:'completed'};
    const controller=createServerController({local:{},enabled:()=>true,context:()=>({key:'chat'}),call:async route=>{
        if(route==='/jobs/list')return [job];gets++;return {...job,sourceChatMissing:true,hidden:[]};
    },sync:async()=>syncs++});
    await controller.restore(true);await controller.restore(true);
    assert.equal(gets,1);assert.equal(syncs,0);
});

test('hot vectors are bounded in browser memory and evictions reload from server without embedding',async()=>{
    const disk=new Map(),reads=[];let localReads=0;
    const store=serverVectorStore({enabled:()=>true,local:{get:async()=>{localReads++;return null;}},call:async(route,{key,vector})=>{
        if(route==='/vectors/put'){disk.set(key,vector);return {ok:true};}
        reads.push(key);return {vector:disk.get(key)};
    }});
    for(let i=0;i<140;i++)await store.put('key'+i,[i,1]);
    assert.deepEqual(await store.get('key139'),[139,1]);assert.equal(reads.length,0);
    assert.deepEqual(await store.get('key0'),[0,1]);assert.deepEqual(reads,['key0']);assert.equal(localReads,0);
    store.clear();assert.deepEqual(await store.get('key139'),[139,1]);assert.equal(disk.size,140);
});

test('server client rejects a result from side search exclusions changed after submission',async()=>{
    let settings={excludedSidePromptKeys:[]};const messages=[{is_user:true,mes:'Remember?'}];
    const controller=createServerController({local:{},enabled:()=>true,settings:()=>settings,context:()=>({key:'chat',messages}),
        input:async()=>({settings:structuredClone(settings),context:{messages}}),sync:async()=>{},countTokens:async()=>1,
        call:async route=>{if(route==='/jobs/list')return [];if(route==='/jobs')return {id:'job',status:'queued'};settings={excludedSidePromptKeys:['private']};return {id:'job',kind:'recall',status:'completed',result:{lastRecall:{units:[],records:[]}}};}});
    await assert.rejects(controller.recall(),/설정이 바뀌/);assert.equal(controller.state().lastRecall,null);
});

test('server client rejects a result after generous recall is toggled',async()=>{
    let settings={generousRecall:false};const messages=[{is_user:true,mes:'Remember?'}];
    const controller=createServerController({local:{},enabled:()=>true,settings:()=>settings,context:()=>({key:'chat',messages}),
        input:async()=>({settings:structuredClone(settings),context:{messages}}),sync:async()=>{},countTokens:async()=>1,
        call:async route=>{if(route==='/jobs/list')return [];if(route==='/jobs')return {id:'job',status:'queued'};settings={generousRecall:true};return {id:'job',kind:'recall',status:'completed',result:{lastRecall:{units:[],records:[]}}};}});
    await assert.rejects(controller.recall(),/설정이 바뀌/);assert.equal(controller.state().lastRecall,null);
});
