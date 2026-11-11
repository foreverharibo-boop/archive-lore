// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {profileTemplate,serverVectorStore,createServerClient,createServerController} from './lore-server.js';
import {embeddingKey} from './lore-api.js';
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
        if(route==='/jobs/list'){lists++;await gate;return [{id:'finished',kind:'index',status:'completed'}];}
        if(route==='/jobs/get'){gets++;return {id:'finished',kind:'index',status:'completed'};}
        throw Error(route);
    },sync:async()=>{syncs++;}});
    const requests=Array.from({length:20},()=>controller.restore(true));release();await Promise.all(requests);
    assert.equal(lists,1);assert.equal(gets,1);assert.equal(syncs,1);
    await controller.restore(true);assert.equal(gets,1);assert.equal(syncs,1);
});
