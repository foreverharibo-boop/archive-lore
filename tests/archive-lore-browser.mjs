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
ctx.extensionSettings.connectionManager={selectedProfile:'p',profiles:[{id:'p',name:'Test profile',model:'fixture'}]};ctx.ConnectionManagerRequestService={getProfile:()=>({model:'fixture'}),validateProfile:()=>({selected:'openai',source:'openai'}),sendRequest:async(_id,messages)=>{const sys=messages[0].content;if(window.modelReply)return {choices:[{message:{content:await window.modelReply(sys,JSON.parse(messages[1].content))}}]};if(sys.includes('sideChanges'))return {choices:[{message:{content:JSON.stringify({entries:[{title:'Hospital promise',date:'2026-03-01',time:'Morning',location:'Home',content:'They agreed to visit the hospital together.',keywords:['hospital']}],sideChanges:['relationship','agreements','preferences','emotions','turningPoints','plans'].map(category=>({op:'add',category,text:category==='relationship'?'Lovers':'Example fact for '+category,evidence:{message:0,quote:'같이 병원에 가자.'},...(category==='relationship'?{relationship:{kind:'start',since:'2026-03-01'},dateEvidence:{message:0,quote:'2026-03-01'}}:{})})),storyDate:{date:'2026-03-01',evidence:{message:0,quote:'2026-03-01'}}})}}]};if(sys.includes('questions') && window.badQuestion)return {choices:[{message:{content:'invalid JSON test'}}]};if(sys.includes('questions'))return {choices:[{message:{content:'{"questions":["병원 약속은 무엇인가?"]}'}}]};return {choices:[{message:{content:'{"ids":["u0"]}'}}]};}};
</script><script type="module" src="/scripts/extensions/third-party/archive-lore/archive-lore.js"></script>`;
const modules={
'/scripts/openai.js':`export const proxies=[];`,
'/scripts/slash-commands.js':`export async function executeSlashCommands(command){const parts=command.match(new RegExp('^/hide ([0-9]+)-([0-9]+)$'));if(!parts)throw Error('unexpected command');for(let i=+parts[1];i<=+parts[2];i++)ctx.chat[i].is_system=true;}`,
'/script.js':`export const eventSource={on:(n,cb)=>(window.events[n]||=[]).push(cb),emit:async(n,...a)=>{for(const cb of window.events[n]||[])await cb(...a)}};export const event_types={WORLDINFO_UPDATED:'world',WORLDINFO_ENTRIES_LOADED:'entries',CHAT_CHANGED:'chat',MESSAGE_EDITED:'edit',MESSAGE_DELETED:'delete',MESSAGE_SWIPED:'swipe',MESSAGE_RECEIVED:'received',GENERATION_STARTED:'started',GENERATION_ENDED:'ended',GENERATION_STOPPED:'stopped'};export const extension_prompt_types={IN_CHAT:1};export const getRequestHeaders=()=>({'Content-Type':'application/json'});export const saveSettingsDebounced=()=>{};export const getCurrentChatId=()=>ctx.getCurrentChatId();export const name1='User',name2='Character',chat_metadata=ctx.chatMetadata,saveMetadata=()=>ctx.saveMetadata();`,
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
await page.route('https://aiplatform.googleapis.com/**',r=>{assert.equal(r.request().headers()['x-goog-api-key'],'vertex-fixture-key');assert(r.request().url().includes('/projects/fixture-project/locations/global/'));return r.fulfill({json:{predictions:[{embeddings:{values:[1,0]}}]}});});
await page.goto('http://127.0.0.1:'+server.address().port);
// Both credential slots survive provider switching; full-screen editing saves and cancels independently.
await page.locator('[name="embeddingProvider"]').selectOption('vertex');
await page.locator('[name="embeddingVertexProjectId"]').fill('fixture-project');await page.locator('[name="embeddingVertexProjectId"]').dispatchEvent('change');
await page.locator('[name="embeddingKey"]').fill('vertex-fixture-key');await page.locator('[name="embeddingKey"]').dispatchEvent('change');
await page.locator('[name="embeddingProvider"]').selectOption('gemini');assert.equal(await page.locator('[name="embeddingKey"]').inputValue(),'fixture-only');
await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-connections.png'),fullPage:true});
await page.locator('#archive-lore-settings [data-settings-tab="prompts"]').click();
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
// The modal keeps search mode in settings and uses one consistent outline icon set.
assert.equal(await page.locator('.al-dialog [name="mode"]').count(),0);
await page.locator('.al-dialog [data-action="settings"]').click();
await page.locator('.al-settings-dialog [data-settings-tab="collection"]').click();
await page.locator('.al-settings-dialog [name="recentCount"]').fill('12');
await page.locator('.al-settings-dialog [name="recentCount"]').dispatchEvent('change');
await page.getByRole('button',{name:'설정 닫기',exact:true}).click();
await page.locator('.al-settings-dialog').waitFor({state:'detached'});
assert.equal(await page.locator('#archive-lore-settings [name="recentCount"]').inputValue(),'12');
assert.equal(await page.locator('.al-dialog > header .al-icon').count(),4);
await page.getByRole('button',{name:'기억 수집',exact:true}).click();
await page.locator('[data-status]').filter({hasText:'수집 완료'}).waitFor();
assert.equal(Object.keys(book.entries).length,9);assert.equal(Object.values(book.entries).filter(e=>e.archiveLore?.sideCategory).length,6);assert.equal(book.archiveLore.receipts.length,1);
await page.waitForFunction(()=>document.querySelectorAll('[data-records] [data-record]').length===3);
await page.locator('[data-view-tab="side"]').click();
await page.waitForFunction(()=>document.querySelectorAll('[data-records] [data-record]').length===6);
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
await page.locator('[data-view-tab="recall"]').click();
await page.locator('[data-recall]').waitFor({state:'visible'});
assert((await page.locator('[data-recall]').textContent()).includes('코어'));
assert.equal(await page.locator('[data-main-pane="records"]').isVisible(),false);
await page.locator('[data-view-tab="memory"]').click();
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
await page.locator('[data-action="tools"]').click();
await page.locator('summary').filter({hasText:'턴별 진단 기록'}).click();
const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'진단 TXT 다운로드'}).click();
const downloaded=await downloadEvent;const diagnosticText=await fs.readFile(await downloaded.path(),'utf8');
assert.equal((diagnosticText.match(/"stage": "rp.response"/g)||[]).length,20);
assert.equal((diagnosticText.match(/"stage": "injection.installed"/g)||[]).length,21);
assert(diagnosticText.includes('search.ranking'));assert(diagnosticText.includes('ai.request'));assert(diagnosticText.includes('injection.budget'));
assert(!diagnosticText.includes('fixture-only'));assert(!diagnosticText.includes('vertex-fixture-key'));
await page.locator('summary').filter({hasText:'턴별 진단 기록'}).click();
await page.locator('[data-view-tab="memory"]').click();
await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-mobile.png'),fullPage:true});
const overflow=await page.evaluate(()=>{const root=document.querySelector('.al-dialog');return {scroll:root.scrollWidth,client:root.clientWidth,font:getComputedStyle(root.querySelector('select')).fontSize};});assert(overflow.scroll<=overflow.client+1);assert.equal(overflow.font,'12px');
await page.getByRole('button',{name:'닫기',exact:true}).click();
await page.locator('[name="enabled"]').uncheck();await page.evaluate(()=>window.archiveLoreInterceptor([],30000,()=>{},'normal'));assert.equal(await page.evaluate(()=>prompts['archive-lore-recalled']),'');
await page.setViewportSize({width:1280,height:900});await page.locator('#archive-lore-menu').click();await page.locator('[data-action="refresh"]').click();await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-desktop.png'),fullPage:true});
await page.getByRole('button',{name:'닫기',exact:true}).click();
await page.locator('#archive-lore-settings [data-settings-tab="connection"]').click();
await page.locator('[name="embeddingProvider"]').selectOption('vertex');assert.equal(await page.locator('[name="embeddingKey"]').inputValue(),'vertex-fixture-key');
await page.getByRole('button',{name:'임베딩 연결 확인',exact:true}).click();await page.locator('[data-embedding-status]').filter({hasText:'임베딩 성공'}).waitFor();assert.equal(await page.locator('[data-embedding-settings] [name="profile"]').count(),0);assert.equal(await page.locator('[data-embedding-settings] [data-action="profiles"]').count(),0);await page.locator('[name="embeddingProvider"]').selectOption('gemini');
await page.locator('#archive-lore-menu').click();await page.locator('[data-action="tools"]').click();await page.getByRole('button',{name:'남은 임베딩',exact:true}).click();
await page.locator('[data-status]').filter({hasText:'임베딩 완료'}).waitFor();
await page.reload();await page.locator('#archive-lore-menu').click();
await page.waitForFunction(()=>document.querySelector('[data-log-counts]')?.textContent.includes('질문으로 검색 10회'));
// New collection controls, per-side editing, draft maintenance and automatic hiding.
await page.getByRole('button',{name:'닫기',exact:true}).click();
await page.locator('#archive-lore-settings [data-settings-tab="prompts"]').click();
await page.locator('[data-side-settings] > summary').click();
await page.getByRole('button',{name:'사이드 항목 추가',exact:true}).click();
const custom=page.locator('[data-side]').last();
await custom.locator('[data-side-field="title"]').fill('Inventory');await custom.locator('[data-side-field="title"]').dispatchEvent('change');
await custom.locator('[data-action="expand-side"]').click();await page.locator('.al-editor textarea').fill('Track only confirmed acquired and lost objects.');await page.getByRole('button',{name:'저장 후 닫기'}).click();
await custom.locator('[data-side-field="enabled"]').uncheck();
assert.equal(await page.evaluate(()=>settings.archiveLore.sideTemplates.at(-1).enabled),false);
assert.equal(await page.evaluate(()=>settings.archiveLore.sideTemplates.at(-1).prompt),'Track only confirmed acquired and lost objects.');
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-side-settings.png'),fullPage:true});
await page.evaluate(()=>{
    window.maintenanceRequests=[];
    window.modelReply=(system,data)=>{
        if(system.includes('complete revised entry')){maintenanceRequests.push({system,data});return JSON.stringify({title:'Edited memory',content:'A concise retained memory.'});}
        return JSON.stringify({entries:[{title:'Batch '+data.dialogue[0].message,content:data.dialogue.map(m=>m.text).join(' '),keywords:[]}],sideChanges:[]});
    };
    for(let i=2;i<6;i++)ctx.chat.push({name:'User',mes:'New fact '+i,is_user:true});
});
await page.locator('#archive-lore-menu').click();
await page.locator('[data-action="tools"]').click();
await page.locator('summary').filter({hasText:'지난 대화 한꺼번에 수집·로어북'}).click();
await page.locator('[name="rangeStart"]').fill('2');await page.locator('[name="rangeEnd"]').fill('5');await page.locator('[name="rangeBatch"]').fill('2');
await page.getByRole('button',{name:'범위 나눠 수집',exact:true}).click();await page.locator('[data-status]').filter({hasText:'수집 완료'}).waitFor();
assert.deepEqual(book.archiveLore.receipts.slice(-2).map(r=>[r.source.start,r.source.end]),[[2,3],[4,5]]);
await page.getByRole('button',{name:'닫기',exact:true}).click();
await page.locator('#archive-lore-settings [data-settings-tab="collection"]').click();
await page.locator('summary').filter({hasText:'자동 수집·숨기기'}).click();
await page.locator('[name="autoMessages"]').fill('3');await page.locator('[name="autoMessages"]').dispatchEvent('change');
await page.locator('[name="keepMessages"]').fill('2');await page.locator('[name="keepMessages"]').dispatchEvent('change');
await page.locator('[name="autoCollect"]').check();
await page.evaluate(async()=>{
    for(const cb of events.started)await cb();
    for(let i=6;i<9;i++)ctx.chat.push({name:'Character',mes:'Automatic fact '+i,is_user:false});
    for(const cb of events.received)await cb(8);
    await new Promise(r=>setTimeout(r,300));
    if(ctx.chat[0].is_system)throw Error('automatic collection ran before RP ended');
    for(const cb of events.ended)await cb();
});
await page.waitForFunction(()=>ctx.chat.slice(0,7).every(m=>m.is_system)&&!ctx.chat[7].is_system&&!ctx.chat[8].is_system);
assert.deepEqual([book.archiveLore.receipts.at(-1).source.start,book.archiveLore.receipts.at(-1).source.end],[6,8]);
// A threshold reached during an in-flight collection is retried when that job finishes.
await page.evaluate(()=>{
    const reply=window.modelReply;let once=true;
    window.modelReply=async(system,data)=>{if(once){once=false;await new Promise(resolve=>window.releaseCollection=resolve);}return reply(system,data);};
    for(let i=9;i<12;i++)ctx.chat.push({name:'User',mes:'Queued fact '+i,is_user:true});
    window.manualCollection=commands['al-collect'].callback({},'').catch(e=>errors.push(e.message));
});
await page.waitForFunction(()=>!!window.releaseCollection);
await page.evaluate(async()=>{
    for(let i=12;i<15;i++)ctx.chat.push({name:'Character',mes:'While collecting '+i,is_user:false});
    for(const cb of events.ended)await cb();
    await new Promise(r=>setTimeout(r,300));releaseCollection();await manualCollection;
});
await page.waitForFunction(()=>ctx.chat.slice(0,13).every(m=>m.is_system)&&!ctx.chat[13].is_system&&!ctx.chat[14].is_system);
assert.deepEqual([book.archiveLore.receipts.at(-1).source.start,book.archiveLore.receipts.at(-1).source.end],[12,14]);
await page.locator('[name="autoCollect"]').uncheck();await page.locator('#archive-lore-menu').click();
let record=page.locator('.al-record').filter({has:page.locator('summary span',{hasText:'Batch 2'})});
await record.locator('summary').first().click();await record.getByRole('button',{name:'다시 만들기',exact:true}).click();
await page.locator('.al-editor [data-action="cancel-draft"]').waitFor();
assert.equal(await page.evaluate(()=>maintenanceRequests.at(-1).data.dialogue[0].text),'New fact 2');
await page.locator('.al-editor [data-action="cancel-draft"]').click();
record=page.locator('.al-record').filter({has:page.locator('summary span',{hasText:'Batch 2'})});await record.locator('summary').first().click();
await record.getByRole('button',{name:'짧게 다듬기',exact:true}).click();
await page.locator('.al-editor [data-action="apply-draft"]').waitFor();
assert(Object.values(book.entries).some(e=>e.comment==='Batch 2'));await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-maintenance.png'),fullPage:true});
await page.locator('.al-editor [data-action="apply-draft"]').click();await page.locator('.al-editor').waitFor({state:'detached'});
assert(Object.values(book.entries).some(e=>e.comment==='Edited memory'&&e.archiveLore.history.length===1));
for(const title of ['첫 여행','Hospital promise']){
    const row=page.locator('.al-record').filter({has:page.locator('summary span',{hasText:title})});await row.locator('summary').first().click();await row.locator('[data-select-memory]').check();
}
const count=Object.keys(book.entries).length;
await page.locator('.al-organize > summary').click();
await page.getByRole('button',{name:'선택 기억 묶기 · 아크',exact:true}).click();await page.locator('.al-editor [data-action="apply-draft"]').click();await page.locator('.al-editor').waitFor({state:'detached'});
assert.equal(Object.keys(book.entries).length,count+1);
const arc=Object.values(book.entries).find(e=>e.archiveLore?.tier===1);assert.equal(arc.archiveLore.members.length,2);
const mergedScan=await page.evaluate(async entries=>{settings.archiveLore.keywordActivation=true;const lists={characterLore:entries.map(e=>({...e,world:'Example'}))};for(const cb of events.entries)await cb(lists);return lists.characterLore;},Object.values(book.entries));
for(const member of arc.archiveLore.members)assert(mergedScan.find(e=>String(e.uid)===member.uid).disable);
assert(!mergedScan.find(e=>e.uid===arc.uid).disable);
assert.deepEqual(runtimeErrors,[]);assert.deepEqual(await page.evaluate(()=>window.errors),[]);
// Reproduce the reported bulk conversion with the real dashboard and server facade.
await page.locator('.al-dialog [data-action="close"]').click();
const bulk=await page.evaluate(async()=>{
    const base='/scripts/extensions/third-party/archive-lore/';
    const {createLoreUI}=await import(base+'lore-ui.js'),{createLoreController}=await import(base+'lore-controller.js'),{createServerController,serverVectorStore}=await import(base+'lore-server.js');
    const book={entries:Object.fromEntries(Array.from({length:105},(_,i)=>[i,{uid:i,comment:'기존 기억 '+i,content:'Saved memory '+i,constant:false}]))};
    const before=JSON.stringify(book),context=()=>({key:'bulk-chat',name:'일괄 변경 확인',messages:[{mes:'hello',is_user:true}]}),settings=()=>({serverEnabled:true,cacheNamespace:'bulk'});let checks=0,ui;
    const call=async(route,body)=>{if(route==='/jobs/list')return [];if(route==='/vectors/has'){checks++;if(checks===1)await new Promise(r=>setTimeout(r,2700));return {present:body.keys.map(()=>false)};}throw Error('Unexpected '+route);};
    const store=serverVectorStore({local:{get:async()=>null},enabled:()=>true,call});
    const local=createLoreController({settings,context,books:()=>['Bulk'],target:()=> 'Bulk',initialStart:()=>0,loadBook:async()=>structuredClone(book),store});
    const controller=createServerController({local,enabled:()=>true,settings,context,call,changed:()=>void ui.refresh()});
    ui=createLoreUI({settings,context,controller,error:e=>{throw e;},books:()=>['Bulk'],target:()=> 'Bulk',bookNames:()=>['Bulk'],diagnostics:{list:async()=>[]}});
    const opening=ui.open();await new Promise(r=>setTimeout(r,20));
    const loading=document.querySelector('[data-counts]').textContent,heading=document.querySelector('[data-chat]').textContent;
    const refreshes=Array.from({length:105},()=>ui.refresh());await Promise.all([opening,...refreshes]);
    return {loading,heading,counts:document.querySelector('[data-counts]').textContent,records:document.querySelectorAll('[data-records] [data-record]').length,page:document.querySelector('[data-page]').textContent,checks,unchanged:before===JSON.stringify(book)};
});
assert(bulk.loading.includes('불러오는 중'));assert.equal(bulk.heading,'일괄 변경 확인');assert(bulk.counts.includes('대기 105'));assert(bulk.page.includes('105항목'));assert.equal(bulk.records,12);assert.equal(bulk.checks,4);assert(bulk.unchanged);
await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-bulk-105.png'),fullPage:true});
for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:844});
    for(const dark of [false,true]){
        await page.evaluate(dark=>{
            document.documentElement.style.setProperty('--SmartThemeBlurTintColor',dark?'#202127':'#f7f9fc');
            document.documentElement.style.setProperty('--SmartThemeBodyColor',dark?'#eee':'#303740');
            document.querySelector('.al-scroll').scrollTop=99999;
        },dark);
        const bounds=await page.locator('[data-action="collect"]').boundingBox();
        assert(bounds.y>=0 && bounds.y+bounds.height<=844);
        assert(await page.locator('.al-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
        if(width===390&&dark)await page.screenshot({path:path.join(os.tmpdir(),'archive-lore-dark.png')});
    }
}
console.log(JSON.stringify({passed:true,bookEntries:Object.keys(book.entries).length,mobile:overflow,runtimeErrors,bulk}));
await browser.close();server.close();
