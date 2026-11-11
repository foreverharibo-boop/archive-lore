// SPDX-License-Identifier: AGPL-3.0-only
// Requires a sibling Silly-Relay checkout (or RELAY_SOURCE) and Playwright.
// Real browser + both real servers; only ST host/tokenizer/provider APIs are fixtures.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createJobService} from '../server/jobs.js';
import {createReplyBridge,registerReplyBridge} from '../server/reply-bridge.js';
import {atomic} from '../server/storage.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const args=process.env.CHROMIUM_ARGS_MODULE?(await import(process.env.CHROMIUM_ARGS_MODULE)).default.args:[];
const root=fileURLToPath(new URL('../',import.meta.url));
const relayRoot=process.env.RELAY_SOURCE||path.resolve(root,'../Silly-Relay');
const {createRelay}=await import(pathToFileURL(path.join(relayRoot,'server/index.cjs')));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'al-relay-browser-'));
const directories={root:temp,worlds:path.join(temp,'worlds'),chats:path.join(temp,'chats'),groupChats:path.join(temp,'groups')};
for(const dir of Object.values(directories))fs.mkdirSync(dir,{recursive:true});
fs.mkdirSync(path.join(directories.chats,'char'));
const messages=[{name:'A',is_user:true,mes:'Do you remember our promise at the hospital?'}];
atomic(path.join(directories.chats,'char','test.jsonl'),'{}\n'+messages.map(m=>JSON.stringify(m)).join('\n')+'\n');
atomic(path.join(directories.worlds,'Book.json'),{entries:{0:{uid:0,content:'They promised to visit the hospital together.'},1:{uid:1,constant:true,content:'They are married.'}}});
const user={profile:{handle:'fixture'},directories};
let release,entered=false,selections=0;const gate=new Promise(r=>release=r),calls=[];
const service=createJobService({sanitize:s=>s.replace(/[<>:"/\\|?*\x00-\x1f]/g,''),embedRequest:async()=>[1,0],
    countTokens:async(_u,_model,text)=>Math.ceil(text.length/3),
    ask:async(_u,payload)=>{selections++;entered=true;await gate;
        const data=JSON.parse(payload.messages.find(m=>m.role==='user').content);
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'The promised hospital visit.'}]});}});
const bridge=createReplyBridge({service,countMessages:async(_u,_m,m)=>Math.ceil(JSON.stringify(m).length/3)}),unregister=registerReplyBridge(bridge);
const input=()=>({context:{key:'fixture-chat',name:'Test',messages},chat:{group:false,id:'test',avatar:'char.png'},books:['Book'],target:'Book',initialStart:0,
    settings:{enabled:true,serverEnabled:true,relayEnabled:true,selectionConcurrency:2,embeddingProvider:'gemini',embeddingKeys:{gemini:'fixture-key'},cacheNamespace:'browser-relay',injectionTokens:1000,mode:'dialogue'},
    templates:{collection:{chat_completion_source:'custom',model:'fixture'},search:{chat_completion_source:'custom',model:'fixture'}},options:{}});
const index=await service.submit(user,'index',input(),randomUUID());
for(let i=0;i<200;i++){const j=service.get(user,index.id);if(j.status==='completed')break;if(j.status==='error')throw Error(j.message);await new Promise(r=>setTimeout(r,10));}
assert.equal(service.get(user,index.id).status,'completed');
const relay=createRelay({pollMs:40}),routes=[];
const router=Object.fromEntries(['get','post'].map(method=>[method,(route,handler)=>routes.push({method:method.toUpperCase(),route,handler})]));relay.install(router);
const html=`<!doctype html><meta charset="utf-8"><script type="module">
import {createBackgroundRecall} from '/archive/lore-background.js';
import {createTransport} from '/relay/transport.mjs';
const data=await (await fetch('/input')).json();window.accepted=false;
const call=async(route,body)=>{const response=await fetch('/archive-api'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;};
const background=createBackgroundRecall({settings:()=>data.settings,context:()=>data.context,
    relay:()=>({enabled:()=>true,supports:async provider=>(await (await fetch('/api/plugins/silly-relay/status')).json()).preparations.includes(provider)}),
    supported:()=>true,tokenizer:async()=> 'fixture',input:async(_k,options)=>({...data,options}),call,countTokens:async t=>Math.ceil(t.length/3),accept:()=>{}});
const transport=createTransport({origin:location.origin,enabled:()=>true,fetchImpl:fetch,shouldRelay:()=>true,
    prepareRecovery:async request=>{localStorage.setItem('job',request.id);return true;},onEvent:type=>{if(type==='accepted')window.accepted=true;}});
window.run=async()=>{const result=await background.prepare('normal');const messages=[{role:'system',content:'Preset: stay in character.'},
    {role:'system',content:result.core},{role:'system',content:result.text},{role:'system',content:result.guidance},{role:'user',content:data.context.messages[0].mes}];
    background.capture({prompt:messages});const payload={model:'RP model',temperature:.7,messages};background.attach(payload);
    const response=await transport.fetch('/api/backends/chat-completions/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});window.answer=await response.text();};window.ready=true;
</script>`;
const server=http.createServer(async(req,res)=>{try{
    res.status=code=>{res.statusCode=code;return res;};res.json=data=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
    req.user=user;const url=new URL(req.url,'http://local');req.query=Object.fromEntries(url.searchParams);
    if(url.pathname==='/')return res.end(html);
    if(url.pathname==='/input')return res.json(input());
    if(url.pathname.startsWith('/archive/')||url.pathname.startsWith('/relay/')){
        const match=url.pathname.match(/^\/(archive|relay)\/([\w.-]+\.(?:js|mjs))$/);if(!match)return res.status(404).end();
        res.setHeader('content-type','text/javascript');return res.end(fs.readFileSync(path.join(match[1]==='archive'?root:relayRoot,match[2])));
    }
    let raw='';for await(const chunk of req)raw+=chunk;req.body=raw?JSON.parse(raw):{};
    if(url.pathname==='/archive-api/reply/prepare')return res.json(bridge.prepareInput(user,req.body));
    if(url.pathname==='/archive-api/reply/cancel')return res.json(bridge.cancel(user,req.body.ticket));
    if(url.pathname==='/api/backends/chat-completions/generate'){
        calls.push(req.body);return res.json({choices:[{message:{content:'I remember our promise at the hospital.'}}]});
    }
    const routePath=url.pathname.replace('/api/plugins/silly-relay','');
    for(const route of routes){const names=[],pattern=route.route.replace(/:([a-z]+)/g,(_,n)=>{names.push(n);return '([^/]+)';}),match=routePath.match(new RegExp('^'+pattern+'$'));
        if(route.method===req.method&&match){req.params=Object.fromEntries(names.map((n,i)=>[n,match[i+1]]));return route.handler(req,res);}}
    res.status(404).json({error:'not found'});
}catch(e){res.status(400).json({error:e.message});}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser;const errors=[];
try{
    browser=await chromium.launch({headless:true,args,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined});
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>window.ready);
    await page.evaluate(()=>{window.run().catch(e=>window.failure=e.message);});
    await page.waitForFunction(()=>window.accepted||window.failure);assert.equal(await page.evaluate(()=>window.failure),undefined);
    for(let i=0;i<200&&!entered;i++)await new Promise(r=>setTimeout(r,10));assert(entered);assert.equal(calls.length,0);
    const jobId=await page.evaluate(()=>localStorage.getItem('job'));
    await browser.close();release();
    let state;for(let i=0;i<200;i++){state=await(await fetch(origin+'/api/plugins/silly-relay/jobs/'+jobId)).json();if(state.state!=='running')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(state.state,'completed',state.error);assert.equal(selections,1);assert.equal(calls.length,1);
    const sent=calls[0];assert.equal(sent.model,'RP model');assert.equal(sent.temperature,.7);
    assert.equal(sent.messages[0].content,'Preset: stay in character.');assert.equal(sent.messages[1].content,'They are married.');
    assert(sent.messages[2].content.includes('hospital'));assert.equal(sent.messages.at(-1).content,messages[0].mes);assert(!JSON.stringify(sent).includes('AL_memory_'));assert(!sent.__silly_relay_prepare);
    browser=await chromium.launch({headless:true,args,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined});
    const reopened=await browser.newPage();await reopened.goto(origin);await reopened.waitForFunction(()=>window.ready);
    const received=await reopened.evaluate(async id=>(await(await fetch('/api/plugins/silly-relay/jobs/'+id)).json()),jobId);
    assert(Buffer.from(received.data,'base64').toString().includes('I remember'));assert.equal(selections,1);assert.equal(calls.length,1);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,browserClosedDuringSelection:true,recallAndReplyCompletedWhileClosed:true,receivedOnReturn:true,originalPresetAndCorePreserved:true,aiSelectionCalls:selections,rpCalls:calls.length}));
}finally{await browser?.close();unregister();relay.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});}
