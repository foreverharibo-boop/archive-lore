// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
const { chromium: pw } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extra = process.env.CHROMIUM_ARGS_MODULE ? (await import(process.env.CHROMIUM_ARGS_MODULE)).default.args : [];
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${process.env.KOREAN_FONT_ROOT ? '<link rel="stylesheet" href="/fonts/400.css">' : ''}<link rel="stylesheet" href="/scripts/extensions/third-party/archive-lore/lore-style.css"><style>:root{--SmartThemeBlurTintColor:#f7f9fc;--SmartThemeBodyColor:#303740;--SmartThemeBorderColor:#cbd6e3;--SmartThemeQuoteColor:#e5ebf2;--black30a:#fff}body{background:#e9eef4;font-family:'Noto Sans KR',Arial,sans-serif;margin:15px}.inline-drawer-content{display:block}.inline-drawer-header{padding:10px}input,select,textarea{color:inherit}button{cursor:pointer}#extensions_settings2{max-width:600px;margin:auto}</style><div id="extensionsMenu"></div><div id="extensions_settings2"></div><script>
window.errors=[];window.toastr={warning:e=>errors.push(e),error:(e)=>errors.push(e),success:()=>{},info:()=>{}};window.commands={};window.prompts={};window.events={};window.settings={archiveLore:{embeddingKey:'fixture-only',profile:'p',cacheNamespace:'fixture'}};
window.ctx={extensionSettings:settings,chatMetadata:{},characters:[{avatar:'test.png',data:{extensions:{world:'Example'}}}],characterId:0,name1:'User',name2:'Character',chat:[{name:'User',mes:'2026-03-01. 같이 병원에 가자.',is_user:true},{name:'Character',mes:'좋아, 같이 가자.'}],getCurrentChatId:()=> 'test-chat',saveMetadata:async()=>{},getTokenCountAsync:async t=>Math.ceil(t.length/3),setExtensionPrompt:(k,v)=>prompts[k]=v};
ctx.extensionSettings.connectionManager={selectedProfile:'p',profiles:[{id:'p',name:'Test profile',model:'fixture'}]};ctx.ConnectionManagerRequestService={getProfile:()=>({model:'fixture'}),validateProfile:()=>({selected:'openai',source:'openai'}),sendRequest:async(_id,messages)=>{const sys=messages[0].content;if(sys.includes('sideChanges'))return {choices:[{message:{content:JSON.stringify({entries:[{title:'Hospital promise',date:'2026-03-01',time:'Morning',location:'Home',content:'They agreed to visit the hospital together.',keywords:['hospital']}],sideChanges:['relationship','agreements','preferences','emotions','turningPoints','plans'].map(category=>({op:'add',category,text:category==='relationship'?'Lovers':'Example fact for '+category,evidence:{message:0,quote:'같이 병원에 가자.'},...(category==='relationship'?{relationship:{kind:'start',since:'2026-03-01'},dateEvidence:{message:0,quote:'2026-03-01'}}:{})})),storyDate:{date:'2026-03-01',evidence:{message:0,quote:'2026-03-01'}}})}}]};if(sys.includes('questions') && window.badQuestion)return {choices:[{message:{content:'invalid JSON test'}}]};if(sys.includes('questions'))return {choices:[{message:{content:'{"questions":["병원 약속은 무엇인가?"]}'}}]};return {choices:[{message:{content:'{"ids":["u0"]}'}}]};}};
</script><script type="module" src="/scripts/extensions/third-party/archive-lore/archive-lore.js"></script>`;
const modules={
'/script.js':`export const eventSource={on:(n,cb)=>(window.events[n]||=[]).push(cb),emit:async(n,...a)=>{for(const cb of window.events[n]||[])await cb(...a)}};export const event_types={WORLDINFO_UPDATED:'world',WORLDINFO_ENTRIES_LOADED:'entries',CHAT_CHANGED:'chat',MESSAGE_EDITED:'edit',MESSAGE_DELETED:'delete',MESSAGE_SWIPED:'swipe',MESSAGE_RECEIVED:'received',GENERATION_ENDED:'ended',GENERATION_STOPPED:'stopped'};export const extension_prompt_types={IN_CHAT:1};export const getRequestHeaders=()=>({'Content-Type':'application/json'});export const saveSettingsDebounced=()=>{};export const getCurrentChatId=()=>ctx.getCurrentChatId();export const name1='User',name2='Character',chat_metadata=ctx.chatMetadata,saveMetadata=()=>ctx.saveMetadata();`,
'/scripts/extensions.js':`export const getContext=()=>window.ctx;export const extension_settings=window.settings;`,
'/scripts/world-info.js':`export const world_names=['Example'];export const worldInfoCache=new Map();export const METADATA_KEY='world_info';export const updateWorldInfoList=async()=>{};export const createNewWorldInfo=async()=>true;export function createWorldInfoEntry(_,d){const uid=Math.max(-1,...Object.keys(d.entries).map(Number))+1;return d.entries[uid]={uid,constant:false,disable:false,key:[],vectorized:false};}`,
'/scripts/i18n.js':`export const translate=t=>t;`,
'/scripts/slash-commands/SlashCommand.js':`export const SlashCommand={fromProps:x=>x};`,
'/scripts/slash-commands/SlashCommandParser.js':`export const SlashCommandParser={addCommandObject:x=>window.commands[x.name]=x};`,
'/scripts/slash-commands/SlashCommandArgument.js':`export const ARGUMENT_TYPE={STRING:'string'};export const SlashCommandArgument={fromProps:x=>x};`,
};
let book={entries:{0:{uid:0,comment:'코어 설정',content:'두 사람은 오래된 친구다.',constant:true},1:{uid:1,comment:'첫 여행',content:'봄에 함께 바닷가를 방문했다.',constant:false}}};
const server=http.createServer(async(req,res)=>{try{
const url=new URL(req.url,'http://local').pathname;
if(url==='/'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
if(url.startsWith('/fonts/')){res.setHeader('Content-Type',url.endsWith('.css')?'text/css':'font/woff2');res.end(await fs.readFile(path.join(process.env.KOREAN_FONT_ROOT,url.slice(7))));return;}
if(modules[url]){res.setHeader('Content-Type','text/javascript');res.end(modules[url]);return;}
if(url.startsWith('/api/')){let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw);if(url.endsWith('/edit'))book=payload.data;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.endsWith('/get')?book:{}));return;}
const file=url.split('/').pop();if(!/^[\w.-]+$/.test(file))throw Error('bad path');res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(root+'/'+file));
}catch(e){res.statusCode=404;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await pw.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,args:extra,headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});const runtimeErrors=[];page.on('pageerror',e=>{runtimeErrors.push(e.message);console.error('PAGE ERROR',e.message);});page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());});
await page.addInitScript(() => { Object.defineProperty(crypto, 'subtle', { value: undefined }); Object.defineProperty(crypto, 'randomUUID', { value: undefined }); });
await page.route('https://generativelanguage.googleapis.com/**',r=>r.fulfill({json:{embedding:{values:[1,0]}}}));
await page.route('https://aiplatform.googleapis.com/**',r=>{assert.equal(r.request().headers()['x-goog-api-key'],'vertex-fixture-key');return r.fulfill({json:{predictions:[{embeddings:{values:[1,0]}}]}});});
await page.goto('http://127.0.0.1:'+server.address().port);
// Both credential slots survive provider switching; full-screen editing saves and cancels independently.
await page.locator('[name="embeddingProvider"]').selectOption('vertex');
await page.locator('[name="embeddingKey"]').fill('vertex-fixture-key');await page.locator('[name="embeddingKey"]').dispatchEvent('change');
await page.locator('[name="embeddingProvider"]').selectOption('gemini');assert.equal(await page.locator('[name="embeddingKey"]').inputValue(),'fixture-only');
await page.locator('#archive-lore-settings summary').filter({hasText:'기본 프롬프트 편집'}).click();
await page.locator('#archive-lore-settings summary').filter({hasText:'기억 수집'}).click();
await page.locator('[data-action="expand-prompt"][data-key="collect"]').click();
assert(await page.locator('.al-editor').evaluate(e=>e.clientHeight>innerHeight*.9));
await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-fullscreen.png'),fullPage:true});
const originalPrompt=await page.locator('.al-editor textarea').inputValue();
await page.locator('.al-editor textarea').fill(originalPrompt+'\nKeep dates accurate.');
await page.getByRole('button',{name:'저장 후 닫기'}).click();assert((await page.locator('[name="prompt.collect"]').inputValue()).endsWith('Keep dates accurate.'));
await page.locator('[data-action="expand-prompt"][data-key="collect"]').click();await page.locator('.al-editor textarea').fill('discard');await page.getByRole('button',{name:'취소',exact:true}).click();assert((await page.locator('[name="prompt.collect"]').inputValue()).includes('memory archivist'));
await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-settings.png'),fullPage:true});
await page.locator('#archive-lore-menu').click();
await page.locator('[data-next]').filter({hasText:'다음 수집'}).waitFor();
await page.getByRole('button',{name:'기억 수집',exact:true}).click();
await page.locator('[data-status]').filter({hasText:'수집 완료'}).waitFor();
assert.equal(Object.keys(book.entries).length,9);assert.equal(Object.values(book.entries).filter(e=>e.archiveLore?.sideCategory).length,6);assert.equal(book.archiveLore.receipts.length,1);
await page.locator('.al-record').filter({has:page.locator('summary span',{hasText:'Relationship'})}).locator('summary').first().click();
await page.locator('[name="relationshipToday"]').fill('2026-03-12');
await page.locator('.al-record').filter({has:page.locator('[name="relationshipToday"]')}).getByRole('button',{name:'저장',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('[name="relationshipToday"]')?.value==='2026-03-12' && [...document.querySelectorAll('.al-record strong')].some(e=>e.textContent==='Lovers · D+12'));
const relation=Object.values(book.entries).find(e=>e.archiveLore?.sideCategory==='relationship');
assert.equal(relation.content,'Lovers · D+12');assert.equal(relation.archiveLore.history[0].content,'Lovers · D+1');
await page.locator('.al-record').filter({has:page.locator('[name="relationshipToday"]')}).locator('summary').first().click();
await page.locator('[name="relationshipToday"]').scrollIntoViewIfNeeded();
await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-relationship.png'),fullPage:true});
assert(await page.locator('.al-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
await page.evaluate(async entries=>{
    const {managerSourceHash}=await import('/scripts/extensions/third-party/archive-lore/lore-translations.js');
    settings['simple-lorebook']={translations:Object.fromEntries(entries.map(e=>['Example␟'+e.uid,{text:'번역된 내용 '+e.comment,language:'Korean',sourceHash:managerSourceHash(e.content)}]))};
},Object.values(book.entries));
await page.locator('[data-action="refresh"]').click();
await page.waitForFunction(()=>document.querySelector('[data-records]')?.textContent.includes('로어북 매니저 번역'));
await page.evaluate(async()=>{await window.archiveLoreInterceptor([],30000,()=>{throw Error('generation aborted')},'normal');});
const prompts=await page.evaluate(()=>window.prompts);assert(prompts['archive-lore-core'].includes('오래된 친구'));assert(prompts['archive-lore-recalled']);
const scan=await page.evaluate(async()=>{const lists={characterLore:[{world:'Example',uid:0,content:'core',constant:true},{world:'Example',uid:1,content:'memory'}]};for(const cb of events.entries)await cb(lists);return lists;});assert(scan.characterLore.every(e=>e.disable));
await page.waitForFunction(()=>document.querySelector('[data-recall-translations]')?.textContent.includes('전체 번역'));
// Execute ten actual interceptor attempts per mode, then retain response/end events.
await page.evaluate(async()=>{
    for(const mode of ['dialogue','questions']){
        settings.archiveLore.mode=mode;
        for(let i=0;i<10;i++){
            ctx.chat.push({name:'User',mes:mode+' test turn '+i,is_user:true});
            await window.archiveLoreInterceptor([],30000,()=>{throw Error('unexpected abort')},'normal');
            ctx.chat.push({name:'Character',mes:'Fixture reply '+mode+' '+i,is_user:false});
            for(const cb of events.received || [])await cb(ctx.chat.length-1);
            for(const cb of events.ended || [])await cb();
        }
    }
});
await page.evaluate(async()=>{window.badQuestion=true;await window.archiveLoreInterceptor([],30000,()=>{window.aborted=true},'normal');window.badQuestion=false;});
assert.equal(await page.evaluate(()=>window.aborted),true);assert.equal(await page.evaluate(()=>prompts['archive-lore-recalled']),'');
assert.equal((await page.evaluate(()=>window.errors.splice(0))).length,1);
await page.locator('[data-action="refresh"]').click();
await page.locator('summary').filter({hasText:'턴별 진단 기록'}).click();
const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'진단 TXT 다운로드'}).click();
const downloaded=await downloadEvent;const diagnosticText=await fs.readFile(await downloaded.path(),'utf8');
assert.equal((diagnosticText.match(/"stage": "rp.response"/g)||[]).length,20);
assert.equal((diagnosticText.match(/"stage": "injection.installed"/g)||[]).length,21);
assert(diagnosticText.includes('search.ranking'));assert(diagnosticText.includes('ai.request'));assert(diagnosticText.includes('injection.budget'));
assert(!diagnosticText.includes('fixture-only'));assert(!diagnosticText.includes('vertex-fixture-key'));
await page.locator('summary').filter({hasText:'턴별 진단 기록'}).click();
await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-mobile.png'),fullPage:true});
const overflow=await page.evaluate(()=>{const root=document.querySelector('.al-dialog');return {scroll:root.scrollWidth,client:root.clientWidth,font:getComputedStyle(root.querySelector('select')).fontSize};});assert(overflow.scroll<=overflow.client+1);assert.equal(overflow.font,'12px');
await page.getByRole('button',{name:'닫기',exact:true}).click();
await page.locator('[name="enabled"]').uncheck();await page.evaluate(()=>window.archiveLoreInterceptor([],30000,()=>{},'normal'));assert.equal(await page.evaluate(()=>prompts['archive-lore-recalled']),'');
await page.setViewportSize({width:1280,height:900});await page.locator('#archive-lore-menu').click();await page.locator('[data-action="refresh"]').click();await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-desktop.png'),fullPage:true});
await page.getByRole('button',{name:'닫기',exact:true}).click();
await page.locator('[name="embeddingProvider"]').selectOption('vertex');assert.equal(await page.locator('[name="embeddingKey"]').inputValue(),'vertex-fixture-key');
await page.locator('#archive-lore-menu').click();await page.getByRole('button',{name:'남은 임베딩',exact:true}).click();
await page.locator('[data-status]').filter({hasText:'임베딩 완료'}).waitFor();
await page.reload();await page.locator('#archive-lore-menu').click();
await page.waitForFunction(()=>document.querySelector('[data-log-counts]')?.textContent.includes('질문으로 검색 10회'));
assert.deepEqual(runtimeErrors,[]);assert.deepEqual(await page.evaluate(()=>window.errors),[]);
console.log(JSON.stringify({passed:true,bookEntries:Object.keys(book.entries).length,mobile:overflow,runtimeErrors}));
await browser.close();server.close();
