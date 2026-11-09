// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics, redact } from './lore-diagnostics.js';
import { linkedTranslation, managerSourceHash } from './lore-translations.js';
import { embed, embeddingRequest } from './lore-api.js';
import { normalizeSettings } from './lore-core.js';

test('diagnostic TXT persists ordered stages, separates chats/modes and removes keys',async()=>{
    const rows=new Map(), store={put:async r=>rows.set(r.id,structuredClone(r)),list:async key=>[...rows.values()].filter(r=>r.chatKey===key)};
    const diagnostics=createDiagnostics({store,secrets:()=>['test-secret-key']});
    const trace=diagnostics.begin({kind:'generation',chatKey:'a',mode:'questions'});
    await trace.event('ai.request',{data:'recent dialogue',embeddingKey:'test-secret-key'});
    await trace.event('ai.response',{text:'echo test-secret-key',authorization:'Bearer hello'});
    await trace.finish('success');await trace.event('injection.installed',{text:'original memory'});
    const other=diagnostics.begin({kind:'generation',chatKey:'b',mode:'dialogue'});await other.finish('error');
    const reopened=createDiagnostics({store});
    const exported=await reopened.export('a','questions');
    assert(exported.includes('original memory'));assert(!exported.includes('test-secret-key'));assert(!exported.includes('Bearer hello'));
    assert.equal((await reopened.list('a')).length,1);assert((await reopened.export('a','dialogue')).includes('"runs": 0'));
    assert(exported.indexOf('ai.request')<exported.indexOf('ai.response'));
});
test('failed diagnostic storage retains an exportable in-memory copy and warns',async()=>{
    const warnings=[];const d=createDiagnostics({store:{put:async()=>{throw Error('quota');},list:async()=>{throw Error('quota');}},warning:t=>warnings.push(t)});
    const t=d.begin({chatKey:'x',kind:'collection'});await t.event('saved',{text:'keep all'});await t.finish('success');
    assert((await d.export('x')).includes('keep all'));assert.equal(warnings.length,1);
    assert.equal(redact({url:'https://example.test?key=secret',password:'hidden'}).password,'[REDACTED]');
});
test('successfully persisted diagnostics are read back from the store, without retaining old full snapshots',async()=>{
    const rows=new Map();const d=createDiagnostics({store:{put:async r=>rows.set(r.id,r),list:async()=>[...rows.values()]}});
    const trace=d.begin({chatKey:'chat'});await trace.event('large',{text:'saved'});await trace.finish('success');
    const persisted=rows.get(trace.id);assert.equal((await d.list('chat'))[0],persisted);
    rows.clear();assert.deepEqual(await d.list('chat'),[]);
});
test('translation bridge uses exact book and UID, marks stale text, and never mutates manager records',()=>{
    const entry={uid:1,content:'Hello'},record={language:'Korean',text:'안녕',sourceHash:managerSourceHash('Hello')};
    const settings={'simple-lorebook':{translations:{'A␟1':record}}};const before=JSON.stringify(settings);
    assert.equal(linkedTranslation(settings,'A',entry).stale,false);
    assert.equal(linkedTranslation(settings,'B',entry),null);
    assert.equal(linkedTranslation(settings,'A',{...entry,content:'Changed'}).stale,true);
    assert.equal(JSON.stringify(settings),before);
});
test('Vertex embedding uses project/location routing, isolated keys and its prediction response',async()=>{
    const config=normalizeSettings({embeddingProvider:'vertex',embeddingVertexProjectId:'my-project',embeddingKeys:{vertex:'vertex-key',gemini:'studio-key'}});
    const spec=embeddingRequest(config,'text',true);
    assert.equal(spec.url,'https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/publishers/google/models/gemini-embedding-001:predict');
    assert.equal(spec.headers['x-goog-api-key'],'vertex-key');assert(!spec.url.includes('vertex-key'));
    assert.equal(spec.body.instances[0].task_type,'RETRIEVAL_QUERY');assert.equal(spec.body.parameters.outputDimensionality,768);assert.equal(spec.body.parameters.autoTruncate,false);
    assert.equal(new URL(embeddingRequest({...config,embeddingVertexRegion:'us-central1'},'text').url).hostname,'us-central1-aiplatform.googleapis.com');
    const vector=await embed(config,'text',false,undefined,async(url,options)=>{assert.equal(url,spec.url);assert.equal(JSON.parse(options.body).instances[0].task_type,'RETRIEVAL_DOCUMENT');return {ok:true,json:async()=>({predictions:[{embeddings:{values:[1,2,3]}}]})};});
    assert.deepEqual(vector,[1,2,3]);assert.equal(embeddingRequest({...config,embeddingProvider:'gemini'},'text').headers['x-goog-api-key'],'studio-key');
    assert.throws(()=>embeddingRequest({...config,embeddingVertexProjectId:''},'text'),/프로젝트 ID/);
    assert.throws(()=>embeddingRequest({...config,embeddingVertexRegion:'evil.example/path'},'text'),/리전/);
});
test('embedding failures expose provider status and redact the entered credential',async()=>{
    const config=normalizeSettings({embeddingKeys:{gemini:'private-fixture-key'}});
    await assert.rejects(embed(config,'test',false,undefined,async()=>({ok:false,status:403,text:async()=>JSON.stringify({error:{message:'API key private-fixture-key is restricted'}})})),e=>e.message.includes('403')&&e.message.includes('restricted')&&!e.message.includes('private-fixture-key'));
});
