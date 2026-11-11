// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackgroundRecall} from './lore-background.js';
import {reserveReplySlots,replaceReplySlots} from './lore-reply-slots.js';
import {normalizeSettings} from './lore-core.js';
import {mapOrdered} from './lore-parallel.js';
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
test('two batches run together but retain input order and every candidate',async()=>{
    const gates=[gate(),gate(),gate()],entered=[];let active=0,max=0;
    const work=mapOrdered([0,1,2],2,async(_,i)=>{entered.push(i);max=Math.max(max,++active);await gates[i].promise;active--;return i;});
    await tick();assert.deepEqual(entered,[0,1]);gates[1].resolve();await tick();assert.deepEqual(entered,[0,1,2]);
    gates[2].resolve();gates[0].resolve();assert.deepEqual(await work,[0,1,2]);assert.equal(max,2);
});
test('failed parallel batch aborts sibling, launches no later batch, and drains before returning',async()=>{
    let sibling=false,later=false;
    await assert.rejects(mapOrdered([0,1,2],2,async(_,i,signal)=>{
        if(i===0){await tick();throw Error('failed');}
        if(i===2)later=true;
        await new Promise(resolve=>signal.addEventListener('abort',()=>{sibling=true;resolve();},{once:true}));
    }),/failed/);assert(sibling);assert(!later);
});
test('public defaults make no server or relay probes and retain sequential selection',async()=>{
    const config=normalizeSettings();assert.equal(config.relayEnabled,false);assert.equal(config.selectionConcurrency,1);
    const background=createBackgroundRecall({settings:()=>config,call:()=>assert.fail(),relay:()=>assert.fail()});
    assert.equal(await background.prepare('normal'),null);
    const disabled=createBackgroundRecall({settings:()=>({...config,relayEnabled:true,serverEnabled:false}),relay:()=>assert.fail()});
    assert.equal(await disabled.prepare('normal'),null);
});
test('slot replacement preserves presets and separates memory/guidance; rejects missing/duplicate slots',async()=>{
    const id='a'.repeat(32),slots=await reserveReplySlots(id,256,t=>t.length);
    const payload={temperature:.8,messages:[{role:'system',content:'Preset\n'+slots.text},{role:'system',content:slots.guidance},{role:'user',content:'Hello'}]};
    const output=replaceReplySlots(payload,id,{memory:'Exact memory',guidance:'Exact guidance'});
    assert.equal(output.messages[0].content,'Preset\nExact memory');assert.equal(output.messages[1].content,'Exact guidance');assert.equal(output.temperature,.8);
    assert.equal(payload.messages[1].content,slots.guidance);
    assert.throws(()=>replaceReplySlots({...payload,messages:payload.messages.slice(1)},id,{}));
    assert.throws(()=>replaceReplySlots({...payload,messages:[...payload.messages,payload.messages[0]]},id,{}));
});
function fixture(){
    const context={key:'chat',messages:[{mes:'Hello',is_user:true}]},calls=[];
    const config=normalizeSettings({serverEnabled:true,relayEnabled:true});
    const host={settings:()=>config,context:()=>context,relay:()=>({supports:async()=>true,enabled:()=>true}),supported:()=>true,
        tokenizer:async()=> 'gemma',countTokens:async t=>t.length,
        input:async(_,options)=>({context:structuredClone(context),settings:config,books:['Book'],options}),
        call:async(route,data)=>{calls.push({route,data});if(route==='/reply/prepare')return {ticket:data.ticket,core:'Core'};return {};},accept(){}};
    return {host,context,calls,background:createBackgroundRecall(host)};
}
test('only native final message objects receive metadata; changed messages prevent handoff',async()=>{
    const f=fixture(),slots=await f.background.prepare('normal');
    assert.equal(slots.core,'Core');assert(!f.calls.some(c=>c.route==='/jobs'));
    const prompt=[{role:'system',content:slots.text},{role:'system',content:slots.guidance}];
    f.background.capture({prompt});
    const helper={messages:[{role:'user',content:'Unrelated helper'}]};f.background.attach(helper);assert(!helper.__silly_relay_prepare);
    const cloned={messages:structuredClone(prompt)};
    assert.throws(()=>f.background.attach(cloned),/답장 연결/);
    assert.equal(cloned.__silly_relay_prepare.ticket,'','a swallowed host-event error still leaves a blocked ticket');
    const request={messages:prompt.filter(Boolean)};f.background.attach(request);assert.equal(request.__silly_relay_prepare.provider,'archive-lore');
    f.context.messages.push({mes:'Changed',is_user:true});assert.throws(()=>f.background.attach(request));
});
test('stop during capability check cannot leave a late ticket or affect a new attempt',async()=>{
    const f=fixture(),hold=gate();f.host.relay=()=>({supports:()=>hold.promise});
    const run=f.background.prepare('normal'),rejected=assert.rejects(run,e=>e.name==='AbortError');
    f.background.cancel();hold.resolve(true);await rejected;
    assert(!f.calls.some(c=>c.route==='/reply/prepare'));
});
test('unsupported group/keyword mode uses existing recall instead of partial background handling',async()=>{
    const f=fixture();f.host.supported=()=>false;f.host.relay=()=>assert.fail();
    assert.equal(await f.background.prepare('normal'),null);
});
