// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings,selectedUnits,fitInjection,formatInjection,embeddingChunks,reviewUnits} from './lore-core.js';
import {parseGenerousSelections} from './lore-generous-recall.js';
import {reviewCandidates,reviewBatches} from './lore-retrieval.js';
import {SELECT_PROMPT,PREVIOUS_BACKGROUND_SELECT} from './lore-prompts.js';
import {createLoreController} from './lore-controller.js';

test('revision 8 upgrades the exact built-in default without modifying customized rules or budgets',()=>{
    const old={promptRevision:7,prompts:{select:PREVIOUS_BACKGROUND_SELECT,questions:'My questions',collect:'My collector'},injectionTokens:4200,candidateCount:7};
    const before=structuredClone(old),next=normalizeSettings(old);
    assert.equal(next.prompts.select,SELECT_PROMPT);assert.equal(next.prompts.questions,'My questions');
    assert.equal(next.injectionTokens,4200);assert.equal(next.candidateCount,7);assert.deepEqual(old,before);
    const custom='Only memories involving this named character. '+PREVIOUS_BACKGROUND_SELECT;
    assert.equal(normalizeSettings({...old,prompts:{select:custom}}).prompts.select,custom);
});
for(const [name,parse] of [['normal',selectedUnits],['generous',parseGenerousSelections]])test(`${name}: a meaningful background event survives alone with more than eight linked context units`,async()=>{
    const units=Array.from({length:13},(_,index)=>({id:'u'+index,entryId:'day',index,title:'Monday',text:`Source event detail ${index}.`}));
    const selection=parse(JSON.stringify({selections:[{id:'u0',priority:2,reason:'Explains the present hesitation',contextIds:units.slice(1).map(u=>u.id)}]}),units);
    const result=await fitInjection(selection,10000,t=>t.length);
    for(const unit of units)assert(result.text.includes(unit.text));
    assert.equal(result.units.length,13);
    const tight=formatInjection(units.slice(0,12)).length;
    assert.equal((await fitInjection(selection,tight,t=>t.length)).text,'');
    assert.equal((await fitInjection(JSON.parse(JSON.stringify(result.units)),tight,t=>t.length)).text,'');
    assert.throws(()=>parse(JSON.stringify({selections:[{id:'u0',priority:2,reason:'Context',contextIds:Array(33).fill('u1')}]}),units),/연결 문장/);
});
test('a smaller lower-priority event can fit without stripping a larger event of its outcome',async()=>{
    const context={id:'end',entryId:'a',index:1,title:'A',text:'Receipt and conditions. '.repeat(50)};
    const event={id:'start',entryId:'a',index:0,title:'A',text:'An important beginning.',priority:3,requiredContext:[context]};
    const background={id:'b',entryId:'b',index:0,title:'B',text:'A related preference with its recorded reason.',priority:2,selectionFormat:'ranked'};
    const fitted=await fitInjection([event,background],formatInjection([background]).length,t=>t.length);
    assert(fitted.text.includes(background.text));assert(!fitted.text.includes(event.text));
});
for(const generousRecall of [false,true])test(`controller reviews a retrieved entry's distant unindexed ending without embedding it, generous=${generousRecall}`,async()=>{
    const content=['Morgan borrowed Lee\'s practice coat.',...Array.from({length:24},(_,i)=>`During the same visit, recorded circumstance ${i} explained their reaction. `+'Specific contextual detail. '.repeat(15)), 'Lee accepted the hanger and put the coat back in his own locker.'].join('\n');
    const entry={uid:0,comment:'Visit',content},pool=embeddingChunks(entry);assert(pool.length>4);
    const book={entries:{0:entry,1:{uid:1,comment:'Other',content:'UNRELATED_PRIVATE_SCENE'},2:{uid:2,disable:true,content:'DISABLED_PRIVATE_SCENE'}}};
    const before=structuredClone(book),messages=[{name:'M',is_user:true,mes:'Remember that visit?'}],cache=new Map();
    const config=normalizeSettings({mode:'dialogue',generousRecall,candidateCount:1,injectionTokens:3000});let documents=0,requests=0;
    const host={settings:()=>config,context:()=>({key:'test',messages}),books:()=>['book'],target:()=>'',loadBook:async()=>structuredClone(book),
        store:{get:async key=>cache.get(key),put:async(key,v)=>cache.set(key,v)},
        embed:async(_c,_text,query)=>{if(!query)documents++;return [1,0];},countTokens:t=>Math.ceil(t.length/4),
        ask:async(_p,system,data)=>{requests++;assert(system.includes('CONTEXT-COMPLETE EVENT SELECTION'));assert(!JSON.stringify(data).includes('PRIVATE_SCENE'));
            const ending=data.memories.find(m=>m.text.includes('accepted the hanger'));
            const start=data.memories.find(m=>m.text.includes('borrowed'));
            return JSON.stringify({selections:ending?[{id:ending.id,priority:2,reason:'The received coat explains current status',contextIds:start?[start.id]:[]}]:[]});},changed:()=>{}};
    const controller=createLoreController(host);await controller.index();const indexed=documents;
    // Keep only the original first chunk's vector. The ending remains saved source.
    const keys=[...cache.keys()];for(const key of keys.slice(1))cache.delete(key);
    const result=await controller.recall();
    assert(result.text.includes('accepted the hanger'));assert(documents===indexed);assert.deepEqual(book,before);assert(result.tokens<=3000);
    assert(requests>=1);assert(controller.state().lastRecall.pending>0);
});
test('full-entry review is deduplicated, preserves source order, and remains batched',()=>{
    const chunks=Array.from({length:20},(_,index)=>({id:'a',index,title:'Event',units:[{index,text:'Context '.repeat(80)}]}));
    const other={id:'b',index:0,units:[{index:0,text:'Excluded unrelated entry'}]};
    const expanded=reviewCandidates([chunks[4],chunks[19]],chunks.concat(other));assert.equal(expanded.length,20);
    assert.deepEqual(expanded.map(c=>c.index),chunks.map(c=>c.index));
    const units=reviewUnits(expanded),batches=reviewBatches(units,1000);assert(batches.length>1);
    assert.equal(new Set(batches.flat().map(u=>u.id)).size,units.length);
});
