// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {planCollectionUndo,saveCollectionUndo} from './lore-collection-undo.js';
import {buildSidePromptRegenerationSnapshot} from './memoryRegeneration.js';
import {NS,sourceRange} from './lore-core.js';

const messages=Array.from({length:6},(_,i)=>({mes:'message '+i,name:'A',is_system:true}));
const memory=(uid,start,end,chatId='chat')=>({uid,comment:'memory '+uid,content:'Story',stmemorybooks:true,STMB_chatId:chatId,STMB_start:start,STMB_end:end});
function side(uid,prior=null,start=2,end=3) {
    const entry={uid,comment:'Relationship (STMB SidePrompt)',content:'New record',STMB_sp_relationship_lastRunAt:'2026-11-09T12:00:00Z'};
    entry.STMB_sidePromptRegeneration=buildSidePromptRegenerationSnapshot({templateKey:'relationship',priorEntry:prior,priorContent:prior?.content||'',writtenEntry:entry,
        compiledScene:{metadata:{sceneStart:start,sceneEnd:end,chatId:'chat'}}});return entry;
}
const plan=books=>planCollectionUndo(books,{chatId:'chat',messages,checkpoint:3});
test('undo deletes new memory/new side, restores overwritten side and preserves unrelated entries and source books',()=>{
    const prior={uid:2,comment:'Relationship (STMB SidePrompt)',content:'Previous record',disable:true};
    const newSide=side(3);newSide.STMB_sidePromptRegeneration.templateKey='plans';
    const data={entries:{0:memory(0,0,1),1:memory(1,2,3),2:side(2,prior),3:newSide,4:memory(4,2,3,'other'),5:{uid:5,content:'manual'}}};
    const before=structuredClone(data),result=plan([{name:'book',data}]);
    assert.deepEqual(data,before);assert.deepEqual(result.range,{start:2,end:3});assert.equal(result.checkpoint,1);
    const after=result.states[0].data.entries;
    assert(!after[1]);assert(!after[3]);assert.deepEqual(after[2],{...prior,displayIndex:6});
    for(const key of [0,4,5])assert.deepEqual(after[key],data.entries[key]);assert.equal(result.rows.length,3);
});
test('already-saved side-only run is undoable from its existing snapshot',()=>{
    const data={entries:{0:side(0)}};const result=plan([{name:'sidebook',data}]);
    assert.deepEqual(result.states[0].data.entries,{});assert.equal(result.rows[0].action,'삭제');
});
test('modified sides or incomplete legacy snapshots block the whole plan',()=>{
    const data={entries:{0:memory(0,2,3),1:side(1)}};data.entries[1].content='manually edited';
    assert.throws(()=>plan([{name:'book',data}]),/수집 후 수정/);assert(data.entries[0]);
    data.entries[1].STMB_sidePromptRegeneration.version=1;
    assert.throws(()=>plan([{name:'book',data}]),/복원 정보/);
});
test('exact range matching leaves overlapping earlier side runs alone',()=>{
    const older=side(0,null,0,2);older.STMB_sp_relationship_lastRunAt='2026-11-09T10:00:00Z';
    const data={entries:{0:older,1:side(1,null,2,3)}};
    const result=plan([{name:'book',data}]);assert.deepEqual(result.states[0].data.entries[0],older);
});
test('new collection timestamps select a later re-collection of an earlier range without rewinding newer progress',()=>{
    const data={entries:{0:{...memory(0,0,1),STMB_collectedAt:'2026-11-09T13:00:00Z'},1:{...memory(1,2,3),STMB_collectedAt:'2026-11-09T12:00:00Z'}}};
    const result=plan([{name:'book',data}]);assert.equal(result.checkpoint,3);assert(!result.states[0].data.entries[0]);assert(result.states[0].data.entries[1]);
});
test('dependent consolidations are not silently left referencing deleted sources',()=>{
    const data={entries:{0:memory(0,2,3),1:{uid:1,stmbSummary:true,stmbSummaryTier:1,stmbSourceEntryUids:['0']}}};
    assert.throws(()=>plan([{name:'book',data}]),/통합/);assert(data.entries[0]);
});
test('repeated collections of the same range are not guessed or deleted together',()=>{
    assert.throws(()=>plan([{name:'book',data:{entries:{0:memory(0,2,3),1:memory(1,2,3)}}}]),/여러 번/);
    assert.throws(()=>plan([{name:'book',data:{entries:{0:side(0),1:side(1)}}}]),/여러 개/);
});
test('legacy receipts undo associated memory, side version and date receipt without touching another branch',()=>{
    const source=sourceRange(messages,2,3),old=sourceRange(messages,0,1),other=sourceRange([...messages.slice(0,2),{mes:'different'},{mes:'branch'}],2,3);
    const data={entries:{0:{uid:0,content:'event',[NS]:{source}},1:{uid:1,content:'new side',[NS]:{source,sideCategory:'plans',facts:[],history:[{content:'old side',source:old,facts:[]}]}},2:{uid:2,content:'other branch',[NS]:{source:other}}},
        [NS]:{receipts:[{source:old,created:'2026-11-08'},{source,created:'2026-11-09'}],storyDates:[{source,date:'2026-03-01'}]}};
    const result=plan([{name:'book',data}]).states[0].data;
    assert(!result.entries[0]);assert.equal(result.entries[1].content,'old side');assert(result.entries[2]);assert.equal(result[NS].receipts.length,1);assert.equal(result[NS].storyDates.length,0);
});
test('multi-book save failure compensates already-written books and never overwrites intervening edits',async()=>{
    const states=['a','b'].map(name=>({name,originalData:{entries:{0:{content:name}}},data:{entries:{}}}));
    const disk=new Map(states.map(s=>[s.name,structuredClone(s.originalData)]));let interfere=false;
    const host={load:async name=>structuredClone(disk.get(name)),save:async(name,data)=>{if(name==='b'){if(interfere)disk.set('a',{entries:{0:{content:'external edit'}}});throw Error('disk failed');}disk.set(name,structuredClone(data));}};
    await assert.rejects(saveCollectionUndo(states,host),/disk failed/);assert.deepEqual(disk.get('a'),states[0].originalData);
    interfere=true;await assert.rejects(saveCollectionUndo(states,host),/일부 책/);assert.equal(disk.get('a').entries[0].content,'external edit');
});
test('stale preview or switched chat rejects before the first write',async()=>{
    const states=[{name:'a',originalData:{entries:{}},data:{entries:{}}}];let writes=0;
    await assert.rejects(saveCollectionUndo(states,{load:async()=>({entries:{0:{content:'new'}}}),save:async()=>writes++}),/변경/);
    await assert.rejects(saveCollectionUndo(states,{load:async()=>states[0].originalData,save:async()=>writes++,assertCurrent:()=>{throw Error('chat switched');}}),/chat switched/);
    assert.equal(writes,0);
});

test('undo does not reorder a separate book with no entries in the undone collection',()=>{
 const untouched={entries:{0:{uid:0,comment:'Other (STMB SidePrompt)',content:'side'},1:{uid:1,content:'manual'}}};
 const result=plan([{name:'active',data:{entries:{0:memory(0,2,3)}}},{name:'unrelated',data:untouched}]);
 assert.deepEqual(result.states.map(s=>s.name),['active']);
 assert.equal(untouched.entries[0].displayIndex,undefined);
});
