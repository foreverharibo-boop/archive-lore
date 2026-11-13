// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {fitFocusedInjection} from './lore-focus-injection.js';
import {selectedUnits,normalizeSettings} from './lore-core.js';
import {SELECTION_FOCUS,focusQuestionPrompt,focusSearchQuery,responseFocusGuidance,orderFocusedUnits} from './lore-selection-focus.js';
const count=text=>Math.ceil(text.length/3);
const anchor={id:'u0',entryId:'visit',index:0,title:'Hospital',text:'On 2027-12-26 they visited the hospital.'};
const fact={id:'u1',entryId:'visit',index:1,title:'Hospital',text:'She thanked him for staying.',priority:3,selectionFormat:'ranked',requiredContext:[anchor],focusMatches:['affection']};
const config=patch=>normalizeSettings({injectionTokens:500,selectionFocus:['affection'],...patch});

for(const mode of ['dialogue','questions','embedding'])test(`common response guidance applies without selected aspects: ${mode}`,async()=>{
    const fitted=await fitFocusedInjection([fact],config({mode,selectionFocus:[]}),count);
    assert.equal(fitted.guidance,responseFocusGuidance([]));assert.match(fitted.guidance,/Do not recap retrieved events/);
    assert.match(fitted.guidance,/Mention the relevant memory when the user asks about the past/);
    assert(fitted.text.includes(fact.text));assert(fitted.text.includes(anchor.text));assert(fitted.tokens<=500);
    assert.equal(focusQuestionPrompt([]),'');assert.equal(focusSearchQuery([],'hospital'),'');
    assert.equal(responseFocusGuidance(['unknown']),responseFocusGuidance([]));
});
test('plain embedding ignores saved aspects but retains common response guidance',async()=>{
    const fitted=await fitFocusedInjection([fact],config({mode:'embedding'}),count);
    assert.equal(fitted.guidance,responseFocusGuidance([]));assert(!fitted.guidance.includes('Let expressed feelings'));
});
test('every category supplies distinct planner, supplementary query and response direction',()=>{
    const guides=[];
    for(const {id,instruction} of SELECTION_FOCUS){
        assert(focusQuestionPrompt([id]).includes(instruction));
        assert(focusSearchQuery([id],'Hospital visit').startsWith('Hospital visit\n'));
        assert(focusSearchQuery([id],'Hospital visit').includes(instruction));
        guides.push(responseFocusGuidance([id]));
    }
    assert.equal(new Set(guides).size,5);assert.equal(focusSearchQuery(['affection'],''),'');
    assert(!responseFocusGuidance(['affection','injected instructions']).includes('injected instructions'));
});
test('guidance shares the cap with intact source and its essential event anchor',async()=>{
    const fitted=await fitFocusedInjection([fact],config(),count);
    assert(fitted.guidance);assert(fitted.text.includes(anchor.text));assert(fitted.text.includes(fact.text));
    assert(!fitted.text.includes('response guidance'));assert(!fitted.guidance.includes(fact.text));
    assert(fitted.tokens<=500);assert(fitted.tokens>=count(fitted.text)+count(fitted.guidance));
    assert.equal(fitted.memoryTokens,count(fitted.text));assert.equal(fitted.guidanceTokens,count(fitted.guidance));
    const refitted=await fitFocusedInjection(fitted.units,config(),count);
    assert.deepEqual(refitted,fitted);
});
for(const selectionFocus of [[],['affection']])test(`small budgets preserve evidence and empty selections omit guidance: ${selectionFocus}`,async()=>{
    const fitted=await fitFocusedInjection([fact],{...config({selectionFocus}),injectionTokens:110},count);
    assert.equal(fitted.guidance,'');assert.equal(fitted.guidanceOmitted,'budget');assert(fitted.text.includes(fact.text));
    assert(fitted.tokens<=110);
    const empty=await fitFocusedInjection([],config({selectionFocus}),count);
    assert.equal(empty.guidance,'');assert.equal(empty.tokens,0);assert.equal(empty.guidanceOmitted,'no-memory');
});
test('client refitting cannot leave supporting sentences without their omitted root',async()=>{
    const fitted=await fitFocusedInjection([fact],config(),count);
    const small=await fitFocusedInjection(fitted.units,{...config(),injectionTokens:30},count);
    assert.deepEqual(small.units,[]);assert.equal(small.text,'');assert.equal(small.guidance,'');
});
test('combined-slot boundary cost is counted and reduced within the cap',async()=>{
    const units=[fact,{...fact,id:'u2',index:0,entryId:'other',text:'Another relevant visit. '.repeat(10),requiredContext:[]}];
    const tokenizer=text=>count(text)+(text.includes('[/Archive Lore]\n\n[')?45:0);
    const fitted=await fitFocusedInjection(units,config(),tokenizer);
    assert(fitted.guidance);assert(fitted.tokens<=500);assert.equal(fitted.tokens,tokenizer(fitted.text+'\n\n'+fitted.guidance));
});
test('reported matches are allowlisted, while priority and essential context remain intact',()=>{
    const units=selectedUnits(JSON.stringify({selections:[{id:'u1',priority:3,reason:'gratitude',contextIds:['u0'],focusMatches:['affection','meaning','unknown','affection']}]}),[anchor,fact],['affection']);
    assert.deepEqual(units[0].focusMatches,['affection']);assert.equal(units[0].requiredContext[0].text,anchor.text);
    const early={...fact,id:'early',entryId:'early',focusMatches:[]};
    const support={...fact,id:'support',entryId:'support',priority:2};
    assert.deepEqual(orderFocusedUnits([early,support,...units],['affection']).map(u=>u.id),['u1','early','support']);
    const unchanged=[early,support];assert.equal(orderFocusedUnits(unchanged,[]),unchanged);
});
