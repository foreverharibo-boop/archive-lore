// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { generousRecall, parseGenerousReviews } from './lore-generous-recall.js';
import { normalizeSettings, formatInjection } from './lore-core.js';
import { fitFocusedInjection } from './lore-focus-injection.js';

const unit=(id,index=0,entryId='entry')=>({id,entryId,index,title:'Memory',text:`Source fact ${id}.`});
const accept=memories=>JSON.stringify({reviews:memories.map(m=>({id:m.id,priority:2,reason:'Recorded preference relevant to the outing.',contextIds:[]}))});
const chunk=(id,text='Relevant background. ')=>( {id,index:0,book:'book',title:'Memory',units:[{index:0,text}]} );
function fixture(count=4,patch={}){
    const chunks=Array.from({length:count},(_,i)=>chunk('entry'+i,('Related detail '+i+' ').repeat(5)));
    const calls=[],events=[];
    return {chunks,calls,events,options:{candidates:chunks.slice(0,1),expandedCandidates:chunks,chunks,
        config:normalizeSettings({generousRecall:true,injectionTokens:3000,...patch}),latestUser:'An outing',dialogue:'An outing',questions:[],
        ask:async(system,data)=>{calls.push({system,data});return accept(data.memories);},countTokens:async text=>Math.ceil(text.length/4),
        signal:new AbortController().signal,log:async(stage,data)=>events.push({stage,data})}};
}

test('generous mode is opt-in and does not treat string false as enabled',()=>{
    assert.equal(normalizeSettings().generousRecall,false);
    assert.equal(normalizeSettings({generousRecall:'false'}).generousRecall,false);
    assert.equal(normalizeSettings({generousRecall:true}).generousRecall,true);
});
test('every unit needs a unique valid decision; omissions and ungrounded duplicates fail closed',()=>{
    const units=[unit('u0'),unit('u1')];
    assert.throws(()=>parseGenerousReviews('{"reviews":[]}',units),/빠졌/);
    assert.throws(()=>parseGenerousReviews(accept([units[0],units[0]]),units),/형식/);
    assert.throws(()=>parseGenerousReviews(accept([units[0],unit('unknown')]),units),/형식/);
    assert.throws(()=>parseGenerousReviews(JSON.stringify({reviews:[{id:'u0',priority:2,reason:'related'},{id:'u1',priority:0,reason:'not essential',exclusion:'unnecessary'}]}),units),/제외 이유/);
    assert.throws(()=>parseGenerousReviews(JSON.stringify({reviews:[{id:'u0',priority:0,reason:'unrelated',exclusion:'unrelated'},{id:'u1',priority:0,reason:'duplicate',exclusion:'duplicate',duplicateOf:'u0'}]}),units),/중복/);
});
test('related background survives without any essential fact and is not limited to 24 sentences',async()=>{
    const units=Array.from({length:30},(_,i)=>unit('u'+i,i));
    const result=parseGenerousReviews(accept(units),units);
    assert.equal(result.selected.length,30);
    const fitted=await fitFocusedInjection(result.selected,normalizeSettings({generousRecall:true,injectionTokens:3000}));
    assert.equal(fitted.units.length,30);assert(fitted.tokens<=3000);
    for(const original of units)assert(fitted.text.includes(original.text));
});
test('same-entry attribution dependencies stay atomic and unknown/cross-entry IDs are rejected',async()=>{
    const units=[unit('u0',0),unit('u1',1),unit('u2',0,'other')];
    const rows=[{id:'u0',priority:2,reason:'related',contextIds:['u1']},{id:'u1',priority:2,reason:'owner context',contextIds:['u0']},{id:'u2',priority:0,reason:'different topic',exclusion:'unrelated'}];
    const parsed=parseGenerousReviews(JSON.stringify({reviews:rows}),units);
    const one=await fitFocusedInjection(parsed.selected,{injectionTokens:formatInjection([units[0]]).length,selectionFocus:[]},text=>text.length);
    assert.equal(one.units.length,0);
    rows[0].contextIds=['u2'];assert.throws(()=>parseGenerousReviews(JSON.stringify({reviews:rows}),units),/연결 문장/);
});
test('below 90 percent widens once; all related originals are packed without rewriting',async()=>{
    const f=fixture();const result=await generousRecall(f.options);
    assert.equal(f.calls.length,2);assert.equal(result.fill.expanded,true);assert.equal(result.fill.targetTokens,2700);
    assert.equal(result.candidateTotal,4);assert.equal(result.fill.related,4);assert.equal(result.units.length,4);
    assert(result.tokens<2700);assert.equal(result.fill.status,'related-pool-or-fit-limit');
    assert.deepEqual(new Set(f.calls[1].data.memories.map(m=>m.text)),new Set(f.chunks.slice(1).map(c=>c.units[0].text)));
    assert(f.events.some(e=>e.stage==='selection.validated'&&e.data.reviews.length));
});
test('at least 90 percent skips the extra pass, while final tokens never exceed the cap',async()=>{
    const f=fixture(3,{injectionTokens:256});f.chunks[0].units[0].text='x'.repeat(870);
    const result=await generousRecall(f.options);
    assert(result.tokens>=231 && result.tokens<=256);assert.equal(f.calls.length,1);assert.equal(result.fill.expanded,false);
});
test('unrelated memories are not padding and fully reviewed empty output is valid',async()=>{
    const f=fixture();f.options.ask=async(_system,data)=>{
        f.calls.push(data);return JSON.stringify({reviews:data.memories.map(m=>({id:m.id,priority:0,exclusion:'unrelated',reason:'No link to the outing.'}))});
    };
    const result=await generousRecall(f.options);
    assert.equal(result.text,'');assert.equal(result.fill.status,'no-related-units');assert.equal(result.fill.excluded,4);assert.equal(f.calls.length,2);
});
test('a missing review is retried once but network errors are never retried',async()=>{
    const f=fixture(1);let calls=0;
    f.options.ask=async()=>{calls++;return '{"reviews":[]}';};
    await assert.rejects(generousRecall(f.options),/빠졌/);assert.equal(calls,2);
    calls=0;f.options.ask=async()=>{calls++;throw Error('provider failed');};
    await assert.rejects(generousRecall(f.options),/provider failed/);assert.equal(calls,1);
});
test('expansion is capped at 40 candidates and dense short records use bounded output batches',async()=>{
    const f=fixture(60);const result=await generousRecall(f.options);assert.equal(result.candidateTotal,40);
    assert.equal(result.fill.reviewed,40);assert(result.tokens<=3000);
    const g=fixture(1);g.chunks[0].units=Array.from({length:140},(_,i)=>({index:i,text:'Fact '+i+'.'}));
    const dense=await generousRecall(g.options);
    assert(g.calls.every(call=>call.data.memories.length<=48));assert.equal(dense.fill.reviewed,140);
    assert.equal(dense.fill.related,140);assert.equal(dense.units.length,140);
});
test('cancellation after the first pass prevents expansion and preserves the abort',async()=>{
    const f=fixture(),abort=new AbortController();f.options.signal=abort.signal;
    f.options.ask=async(_system,data)=>{abort.abort();return accept(data.memories);};
    await assert.rejects(generousRecall(f.options),{name:'AbortError'});
});

test('overlapping review batches cannot silently veto already accepted related context',async()=>{
    const f=fixture(1),reviewed=new Set();f.chunks[0].units=Array.from({length:70},(_,i)=>({index:i,text:'Fact '+i+'.'}));
    f.options.ask=async(_system,data)=>JSON.stringify({reviews:data.memories.map(m=>{
        if(reviewed.has(m.id))return {id:m.id,priority:0,exclusion:'ambiguous',reason:'Narrower overlap lacks previous attribution.'};
        reviewed.add(m.id);return {id:m.id,priority:2,reason:'Connected original event detail.',contextIds:[]};
    })});
    const result=await generousRecall(f.options);assert.equal(result.fill.related,70);assert.equal(result.units.length,70);
});
