// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { retrievalFocus, rankFocusedChunks, chooseCandidates } from './lore-retrieval.js';
import { DEFAULT_PROMPTS, normalizeSettings, textUnits, embeddingChunks, reviewUnits, selectedUnits, fitInjection } from './lore-core.js';
import { LEGACY_QUESTIONS, LEGACY_SELECT } from './lore-prompts.js';

test('latest visible user request stays separate from a long preceding scene and hidden messages',()=>{
    const messages=[{is_user:true,mes:'old question'},{mes:'a long unrelated scene '.repeat(3000)},
        {is_user:true,mes:'Remember our skiing trip?'},{is_user:true,is_system:true,mes:'hidden secret'}];
    const focus=retrievalFocus(messages,2);
    assert.equal(focus.latestUser,'Remember our skiing trip?');
    assert(!focus.context.includes('hidden secret'));assert(!focus.context.includes('old question'));
    assert.equal(retrievalFocus([{is_user:true,mes:'outside range'},{mes:'Continue this scene.'}],1).latestUser,'Continue this scene.');
});

test('a focused event gets review space even when sixteen old-scene chunks match context more closely',()=>{
    const old=Array.from({length:20},(_,index)=>({id:'old-'+index,index:0,vector:[.1,1]}));
    const ski={id:'ski',index:0,vector:[1,.05]};
    const ranked=rankFocusedChunks([...old,ski],{focus:[[1,0]],context:[[0,1]]});
    const candidates=chooseCandidates(ranked,16);
    assert.equal(candidates.length,16);assert.equal(candidates[0].id,'ski');
    assert.equal(candidates[0].focusRank,1);assert.equal(candidates[0].contextRank,21);
});

test('questions contribute reserved candidates and one long record cannot monopolize a diverse book',()=>{
    const ranked=Array.from({length:20},(_,i)=>({id:i<12?'long':'other-'+i,index:i,score:1-i/100,focusRank:i+1,questionsRank:20-i}));
    const chosen=chooseCandidates(ranked,8);
    assert.equal(chosen.length,8);assert.equal(chosen.filter(c=>c.id==='long').length,2);
    assert(chosen.some(c=>c.questionsRank===1));
    assert.equal(chooseCandidates(ranked.filter(c=>c.id==='long'),8).length,8);
    assert.deepEqual(rankFocusedChunks([{id:'bad',index:0,vector:[1,2]}],{focus:[[1]]}),[]);
});

test('question mode preserves its top half even when fusion buries an event or it spans many chunks',()=>{
    const ranked=Array.from({length:100},(_,i)=>({id:'background-'+i,index:0,focusRank:i+1,questionsRank:i+9}));
    const event=Array.from({length:8},(_,i)=>({id:'event',index:i,focusRank:101+i,questionsRank:i+1}));
    ranked.push(...event);
    const chosen=chooseCandidates(ranked,16,'questions');
    assert.equal(chosen.length,16);
    assert.deepEqual(chosen.slice(0,8),event);
    assert.equal(new Set(chosen.map(c=>JSON.stringify([c.id,c.index]))).size,16);
    assert.deepEqual(chooseCandidates(ranked,1,'questions'),[event[0]]);
    assert.deepEqual(chooseCandidates(ranked,0,'questions'),[]);
    const noQuestions=ranked.map(({questionsRank,...row})=>row);
    assert.deepEqual(chooseCandidates(noQuestions,16,'questions'),chooseCandidates(noQuestions,16));
});

test('review preserves times, decimals, initials, titles, quotes and exact source text',()=>{
    const text='Dr. Lee met A. Smith at 9 a.m. They watched the No. 1 singer. At 7:30 p.m. he paid 12.50 dollars. “Not today!” she said.\n다음 날이었다.';
    const units=textUnits(text);
    assert(!units.includes('m.'));assert(units.some(s=>s.includes('9 a.m.')));
    assert(units.some(s=>s.includes('No. 1 singer')));assert(units.some(s=>s.includes('12.50')));
    assert(units.every(s=>text.includes(s)));
    assert.equal(units.join('').replace(/\s/g,''),text.replace(/\s/g,''));
});

test('existing embedding text stays byte-identical while review repairs sentence boundaries',()=>{
    const text='At 7:30 p.m. Dr. Lee arrived. No. 1 was waiting.';
    const chunks=embeddingChunks({comment:'Dinner',content:text});
    assert.equal(chunks[0].text,'Dinner\nAt 7:30 p.\nm.\nDr.\nLee arrived.\nNo.\n1 was waiting.');
    const offered=reviewUnits(chunks.map(c=>({...c,id:'entry',title:'Dinner',book:'book'})));
    assert(offered.some(u=>u.text.includes('7:30 p.m. Dr. Lee arrived.')));
    assert(!offered.some(u=>u.text==='m.'));assert(offered.every(u=>text.includes(u.text)));
    // Complete source sentences straddling two embedding chunks appear only once in review.
    const long=('A single long sentence with enough detail to span a cached chunk ').repeat(50)+'.';
    const multiple=embeddingChunks({content:long},150);
    const review=reviewUnits(multiple.map(c=>({...c,id:'one'})));
    assert.equal(review.length,textUnits(long).length);
    assert.equal(new Set(review.map(u=>u.index)).size,review.length);
});

test('ranked selection rejects invented IDs and vague relevance; budget retains direct facts first',async()=>{
    const offered=[{id:'u0',entryId:'old',title:'Old',text:'Supporting detail '.repeat(30),index:0},
        {id:'u1',entryId:'ski',title:'Trip',text:'They exchanged rings on the slope.',index:0}];
    const response=JSON.stringify({selections:[{id:'u0',priority:2,reason:'context'},
        {id:'u1',priority:3,reason:'answers the named past event'},
        {id:'fake',priority:3,reason:'invented'},{id:'u0',priority:3,reason:'duplicate'}]});
    const selected=selectedUnits(response,offered);
    assert.deepEqual(selected.map(u=>u.id),['u1','u0']);
    const fitted=await fitInjection(selected,180,t=>t.length);
    assert(fitted.text.includes('exchanged rings'));assert(!fitted.text.includes('Supporting detail'));
    assert.equal(selectedUnits(JSON.stringify({selections:[{id:'u0',priority:1,reason:'same mood'},{id:'u1',priority:3,reason:''}]}),offered).length,0);
    assert.deepEqual(selectedUnits('{"selections":[]}',offered),[]);
    const contextOnly=selectedUnits('{"selections":[{"id":"u0","priority":2,"reason":"background only"}]}',offered);
    assert.equal((await fitInjection(contextOnly,3000)).text,'');
    const oversized=selectedUnits(JSON.stringify({selections:[{id:'u0',priority:3,reason:'direct but too long'},
        {id:'u1',priority:2,reason:'context for oversized fact'}]}),offered);
    assert.equal((await fitInjection(oversized,180,t=>t.length)).text,'');
});

test('selection flooding is bounded and legacy custom responses preserve their relevance order',()=>{
    const offered=Array.from({length:100},(_,i)=>({id:'u'+i,text:'original '+i}));
    const picked=selectedUnits(JSON.stringify({ids:[...offered.map(u=>u.id)].reverse()}),offered);
    assert.equal(picked.length,24);assert.equal(picked[0].id,'u99');
});

test('saved old defaults upgrade once while customized search and selection prompts survive',()=>{
    const migrated=normalizeSettings({promptRevision:2,prompts:{questions:LEGACY_QUESTIONS,select:LEGACY_SELECT}});
    assert.equal(migrated.prompts.questions,DEFAULT_PROMPTS.questions);assert.equal(migrated.prompts.select,DEFAULT_PROMPTS.select);
    const custom=normalizeSettings({promptRevision:2,prompts:{questions:'My query rules',select:'My selection rules'}});
    assert.equal(custom.prompts.questions,'My query rules');assert.equal(custom.prompts.select,'My selection rules');
});

test('regeneration excludes only the answer being replaced without mutating chat or continuation context', async()=>{
    const {recallMessages}=await import('./lore-retrieval.js');
    const messages=[{is_user:true,mes:'remember the rings?'},{mes:'wrong old answer'},{is_system:true,mes:'hidden'}];
    assert.deepEqual(recallMessages(messages,'swipe'),messages.slice(0,1));
    assert.deepEqual(recallMessages(messages,'regenerate'),messages.slice(0,1));
    assert.equal(recallMessages(messages,'continue'),messages);
    assert.equal(recallMessages(messages.slice(0,1),'swipe').length,1);
    assert.equal(messages.length,3);
});

test('attribution dependencies survive together or are dropped together, including client re-budgeting',async()=>{
    const offered=[
        {id:'u0',entryId:'rings',index:0,title:'Rings',text:'Her ring reads A × B.'},
        {id:'u1',entryId:'rings',index:1,title:'Rings',text:'His ring reads B × A.'},
        {id:'u2',entryId:'other',index:0,title:'Other',text:'An unrelated ring.'},
    ];
    const selected=selectedUnits(JSON.stringify({selections:[{id:'u0',priority:3,reason:'the two rings',contextIds:['u1']}]}),offered);
    const full=await fitInjection(selected,1000,t=>t.length);
    assert(full.text.includes('Her ring'));assert(full.text.includes('His ring'));
    const small=await fitInjection(full.units,full.tokens-1,t=>t.length);
    assert.equal(small.text,'');assert.equal(small.units.length,0);
    assert.throws(()=>selectedUnits(JSON.stringify({selections:[{id:'u0',priority:3,reason:'x',contextIds:['u2']}]}),offered),/연결 문장/);
    const both=selectedUnits(JSON.stringify({selections:[{id:'u0',priority:3,reason:'her ring',contextIds:['u1']},{id:'u1',priority:3,reason:'his ring',contextIds:['u0']}]}),offered);
    const result=await fitInjection(both,1000,t=>t.length);assert.equal(result.units.length,2);
    assert.equal((await fitInjection(result.units,1000,t=>t.length)).text,result.text);
});

test('review expands only adjacent chunks of the same retrieved entry',async()=>{
    const {reviewCandidates}=await import('./lore-retrieval.js');
    const chunks=Array.from({length:5},(_,index)=>({id:'a',index})).concat({id:'b',index:1});
    assert.deepEqual(reviewCandidates([chunks[1]],chunks).map(c=>c.index),[0,1,2]);
});

test('review batching keeps short entries intact and overlaps large-entry source context',async()=>{
    const {reviewBatches}=await import('./lore-retrieval.js');
    const units=Array.from({length:40},(_,index)=>({id:'u'+index,entryId:index<6?'a':'b',index,text:'A fact with an owner. '.repeat(5)}));
    const batches=reviewBatches(units,700);
    assert(batches[0].filter(u=>u.entryId==='a').length===6);
    assert.equal(new Set(batches.flat().map(u=>u.id)).size,40);
    assert(batches.flat().length>40);
});

test('transitive attribution dependencies cannot be orphaned by client re-budgeting',async()=>{
    const a={entryId:'x',index:0,id:'a',text:'Her ring reads A B.',title:'Rings'},b={entryId:'x',index:1,id:'b',text:'His ring is different.',title:'Rings'},c={entryId:'x',index:2,id:'c',text:'His ring reads B A.',title:'Rings'};
    const result=await fitInjection([{...a,requiredContext:[b]},{...b,requiredContext:[c]}],1000,t=>t.length);
    assert.equal(result.units.length,3);
    const smaller=await fitInjection(result.units,result.tokens-1,t=>t.length);
    assert(!smaller.text.includes('Her ring'));assert(smaller.text.includes('His ring reads B A.'));
});
