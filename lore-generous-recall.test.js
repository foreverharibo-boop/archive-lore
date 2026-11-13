// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { generousRecall, parseGenerousSelections } from './lore-generous-recall.js';
import { normalizeSettings, formatInjection, reviewUnits } from './lore-core.js';
import { reviewCandidates, reviewBatches } from './lore-retrieval.js';
import { fitFocusedInjection } from './lore-focus-injection.js';

const unit=(id,index=0,entryId='entry')=>({id,entryId,index,title:'Memory',text:`Source fact ${id}.`});
const accept=memories=>JSON.stringify({selections:memories.map(m=>({id:m.id,priority:2,contextIds:[]}))});
const chunk=(id,text='Relevant background. ')=>( {id,index:0,book:'book',title:'Memory',units:[{index:0,text}]} );
function fixture(count=4,patch={}){
    const chunks=Array.from({length:count},(_,i)=>chunk('entry'+i,('Related detail '+i+' ').repeat(5)));
    const calls=[],events=[];
    return {chunks,calls,events,options:{candidates:chunks.slice(0,1),chunks,
        config:normalizeSettings({generousRecall:true,injectionTokens:3000,...patch}),latestUser:'An outing',dialogue:'An outing',questions:[],
        ask:async(system,data)=>{calls.push({system,data});return accept(data.memories);},countTokens:async text=>Math.ceil(text.length/4),
        signal:new AbortController().signal,log:async(stage,data)=>events.push({stage,data})}};
}

test('generous mode stays opt-in and does not treat string false as enabled',()=>{
    assert.equal(normalizeSettings().generousRecall,false);
    assert.equal(normalizeSettings({generousRecall:'false'}).generousRecall,false);
    assert.equal(normalizeSettings({generousRecall:true}).generousRecall,true);
});
test('selected IDs need no explanation or rejected-unit accounting; invalid source IDs fail closed',()=>{
    const units=[unit('u0'),unit('u1')];
    assert.deepEqual(parseGenerousSelections('{"selections":[]}',units),[]);
    const selected=parseGenerousSelections(accept([units[0]]),units);
    assert.equal(selected.length,1);assert.equal(selected[0].text,units[0].text);assert.equal('reason' in selected[0],false);
    assert.throws(()=>parseGenerousSelections(accept([units[0],units[0]]),units),/형식/);
    assert.throws(()=>parseGenerousSelections(accept([unit('unknown')]),units),/형식/);
    assert.throws(()=>parseGenerousSelections('{"selections":[{"id":"u0","priority":0}]}',units),/형식/);
    assert.throws(()=>parseGenerousSelections('{"reviews":[]}',units),/형식/);
});
test('related background survives without an essential fact and is not limited to 24 sentences',async()=>{
    const units=Array.from({length:30},(_,i)=>unit('u'+i,i));
    const selected=parseGenerousSelections(accept(units),units);
    assert.equal(selected.length,30);
    const fitted=await fitFocusedInjection(selected,normalizeSettings({generousRecall:true,injectionTokens:3000}));
    assert.equal(fitted.units.length,30);assert(fitted.tokens<=3000);
    for(const original of units)assert(fitted.text.includes(original.text));
});
test('same-entry attribution dependencies stay atomic and unknown/cross-entry references are rejected',async()=>{
    const units=[unit('u0',0),unit('u1',1),unit('u2',0,'other')];
    const rows=[{id:'u0',priority:2,contextIds:['u1']},{id:'u1',priority:2,contextIds:['u0']}];
    const parsed=parseGenerousSelections(JSON.stringify({selections:rows}),units);
    const one=await fitFocusedInjection(parsed,{injectionTokens:formatInjection([units[0]]).length,selectionFocus:[]},text=>text.length);
    assert.equal(one.units.length,0);
    for(const contextIds of [['u2'],['unknown']]){
        rows[0].contextIds=contextIds;assert.throws(()=>parseGenerousSelections(JSON.stringify({selections:rows}),units),/연결 문장/);
    }
});
test('unused budget never expands candidates or runs a second pass',async()=>{
    const f=fixture(60);const result=await generousRecall(f.options);
    assert.equal(f.calls.length,1);assert.equal(result.candidateTotal,1);assert.equal(result.units.length,1);
    assert(result.tokens<2700);assert.equal(result.fill,undefined);
    assert.deepEqual(f.calls[0].data.memories.map(m=>m.text),[f.chunks[0].units[0].text]);
    assert.match(f.calls[0].system,/Select related source units generously from the FIRST review/);
    assert.match(f.calls[0].system,/Do NOT output inclusion\/exclusion reasons/);
    const validated=f.events.find(e=>e.stage==='selection.validated').data;
    assert(!('reviews' in validated));assert(!('rejectedOrUnselected' in validated));
});
test('even an empty or partial valid selection costs just the existing review batch',async()=>{
    for(const count of [0,1]){
        const f=fixture();f.options.candidates=f.chunks;
        f.options.ask=async(_system,data)=>{f.calls.push(data);return accept(data.memories.slice(0,count));};
        const result=await generousRecall(f.options);
        assert.equal(f.calls.length,1);assert.equal(result.units.length,count);assert.equal(result.candidateTotal,4);
    }
});
test('final budget remains a hard cap without padding',async()=>{
    const f=fixture(5,{injectionTokens:256});f.options.candidates=f.chunks;
    for(const c of f.chunks)c.units[0].text=c.id+' '+('x'.repeat(650));
    const result=await generousRecall(f.options);
    assert(result.units.length>0 && result.units.length<5);assert(result.tokens<=256);assert.equal(f.calls.length,1);
});
test('malformed selections retry once; transport errors do not retry',async()=>{
    const f=fixture(1);let calls=0;
    f.options.ask=async()=>{calls++;return '{}';};
    await assert.rejects(generousRecall(f.options),/형식/);assert.equal(calls,2);
    calls=0;f.options.ask=async()=>{calls++;throw Error('provider failed');};
    await assert.rejects(generousRecall(f.options),/provider failed/);assert.equal(calls,1);
});
test('dense source units use normal input batching without the former 48-unit restriction',async()=>{
    const f=fixture(1);f.chunks[0].units=Array.from({length:140},(_,i)=>({index:i,text:'Fact '+i+'.'}));
    const normal=reviewBatches(reviewUnits(reviewCandidates(f.options.candidates,f.chunks)));
    const result=await generousRecall(f.options);
    assert.equal(f.calls.length,normal.length);assert(f.calls.some(call=>call.data.memories.length>48));
    assert.equal(result.units.length,140);
});
test('cancellation discards noncooperative late output',async()=>{
    const f=fixture(),abort=new AbortController();f.options.signal=abort.signal;
    f.options.ask=async(_system,data)=>{abort.abort();return accept(data.memories);};
    await assert.rejects(generousRecall(f.options),{name:'AbortError'});
});
test('overlapping normal batches preserve accepted related context when later omitted',async()=>{
    const f=fixture(1),reviewed=new Set();f.chunks[0].units=Array.from({length:100},(_,i)=>({index:i,text:('Fact '+i+' ').repeat(50)}));
    f.options.config.injectionTokens=32000;
    f.options.ask=async(_system,data)=>{f.calls.push(data);return accept(data.memories.filter(m=>{if(reviewed.has(m.id))return false;reviewed.add(m.id);return true;}));};
    const result=await generousRecall(f.options);assert(f.calls.length>1);assert.equal(result.units.length,100);
});
