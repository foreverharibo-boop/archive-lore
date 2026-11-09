// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings} from './lore-core.js';
import {SELECTION_FOCUS,normalizeSelectionFocus,selectionFocusPrompt} from './lore-selection-focus.js';
import {createLoreUI} from './lore-ui.js';

test('selection emphasis defaults to automatic and safely round-trips multiple choices',()=>{
    for(const value of [undefined,null,'affection',{},['unknown']])assert.deepEqual(normalizeSettings({selectionFocus:value}).selectionFocus,[]);
    const input=['meaning','affection','meaning','unknown'];
    const settings=normalizeSettings({selectionFocus:input,prompts:{select:'Custom selector'}});
    assert.deepEqual(settings.selectionFocus,['affection','meaning']);
    assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(settings))).selectionFocus,settings.selectionFocus);
    assert.equal(settings.prompts.select,'Custom selector');assert.deepEqual(input,['meaning','affection','meaning','unknown']);
    assert.equal(selectionFocusPrompt([]),'');
    assert.equal(selectionFocusPrompt(['unknown']),'');
});

test('all five aspects are selectable without forcing quotas or unrelated memories',()=>{
    assert.equal(SELECTION_FOCUS.length,5);
    for(const item of SELECTION_FOCUS){
        assert.deepEqual(normalizeSelectionFocus([item.id]),[item.id]);
        const prompt=selectionFocusPrompt([item.id]);assert(prompt.includes(item.instruction));
        for(const other of SELECTION_FOCUS.filter(x=>x.id!==item.id))assert(!prompt.includes(other.instruction));
        assert.match(prompt,/Relevance to the current request comes first/);
        assert.match(prompt,/refusal, negation and uncertainty must survive/);
        assert.match(prompt,/Never invent/);assert.match(prompt,/existing injectionBudgetTokens/);
    }
    assert.equal(normalizeSelectionFocus(SELECTION_FOCUS.map(x=>x.id)).length,5);
});

test('actual settings change handler saves independent choices across panels and clearing survives remount',async()=>{
    let saved=JSON.stringify(normalizeSettings({}));const errors=[];
    const ui=createLoreUI({settings:()=>JSON.parse(saved),profiles:()=>[],saveSettings:patch=>{saved=JSON.stringify(normalizeSettings({...JSON.parse(saved),...patch}));},error:e=>errors.push(e)});
    const panel=()=>{
        const handlers={},fieldset={},status={};
        const node={dataset:{},innerHTML:'',querySelectorAll:()=>[],querySelector:selector=>selector==='.al-selection-focus'?fieldset:status,addEventListener:(type,handler)=>handlers[type]=handler};
        ui.mountSettings(node);
        return {node,fieldset,status,change:(name,value)=>handlers.change({target:{name,dataset:{},type:name==='mode'?'select-one':'checkbox',value,checked:value,matches:()=>false}})};
    };
    const a=panel(),b=panel();assert.equal((a.node.innerHTML.match(/name="selectionFocus\./g)||[]).length,5);
    await a.change('selectionFocus.affection',true);await b.change('selectionFocus.meaning',true);
    assert.deepEqual(JSON.parse(saved).selectionFocus,['affection','meaning']);
    await a.change('selectionFocus.affection',false);assert.deepEqual(JSON.parse(saved).selectionFocus,['meaning']);
    await b.change('mode','embedding');assert.equal(b.fieldset.disabled,true);assert.match(b.status.textContent,/적용되지/);
    assert.deepEqual(JSON.parse(saved).selectionFocus,['meaning']);
    await b.change('mode','questions');assert.equal(b.fieldset.disabled,false);
    await b.change('selectionFocus.meaning',false);assert.deepEqual(JSON.parse(saved).selectionFocus,[]);
    const c=panel();assert(!/name="selectionFocus\.[^"]+" checked/.test(c.node.innerHTML));assert.deepEqual(errors,[]);
});
