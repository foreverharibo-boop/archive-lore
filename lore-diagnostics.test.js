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
test('translation bridge uses exact book and UID, marks stale text, and never mutates manager records',()=>{
    const entry={uid:1,content:'Hello'},record={language:'Korean',text:'안녕',sourceHash:managerSourceHash('Hello')};
    const settings={'simple-lorebook':{translations:{'A␟1':record}}};const before=JSON.stringify(settings);
    assert.equal(linkedTranslation(settings,'A',entry).stale,false);
    assert.equal(linkedTranslation(settings,'B',entry),null);
    assert.equal(linkedTranslation(settings,'A',{...entry,content:'Changed'}).stale,true);
    assert.equal(JSON.stringify(settings),before);
});
test('Vertex Express is rejected before network access and AI Studio uses its own preserved key',async()=>{
    const settings=normalizeSettings({embeddingProvider:'vertex',embeddingKey:'old-key',embeddingKeys:{vertex:'vertex-key',gemini:'studio-key'}});
    assert.throws(()=>embeddingRequest(settings,'text',true),/Express.*지원 목록/);
    let calls=0;await assert.rejects(embed(settings,'text',false,undefined,async()=>{calls++;}),/Express/);assert.equal(calls,0);
    assert.equal(embeddingRequest({...settings,embeddingProvider:'gemini'},'text').headers['x-goog-api-key'],'studio-key');
});
test('embedding failures expose provider status and redact the entered credential',async()=>{
    const config=normalizeSettings({embeddingKeys:{gemini:'private-fixture-key'}});
    await assert.rejects(embed(config,'test',false,undefined,async()=>({ok:false,status:403,text:async()=>JSON.stringify({error:{message:'API key private-fixture-key is restricted'}})})),e=>e.message.includes('403')&&e.message.includes('restricted')&&!e.message.includes('private-fixture-key'));
});
