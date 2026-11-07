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
    const missing=createServerClient({headers:()=>({}),request:async()=>({status:404})});await assert.rejects(missing('/status'),/플러그인이 없어/);
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
