// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchToolsPanel} from './lore-native-tools.js';

function fixture(cached=null){
    const slots=new Map();
    const element=()=>({textContent:'',children:[],append(child){this.children.push(child);},setAttribute(){},querySelector(selector){if(!slots.has(selector))slots.set(selector,element());return slots.get(selector);}});
    let resolve,reads=0,subscriber,key='chat';
    const pending=new Promise(r=>resolve=r);
    const search={context:()=>({key}),subscribe:fn=>{subscriber=fn;return()=>subscriber=null;},controller:{
        state:()=>({busy:false}),cachedEmbeddingCounts:()=>cached,embeddingCounts:()=>{reads++;return pending;},
        dashboard:()=>assert.fail('opening counts must not restore jobs'),
    }};
    const panel=createSearchToolsPanel({search,download(){},document:{createElement:element}});
    return {panel,slots,resolve,get reads(){return reads;},set key(value){key=value;},get subscribed(){return !!subscriber;}};
}
test('reopening paints cached counts synchronously while a slow fresh count is pending',async()=>{
    const f=fixture({embedded:104,pending:1});
    assert.equal(f.slots.get('[data-embedding-count]').textContent,'최근 확인: 104/105 완료 · 남은 임베딩 1개');
    assert.equal(f.slots.get('.al-range-actions').children[0].disabled,false);
    assert.equal(f.reads,1);f.resolve({embedded:105,pending:0});await new Promise(r=>setImmediate(r));
    assert.equal(f.slots.get('[data-embedding-count]').textContent,'105/105 완료 · 남은 임베딩 0개');
    assert.equal(f.slots.get('.al-range-actions').children[0].disabled,true);f.panel.dispose();assert(!f.subscribed);
});
test('first count only uses the lightweight path and a closed panel ignores late results',async()=>{
    const f=fixture();assert.equal(f.reads,1);assert.equal(f.slots.get('.al-range-actions').children[0].disabled,true);
    f.panel.dispose();f.resolve({embedded:7,pending:0});await new Promise(r=>setImmediate(r));
    assert(!f.slots.get('[data-embedding-count]').textContent.includes('7/7'));
});
