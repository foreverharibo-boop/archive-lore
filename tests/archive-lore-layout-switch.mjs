// SPDX-License-Identifier: AGPL-3.0-only
// Exercise production preference/open/close functions with asynchronous popup teardown.
import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extra=process.env.CHROMIUM_ARGS_MODULE?(await import(process.env.CHROMIUM_ARGS_MODULE)).default.args:[];
const root=fileURLToPath(new URL('../',import.meta.url));
const source=await fs.readFile(root+'index.js','utf8');
const lifecycle=source.slice(source.indexOf('async function showArchiveLorePreferences()'),source.indexOf('async function showGeneralSettingsPopup('));
const close=source.slice(source.indexOf('function handleSettingsPopupClose('),source.indexOf('/**\n * Refresh popup content'));
const harness=`
import {settingsTemplate} from '/templates.js';
import {nativePreferences,createNativePreferences,appendOriginalTools,applyNativeTheme} from '/lore-native-preferences.js';
import {FEATURE_GROUPS,organizeMemoryBooks} from '/lore-fork-layout.js';
globalThis.archiveLoreFork=true;
window.testSettings={moduleSettings:{archiveLoreBookMode:'fixed',archiveLoreBook:'Shared',archiveLorePalette:'rose'},profiles:[{name:'Native profile'}],defaultProfile:0};
window.calls=[];window.saves=0;
let currentPopupInstance=null;
const initializeSettings=()=>testSettings,translate=x=>x,DOMPurify={sanitize:x=>x};
const world_names=['Shared','Other'],POPUP_TYPE={TEXT:1},POPUP_RESULT={CANCELLED:null};
const saveSettingsDebounced=()=>saves++;
const getCurrentCanonicalLorebookName=()=>testSettings.moduleSettings.archiveLoreBook;
const reconcileCurrentManualGroupStloFilters=async()=>{};
const setupSettingsEventListeners=()=>{},initializeSettingsPopupSelect2=()=>{},captureSettingsForm=()=>{},mountArchiveLoreLazyDetails=()=>{};
const handleSettingsFormPopupClose=()=>{},refreshPopupContent=async()=>{};
const getSceneMarkers=()=>({sceneStart:0,sceneEnd:1});
const initiateMemoryCreation=async()=>calls.push('create'),showSummaryConsolidationPopup=async()=>calls.push('consolidate'),clearScene=()=>calls.push('clear');
const markStmbPopup=popup=>{popup.dlg.classList.add('stmb-popup');applyNativeTheme(popup.dlg,testSettings);return popup;};
const buildSettingsTemplateData=async()=>({profiles:[{name:'Native profile',isDefault:true}],selectedProfile:{connection:{api:'Native API',model:'Native Model'},effectivePrompt:'Native prompt'},currentLorebookName:'Shared'});
class Popup {
 constructor(content,type,value,options){
  this.options=options;this.dlg=document.createElement('dialog');this.dlg.className='popup';this.content=document.createElement('div');this.content.className='popup-content';
  if(typeof content==='string')this.content.innerHTML=content;else this.content.append(content);this.dlg.append(this.content);
  const controls=document.createElement('div');controls.className='popup-controls';this.dlg.append(controls);
  for(const action of options.customButtons || []){const b=document.createElement('button');b.className='menu_button popup-button-custom';b.textContent=action.text;b.onclick=action.action;controls.append(b);}
  const close=document.createElement('button');close.className='menu_button popup-button-cancel';close.textContent=options.cancelButton;close.onclick=()=>this.complete(null);controls.append(close);
 }
 show(){document.body.append(this.dlg);this.dlg.showModal();this.closed=new Promise(r=>this.resolve=r);return this.closed;}
 complete(result){setTimeout(()=>{this.dlg.close();this.options.onClose?.(this);this.dlg.remove();this.resolve(result);},25);return this.closed;}
}
function populateInlineButtons(){
 const popup=currentPopupInstance;
 const native=document.createElement('button');native.id='native-edit-profile';native.textContent='Edit';native.onclick=()=>calls.push('edit');popup.content.querySelector('#stmb-profile-buttons').append(native);
 for(const [, ,features] of FEATURE_GROUPS)for(const [id] of features)if(id.startsWith('stmb-')){const b=document.createElement('button');b.id=id;b.textContent='Native '+id;popup.content.querySelector('#stmb-prompt-manager-buttons').append(b);}
 const actions={'al-preferences':()=>showArchiveLorePreferences(),'al-search-tools':()=>calls.push('search')};
 if(nativePreferences(testSettings).layout==='original')appendOriginalTools(popup.dlg,actions,popup.content);
 else organizeMemoryBooks(popup.dlg,actions,popup.content);
}
${close}
${lifecycle}
window.openHome=()=>{void showSettingsPopup();};
openHome();
`;
const server=http.createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname;
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/lore-fork.css"><style>:root{--SmartThemeBlurTintColor:#f8f9fb;--SmartThemeBodyColor:#303740;--SmartThemeBorderColor:#d5dbe3;--mainFontSize:16px}body{font:14px Arial}dialog{width:85vw;max-height:85vh;overflow:auto}.displayNone{display:none!important}.menu_button{width:auto;padding:8px;cursor:pointer}.popup-controls{display:flex;gap:8px}</style><script src="/handlebars.js"></script><script type="module" src="/lifecycle.js"></script>');return;}
 if(path==='/lifecycle.js'){res.setHeader('Content-Type','text/javascript');res.end(harness);return;}
 if(path==='/lib.js'){res.setHeader('Content-Type','text/javascript');res.end('export const Handlebars=window.Handlebars;');return;}
 const file=path==='/handlebars.js'?'node_modules/handlebars/dist/handlebars.js':path.slice(1);if(file.includes('..'))throw Error('invalid path');
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(root+file));
}catch(e){res.statusCode=404;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,args:extra});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [390,1000]){
  await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.al-feature-home').waitFor();
  for(let round=0;round<2;round++){
   await page.locator('[data-home-tab=settings]').click();await page.locator('#al-preferences').click();await page.locator('#al-layout').waitFor();
   // Unsaved routing choices must not be applied by a screen switch.
   await page.locator('#al-book-mode').selectOption('chat');
   await page.locator('#al-layout').selectOption('original');
   await page.locator('.al-original-addons').waitFor();
   assert.equal(await page.locator('dialog').count(),1);assert.equal(await page.locator('.al-feature-home').count(),0);
   assert.equal(await page.locator('h2').innerText(),'📕 Memory Books');
   assert.equal(await page.locator('.popup-controls .popup-button-custom').count(),3);
   assert(await page.locator('#stmb-profile-buttons #native-edit-profile').isVisible());
   await page.locator('#native-edit-profile').click();await page.getByRole('button',{name:'🌈 Consolidate Memories',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>calls.slice(-2)),['edit','consolidate']);
   assert.equal(await page.evaluate(()=>testSettings.moduleSettings.archiveLoreBookMode),'fixed');
   assert.equal(await page.evaluate(()=>testSettings.moduleSettings.archiveLoreBook),'Shared');
   // Closing and reopening uses the saved original screen, not just host colors.
   await page.locator('.popup-button-cancel').click();await page.waitForFunction(()=>!document.querySelector('dialog'));await page.evaluate(()=>openHome());await page.locator('.al-original-addons').waitFor();
   assert.equal(await page.locator('.popup-controls .popup-button-custom').count(),3);
   await page.locator('#al-preferences').click();assert.equal(await page.locator('#al-layout').inputValue(),'original');
   await page.locator('#al-layout').selectOption('archive');await page.locator('.al-feature-home').waitFor();
   assert.equal(await page.locator('dialog').count(),1);assert.equal(await page.locator('.al-original-addons').count(),0);
   assert.equal(await page.locator('.popup-controls .popup-button-custom').count(),0);
   assert.equal(await page.locator('dialog').getAttribute('data-al-palette'),'rose');
   assert.equal(await page.locator('.al-home-tabs button').count(),3);
  }
 }
 assert.deepEqual(errors,[]);console.log('Production layout switching: original template/footer/actions, immediate selection, repeated round trips, reopen persistence and unsaved routing isolation passed.');
}finally{await browser.close();server.close();}
