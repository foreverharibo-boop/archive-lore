// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostics} from './lore-diagnostics.js';
import {expiredHistory,HISTORY_AGE_MS} from './lore-retention.js';
import {normalizeSettings} from './lore-core.js';

test('retention reserves active work and expires older count, age and byte overflow',()=>{
    const now=Date.now(),rows=Array.from({length:25},(_,id)=>({id,time:now-id,bytes:10}));
    rows.push({id:'active',time:0,bytes:10,protected:true},{id:'expired',time:now-HISTORY_AGE_MS-1,bytes:1});
    const removed=expiredHistory(rows,{now,maxBytes:100});
    assert(!removed.some(r=>r.id==='active'));assert(removed.some(r=>r.id==='expired'));
    assert.equal(rows.length-removed.length,10);
    assert.deepEqual(removed.filter(r=>typeof r.id==='number').map(r=>r.id),Array.from({length:16},(_,i)=>i+9));
});

test('default diagnostics retain useful timings and redacted errors but omit dialogue and API bodies',async()=>{
    assert.equal(normalizeSettings().diagnosticsDetailed,false);
    const saved=new Map(),d=createDiagnostics({store:{put:async r=>saved.set(r.id,r),list:async()=>[...saved.values()]},secrets:()=>['private-test-key']});
    const trace=d.begin({kind:'generation',chatKey:'chat'});
    await trace.event('ai.request',{system:'secret prompt',data:{dialogue:'private dialogue',memories:[{text:'private memory'}]},maxTokens:1200});
    await trace.event('server.recall',{text:'private recalled text',timings:{questionMs:12,clientStages:{inputMs:110000}}});
    await trace.finish('error',{message:'Invalid request private-test-key'});
    const exported=await d.export('chat');
    for(const text of ['secret prompt','private dialogue','private memory','private recalled text','private-test-key'])assert(!exported.includes(text));
    assert(exported.includes('110000'));assert(exported.includes('Invalid request [REDACTED]'));
    assert.equal(saved.get(trace.id).detail,'timing');
});

test('full traces opt in per run and stop retaining large bodies at the size limit',async()=>{
    const saved=new Map(),d=createDiagnostics({detailed:()=>true,store:{put:async r=>saved.set(r.id,r),list:async()=>[...saved.values()]}});
    const trace=d.begin({chatKey:'chat'});await trace.event('ai.response',{response:'small exact response'});
    await trace.event('ai.response',{response:'x'.repeat(5*1024*1024),elapsedMs:3});await trace.finish('success');
    const run=saved.get(trace.id);assert.equal(run.detail,'full');assert.equal(run.detailTruncated,true);
    assert.equal(run.events[0].data.response,'small exact response');assert.equal(run.events[1].data.response,undefined);
    assert.equal(run.events[1].data.elapsedMs,3);assert(run.diagnosticBytes<10000);
});

test('failed persistence cannot accumulate unlimited fallback runs',async()=>{
    const d=createDiagnostics({store:{put:async()=>{throw Error('offline');},list:async()=>[]}});
    for(let i=0;i<25;i++){const t=d.begin({chatKey:'chat'});await t.finish('error',{message:'offline'});}
    assert.equal((await d.list('chat')).length,20);
});
