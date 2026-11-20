// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedUnits, fitInjection, formatInjection } from './lore-core.js';
import { parseGenerousSelections } from './lore-generous-recall.js';

// Synthetic regression data: never publish a user's chat or lorebook fixture.
const offered = [
    {id:'u0',entryId:'side',index:0,title:'Expenses',text:'Morgan paid to clean the borrowed raincoat.'},
    {id:'u1',entryId:'day',index:0,title:'Monday',text:'Morgan brought the coat back to Lee in a garment bag.'},
    {id:'u2',entryId:'day',index:1,title:'Monday',text:'Lee took the hanger and put the coat in his locker.'},
    {id:'u3',entryId:'other',index:0,title:'Another loan',text:'Lee still owed Casey a book.'},
];
const response = rows => JSON.stringify({selections:rows});
const root = {id:'u0',priority:3,reason:'Relevant cleaning expense',outcomeIds:['u1','u2']};

for (const [mode,parse] of [['normal',selectedUnits],['generous',parseGenerousSelections]]) {
    test(`${mode}: side reference carries original return and receipt across entries`,async()=>{
        const selected=parse(response([root]),offered);
        const fitted=await fitInjection(selected,2000,t=>t.length);
        assert(fitted.text.includes(offered[0].text));
        assert(fitted.text.includes(offered[1].text));
        assert(fitted.text.includes(offered[2].text));
        assert(!fitted.text.includes(offered[3].text));
        assert.equal(fitted.units.length,3);
        // Budget can fit the misleading setup alone, but not its full outcome.
        const budget=formatInjection([offered[0]]).length;
        assert.equal((await fitInjection(selected,budget,t=>t.length)).text,'');
        // Server serialization and a second tokenizer must retain the dependency.
        const transported=JSON.parse(JSON.stringify(fitted.units));
        assert.equal((await fitInjection(transported,budget,t=>t.length)).text,'');
    });
    test(`${mode}: outcome references cannot import unknown/unoffered records`,()=>{
        for(const outcomeIds of [['missing'],['u1',null],'u1',Array(9).fill('u1')]) {
            assert.throws(()=>parse(response([{...root,outcomeIds}]),offered),/연결 문장/);
        }
        assert.throws(()=>parse(response([{...root,contextIds:['missing']}]),offered),/연결 문장/);
    });
    test(`${mode}: same-entry context and outcomes deduplicate without fabricating status`,async()=>{
        const selected=parse(response([{id:'u1',priority:3,reason:'Return',contextIds:['u2'],outcomeIds:['u1','u2','u2']}]),offered);
        assert.deepEqual(selected[0].requiredContext.map(u=>u.id),['u2']);
        const legacy=parse(response([{id:'u0',priority:3,reason:'Cost only'}]),offered);
        assert.deepEqual(legacy[0].requiredContext,[]);
        const fitted=await fitInjection(legacy,2000,t=>t.length);
        assert(!fitted.text.includes('locker'));
    });
    test(`${mode}: terminal status can survive when an oversized setup is dropped`,async()=>{
        const selected=parse(response([root,{id:'u2',priority:3,reason:'Already received',contextIds:['u1']}]),offered);
        const budget=formatInjection(offered.slice(1,3)).length;
        const fitted=await fitInjection(selected,budget,t=>t.length);
        assert(!fitted.text.includes(offered[0].text));
        assert(fitted.text.includes(offered[1].text));assert(fitted.text.includes(offered[2].text));
    });
}

test('later outcome dependencies remain transitive across a client re-budget',async()=>{
    const timeline=[...offered.slice(0,3),{...offered[3],text:'Lee later lent the same raincoat to Casey.'}];
    const units=selectedUnits(response([root,{id:'u2',priority:3,reason:'Subsequent change',outcomeIds:['u3']}]),timeline);
    const fitted=await fitInjection(units,2000,t=>t.length);
    const setup=fitted.units.find(u=>u.id==='u0');
    assert.deepEqual(new Set(setup.requiredContext.map(u=>u.id)),new Set(['u1','u2','u3']));
    const rebudget=await fitInjection(JSON.parse(JSON.stringify(fitted.units)),fitted.tokens-1,t=>t.length);
    assert(!rebudget.text.includes(offered[0].text));
});
