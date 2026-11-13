// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import Handlebars from 'handlebars';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args=process.env.CHROMIUM_ARGS_MODULE?(await import(process.env.CHROMIUM_ARGS_MODULE)).default.args:[];
Handlebars.registerHelper('eq',(a,b)=>a===b);
const source=await fs.readFile(root+'profileManager.js','utf8');
const marker='const profileEditTemplate = Handlebars.compile(`';const start=source.indexOf(marker)+marker.length;
const profile=Handlebars.compile(source.slice(start,source.indexOf('`);',start)))({archiveLoreFork:true,name:'기본 수집',connection:{api:'current_st'},archiveLoreConnections:[{id:'saved',name:'저장된 연결',selected:true}],titleFormats:[{value:'[000] - {{title}}',label:'번호 · 제목',isSelected:true}]});
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/lore-fork.css">${process.env.KOREAN_FONT_ROOT?'<link rel="stylesheet" href="/fonts/400.css">':''}
<style>:root{--SmartThemeBlurTintColor:#f8f9fb;--SmartThemeBodyColor:#303740;--SmartThemeBorderColor:#d5dbe3;--mainFontSize:16px}body{background:#edf0f4;color:#303740;font:14px 'Noto Sans KR',Arial;margin:12px}#panel{background:#f8f9fb;padding:16px;max-width:700px;margin:auto;border-radius:12px}.checkbox_label{display:flex;align-items:center;gap:7px}.world_entry_form_control{margin:12px 0}input:not([type=checkbox]):not([type=radio]),select,textarea{max-width:100%;box-sizing:border-box}.displayNone,[hidden]{display:none!important}</style>
<div id="chat"></div><div id="panel" class="al-fork-surface"><section class="al-home-pane" data-home-pane="settings"></section><main></main><p role="status">진행 중 · 3/10</p><div class="warning">삭제하면 복원할 수 없습니다.</div></div>
<div class="al-fork-settings"><div class="inline-drawer-content"></div></div>
<script src="/handlebars.js"></script><script type="module">
import {generalSettingsTemplate,automaticMemoriesSettingsTemplate} from '/templates.js';
import {installSettingsHelp} from '/lore-help.js';
import {sideSearchControl} from '/lore-side-search.js';
import {sideWriteModeControl} from '/lore-side-write-mode.js';
window.mountSide=()=>{
 window.archiveLoreFork=true;
 const d=document.createElement('dialog');d.id='side-test';
 d.innerHTML=sideSearchControl('stmb-sp-edit',{archiveLoreSearchEnabled:false})+sideWriteModeControl('stmb-sp-edit')+'<p role="status">저장됨</p><p class="warning">삭제하시겠습니까?</p>';
 document.body.append(d);d.show();
};
Handlebars.registerHelper('eq',(a,b)=>a===b);
const locale=await (await fetch('/locales/ko-kr.json')).json();
window.translate=()=>{for(const e of document.querySelectorAll('[data-i18n]')){const key=e.dataset.i18n.split(';')[0];if(!key.startsWith('[') && locale[key])e.textContent=locale[key];}};
window.paint=kind=>{document.querySelector('main').innerHTML=(kind==='automatic'?automaticMemoriesSettingsTemplate:generalSettingsTemplate)({maxTokens:2000,autoSummaryInterval:20,autoSummaryBuffer:0});translate();};paint();
window.help=installSettingsHelp({read:()=>JSON.parse(localStorage.getItem('help') || 'null'),write:value=>{localStorage.setItem('help',JSON.stringify(value));window.writes=(window.writes||0)+1;}});window.ready=true;
</script>`;
const server=http.createServer(async(req,res)=>{try{
const pathname=new URL(req.url,'http://local').pathname;
if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
if(pathname==='/lib.js'){res.setHeader('Content-Type','text/javascript');res.end('export const Handlebars=window.Handlebars;');return;}
if(pathname.startsWith('/fonts/') && process.env.KOREAN_FONT_ROOT){const rel=pathname.slice(7);if(rel.includes('..'))throw Error('path');res.setHeader('Content-Type',rel.endsWith('.css')?'text/css':'font/woff2');res.end(await fs.readFile(process.env.KOREAN_FONT_ROOT+'/'+rel));return;}
const path=pathname==='/handlebars.js'?'node_modules/handlebars/dist/handlebars.js':pathname.slice(1);if(path.includes('..'))throw Error('path');res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'text/javascript');res.end(await fs.readFile(root+path));
}catch(e){res.statusCode=404;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args});
try{
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
for(const width of [320,390,1000]){
 await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 const toggle=page.locator('[data-al-help-toggle]').first();await toggle.check();
 assert.equal(await page.locator('[data-al-help-toggle]').count(),2);
 assert.equal(await page.locator('main input:not([type=file]),main select,main textarea').evaluateAll(items=>items.filter(e=>!e.hasAttribute('aria-describedby')).map(e=>e.id||e.outerHTML)).then(x=>x.length),0);
 await page.locator('#stmb-max-tokens').fill('4096');
 await page.locator('#stmb-unhide-before-memory').check();
 // Clicking/selecting a description must not toggle its enclosing checkbox.
 const desc=await page.locator('#stmb-unhide-before-memory').getAttribute('aria-describedby');
 assert((await page.locator('#'+desc).textContent()).includes('실제로 해제'));
 await page.locator('#'+desc).click();assert(await page.locator('#stmb-unhide-before-memory').isChecked());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await toggle.uncheck();
 assert.equal(await page.locator('[data-al-help]:visible').count(),0);
 assert.equal(await page.locator('[data-al-help-toggle]:checked').count(),0);
 assert(await page.getByRole('status').isVisible());for(const warning of await page.locator('.warning').all())assert(await warning.isVisible());
 assert.equal(await page.locator('#stmb-max-tokens').inputValue(),'4096');
 assert(await page.locator('#stmb-unhide-before-memory').isChecked());
 await page.reload();await page.waitForFunction(()=>window.ready);
 assert.equal(await page.locator('[data-al-help-toggle]:checked').count(),0);assert.equal(await page.locator('[data-al-help]:visible').count(),0);
 await toggle.check();await page.evaluate(()=>paint('automatic'));
 await page.waitForFunction(()=>document.querySelector('#stmb-auto-summary-buffer')?.hasAttribute('aria-describedby'));
 assert.equal(await page.locator('main input,main select').evaluateAll(items=>items.filter(e=>!e.hasAttribute('aria-describedby')).map(e=>e.outerHTML)).then(x=>x.length),0);
 // Native popup without markStmbPopup, reused on profile switch.
 await page.evaluate(html=>{const d=document.createElement('dialog');d.id='profile-test';d.innerHTML=html;document.body.append(d);d.show();translate();},profile);
 await page.waitForFunction(()=>document.querySelector('#al-native-connection')?.hasAttribute('aria-describedby'));
 assert.equal(await page.locator('#profile-test input,#profile-test select').evaluateAll(items=>items.filter(e=>!e.hasAttribute('aria-describedby')).map(e=>e.id||e.name)).then(x=>x.length),0);
 const radioHelp=await page.locator('#profile-test input[name="order-mode"]').evaluateAll(items=>items.map(e=>e.getAttribute('aria-describedby')));
 assert.equal(new Set(radioHelp).size,1);
 const customHelp=await page.locator('#stmb-profile-custom-title-format').getAttribute('aria-describedby');
 assert.equal(await page.locator('#'+customHelp).isVisible(),false);
 await page.locator('#profile-test').screenshot({path:'/tmp/archive-lore-profile-help-'+width+'.png'});
 await page.locator('#profile-test').evaluate(e=>e.remove());
 // Side editing keeps its choice, labels and status while long static/dynamic help follows the switch.
 await page.evaluate(()=>mountSide());
 const side=page.locator('#side-test');
 await page.waitForFunction(()=>document.querySelector('#stmb-sp-edit-archive-search')?.hasAttribute('aria-describedby'));
 assert.equal(await side.locator('#stmb-sp-edit-archive-search').isChecked(),false);
 assert(await side.locator('.al-optional-help').isVisible());
 await toggle.uncheck();
 assert.equal(await side.locator('[data-al-help]:visible,.al-optional-help:visible').count(),0);
 assert(await side.getByText('아카이브 검색에 포함',{exact:true}).isVisible());
 assert(await side.getByRole('status').isVisible());assert(await side.locator('.warning').isVisible());
 await side.locator('#stmb-sp-edit-archive-search').check();
 await toggle.check();assert(await side.locator('.al-optional-help').isVisible());
 assert(await side.locator('#stmb-sp-edit-archive-search').isChecked());
 await side.evaluate(e=>e.remove());
 // Dynamic search settings have names, not native IDs. Server/error notices remain visible.
 await page.evaluate(()=>{const d=document.createElement('dialog');d.className='al-settings-dialog';d.id='search-test';d.innerHTML='<div data-settings-body><div class="al-settings"><label>검색 방식<select name="mode"><option>질문으로 검색</option></select></label><label>자동 임베딩<input name="autoEmbed" type="checkbox"></label><div role="alert">연결 오류</div></div></div>';document.body.append(d);d.show();});
 await page.waitForFunction(()=>document.querySelector('[name=autoEmbed]')?.hasAttribute('aria-describedby'));
 assert.equal(await page.locator('[data-al-help-toggle]').count(),3);
 await page.locator('#search-test [data-al-help-toggle]').uncheck();assert(await page.getByRole('alert').isVisible());
 await page.locator('#search-test [data-al-help-toggle]').check();
 await page.evaluate(()=>{document.querySelector('#search-test [data-settings-body]').innerHTML='<div class="al-settings"><label>검색 방식<select name="mode"><option>대화로 검색</option></select></label></div>';});
 await page.locator('#search-test [data-al-help-toggle]').waitFor();
 assert.equal(await page.locator('[data-al-help-toggle]').count(),3);
 await page.locator('#search-test').evaluate(e=>e.remove());
 // Chat mutations must not be decorated; repeated refresh must not duplicate descriptions.
 await page.evaluate(()=>{for(let i=0;i<100;i++){const span=document.createElement('span');span.textContent='stream ';document.querySelector('#chat').append(span);}for(let i=0;i<20;i++)help.refresh(document.querySelector('#panel'));});
 const count=await page.locator('[data-al-help]').count();await page.evaluate(()=>help.refresh(document.querySelector('#panel')));assert.equal(await page.locator('[data-al-help]').count(),count);
 assert.equal(await page.locator('#chat [data-al-help]').count(),0);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.evaluate(()=>{document.querySelector('#chat').replaceChildren();return document.fonts.ready;});await page.screenshot({path:'/tmp/archive-lore-help-'+width+'.png',fullPage:true});
 await page.evaluate(()=>localStorage.clear());
}
assert.deepEqual(errors,[]);console.log('Help: native settings/profile coverage, search, persistence, live sync, input preservation, dynamic refresh, mobile and desktop passed.');
}finally{await browser.close();server.close();}
