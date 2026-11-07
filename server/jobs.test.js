// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJobService } from './jobs.js';
import { invokeBackend } from './backend.js';
import { atomic,json,inside } from './storage.js';
const sanitize=s=>s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'');
function fixture(t){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'al-server-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const dirs={root,worlds:path.join(root,'worlds'),chats:path.join(root,'chats'),groupChats:path.join(root,'group-chats')};for(const dir of Object.values(dirs))fs.mkdirSync(dir,{recursive:true});
    fs.mkdirSync(path.join(dirs.chats,'char'));const file=path.join(dirs.chats,'char','chat.jsonl');
    const messages=[{name:'A',mes:'We agreed to go to the hospital.',is_user:true},{name:'B',mes:'We arrived at the hospital.'}];
    const writeChat=value=>atomic(file,[JSON.stringify({chat_metadata:{}}),...value.map(m=>JSON.stringify(m))].join('\n')+'\n');writeChat(messages);
    const book=path.join(dirs.worlds,'Book.json');atomic(book,{entries:{}});
    const user={profile:{handle:'owner'},directories:dirs},replies=[],calls=[];
    const dependencies={sanitize,ask:async(_user,payload,signal)=>{calls.push(payload);const r=replies.shift();return typeof r==='function'?r(payload,signal):r;},embedRequest:async()=>[1,0]};
    const service=createJobService(dependencies);
    const input=()=>({context:{key:'test-key',name:'Test',messages:jsonLines(file).slice(1)},chat:{id:'chat',avatar:'char.png',group:false},books:['Book'],target:'Book',initialStart:0,settings:{embeddingProvider:'gemini',embeddingKeys:{gemini:'private-embedding-key'},keepMessages:1,cacheNamespace:'server-test'},templates:{collection:{chat_completion_source:'custom',model:'test'},search:{chat_completion_source:'custom',model:'test'}},options:{}});
    return {root,user,file,book,messages,writeChat,replies,calls,service,input,dependencies};
}
const jsonLines=file=>fs.readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const memory=()=>JSON.stringify({entries:[{title:'Hospital',content:'They agreed to visit and arrived at the hospital.',keywords:['hospital']}],sideChanges:[]});
async function done(service,user,id){for(let i=0;i<500;i++){const job=service.get(user,id);if(!['queued','running'].includes(job.status))return job;await new Promise(r=>setTimeout(r,5));}throw Error('job timeout');}
test('accepted collection survives without polling; saves book, vector, hide flags and redacted diagnostics on disk',async t=>{
    const f=fixture(t);f.replies.push(memory());const id=randomUUID(),job=await f.service.submit(f.user,'collect',f.input(),id);
    assert.equal((await f.service.submit(f.user,'collect',f.input(),id)).id,job.id);
    await new Promise(r=>setTimeout(r,50));const result=await done(f.service,f.user,job.id);assert.equal(result.status,'completed',result.message);
    assert.equal(Object.keys(json(f.book).entries).length,1);assert.equal(json(f.book).archiveLore.receipts.length,1);
    assert.equal(jsonLines(f.file)[1].is_system,true);assert(!jsonLines(f.file)[2].is_system);
    assert.equal(fs.readdirSync(path.join(f.root,'archive-lore-server','vectors')).length,1);
    const logs=await f.service.logs(f.user,'test-key');assert(logs.some(r=>r.events.some(e=>e.stage==='collection.saved')));
    assert(!JSON.stringify(result).includes('private-embedding-key'));assert(!JSON.stringify(logs).includes('private-embedding-key'));
    assert(fs.readdirSync(path.join(f.root,'archive-lore-server','backups',job.id)).length>=2);
});
test('embedding-only server job works without collection profile or AI calls',async t=>{
    const f=fixture(t);atomic(f.book,{entries:{0:{uid:0,content:'Existing memory'}}});const input=f.input();input.templates={};
    const job=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,job.id)).status,'completed');assert.equal(f.calls.length,0);
});
test('provider failure retains saved memory; next collection only retries indexing and hiding',async t=>{
    const f=fixture(t);let fail=true;const service=createJobService({...f.dependencies,embedRequest:async()=>{if(fail)throw Error('embedding failed');return [1,0];}});f.replies.push(memory());
    const first=await service.submit(f.user,'collect',f.input(),randomUUID());assert.equal((await done(service,f.user,first.id)).status,'error');assert.equal(json(f.book).archiveLore.receipts.length,1);assert(!jsonLines(f.file)[1].is_system);
    fail=false;const next=await service.submit(f.user,'collect',f.input(),randomUUID());assert.equal((await done(service,f.user,next.id)).status,'completed');assert.equal(f.calls.length,1);assert(jsonLines(f.file)[1].is_system);
});
test('source edits during AI work abort before saving and do not hide messages',async t=>{
    const f=fixture(t);f.replies.push(()=>{f.writeChat([{...f.messages[0],mes:'edited'},f.messages[1]]);return memory();});
    const job=await f.service.submit(f.user,'collect',f.input(),randomUUID());const result=await done(f.service,f.user,job.id);assert.equal(result.status,'error');assert.deepEqual(json(f.book),{entries:{}});assert(!jsonLines(f.file)[1].is_system);
});
test('concurrent external book writes are preserved',async t=>{
    const f=fixture(t);f.replies.push(()=>{atomic(f.book,{entries:{5:{uid:5,content:'External edit'}}});return memory();});
    const job=await f.service.submit(f.user,'collect',f.input(),randomUUID());assert.equal((await done(f.service,f.user,job.id)).status,'error');assert.equal(json(f.book).entries[5].content,'External edit');assert.equal(Object.keys(json(f.book).entries).length,1);
});
test('restarting marks interrupted jobs and persists completed vectors; users cannot read each other jobs',async t=>{
    const f=fixture(t);f.replies.push(memory());const job=await f.service.submit(f.user,'collect',f.input(),randomUUID());await done(f.service,f.user,job.id);
    await f.service.vectors(f.user).put('key',[3,4]);const file=path.join(f.root,'archive-lore-server','jobs',job.id+'.json');atomic(file,{...json(file),status:'running'});
    const restarted=createJobService(f.dependencies);assert.equal(restarted.get(f.user,job.id).status,'interrupted');assert.deepEqual(await restarted.vectors(f.user).get('key'),[3,4]);
    const other=fixture(t);assert.throws(()=>restarted.get(other.user,job.id),/찾을 수/);
    assert.throws(()=>restarted.list({directories:f.user.directories}),/로그인/);
});
test('path traversal and unsaved source snapshots are rejected before AI work',async t=>{
    const f=fixture(t);const bad=f.input();bad.chat.avatar='../../evil.png';await assert.rejects(f.service.submit(f.user,'collect',bad,randomUUID()),/경로/);
    const changed=f.input();changed.context.messages[0].mes='not saved';await assert.rejects(f.service.submit(f.user,'collect',changed,randomUUID()),/대화 저장/);assert.equal(f.calls.length,0);
    const outside=fs.mkdtempSync(path.join(os.tmpdir(),'al-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.symlinkSync(outside,path.join(f.root,'escape'));assert.throws(()=>inside(f.root,'escape','file'),/외부 경로/);
});
test('server drafts survive service recreation; applying preserves history and consumes draft once',async t=>{
    const f=fixture(t);f.replies.push(memory());let job=await f.service.submit(f.user,'collect',f.input(),randomUUID());await done(f.service,f.user,job.id);
    f.replies.push(JSON.stringify({title:'Compact',content:'They visited the hospital.'}));let input=f.input();input.options={kind:'compact',ids:['["Book","0"]']};job=await f.service.submit(f.user,'prepareMaintenance',input,randomUUID());const preview=await done(f.service,f.user,job.id);assert.equal(preview.status,'completed',preview.message);assert.equal(json(f.book).entries[0].comment,'Hospital');
    const restarted=createJobService(f.dependencies);input=f.input();input.options={...preview.result,draftJobId:job.id};const applied=await restarted.submit(f.user,'applyMaintenance',input,randomUUID());const result=await done(restarted,f.user,applied.id);assert.equal(result.status,'completed',result.message);assert.equal(json(f.book).entries[0].comment,'Compact');assert.equal(json(f.book).entries[0].archiveLore.history.length,1);assert.equal(restarted.get(f.user,job.id).draftAvailable,false);
});
test('both server retrieval modes use stored vectors and persist the full selection trace',async t=>{
    const f=fixture(t);f.replies.push(memory());let job=await f.service.submit(f.user,'collect',f.input(),randomUUID());await done(f.service,f.user,job.id);
    for(const mode of ['dialogue','questions']){const input=f.input();input.settings.mode=mode;if(mode==='questions')f.replies.push('{"questions":["Which hospital visit?"]}');f.replies.push('{"selections":[{"id":"u0","priority":3,"reason":"supplies the requested visit fact"}]}');job=await f.service.submit(f.user,'recall',input,randomUUID());const result=await done(f.service,f.user,job.id);assert.equal(result.status,'completed',result.message);assert(result.result.text.includes('hospital'));assert.equal(result.result.selected.length,1);assert.equal(result.result.lastRecall.units[0].priority,3);}
    assert((await f.service.logs(f.user,'test-key')).some(r=>r.events.some(e=>e.stage==='selection.validated')));
});
test('detached backend keeps non-streaming payload and aborts only on explicit signal',async()=>{
    let req;const router={handle(request,response){req=request;setTimeout(()=>response.json({choices:[{message:{content:'done'}}]}),15);}};
    const result=await invokeBackend(router,{profile:{handle:'u'}},{stream:true,model:'test'});assert.equal(result.choices[0].message.content,'done');assert.equal(req.body.stream,false);
    const abort=new AbortController();let closed=false;const pending=invokeBackend({handle(request){request.socket.on('close',()=>closed=true);}},{},{},abort.signal);abort.abort();await assert.rejects(pending,/중지/);assert(closed);
});
test('plugin routes enforce ST authentication and never accept client-provided user directories',async()=>{
    const {registerRoutes}=await import('./index.js');const handlers=new Map();let seen;
    registerRoutes({post:(path,handler)=>handlers.set(path,handler)},{list:(user)=>{seen=user;return [];}});
    const response=()=>({code:200,status(n){this.code=n;return this;},json(data){this.data=data;return this;}});
    let res=response();await handlers.get('/jobs/list')({body:{user:{profile:{handle:'forged'},directories:{root:'/tmp'}}}},res);assert.equal(res.code,401);assert.equal(seen,undefined);
    const user={profile:{handle:'authenticated'},directories:{root:'/real'}};res=response();await handlers.get('/jobs/list')({user,body:{directories:{root:'/other'}}},res);assert.equal(res.code,200);assert.equal(seen,user);
});
test('private job persistence excludes API keys and proxy passwords',async t=>{
    const f=fixture(t);f.replies.push(memory());const input=f.input();input.templates.collection.proxy_password='private-proxy-password';const job=await f.service.submit(f.user,'collect',input,randomUUID());await done(f.service,f.user,job.id);
    const disk=fs.readFileSync(path.join(f.root,'archive-lore-server','jobs',job.id+'.json'),'utf8');assert(!disk.includes('private-embedding-key'));assert(!disk.includes('private-proxy-password'));
});

test('batch vector presence returns only booleans, validates limits and isolates users',async t=>{
    const f=fixture(t);await f.service.vectors(f.user).put('saved',[1,2,3]);
    const {registerRoutes}=await import('./index.js'),handlers=new Map();registerRoutes({post:(route,fn)=>handlers.set(route,fn)},f.service);
    const response=()=>({status(n){this.code=n;return this;},json(data){this.data=data;return this;}});
    let res=response();await handlers.get('/vectors/has')({user:f.user,body:{keys:['saved','missing']}},res);assert.deepEqual(res.data,{present:[true,false]});
    res=response();await handlers.get('/vectors/has')({user:f.user,body:{keys:Array(65).fill('saved')}},res);assert.equal(res.code,400);
    res=response();await handlers.get('/vectors/has')({body:{keys:['saved']}},res);assert.equal(res.code,401);
});

test('plain vector recall on server works without completion templates and preserves regeneration filtering',async t=>{
    const f=fixture(t);atomic(f.book,{entries:{0:{uid:0,content:'The hospital visit happened.'}}});
    const input=f.input();input.templates={};input.settings.mode='embedding';input.options={generationType:'swipe'};
    let job=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,job.id)).status,'completed');
    job=await f.service.submit(f.user,'recall',input,randomUUID());const result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert(result.result.text.includes('hospital'));
    assert.equal(f.calls.length,0);assert.equal(result.result.lastRecall.mode,'embedding');
    const logs=await f.service.logs(f.user,'test-key');
    const context=logs.flatMap(r=>r.events).find(e=>e.stage==='dialogue.context').data;
    assert.equal(context.excludedTail,1);assert.equal(context.sourceMessages.length,1);
});

test('polling queued/running and completed recall jobs does not read the chat file',async t=>{
    const f=fixture(t),s=f.service.state(f.user),id=randomUUID();
    const job={id,kind:'index',status:'running',input:f.input(),hidden:[],message:'indexing'};
    s.jobs.set(id,job);
    fs.renameSync(f.file,f.file+'.held');
    try{
        for(const status of ['queued','running','error','interrupted']){job.status=status;assert.equal(f.service.get(f.user,id).status,status);}
        job.status='completed';job.kind='recall';job.result={text:'Fact'};
        assert.equal(f.service.get(f.user,id).result.text,'Fact');
    }finally{fs.renameSync(f.file+'.held',f.file);}
    job.kind='collect';const messages=jsonLines(f.file);messages[1].is_system=true;fs.writeFileSync(f.file,messages.map(m=>JSON.stringify(m)).join('\n')+'\n');
    assert.deepEqual(f.service.get(f.user,id).hidden[0].indices,[0]);
});

test('indexing 105 memories with a long chat yields and avoids per-chunk chat reads',async t=>{
    const f=fixture(t),messages=Array.from({length:2100},(_,i)=>({name:'A',mes:`Message ${i} `+'x'.repeat(500),is_user:i%2===0}));
    f.writeChat(messages);atomic(f.book,{entries:Object.fromEntries(Array.from({length:105},(_,uid)=>[uid,{uid,content:'Remember fact '+uid}]))});
    const input=f.input();input.context.messages=messages;input.templates={};
    let reads=0,ticks=0;const original=fs.readFileSync;
    fs.readFileSync=function(file,...args){if(file===f.file)reads++;return original.call(this,file,...args);};
    const tick=setInterval(()=>ticks++,1);
    try{
        const job=await f.service.submit(f.user,'index',input,randomUUID());
        assert.equal((await done(f.service,f.user,job.id)).status,'completed');
        assert(reads<20,`chat read ${reads} times`);assert(ticks>0,'other event-loop work must run while indexing');
    }finally{clearInterval(tick);fs.readFileSync=original;}
});
