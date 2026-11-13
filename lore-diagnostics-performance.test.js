// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostics} from './lore-diagnostics.js';
import {observer} from './lore-telemetry.js';
import {captureTransport} from './server/connection-test.js';
test('interleaved operations share exactly ten stages and evicted operations cannot restore old events',async()=>{
    const d=createDiagnostics(),a=d.begin({chatKey:'a'}),b=d.begin({chatKey:'b'});
    for(let i=0;i<15;i++)await (i%2?a:b).event('step-'+i,{elapsedMs:i});
    let events=(await d.list()).flatMap(r=>r.events);assert.equal(events.length,10);assert(!events.some(e=>e.stage==='step-4'));
    await a.finish('error',{message:'latest failure'});events=(await d.list()).flatMap(r=>r.events);assert.equal(events.length,10);assert(!events.some(e=>e.stage==='step-5'));
    assert((await d.preview()).includes('latest failure'));
});
test('diagnostic source does not enumerate or clone a large content array',async()=>{
    const forbidden=new Proxy([],{get(){throw Error('body array accessed');}}),events=[];
    const log=observer((stage,data)=>events.push({stage,data}));
    await log('request',{body:{model:'model',messages:forbidden},vectors:forbidden,memories:forbidden});
    assert.equal(events.length,1);assert.equal(events[0].data['body.model'],'model');assert(!JSON.stringify(events).includes('messages'));
});
test('nested provider status/errors survive multiple diagnostic boundaries with secrets masked',async()=>{
    const d=createDiagnostics({secrets:()=>['private-key']}),t=d.begin({chatKey:'chat'});
    const log=observer(observer((stage,data)=>t.event(stage,data),['private-key']),['private-key']);
    await log('error',{status:429,response:{error:{code:'RESOURCE_EXHAUSTED',message:'quota private-key'}},body:{messages:[{content:'private story'}]}});
    const text=await d.preview();assert(text.includes('RESOURCE_EXHAUSTED'));assert(text.includes('429'));assert(text.includes('quota [REDACTED]'));assert(!text.includes('private story'));assert(!text.includes('private-key'));
});
test('turning debug off stops recording for an in-progress operation',async()=>{
    let enabled=true;const d=createDiagnostics({detailed:()=>enabled}),t=d.begin();await t.event('before');enabled=false;await t.event('after');await t.finish('error');
    assert.equal((await d.list())[0].events.length,1);assert(!(await d.preview()).includes('after'));
});
test('server probe records metadata only and caps ephemeral stages at ten',async()=>{
    const result=await captureTransport(async log=>{for(let i=0;i<15;i++)await log('step-'+i,{model:'model',response:'private body',vectors:[1,2,3]});return 'actual reply';},{detailed:true});
    assert.equal(result.result,'actual reply');assert.equal(result.events.length,10);assert.equal(result.events[0].stage,'step-5');assert(!JSON.stringify(result.events).includes('private body'));
});
