// SPDX-License-Identifier: AGPL-3.0-only
// JSDOM_MODULE may point to an external jsdom installation; production has no DOM-test dependency.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import Handlebars from 'handlebars';
import {mountCollectionPreferences} from '../lore-collection-options.js';
const {JSDOM}=await import(process.env.JSDOM_MODULE || 'jsdom');
Handlebars.registerHelper('eq',(a,b)=>a===b);
const source=(await fs.readFile(new URL('../templates.js',import.meta.url),'utf8'))
    .replace(/^import .*;$/m,'').replace(/^export /gm,'');
const render=vm.runInNewContext(source+'\ngeneralSettingsTemplate;',{Handlebars});
const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main');
let settings={moduleSettings:{unrelated:true}},saved=null,saves=0;
const mount=()=>{
    root.innerHTML=render({});
    mountCollectionPreferences(root,{settings,save:()=>{saves++;saved=JSON.stringify(settings);}});
};
const input=id=>root.querySelector('#'+id);
mount();
mountCollectionPreferences(root,{settings,save:()=>{throw Error('duplicate mount');}});
assert.equal(root.querySelectorAll('#al-collection-options').length,1);
assert.equal(input('al-collection-order-100').checked,false);
assert.equal(input('al-collection-no-keywords').checked,false);
input('al-collection-order-100').click();input('al-collection-no-keywords').click();
assert.equal(saves,2);
settings=JSON.parse(saved);mount();
assert.equal(input('al-collection-order-100').checked,true);
assert.equal(input('al-collection-no-keywords').checked,true);
input('al-collection-order-100').click();
settings=JSON.parse(saved);mount();
assert.equal(input('al-collection-order-100').checked,false);
assert.equal(input('al-collection-no-keywords').checked,true);
assert.equal(settings.moduleSettings.unrelated,true);
for(const id of ['al-collection-order-100','al-collection-no-keywords']){
    assert(input(id).closest('label').textContent.trim());
    assert(root.querySelector('#'+input(id).getAttribute('aria-describedby')).textContent.trim());
}
const ko=JSON.parse(await fs.readFile(new URL('../locales/ko-kr.json',import.meta.url),'utf8'));
root.innerHTML=render({});
mountCollectionPreferences(root,{settings,save:()=>{},translate:(_text,key)=>{assert(ko[key]);return ko[key];}});
assert(root.textContent.includes('수집 시 순서를 항상 100으로 고정'));
assert(root.textContent.includes('수집 시 키워드 생성 안 함'));
dom.window.close();
console.log('General-settings DOM checks passed: insertion, defaults, independent toggles, persistence, accessible labels, translations and duplicate mounting.');
