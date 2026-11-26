// Archive Lore — AGPL-3.0-only
// Run the real settings renderer and event handlers with a DOM implementation.
import assert from 'node:assert/strict';
const {JSDOM}=await import(process.env.DOM_MODULE || 'jsdom');
const dom=new JSDOM('<main></main>',{url:'https://settings.test/'});
globalThis.document=dom.window.document;
const {createLoreUI}=await import('../lore-ui.js');
const {normalizeSettings}=await import('../lore-core.js');
const {helpFor}=await import('../lore-help-catalog.js');
let settings=normalizeSettings({injectionTokens:5000});
const errors=[];
const api={settings:()=>settings,saveSettings:patch=>{settings=normalizeSettings({...settings,...patch});dom.window.localStorage.setItem('settings',JSON.stringify(settings));},profiles:()=>[],context:()=>({key:'test'}),error:e=>errors.push(e),diagnostics:{preview:async()=>''}};
function mount(){const old=document.querySelector('main');const main=document.createElement('main');old.replaceWith(main);createLoreUI(api).mountSettings(main);return main;}
let main=mount();let input=main.querySelector('[name="reviewTokens"]');
assert.equal(input.value,'8000');assert.equal(input.min,'1000');assert.equal(input.max,'64000');assert.equal(input.disabled,false);
assert(helpFor(input).includes('최종 주입 상한과 별도'));assert.equal(input.closest('[data-settings-pane]').dataset.settingsPane,'collection');
input.value='16000';input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await Promise.resolve();
assert.equal(settings.reviewTokens,16000);assert.equal(settings.injectionTokens,5000);
settings=JSON.parse(dom.window.localStorage.getItem('settings'));main=mount();input=main.querySelector('[name="reviewTokens"]');assert.equal(input.value,'16000');
const mode=main.querySelector('[name="mode"]');mode.value='embedding';mode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await Promise.resolve();assert.equal(input.disabled,true);assert.equal(settings.reviewTokens,16000);
mode.value='questions';mode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await Promise.resolve();assert.equal(input.disabled,false);assert.equal(input.value,'16000');
settings=normalizeSettings({...settings,mode:'embedding'});main=mount();assert.equal(main.querySelector('[name="reviewTokens"]').disabled,true);
await Promise.resolve();assert.deepEqual(errors,[]);dom.window.close();
console.log('PASS default/range, saved value after reopen, independent injection limit, help and embedding-mode disable/reenable');
