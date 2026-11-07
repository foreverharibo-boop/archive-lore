// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticReady, collectedHideRanges } from './lore-automation.js';
import { normalizeSettings, sourceRange, NS, entryAvailable } from './lore-core.js';
import { normalizeSides, sideInstructions, DEFAULT_SIDES } from './lore-side-config.js';
import { consolidationView } from './lore-maintenance.js';
const messages=Array.from({length:10},(_,i)=>({mes:'Message '+i,is_user:i%2===0}));
test('message and token triggers count uncollected visible dialogue with no buffer',()=>{
    const c=normalizeSettings({autoCollect:true,autoMessages:2});
    assert.equal(automaticReady(c,messages,8),true);assert.equal(automaticReady(c,messages,9),false);
    assert.equal(automaticReady({...c,autoCollect:false},messages,0),false);
    assert.equal(automaticReady({...c,autoMode:'tokens',autoTokens:4},messages,9),true);
    assert.equal(automaticReady(c,[...messages.slice(0,9),{mes:'hidden',is_system:true}],8),false);
});
test('hiding respects committed ranges, gaps, retained messages and edited sources',()=>{
    const receipts=[{source:sourceRange(messages,0,2)},{source:sourceRange(messages,5,8)}];
    assert.deepEqual(collectedHideRanges(receipts,messages,2),[{start:0,end:2},{start:5,end:6}]);
    assert.deepEqual(collectedHideRanges(receipts,messages,0),[{start:0,end:2},{start:5,end:8}]);
    assert.deepEqual(collectedHideRanges(receipts,messages,20),[]);
    const changed=structuredClone(messages);changed[0].mes='edited';changed[5].is_system=true;
    assert.deepEqual(collectedHideRanges(receipts,changed,2),[{start:6,end:6}]);
});
test('side prompts retain six editable defaults and support isolated custom categories',()=>{
    assert.equal(DEFAULT_SIDES.length,6);
    for(const side of DEFAULT_SIDES)assert(side.prompt.length>50);
    const rows=normalizeSides();rows[0].enabled=false;rows.push({id:'custom_inventory',title:'Inventory',label:'소지품',enabled:true,prompt:'Track explicitly acquired and lost objects.'});
    const result=sideInstructions(normalizeSettings({sideTemplates:rows}));
    assert(!result.includes('ID: relationship\n'));assert(result.includes('ID: custom_inventory'));assert(result.includes('single response'));
    assert.throws(()=>normalizeSides([...rows,rows[0]]),/중복/);
    assert.match(sideInstructions(normalizeSettings({sideEnabled:false})),/empty sideChanges/);
});
test('consolidation hides originals on matching branch only; editing or deleting parent restores originals',()=>{
    const source=sourceRange(messages,0,2), originals=[{uid:0,content:'A',[NS]:{source}},{uid:1,content:'B',[NS]:{source}}];
    const parent={uid:2,content:'AB',[NS]:{tier:1,source:sourceRange(messages,0,4),members:originals.map(e=>({uid:e.uid,content:e.content}))}};
    let view=consolidationView([...originals,parent],messages);assert.deepEqual(view.map(e=>entryAvailable(e,messages)),[false,false,true]);
    view=consolidationView([...originals,parent],messages.slice(0,3));assert.deepEqual(view.map(e=>entryAvailable(e,messages.slice(0,3))),[true,true,false]);
    view=consolidationView([{...originals[0],content:'edited'},originals[1],parent],messages);assert.deepEqual(view.map(e=>entryAvailable(e,messages)),[true,true,false]);
    assert(consolidationView(originals,messages).every(e=>entryAvailable(e,messages)));
});
test('promoting an original member to core invalidates its parent and keeps the core available',()=>{
    const a={uid:0,content:'A',constant:true},b={uid:1,content:'B'},arc={uid:2,content:'AB',[NS]:{tier:1,members:[{uid:0,content:'A'},{uid:1,content:'B'}]}};
    assert.deepEqual(consolidationView([a,b,arc],messages).map(e=>entryAvailable(e,messages)),[true,true,false]);
});

test('server completion notifications do not enqueue another automatic index',async()=>{
    const {syncServerBooks,shouldIndexBookUpdate}=await import('./lore-automation.js');
    let indexes=0,loads=0,events=0;const cache=new Map(),books=['Book'];
    const host={cache,loadBook:async()=>{loads++;return {entries:{0:{uid:0,content:'Fact'}}};},
        emit:async(name,_data,metadata)=>{events++;if(shouldIndexBookUpdate(name,books,metadata))indexes++;}};
    // A real edit is the initial trigger. Completion must not feed itself back into the queue.
    if(shouldIndexBookUpdate('Book',books))indexes++;
    await syncServerBooks({kind:'index',books},host);
    assert.equal(indexes,1);assert.equal(loads,0);assert.equal(events,0);
    await syncServerBooks({kind:'collect',books},host);
    await syncServerBooks({kind:'applyMaintenance',books},host);
    assert.equal(indexes,1);assert.equal(loads,2);assert.equal(events,2);assert(cache.has('Book'));
    assert(!shouldIndexBookUpdate('Book',books,undefined,true));
    assert(!shouldIndexBookUpdate('Unrelated',books));
    assert(shouldIndexBookUpdate('Book',books));
});
