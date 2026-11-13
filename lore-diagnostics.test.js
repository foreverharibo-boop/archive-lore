// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics, redact } from './lore-diagnostics.js';
import { linkedTranslation, managerSourceHash } from './lore-translations.js';
import { embed, embeddingRequest } from './lore-api.js';
import { normalizeSettings } from './lore-core.js';

test('diagnostics stay only in session memory and never access legacy stores',async()=>{
    const store={put:()=>assert.fail('no disk writes'),list:()=>assert.fail('no disk reads')};
    const d=createDiagnostics({store,secrets:()=>['private-key']});const t=d.begin({chatKey:'a'});
    await t.event('ai.error',{message:'denied private-key',status:403,body:{messages:[{content:'PRIVATE DIALOGUE'}]}});await t.finish('error');
    const text=await d.export();assert(text.includes('denied [REDACTED]'));assert(!text.includes('PRIVATE DIALOGUE'));
    assert.equal(await d.preview(),text);assert.equal((await createDiagnostics({store}).list()).length,0);
});
test('callers cannot mutate the diagnostic ring through list results',async()=>{
    const d=createDiagnostics(),t=d.begin({chatKey:'a'});await t.event('error',{message:'original'});
    const rows=await d.list();rows[0].events[0].data.message='changed';rows[0].events.push({});
    assert.equal((await d.list())[0].events.length,1);assert((await d.preview()).includes('original'));
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
