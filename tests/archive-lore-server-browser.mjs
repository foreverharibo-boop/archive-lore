// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createJobService } from '../server/jobs.js';
import { atomic,json } from '../server/storage.js';
const {chromium:pw}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args=process.env.CHROMIUM_ARGS_MODULE?(await import(process.env.CHROMIUM_ARGS_MODULE)).default.args:[];
const root=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'al-server-browser-'));
const directories={root:temp,worlds:path.join(temp,'worlds'),chats:path.join(temp,'chats'),groupChats:path.join(temp,'groups')};
for(const d of Object.values(directories))fs.mkdirSync(d,{recursive:true});fs.mkdirSync(path.join(directories.chats,'char'));
const chatFile=path.join(directories.chats,'char','test.jsonl'),bookFile=path.join(directories.worlds,'Book.json');
atomic(chatFile,'{}\n'+JSON.stringify({name:'A',is_user:true,mes:'We agreed to visit the hospital.'})+'\n'+JSON.stringify({name:'B',mes:'We visited the hospital together.'})+'\n');atomic(bookFile,{entries:{}});
const user={profile:{handle:'browser-fixture'},directories};let release,started=false,calls=0;
const gate=new Promise(resolve=>release=resolve);
const service=createJobService({sanitize:s=>s.replace(/[<>:"/\\|?*\x00-\x1f]/g,''),embedRequest:async()=>[1,0],ask:async(_user,payload)=>{
    calls++;if(calls===1){started=true;await gate;}
    const system=payload.messages[0].content;
    const text=system.includes('complete revised entry')?JSON.stringify({title:'Compact memory',content:'They visited the hospital.'}):system.includes('sideChanges')?JSON.stringify({entries:[{title:'Hospital visit',content:'They agreed and visited the hospital together.',keywords:['hospital']}],sideChanges:[]}):system.includes('"questions"')?'{"questions":["What was agreed?"]}':'{"ids":["u0"]}';
    return {choices:[{message:{content:text}}]};
}});
const input=()=>({context:{key:'fixture-chat',name:'Test',messages:fs.readFileSync(chatFile,'utf8').trim().split('\n').slice(1).map(JSON.parse)},chat:{group:false,id:'test',avatar:'char.png'},books:['Book'],target:'Book',initialStart:0,settings:{serverEnabled:true,embeddingProvider:'gemini',embeddingKeys:{gemini:'fixture-private-key'},keepMessages:1,cacheNamespace:'browser-fixture'},templates:{collection:{chat_completion_source:'custom',model:'fixture'},search:{chat_completion_source:'custom',model:'fixture'}},options:{}});
const html=`<!doctype html><meta charset="utf-8"><button id="collect">기억 수집</button><div id="status"></div><script type="module">
import {createServerClient,createServerController} from '/lore-server.js';
const call=createServerClient({headers:()=>({'Content-Type':'application/json','x-fixture-user':'owner'})});
let data=await (await fetch('/input')).json();window.mode='dialogue';window.synced=0;
window.controller=createServerController({local:{cancel(){},clearRecall(){},state:()=>({busy:false}),dashboard:async()=>({records:[],next:2})},enabled:()=>true,settings:()=>({...data.settings,mode:window.mode}),context:()=>data.context,call,
input:async(kind,options)=>{data=await (await fetch('/input')).json();return {...data,settings:{...data.settings,mode:window.mode},options,...(kind==='index'||(kind==='recall'&&window.mode==='embedding')?{templates:{}}:{})};},
sync:async()=>{window.synced++;data=await (await fetch('/input')).json();},changed:()=>document.querySelector('#status').textContent=controller.state().status,countTokens:async text=>Math.ceil(text.length/3)});
window.failures=[];document.querySelector('#collect').onclick=()=>controller.collect().catch(e=>failures.push(e.message));await controller.restore(true);window.ready=true;
</script>`;
const server=http.createServer(async(req,res)=>{try{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    if(req.url==='/input'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(input()));return;}
    if(req.url.startsWith('/api/plugins/archive-lore-server/')){
        if(req.headers['x-fixture-user']!=='owner'){res.writeHead(401);res.end('{}');return;}
        let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),route=req.url.slice('/api/plugins/archive-lore-server'.length);let result;
        if(route==='/jobs')result=await service.submit(user,body.kind,body.input,body.requestId);
        else if(route==='/jobs/list')result=service.list(user,body.chatKey);
        else if(route==='/jobs/get')result=service.get(user,body.id);
        else if(route==='/jobs/cancel')result=service.cancel(user,body.id);
        else throw Error('unknown route');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    const name=req.url.slice(1);if(!/^[\w.-]+\.js$/.test(name))throw Error('bad path');res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,name)));
}catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const errors=[];const launch=()=>pw.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args,headless:true});
const open=async()=>{if(!browser||!browser.isConnected())browser=await launch();const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);return page;};
try{
    let page=await open();await page.locator('#collect').click();for(let i=0;i<100&&!started;i++)await new Promise(r=>setTimeout(r,10));assert(started);
    const accepted=service.list(user,'fixture-chat')[0];assert.equal(accepted.status,'running');
    await browser.close();release();
    for(let i=0;i<200&&service.get(user,accepted.id).status==='running';i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(service.get(user,accepted.id).status,'completed');assert.equal(Object.keys(json(bookFile).entries).length,1);assert.equal(calls,1);
    page=await open();assert((await page.evaluate(()=>controller.jobs())).some(j=>j.id===accepted.id&&j.status==='completed'));assert.equal(await page.evaluate(()=>window.synced),1);
    await page.evaluate(()=>controller.index());assert.equal(calls,1);
    for(const mode of ['dialogue','questions','embedding']){const result=await page.evaluate(async m=>{window.mode=m;return controller.recall();},mode);assert(result.text.includes('hospital'));}
    const draft=await page.evaluate(()=>controller.prepareMaintenance({kind:'compact',ids:['["Book","0"]']}));await browser.close();
    page=await open();const restored=await page.evaluate(id=>controller.getDraft(id),draft.serverJobId);assert.equal(restored.content,draft.content);
    await page.evaluate(d=>controller.applyMaintenance({...d,draftJobId:d.serverJobId}),restored);assert.equal(json(bookFile).entries[0].comment,'Compact memory');assert.equal(json(bookFile).entries[0].archiveLore.history.length,1);
    assert.deepEqual(await page.evaluate(()=>failures),[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,browserClosedDuringCollection:true,completedWhileClosed:true,reconnected:true,embeddingWithoutCollectionProfile:true,allThreeSearchModes:true,restoredDraftApplied:true}));
}finally{await browser.close();server.close();fs.rmSync(temp,{recursive:true,force:true});}
