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

test('diagnostics retain only metadata even when debug is enabled',async()=>{
    const d=createDiagnostics({detailed:()=>true,secrets:()=>['private-test-key']}),t=d.begin({chatKey:'chat'});
    await t.event('request',{system:'secret prompt',body:{messages:[{content:'private dialogue'}],model:'example'},elapsedMs:12});
    await t.event('response',{response:'x'.repeat(5*1024*1024),vectors:[1,2,3]});
    await t.finish('error',{message:'Invalid request private-test-key'});
    const text=await d.export();assert(text.includes('example'));assert(text.includes('Invalid request [REDACTED]'));
    assert(!text.includes('private dialogue'));assert(!text.includes('secret prompt'));assert(text.length<3000);
});
test('one ring covers every chat and operation, including errors',async()=>{
    const d=createDiagnostics();for(let i=0;i<25;i++){const t=d.begin({chatKey:'chat'+i});await t.finish('error',{message:'error '+i});}
    const rows=await d.list();assert.equal(rows.reduce((n,r)=>n+r.events.length,0),10);assert.equal(rows.length,10);
    assert.equal((await d.list('chat0')).length,0);assert((await d.preview()).includes('error 24'));d.clear();assert.deepEqual(await d.list(),[]);
});
