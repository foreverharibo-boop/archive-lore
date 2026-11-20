// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedUnits, fitInjection } from './lore-core.js';
import { parseGenerousSelections } from './lore-generous-recall.js';

const offered=[
    {id:'u84',entryId:'day',index:0,title:'Day',text:'Lee borrowed a coat.'},
    {id:'u85',entryId:'day',index:1,title:'Day',text:'The owner agreed to lend it.'},
    {id:'u86',entryId:'return',index:0,title:'Return',text:'Lee returned the coat.'},
];
const anchor={id:'u84',priority:3,reason:'Coat status',contextIds:['u85'],outcomeIds:['u86']};
for(const [name,parse] of [['normal',selectedUnits],['generous',parseGenerousSelections]]){
    for(const [field,refs,code] of [
        ['contextIds',['u0'],'id-not-in-batch'],
        ['contextIds','u85','expected-array'],
        ['contextIds',null,'expected-array'],
        ['contextIds',Array(33).fill('u85'),'too-many-references'],
        ['outcomeIds',['u999'],'id-not-in-batch'],
        ['outcomeIds',Array(9).fill('u86'),'too-many-references'],
        ['outcomeIds',{},'expected-array'],
    ])test(`${name}: invalid ${field} explains ${code} without accepting a partial bundle`,()=>{
        const before=structuredClone(offered);
        assert.throws(()=>parse(JSON.stringify({selections:[{...anchor,[field]:refs}]}),offered),error=>{
            assert.equal(error.category,'response-format');assert.equal(error.stage,'selection.validate');
            assert.equal(error.details.field,field);assert.equal(error.details.anchorId,'u84');
            assert(error.details.problems.some(p=>p.code===code));return true;
        });
        assert.deepEqual(offered,before);
    });
    test(`${name}: valid corrected context and cross-entry outcome remain atomic under budget`,async()=>{
        const selected=parse(JSON.stringify({selections:[anchor]}),offered);
        assert.deepEqual(selected[0].requiredContext.map(u=>u.id),['u85','u86']);
        const full=await fitInjection(selected,10000,t=>t.length);
        for(const u of offered)assert(full.text.includes(u.text));
        const tight=await fitInjection(selected,full.tokens-1,t=>t.length);
        assert.equal(tight.text,'');
    });
    test(`${name}: cross-entry context preserves source labels, deduplicates, and stays atomic`,async()=>{
        const before=structuredClone(offered);
        const selected=parse(JSON.stringify({selections:[{...anchor,contextIds:['u85','u86','u86']}]}),offered);
        assert.deepEqual(selected[0].requiredContext.map(u=>u.id),['u85','u86']);
        const full=await fitInjection(selected,10000,t=>t.length);
        assert(full.text.includes('Day\nLee borrowed a coat.\nThe owner agreed to lend it.'));
        assert(full.text.includes('Return\nLee returned the coat.'));
        assert.deepEqual(offered,before);
        assert.equal((await fitInjection(JSON.parse(JSON.stringify(full.units)),full.tokens-1,t=>t.length)).text,'');
    });
}

for (const [name,parse] of [['normal',selectedUnits],['generous',parseGenerousSelections]]) {
    for (const count of [33,35,135]) test(`${name}: ${count} references fail on every attempt without overflow bypass`,async()=>{
        const {validateSelectionAttempt}=await import('./lore-selection-repair.js');
        const units=Array.from({length:count+1},(_,i)=>({id:`u${i}`,entryId:'visit',index:i,title:'Visit',text:`Recorded visit detail ${i}.`}));
        const raw=JSON.stringify({selections:[{id:'u0',priority:3,reason:'Visit context',contextIds:units.slice(1).map(u=>u.id)}]});
        for (const formerRecoveryFlag of [false,true])
            assert.throws(()=>validateSelectionAttempt(parse,raw,units,[],formerRecoveryFlag),/too-many-references/);
        assert.throws(()=>parse(raw,units,[],{allowContextOverflow:true}),/too-many-references/);
    });
    test(`${name}: exactly 32 context references preserve original text and atomic budget`,async()=>{
        const {validateSelectionAttempt}=await import('./lore-selection-repair.js');
        const units=Array.from({length:33},(_,i)=>({id:`u${i}`,entryId:'visit',index:i,title:'Visit',text:`Recorded visit detail ${i}.`}));
        const raw=JSON.stringify({selections:[{id:'u0',priority:3,reason:'Visit context',contextIds:units.slice(1).map(u=>u.id)}]});
        const result=validateSelectionAttempt(parse,raw,units,[]);
        assert.equal(result.contextOverflowRecovered,false);
        assert.deepEqual(result.accepted[0].requiredContext,units.slice(1));
        const full=await fitInjection(result.accepted,100000,t=>t.length);
        assert.equal(full.units.length,33);
        for (const u of units) assert(full.text.includes(u.text));
        assert.equal((await fitInjection(result.accepted,full.tokens-1,t=>t.length)).text,'');
    });
}

test('over-limit arrays are rejected before reference-by-reference lookup',async()=>{
    const {linkedSelectionUnits}=await import('./lore-selection-repair.js');
    let lookups=0;
    const allowed=new Map([['u0',{id:'u0'}]]);
    allowed.has=()=>{lookups++;return true;};
    assert.throws(()=>linkedSelectionUnits({id:'u0',contextIds:Array(135).fill('u1')},allowed,{field:'contextIds',limit:32}),/too-many-references/);
    assert.equal(lookups,0);
});
