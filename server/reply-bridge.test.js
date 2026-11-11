// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {createReplyBridge} from './reply-bridge.js';
import {reserveReplySlots} from '../lore-reply-slots.js';
const id='a'.repeat(32),user={profile:{handle:'owner'},directories:{root:os.tmpdir()}};
async function fixture(){
    let submitted=0,canceled=0,current='same',status='completed';
    const result={core:'Core',text:'Accurate memory',guidance:'Guidance'};
    const service={replySnapshot:()=>({core:'Core',fingerprint:current}),
        submit:async()=>{submitted++;return {id:'job'};},get:()=>({status,result}),cancel:()=>canceled++};
    const bridge=createReplyBridge({service,countMessages:async(_u,_m,m)=>JSON.stringify(m).length});
    const input={options:{generationType:'normal',replyTokenizer:'gemma'}};
    bridge.prepareInput(user,{ticket:id,input});
    const slots=await reserveReplySlots(id,256,t=>t.length);
    const payload={model:'gemini',temperature:.8,messages:[{role:'system',content:slots.text},{role:'system',content:slots.guidance},{role:'user',content:'Current input'}]};
    return {bridge,input,payload,result,counts:()=>({submitted,canceled}),setCurrent:v=>current=v,setStatus:v=>status=v};
}
test('ticket creation never invokes AI; server replaces slots without changing preset or user text',async()=>{
    const f=await fixture();assert.equal(f.counts().submitted,0);
    const out=await f.bridge.prepare({user,ticket:id,jobId:'relay',payload:f.payload,signal:new AbortController().signal});
    assert.equal(out.temperature,.8);assert.equal(out.messages[0].content,'Accurate memory');assert.equal(out.messages[1].content,'Guidance');assert.equal(out.messages[2].content,'Current input');
    assert.equal(f.counts().submitted,1);
    await assert.rejects(f.bridge.prepare({user,ticket:id,jobId:'another',payload:f.payload,signal:new AbortController().signal}));assert.equal(f.counts().submitted,1);
});
test('other accounts, missing slots and edited sources cannot launch recall',async()=>{
    for(const mode of ['owner','slot','source']){
        const f=await fixture(),other={...user,profile:{handle:'other'}};
        if(mode==='source')f.setCurrent('changed');
        const payload=mode==='slot'?{...f.payload,messages:[]}:f.payload;
        await assert.rejects(f.bridge.prepare({user:mode==='owner'?other:user,ticket:id,jobId:'relay',payload,signal:new AbortController().signal}));
        assert.equal(f.counts().submitted,0);
    }
});
test('cancel-before-prepare tombstone prevents late preparation',async()=>{
    const f=await fixture(),late='b'.repeat(32);f.bridge.cancel(user,late);
    assert.throws(()=>f.bridge.prepareInput(user,{ticket:late,input:f.input}));assert.equal(f.counts().submitted,0);
});
test('relay cancellation reaches running recall and prevents a reply handoff',async()=>{
    const f=await fixture();f.setStatus('running');const abort=new AbortController();
    const result=f.bridge.prepare({user,ticket:id,jobId:'relay',payload:f.payload,signal:abort.signal});
    const rejected=assert.rejects(result);await new Promise(r=>setTimeout(r,5));abort.abort();await rejected;
    assert(f.counts().canceled>0);assert.equal(f.bridge.get(user,id).state,'canceled');
});
test('changed core or oversized final prompt fails rather than omitting memory',async()=>{
    for(const mode of ['core','budget']){
        const f=await fixture();if(mode==='core')f.result.core='Changed';else f.result.text='x'.repeat(10000);
        await assert.rejects(f.bridge.prepare({user,ticket:id,jobId:'relay',payload:f.payload,signal:new AbortController().signal}));
        assert.equal(f.bridge.get(user,id).state,'error');
    }
});
test('explicit review descendants reuse the selected memory without another AI call',async()=>{
    const f=await fixture(),signal=new AbortController().signal;
    await f.bridge.prepare({user,ticket:id,jobId:'original',payload:f.payload,signal});
    f.setCurrent('chat-now-includes-the-answer');
    for(const [jobId,parentJobId] of [['revision-1','original'],['revision-2','revision-1']]){
        const payload=structuredClone(f.payload);payload.messages.push({role:'user',content:'Revise only the last reply.'});
        const result=await f.bridge.prepare({user,ticket:id,jobId,parentJobId,payload,signal});
        assert.equal(result.messages[0].content,'Accurate memory');assert.equal(result.messages.at(-1).content,'Revise only the last reply.');
    }
    assert.equal(f.counts().submitted,1);
    await assert.rejects(f.bridge.prepare({user,ticket:id,jobId:'unrelated',parentJobId:'unknown',payload:f.payload,signal}));
    f.bridge.close();
});
