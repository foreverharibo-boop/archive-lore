// SPDX-License-Identifier: AGPL-3.0-only
// Real native forms and save/change handlers; only SillyTavern host services are stubbed.
import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args=process.env.CHROMIUM_ARGS_MODULE?(await import(process.env.CHROMIUM_ARGS_MODULE)).default.args:[];
const source=await fs.readFile(root+'index.js','utf8');
function extract(name){const start=source.indexOf('function '+name+'('),end=start+source.slice(start).search(/\n}\r?(?:\n|$)/)+2;assert(start>=0 && end>start);return source.slice(start,end);}
const functions=['getDefaultProfileTitleFormat','setDefaultProfileTitleFormat','persistMemoryReminderControls','persistMainPopupSettings','setupSettingsEventListeners'].map(extract).join('\n');
const native=`
import {captureSettingsForm,acknowledgeSettingsControl,changedSettingsForm} from '/lore-native-settings.js';
import {settingsTemplate,generalSettingsTemplate,automaticMemoriesSettingsTemplate} from '/templates.js';
import {ARCHIVE_LORE_TITLE_FORMAT} from '/lore-native-title.js';
import {MEMORY_REMINDER_DEFAULTS,normalizeReminderInterval} from '/memoryReminders.js';
Handlebars.registerHelper('eq',(a,b)=>a===b);
const DEFAULT_TITLE_FORMAT='[000] - {{title}}',DEFAULT_MAX_TOKENS=2000;
let currentPopupInstance=null;
const initializeSettings=()=>window.settings;
const saveSettingsDebounced=()=>localStorage.setItem('settings',JSON.stringify(settings));
const clampInt=(v,a,b)=>Math.max(a,Math.min(b,v));
const readIntInput=(e,f)=>Number.isFinite(parseInt(e?.value))?parseInt(e.value):f;
const normalizeMemoryBoundaryMode=v=>v||'both',normalizeSidePromptSetKey=v=>v||'';
const normalizeAutoConsolidationTargetTiers=v=>Array.isArray(v)?v:[];
const getAutoHideMode=s=>s.autoHideMode||'none';
const getMemoryReminderController=()=>({check(){}});
const syncGroupSettingsControls=()=>{},refreshFloatingClipButtonSetting=()=>{},refreshMemoryBoundaryUi=()=>{};
const translate=s=>s;
${functions}
window.reset=()=>{window.settings={defaultProfile:0,titleFormat:DEFAULT_TITLE_FORMAT,profiles:[{name:'First',titleFormat:DEFAULT_TITLE_FORMAT},{name:'Second',titleFormat:'[[00]] {{title}}'}],moduleSettings:{maxTokens:2000,showMemoryPreviews:false,showNotifications:false,autoSummaryInterval:20,autoSummaryTokenThreshold:4000,autoSummaryBuffer:0,tokenWarningThreshold:50000,unhiddenEntriesCount:10}};};
window.reset();
window.mount=(kind='main')=>{
 const old=document.querySelector('main');if(old)old.remove();const main=document.createElement('main');document.body.append(main);
 const format=settings.profiles[settings.defaultProfile].titleFormat;
 const data={...settings.moduleSettings,profiles:settings.profiles.map((p,i)=>({...p,isDefault:i===settings.defaultProfile})),selectedProfile:settings.profiles[settings.defaultProfile],titleFormats:[DEFAULT_TITLE_FORMAT,ARCHIVE_LORE_TITLE_FORMAT,'[[00]] {{title}}'].map(v=>({value:v,label:v,isSelected:v===format})),titleFormat:format,customTitleFormat:format,autoHideMode:'none',autoHideModeNone:true};
 main.innerHTML=({main:settingsTemplate,general:generalSettingsTemplate,automatic:automaticMemoriesSettingsTemplate}[kind])(data);
 setupSettingsEventListeners({dlg:main});window.form=main;return main;
};
window.flush=()=>persistMainPopupSettings(form);
window.reopen=kind=>{flush();window.settings=JSON.parse(localStorage.getItem('settings'));mount(kind);};
window.externalSave=patch=>{Object.assign(settings.moduleSettings,patch);saveSettingsDebounced();};
window.setTitle=title=>{setDefaultProfileTitleFormat(settings,title);saveSettingsDebounced();};
window.ready=true;
`;
const server=http.createServer(async(req,res)=>{try{
 const p=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type',p==='/'?'text/html':'text/javascript');
 if(p==='/'){res.end('<script src="/handlebars.js"></script><script type="module" src="/native.js"></script>');return;}
 if(p==='/native.js'){res.end(native);return;}
 if(p==='/lib.js'){res.end('export const Handlebars=window.Handlebars;');return;}
 if(p.includes('..'))throw Error('invalid');res.end(await fs.readFile(root+(p==='/handlebars.js'?'node_modules/handlebars/dist/handlebars.js':p.slice(1))));
}catch(e){res.statusCode=404;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e);});page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 // A nested profile editor saves while the parent still shows its old format.
 await page.evaluate(()=>{try{mount();setTitle('{{archiveLoreTitle}}');flush();reopen();}catch(e){console.error(e.stack||String(e));throw Error(e.message||String(e));}});
 assert.equal(await page.locator('#stmb-title-format-select').inputValue(),'{{archiveLoreTitle}}');
 // Switching the active profile must preserve both profiles' own formats.
 await page.evaluate(()=>{settings.defaultProfile=1;flush();mount();});
 assert.equal(await page.locator('#stmb-title-format-select').inputValue(),'[[00]] {{title}}');
 assert.equal(await page.evaluate(()=>settings.profiles[0].titleFormat),'{{archiveLoreTitle}}');
 // Custom native formats support any numbering width, including edits not yet blurred.
 await page.locator('#stmb-title-format-select').selectOption('custom');
 await page.locator('#stmb-custom-title-format').fill('[00] - {{title}}');
 await page.evaluate(()=>flush());assert.equal(await page.evaluate(()=>settings.profiles[1].titleFormat),'[00] - {{title}}');
 await page.locator('#stmb-custom-title-format').fill('[0] - {{title}}');
 await page.locator('#stmb-custom-title-format').dispatchEvent('change');
 assert.equal(await page.evaluate(()=>settings.profiles[1].titleFormat),'[0] - {{title}}');
 // An already-saved edit in the parent must not overwrite a newer child save.
 await page.evaluate(()=>{mount('general');});
 await page.locator('#stmb-show-notifications').check();
 await page.evaluate(()=>{externalSave({showNotifications:false,maxTokens:3072});flush();reopen('general');});
 assert.equal(await page.locator('#stmb-show-notifications').isChecked(),false);
 assert.equal(await page.locator('#stmb-max-tokens').inputValue(),'3072');
 // Save, serialize, reopen actual general controls, including unchecked values.
 await page.locator('#stmb-show-memory-previews').check();
 await page.locator('#stmb-unhide-before-memory').check();
 await page.locator('#stmb-allow-scene-overlap').check();
 await page.locator('#stmb-max-tokens').fill('4096'); // No change event yet.
 await page.evaluate(()=>reopen('general'));
 for(const id of ['show-memory-previews','unhide-before-memory','allow-scene-overlap'])assert(await page.locator('#stmb-'+id).isChecked());
 assert.equal(await page.locator('#stmb-max-tokens').inputValue(),'4096');
 // Automatic collection, token threshold and multiselect targets persist together.
 await page.evaluate(()=>mount('automatic'));
 await page.locator('#stmb-auto-summary-interval').fill('30');await page.locator('#stmb-auto-summary-interval').dispatchEvent('change');
 await page.locator('#stmb-auto-summary-token-threshold').fill('7000');await page.locator('#stmb-auto-summary-token-threshold').dispatchEvent('change');
 await page.locator('#stmb-auto-summary-enabled').check();
 const tierValues=await page.locator('#stmb-auto-consolidation-target-tier option').evaluateAll(x=>x.slice(0,2).map(o=>o.value));
 await page.locator('#stmb-auto-consolidation-target-tier').selectOption(tierValues);
 await page.evaluate(()=>reopen('automatic'));
 assert.equal(await page.locator('#stmb-auto-summary-interval').inputValue(),'30');
 assert.equal(await page.locator('#stmb-auto-summary-token-threshold').inputValue(),'7000');
 assert(await page.locator('#stmb-auto-summary-enabled').isChecked());
 assert.deepEqual(await page.evaluate(()=>settings.moduleSettings.autoConsolidationTargetTiers),tierValues);
 assert.deepEqual(errors,[]);
 console.log('Native settings: nested save, profile switch, custom titles, latest-child-wins, live changes, unblurred edits and general/automatic reload passed.');
}finally{await browser.close();server.close();}
