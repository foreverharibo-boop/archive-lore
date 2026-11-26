// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJobService } from './jobs.js';
import { createReplyBridge } from './reply-bridge.js';
import { createBackgroundRecall } from '../lore-background.js';
import { reserveReplySlots } from '../lore-reply-slots.js';
import { applyNativePolicy, normalizeSettings } from '../lore-core.js';
import { invokeBackend } from './backend.js';
import { atomic,json,inside } from './storage.js';
import {serverChatSnapshot} from '../lore-chat-snapshot.js';
const sanitize=s=>s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'');
function fixture(t){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'al-server-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const dirs={root,worlds:path.join(root,'worlds'),chats:path.join(root,'chats'),groupChats:path.join(root,'group-chats')};for(const dir of Object.values(dirs))fs.mkdirSync(dir,{recursive:true});
    fs.mkdirSync(path.join(dirs.chats,'char'));const file=path.join(dirs.chats,'char','chat.jsonl');
    const messages=[{name:'A',mes:'We agreed to go to the hospital.',is_user:true},{name:'B',mes:'We arrived at the hospital.'}];
    const writeChat=value=>atomic(file,[JSON.stringify({chat_metadata:{}}),...value.map(m=>JSON.stringify(m))].join('\n')+'\n');writeChat(messages);
    const book=path.join(dirs.worlds,'Book.json');atomic(book,{entries:{}});
    const user={profile:{handle:'owner'},directories:dirs},replies=[],calls=[],embeddingCalls=[];
    const dependencies={sanitize,ask:async(_user,payload,signal)=>{calls.push(payload);const r=replies.shift();return typeof r==='function'?r(payload,signal):r;},embedRequest:async(_config,text,query)=>{embeddingCalls.push({text,query});return [1,0];}};
    const service=createJobService(dependencies);
    const input=()=>({context:{key:'test-key',name:'Test',messages:jsonLines(file).slice(1)},chat:{id:'chat',avatar:'char.png',group:false},books:['Book'],target:'Book',initialStart:0,settings:{diagnosticsDetailed:true,embeddingProvider:'gemini',embeddingKeys:{gemini:'private-embedding-key'},keepMessages:1,cacheNamespace:'server-test'},templates:{collection:{chat_completion_source:'custom',model:'test'},search:{chat_completion_source:'custom',model:'test'}},options:{}});
    return {root,user,file,book,messages,writeChat,replies,calls,embeddingCalls,service,input,dependencies};
}
const jsonLines=file=>fs.readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l));
async function readLogs(service,user,key){let text='';for await(const chunk of await service.logStream(user,key))text+=chunk;return JSON.parse(text);}
const memory=()=>JSON.stringify({entries:[{title:'Hospital',content:'They agreed to visit and arrived at the hospital.',keywords:['hospital']}],sideChanges:[]});
for(const keywordActivation of [false,true])test(`background recall preserves native lore after client detaches: keywords=${keywordActivation}`,{timeout:5000},async t=>{
    const f=fixture(t),source='They agreed to visit the hospital together.';
    atomic(f.book,{entries:{0:{uid:0,key:['hospital'],content:source},1:{uid:1,constant:true,content:'Core relationship.'}}});
    const originalBook=fs.readFileSync(f.book,'utf8');
    const service=createJobService({...f.dependencies,countTokens:async(_u,_m,text)=>Math.ceil(text.length/3)});
    const input=f.input();input.settings=normalizeSettings({...input.settings,enabled:true,serverEnabled:true,relayEnabled:true,keywordActivation,mode:'dialogue'});
    const indexed=await service.submit(f.user,'index',input,randomUUID());assert.equal((await done(service,f.user,indexed.id)).status,'completed');
    const bridge=createReplyBridge({service,countMessages:async(_u,_m,messages)=>Math.ceil(JSON.stringify(messages).length/3)});t.after(()=>bridge.close());
    let enter,release;const entered=new Promise(r=>enter=r),hold=new Promise(r=>release=r);t.after(()=>release());
    f.replies.push(async payload=>{enter();await hold;const data=JSON.parse(payload.messages.find(m=>m.role==='user').content);
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Hospital agreement'}]});});
    const background=createBackgroundRecall({settings:()=>input.settings,context:()=>input.context,
        supported:()=>true,relay:()=>({supports:async()=>true,enabled:()=>true}),tokenizer:async()=> 'fixture',countTokens:async text=>Math.ceil(text.length/3),
        input:async(_kind,options)=>({...input,options}),call:async(route,data)=>{
            if(route==='/reply/prepare')return bridge.prepareInput(f.user,data);
            if(route==='/reply/cancel')return bridge.cancel(f.user,data.ticket);
            assert.fail('Unexpected browser call after handoff: '+route);
        }});
    const slots=await background.prepare('normal');assert(slots.deferred);
    const lists={chat:[{world:'Book',uid:0,key:['hospital'],content:source}]};
    applyNativePolicy(lists,{...input.settings,books:input.books,messages:input.context.messages,selected:slots.selected});
    assert.equal(!!lists.chat[0].disable,!keywordActivation);
    const native=keywordActivation?[{role:'system',content:'Native lore: '+source}]:[];
    const prompt=[{role:'system',content:'Preset'},...native,{role:'system',content:slots.core},{role:'system',content:slots.text},{role:'system',content:slots.guidance},{role:'user',content:'Current hospital scene'}];
    background.capture({prompt});const payload={messages:prompt,model:'RP model',temperature:.7};background.attach(payload);
    const ticket=payload.__silly_relay_prepare.ticket,signal=new AbortController().signal;
    const pending=bridge.prepare({user:f.user,ticket,jobId:'relay',payload,signal});
    await entered;background.detach();release();const prepared=await pending;
    assert.equal(bridge.get(f.user,ticket).state,'completed');assert.equal(f.calls.length,1);
    const memory=prepared.messages.find(m=>m.content.startsWith('[Archive Lore — recalled records;'));
    assert(memory?.content.includes(source));assert(!JSON.stringify(prepared).includes('AL_memory_'));
    assert.deepEqual(prepared.messages.filter(m=>m.content.startsWith('Native lore:')),native);
    assert.equal(prepared.model,'RP model');assert.equal(prepared.temperature,.7);
    assert.equal(prepared.messages[0].content,'Preset');assert.equal(prepared.messages.at(-1).content,'Current hospital scene');
    assert(prepared.messages.some(m=>m.content==='Core relationship.'));
    assert.equal(fs.readFileSync(f.book,'utf8'),originalBook);
});
test('keyword support does not bypass disabled relay or group guards',t=>{
    const f=fixture(t);
    for(const setting of ['serverEnabled','relayEnabled']){
        const input=f.input();Object.assign(input.settings,{serverEnabled:true,relayEnabled:true,keywordActivation:true,[setting]:false});
        assert.throws(()=>f.service.replySnapshot(f.user,input),/서버 답변 연동 설정/);
    }
    const group=f.input();group.chat={id:'group',group:true};
    Object.assign(group.settings,{serverEnabled:true,relayEnabled:true,keywordActivation:true});
    atomic(path.join(f.user.directories.groupChats,'group.jsonl'),f.messages.map(m=>JSON.stringify(m)).join('\n')+'\n');
    assert.throws(()=>f.service.replySnapshot(f.user,group),/서버 답변 연동 설정/);
});
test('completed jobs release full chat inputs from RAM but preserve result and request-ID replay on disk',async t=>{
    const f=fixture(t);f.replies.push(memory());const requestId=randomUUID();
    const submitted=await f.service.submit(f.user,'collect',f.input(),requestId);
    const result=await done(f.service,f.user,submitted.id);
    assert.equal(result.status,'completed');
    const held=f.service.state(f.user).jobs.get(submitted.id);
    assert.equal(held.archived,true);assert.equal(held.input.context.messages,undefined);
    assert.equal(held.result,undefined);assert.equal(held.input.templates,undefined);
    const stored=json(path.join(f.root,'archive-lore-server','jobs',submitted.id+'.json'));
    assert.equal(stored.input.context.messages,undefined);assert.deepEqual(stored.result,result.result);
    const replay=await f.service.submit(f.user,'collect',f.input(),requestId);
    assert.equal(replay.id,submitted.id);assert.deepEqual(replay.result,result.result);assert.equal(f.calls.length,1);
    const restarted=createJobService(f.dependencies);
    assert.deepEqual(restarted.get(f.user,submitted.id).result,result.result);
    assert.equal(restarted.state(f.user).jobs.get(submitted.id).input.context.messages,undefined);
});
test('count presence does not load vector payloads or initialize persisted job history',async t=>{
    const f=fixture(t);await f.service.vectors(f.user).put('saved',[1,2,3]);
    const jobs=path.join(f.root,'archive-lore-server','jobs');fs.mkdirSync(jobs);fs.writeFileSync(path.join(jobs,randomUUID()+'.json'),'invalid job JSON must not be opened by counting');
    const service=createJobService(f.dependencies);
    const original=fs.readFileSync;let reads=0;
    fs.readFileSync=function(...args){reads++;return original.apply(this,args);};
    try{assert.deepEqual(await service.vectors(f.user).hasMany(['saved','missing']),[true,false]);assert.equal(reads,0);}
    finally{fs.readFileSync=original;}
    const other=fixture(t);assert.deepEqual(await service.vectors(other.user).hasMany(['saved']),[false]);
});
test('request-ID cancellation works before submission and before the accepted ID reaches the browser',async t=>{
    const f=fixture(t),early=randomUUID();
    f.service.cancel(f.user,undefined,early);
    assert.equal((await f.service.submit(f.user,'collect',f.input(),early)).status,'canceled');
    assert.equal(f.service.list(f.user).length,0);assert.equal(f.calls.length,0);
    const late=randomUUID(),job=await f.service.submit(f.user,'collect',f.input(),late);
    assert.equal(f.service.cancel(f.user,undefined,late).id,job.id);
    assert.equal((await done(f.service,f.user,job.id)).status,'canceled');assert.equal(f.calls.length,0);
});
test('running server cancellation aborts provider signal and prevents late memory writes',async t=>{
    const f=fixture(t);let entered,release,signal;
    const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
    f.replies.push(async(_payload,s)=>{signal=s;entered();await gate;return memory();});
    const job=await f.service.submit(f.user,'collect',f.input(),randomUUID());await started;
    f.service.cancel(f.user,job.id);assert(signal.aborted);
    assert.equal((await done(f.service,f.user,job.id)).status,'canceled');release();await new Promise(r=>setImmediate(r));
    assert.deepEqual(json(f.book),{entries:{}});assert(!jsonLines(f.file)[1].is_system);
});
test('direct embedding aborts on HTTP disconnect but persistent jobs do not',async()=>{
    const {EventEmitter}=await import('node:events'),{registerRoutes}=await import('./index.js');
    const handlers=new Map();let entered,signal;const started=new Promise(r=>entered=r);
    registerRoutes({post:(route,handler)=>handlers.set(route,handler)},{},async(_s,_text,_query,s)=>{
        signal=s;entered();return new Promise((_r,reject)=>s.addEventListener('abort',()=>reject(s.reason),{once:true}));
    });
    const res=new EventEmitter();res.json=()=>assert.fail('disconnected response');res.status=()=>res;
    const result=handlers.get('/embedding')({user:{profile:{handle:'owner'},directories:{root:'/tmp'}},body:{text:'hello'}},res);
    await started;res.emit('close');await result;assert(signal.aborted);assert.equal(res.listenerCount('close'),0);
});
async function done(service,user,id){for(let i=0;i<500;i++){const job=service.get(user,id);if(!['queued','running'].includes(job.status))return job;await new Promise(r=>setTimeout(r,5));}throw Error('job timeout');}
for(const generousRecall of [false,true])test(`first server selection constrains counts before generation: generous=${generousRecall}`,async t=>{
    const f=fixture(t);atomic(f.book,{entries:{0:{uid:0,content:'They visited the hospital. They agreed to return together.'}}});
    const input=f.input();input.settings.generousRecall=generousRecall;
    input.templates.collection.json_schema={name:'unrelated-preset-schema',value:{type:'string'}};
    const before=structuredClone(input.templates);
    const indexed=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,indexed.id)).status,'completed');
    f.replies.push(payload=>{
        const data=JSON.parse(payload.messages[1].content),schema=payload.json_schema;
        assert.equal(data.selectionFormat,generousRecall?'generous':'ranked');assert.equal(schema.strict,true);
        const rows=schema.value.properties.selections;assert.equal(rows.maxItems,48);
        assert.deepEqual(rows.items.properties.priority,{type:'integer',minimum:2,maximum:3});
        assert.equal(rows.items.properties.contextIds.maxItems,32);assert.equal(rows.items.properties.outcomeIds.maxItems,8);
        assert.equal(Object.hasOwn(rows.items.properties,'reason'),!generousRecall);
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Hospital visit',contextIds:[],outcomeIds:[]}]});
    });
    const job=await f.service.submit(f.user,'recall',input,randomUUID()),result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert.equal(f.calls.length,1);assert.deepEqual(input.templates,before);
    assert(result.result.text.includes('hospital'));assert.match(JSON.stringify(await readLogs(f.service,f.user,'test-key')),/선별 출력 제한/);
});
for(const generousRecall of [false,true])test(`Vertex server selection clears inherited schemas before the first backend request: generous=${generousRecall}`,async t=>{
    const f=fixture(t);atomic(f.book,{entries:{0:{uid:0,content:'They visited the hospital. They agreed to return together.'}}});
    const input=f.input();input.settings.generousRecall=generousRecall;
    Object.assign(input.templates.collection,{chat_completion_source:'vertexai',json_schema:{name:'old',value:{type:'string'}},responseSchema:{type:'string'},responseMimeType:'application/json'});
    const before=structuredClone(input.templates);
    const indexed=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,indexed.id)).status,'completed');
    f.replies.push((payload,signal)=>invokeBackend({handle(req,res){
        for(const field of ['json_schema','responseSchema','responseMimeType'])assert.equal(req.body[field],null);
        const data=JSON.parse(req.body.messages[1].content);
        assert.equal(data.selectionFormat,generousRecall?'generous':'ranked');
        assert.deepEqual(data.selectionLimits,{contextIds:32,outcomeIds:8});
        assert.match(req.body.messages[0].content,/HARD OUTPUT LIMITS/);
        res.json({choices:[{message:{content:JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Hospital visit',contextIds:[],outcomeIds:[]}]})},finish_reason:'stop'}]});
    }},f.user,payload,signal));
    const job=await f.service.submit(f.user,'recall',input,randomUUID()),result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert.equal(f.calls.length,1);assert.deepEqual(input.templates,before);
    assert.match(result.result.text,/hospital/);assert(result.result.tokens<=normalizeSettings(input.settings).injectionTokens);
    assert.match(JSON.stringify(await readLogs(f.service,f.user,'test-key')),/disabled-vertex/);
});
for(const genericGoogle of [false,true])test(`server compares schema failure and records compatibility mode: generic Google=${genericGoogle}`,async t=>{
    const f=fixture(t);atomic(f.book,{entries:{0:{uid:0,content:'They visited the hospital.'}}});
    const input=f.input();if(genericGoogle)input.templates.collection.chat_completion_source='makersuite';
    const indexed=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,indexed.id)).status,'completed');
    f.replies.push(payload=>{assert(payload.json_schema);throw Object.assign(Error(genericGoogle?'Request contains an invalid argument.':'json_schema response_format not supported'),{status:400});},payload=>{
        assert.equal(payload.json_schema,undefined);const data=JSON.parse(payload.messages[1].content);
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Hospital visit'}]});
    });
    const job=await f.service.submit(f.user,'recall',input,randomUUID()),result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert.equal(f.calls.length,2);
    assert.match(JSON.stringify(await readLogs(f.service,f.user,'test-key')),/unsupported/);
});
for(const comparisonSucceeds of [true,false])test(`server recall handles the real backend 500/Google 400 envelope: comparison succeeds=${comparisonSucceeds}`,async t=>{
    const f=fixture(t);atomic(f.book,{entries:{0:{uid:0,content:'They visited the hospital.'}}});
    const input=f.input();input.templates.collection.chat_completion_source='makersuite';
    const indexed=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,indexed.id)).status,'completed');
    const backend=(payload,signal)=>invokeBackend({handle(req,res){
        if(req.body.json_schema||!comparisonSucceeds)return res.status(500).json({error:{code:400,status:'INVALID_ARGUMENT',message:'Request contains an invalid argument.'}});
        const data=JSON.parse(req.body.messages[1].content);
        res.json({choices:[{message:{content:JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Hospital visit'}]})},finish_reason:'stop'}]});
    }},f.user,payload,signal);
    f.replies.push(backend,backend);
    const job=await f.service.submit(f.user,'recall',input,randomUUID()),result=await done(f.service,f.user,job.id);
    assert.equal(f.calls.length,2);assert(f.calls[0].json_schema);assert.equal(f.calls[1].json_schema,undefined);
    assert.deepEqual(f.calls[1],{...f.calls[0],json_schema:undefined});
    const logs=JSON.stringify(await readLogs(f.service,f.user,'test-key'));
    if(comparisonSucceeds){assert.equal(result.status,'completed',result.message);assert.match(result.result.text,/hospital/);assert.match(logs,/unsupported/);}
    else {assert.equal(result.status,'error');assert.match(result.message,/\(500\).*invalid argument/);assert.match(logs,/probe-failed/);}
});
test('server recall preserves selection emphasis in persisted jobs, AI requests and diagnostics',async t=>{
    const f=fixture(t);atomic(f.book,{entries:{0:{uid:0,content:'They visited the hospital. She felt grateful for his support.'}}});
    const input=f.input();input.settings.selectionFocus=['meaning','affection','unknown'];
    let job=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,job.id)).status,'completed');
    f.replies.push(payload=>{
        const messages=payload.messages,system=messages.find(x=>x.role==='system').content,data=JSON.parse(messages.find(x=>x.role==='user').content);
        assert.match(system,/MEMORY SELECTION EMPHASIS/);assert.deepEqual(data.selectionFocus,['affection','meaning']);
        const unit=data.memories.find(x=>x.text.includes('grateful'));
        return JSON.stringify({selections:[{id:unit.id,priority:3,reason:'Recorded gratitude'}]});
    });
    job=await f.service.submit(f.user,'recall',input,randomUUID());const result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert(result.result.text.includes('grateful'));assert.equal(f.calls.length,1);
    const saved=json(path.join(f.root,'archive-lore-server','jobs',job.id+'.json'));
    assert.deepEqual(saved.input.settings.selectionFocus,['affection','meaning']);
    assert.match(result.result.guidance,/response guidance, not past facts/);
    assert.equal(saved.result.guidance,result.result.guidance);
    assert.equal(saved.result.lastRecall.guidance,result.result.guidance);
    assert(result.result.tokens<=3000);
    assert(result.result.tokens>result.result.memoryTokens);
    const logs=await readLogs(f.service,f.user,'test-key');
    assert(logs.every(r=>r.events.length<=10));assert(logs.some(r=>r.events.some(e=>e.stage==='recall.review'&&e.data.recallReview.includes('선별'))));
});
test('server recall persists cross-entry completion dependencies for client budgeting',async t=>{
    const f=fixture(t);
    atomic(f.book,{entries:{
        0:{uid:0,comment:'Expense',content:'Morgan paid to clean the borrowed coat.'},
        1:{uid:1,comment:'Return',content:'Lee received the coat and put it in his locker.'},
    }});
    const input=f.input();
    let job=await f.service.submit(f.user,'index',input,randomUUID());
    assert.equal((await done(f.service,f.user,job.id)).status,'completed');
    f.replies.push(payload=>{
        const system=payload.messages.find(m=>m.role==='system').content;
        const data=JSON.parse(payload.messages.find(m=>m.role==='user').content);
        assert.match(system,/EVENT OUTCOME CONTINUITY/);
        const cost=data.memories.find(u=>u.text.includes('paid')),outcome=data.memories.find(u=>u.text.includes('received'));
        return JSON.stringify({selections:[{id:cost.id,priority:3,reason:'Expense',outcomeIds:[outcome.id]}]});
    });
    job=await f.service.submit(f.user,'recall',input,randomUUID());
    const result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert.equal(f.calls.length,1);
    assert(result.result.text.includes('locker'));
    const saved=json(path.join(f.root,'archive-lore-server','jobs',job.id+'.json'));
    const cost=saved.result.lastRecall.units.find(u=>u.text.includes('paid'));
    assert(cost.requiredContext.some(u=>u.text.includes('received')));
});
for(const generousRecall of [false,true])test(`server recall repairs rejected references and persists corrected evidence: generous=${generousRecall}`,async t=>{
    const f=fixture(t);
    atomic(f.book,{entries:{
        0:{uid:0,comment:'Expense',content:'Morgan paid to clean the borrowed coat.'},
        1:{uid:1,comment:'Return',content:'Lee received the coat and put it in his locker.'},
    }});
    const input=f.input();input.settings.generousRecall=generousRecall;
    let job=await f.service.submit(f.user,'index',input,randomUUID());
    assert.equal((await done(f.service,f.user,job.id)).status,'completed');
    let rejected,offered;
    f.replies.push(payload=>{
        const data=JSON.parse(payload.messages.find(m=>m.role==='user').content);offered=data.memories;
        const cost=offered.find(u=>u.text.includes('paid')),outcome=offered.find(u=>u.text.includes('received'));
        rejected=JSON.stringify({selections:[{id:cost.id,priority:3,reason:'Expense and return',contextIds:['missing-id']}]});
        return rejected;
    },payload=>{
        const data=JSON.parse(payload.messages.find(m=>m.role==='user').content);
        assert.deepEqual(data.memories,offered);assert.equal(data.selectionRepair.previousResponse,rejected);
        assert.equal(data.selectionRepair.details.problems[0].code,'id-not-in-batch');
        const cost=offered.find(u=>u.text.includes('paid')),outcome=offered.find(u=>u.text.includes('received'));
        return JSON.stringify({selections:[{id:cost.id,priority:3,reason:'Expense and return',contextIds:[],outcomeIds:[outcome.id]}]});
    });
    job=await f.service.submit(f.user,'recall',input,randomUUID());
    const result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert.equal(f.calls.length,2);
    assert.match(result.result.text,/paid/);assert.match(result.result.text,/locker/);
    const saved=json(path.join(f.root,'archive-lore-server','jobs',job.id+'.json'));
    assert(saved.result.lastRecall.units.find(u=>u.text.includes('paid')).requiredContext.some(u=>u.text.includes('received')));
    const logs=JSON.stringify(await readLogs(f.service,f.user,'test-key'));
    assert.match(logs,/id-not-in-batch/);assert.match(logs,/수정 응답 재검증 성공/);
});
for(const generousRecall of [false,true])test(`Relay preparation survives truncated selection and cross-entry context: generous=${generousRecall}`,async t=>{
    const f=fixture(t);
    atomic(f.book,{entries:{0:{uid:0,comment:'Agreements',content:'Lee agreed to meet Morgan on Saturday.'},1:{uid:1,comment:'Plans',content:'Morgan plans to wait at the station.'}}});
    const service=createJobService({...f.dependencies,countTokens:async(_u,_m,text)=>Math.ceil(text.length/3)});
    const input=f.input();input.settings=normalizeSettings({...input.settings,serverEnabled:true,relayEnabled:true,generousRecall});
    input.options={generationType:'normal',replyTokenizer:'fixture'};
    const index=await service.submit(f.user,'index',input,randomUUID());assert.equal((await done(service,f.user,index.id)).status,'completed');
    f.replies.push({choices:[{finish_reason:'length',message:{content:'{"selections":['}}]},payload=>{
        const data=JSON.parse(payload.messages.find(m=>m.role==='user').content);
        const a=data.memories.find(u=>u.text.includes('agreed')),b=data.memories.find(u=>u.text.includes('plans'));
        return JSON.stringify({selections:[{id:a.id,priority:3,reason:'Meeting arrangements',contextIds:[b.id]}]});
    });
    const bridge=createReplyBridge({service,countMessages:async(_u,_m,m)=>Math.ceil(JSON.stringify(m).length/3)});t.after(()=>bridge.close());
    const ticket='c'.repeat(32);bridge.prepareInput(f.user,{ticket,input});
    const slots=await reserveReplySlots(ticket,3000,text=>Math.ceil(text.length/3));
    const out=await bridge.prepare({user:f.user,ticket,jobId:'relay-job',payload:{messages:[{role:'system',content:slots.text},{role:'system',content:slots.guidance}]},signal:new AbortController().signal});
    assert.equal(bridge.get(f.user,ticket).state,'completed');assert.deepEqual(f.calls.map(c=>c.max_tokens),[6000,12000]);
    assert.match(out.messages[0].content,/Agreements\nLee agreed/);assert.match(out.messages[0].content,/Plans\nMorgan plans/);
    assert(!JSON.stringify(out).includes('AL_memory_'));
    const job=service.get(f.user,bridge.get(f.user,ticket).jobId);
    assert.equal(job.status,'completed');assert.equal(job.backgroundReply,true);assert.equal(job.result.selected.length,2);
});
test('server generous recall persists its option and finishes underfilled without another review',async t=>{
    const f=fixture(t);atomic(f.book,{entries:{0:{uid:0,content:'The hospital visit reassured her.'},1:{uid:1,content:'She liked having him beside her at the hospital.'}}});
    const input=f.input();input.settings.generousRecall=true;input.settings.candidateCount=1;
    let job=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,job.id)).status,'completed');
    f.replies.push(payload=>{
        const system=payload.messages.find(x=>x.role==='system').content,data=JSON.parse(payload.messages.find(x=>x.role==='user').content);
        assert.match(system,/GENEROUS RELATED MEMORY MODE/);
        return JSON.stringify({selections:data.memories.map(m=>({id:m.id,priority:2,contextIds:[]}))});
    });
    job=await f.service.submit(f.user,'recall',input,randomUUID());const result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert.equal(f.calls.length,1);
    assert(result.result.text.includes('reassured'));assert(!result.result.text.includes('liked'));assert(result.result.tokens<2700);
    assert.equal(result.result.lastRecall.fill,undefined);
    const saved=json(path.join(f.root,'archive-lore-server','jobs',job.id+'.json'));assert.equal(saved.input.settings.generousRecall,true);
    const logs=await readLogs(f.service,f.user,'test-key');
    assert(logs.some(r=>r.events.some(e=>e.stage==='recall.review'&&e.data.recallReview.includes('선별')&&!('accepted' in e.data)&&!('reviews' in e.data))));
});
test('accepted collection survives without polling; saves book, vector, hide flags and redacted diagnostics on disk',async t=>{
    const f=fixture(t);f.replies.push(memory());const id=randomUUID(),job=await f.service.submit(f.user,'collect',f.input(),id);
    assert.equal((await f.service.submit(f.user,'collect',f.input(),id)).id,job.id);
    await new Promise(r=>setTimeout(r,50));const result=await done(f.service,f.user,job.id);assert.equal(result.status,'completed',result.message);
    assert.equal(Object.keys(json(f.book).entries).length,1);assert.equal(json(f.book).archiveLore.receipts.length,1);
    assert.equal(jsonLines(f.file)[1].is_system,true);assert(!jsonLines(f.file)[2].is_system);
    assert.equal(fs.readdirSync(path.join(f.root,'archive-lore-server','vectors')).length,1);
    const logs=await readLogs(f.service,f.user,'test-key');assert(logs.some(r=>r.events.some(e=>e.stage==='collection.saved')));
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
    for(const mode of ['dialogue','questions']){const input=f.input();input.settings.mode=mode;if(mode==='questions')f.replies.push('{"questions":["Which hospital visit?"]}');f.replies.push('{"selections":[{"id":"u0","priority":3,"reason":"supplies the requested visit fact"}]}');job=await f.service.submit(f.user,'recall',input,randomUUID());const result=await done(f.service,f.user,job.id);assert.equal(result.status,'completed',result.message);assert(result.result.text.includes('hospital'));assert.equal(result.result.selected.length,1);assert.equal(result.result.lastRecall.units[0].priority,3);
        const preview=await f.service.logPreview(f.user);assert.equal(preview.recallDiagnostics,true);assert.equal(preview.fullRecallDiagnostics,true);assert.match(preview.text,/주입 준비 완료/);assert(preview.text.includes(result.result.text));assert.match(preview.text,/supplies the requested visit fact/);assert(!preview.text.includes('private-embedding-key'));assert(!preview.text.includes('주입 슬롯 등록 완료'));
    }
    assert((await readLogs(f.service,f.user,'test-key')).some(r=>r.events.some(e=>e.stage==='recall.review'&&e.data.recallReview.includes('선별'))));
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
    const queries=f.embeddingCalls.filter(call=>call.query).map(call=>call.text).join('\n');
    assert(queries.includes(f.messages[0].mes));assert(!queries.includes(f.messages[1].mes));
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

test('empty chat key never lists completed jobs from other chats',t=>{
    const f=fixture(t),s=f.service.state(f.user),id=randomUUID();
    s.jobs.set(id,{id,kind:'index',status:'completed',input:f.input(),hidden:[],message:'done'});
    assert.deepEqual(f.service.list(f.user,''),[]);
    assert.equal(f.service.list(f.user,'test-key').length,1);
});
for(const kind of ['collect','index'])test(`completed ${kind} history remains readable after source chat removal without replaying hide flags`,t=>{
    const f=fixture(t),s=f.service.state(f.user),id=randomUUID();
    const job={id,kind,status:'completed',input:f.input(),hidden:[{indices:[0]}],result:{saved:true},message:'done'};
    s.jobs.set(id,job);const before=JSON.stringify(job);fs.renameSync(f.file,f.file+'.renamed');
    const result=f.service.get(f.user,id);
    assert.equal(result.status,'completed');assert.equal(result.sourceChatMissing,true);assert.deepEqual(result.hidden,[]);
    assert.deepEqual(result.result,{saved:true});assert.equal(JSON.stringify(job),before);assert(!fs.existsSync(f.file));
    fs.renameSync(f.file+'.renamed',f.file);assert.equal(f.service.get(f.user,id).sourceChatMissing,undefined);
    fs.writeFileSync(f.file,'invalid json');assert.throws(()=>f.service.get(f.user,id),SyntaxError);
});

test('missing chat handling for completed history never permits a new job with a missing source',async t=>{
    const f=fixture(t),input=f.input();fs.renameSync(f.file,f.file+'.renamed');
    await assert.rejects(f.service.submit(f.user,'index',input,randomUUID()),e=>e.code==='ENOENT');
    assert.equal(f.service.list(f.user,'test-key').length,0);assert(!fs.existsSync(f.file));
});

test('large job input is not copied into every progress snapshot, restart keeps result and draft support',async t=>{
    const f=fixture(t),messages=[{name:'A',mes:'PRIVATE_LARGE_CHAT_'+ 'x'.repeat(200000),is_user:true}];
    f.writeChat(messages);const input=f.input();input.context.messages=messages;input.templates={};
    const submitted=await f.service.submit(f.user,'index',input,randomUUID());
    assert.equal((await done(f.service,f.user,submitted.id)).status,'completed');
    const raw=fs.readFileSync(path.join(f.root,'archive-lore-server','jobs',submitted.id+'.json'),'utf8');
    assert(!raw.includes('PRIVATE_LARGE_CHAT_'));assert(raw.length<messages[0].mes.length/2, `snapshot size ${raw.length}`);
    const restarted=createJobService(f.dependencies),result=restarted.get(f.user,submitted.id);
    assert.equal(result.status,'completed');assert.equal(result.chatKey,input.context.key);
});
test('renamed book recovers a pre-update server embedding and recalls without re-embedding documents',async t=>{
    const f=fixture(t);let documentEmbeds=0,queryEmbeds=0;
    const dependencies={...f.dependencies,embedRequest:async(_config,_text,query)=>{if(query)queryEmbeds++;else documentEmbeds++;return [1,0];}};
    const service=createJobService(dependencies);
    atomic(f.book,{entries:{0:{uid:0,comment:'Bracelet',content:'He wore a bracelet in Busan.',key:[],disable:false}}});
    let input=f.input();input.settings.mode='embedding';
    let job=await service.submit(f.user,'index',input,randomUUID());assert.equal((await done(service,f.user,job.id)).status,'completed');assert.equal(documentEmbeds,1);
    // Emulate old installs, which kept vectors and jobs but no content aliases.
    fs.rmSync(path.join(f.root,'archive-lore-server','vector-aliases'),{recursive:true,force:true});
    fs.renameSync(f.book,path.join(f.user.directories.worlds,'Renamed.json'));
    const restarted=createJobService(dependencies);input={...input,books:['Renamed'],target:'Renamed'};documentEmbeds=0;
    job=await restarted.submit(f.user,'index',input,randomUUID());let completed=await done(restarted,f.user,job.id);assert.equal(completed.status,'completed',completed.message);assert.equal(documentEmbeds,0);
    job=await restarted.submit(f.user,'recall',input,randomUUID());completed=await done(restarted,f.user,job.id);assert.equal(completed.status,'completed',completed.message);assert.match(completed.result.text,/bracelet/);assert.equal(documentEmbeds,0);assert(queryEmbeds>0);
});

test('server question mode repairs an empty JSON object in the same job and records the valid questions',async t=>{
    const f=fixture(t),input=f.input();input.settings.mode='questions';
    atomic(f.book,{entries:{0:{uid:0,content:'They visited the hospital.'}}});
    const before=json(f.book),indexed=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,indexed.id)).status,'completed');
    f.replies.push('{}','{"questions":["Which hospital did they visit?"]}','{"selections":[]}');
    const job=await f.service.submit(f.user,'recall',input,randomUUID()),result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert.equal(f.calls.length,3);
    assert.deepEqual(result.result.lastRecall.questions,['Which hospital did they visit?']);
    assert.match(f.calls[1].messages[0].content,/previous response/);
    assert.deepEqual(json(f.book),before);
});

test('server retries an empty plan and selects cached evidence without reembedding documents',async t=>{
    const f=fixture(t),input=f.input();input.settings.mode='questions';
    atomic(f.book,{entries:{0:{uid:0,content:'They visited the hospital together.',key:[],disable:false}}});
    const indexed=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,indexed.id)).status,'completed');
    f.replies.push('{"questions":[]}','{"questions":["What happened during their hospital visit?"]}',payload=>{
        const data=JSON.parse(payload.messages.at(-1).content);
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Their recorded shared visit.'}]});
    });
    const job=await f.service.submit(f.user,'recall',input,randomUUID()),result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert.equal(f.calls.length,3);
    assert.deepEqual(result.result.lastRecall.questions,['What happened during their hospital visit?']);
    assert.match(result.result.text,/hospital together/);
});
test('server exposes repeated empty question plans as errors instead of completed zero-memory recalls',async t=>{
    const f=fixture(t),input=f.input();input.settings.mode='questions';f.replies.push('{"questions":[]}','{"questions":[]}');
    atomic(f.book,{entries:{0:{uid:0,content:'They visited the hospital.'}}});
    const indexed=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,indexed.id)).status,'completed');
    const job=await f.service.submit(f.user,'recall',input,randomUUID()),result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'error');assert.match(result.message,/유효한 질문을 1~6개/);assert.equal(f.calls.length,2);
});

test('server and relay exclude private side records before core preparation and retrieval',async t=>{
    const f=fixture(t);atomic(f.book,{entries:{
        0:{uid:0,constant:true,content:'PUBLIC core.'},
        1:{uid:1,constant:true,content:'PRIVATE core.',STMB_sidePromptHistory:{templateKey:'private'}},
        2:{uid:2,content:'PRIVATE search.',STMB_sidePromptRegeneration:{templateKey:'private'}},
        3:{uid:3,content:'PUBLIC hospital memory.'},
    }});
    const input=f.input();Object.assign(input.settings,{mode:'embedding',serverEnabled:true,relayEnabled:true,excludedSidePromptKeys:['private']});
    assert.equal(f.service.replySnapshot(f.user,input).core,'PUBLIC core.');
    let job=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,job.id)).status,'completed');
    job=await f.service.submit(f.user,'recall',input,randomUUID());const result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed');assert.equal(result.result.core,'PUBLIC core.');assert(!result.result.text.includes('PRIVATE'));
    assert.deepEqual(result.result.lastRecall.records.map(r=>r.entry.uid),[0,3]);
    assert.equal(f.calls.length,0,'embedding mode needs no question or selector requests');
});

for(const mode of ['dialogue','questions'])for(const scenario of ['empty','core','unindexed'])test(`server skips provider calls without searchable memories: ${mode}, ${scenario}`,async t=>{
    const f=fixture(t),input=f.input();input.settings.mode=mode;input.settings.generousRecall=true;
    if(scenario!=='empty')atomic(f.book,{entries:{0:{uid:0,constant:scenario==='core',content:'Retained memory.'}}});
    const service=createJobService({...f.dependencies,ask:()=>assert.fail('no completion expected'),embedRequest:()=>assert.fail('no embedding expected')});
    const job=await service.submit(f.user,'recall',input,randomUUID()),result=await done(service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert.equal(result.result.text,'');assert.deepEqual(result.result.selected,[]);
    assert.equal(result.result.core,scenario==='core'?'Retained memory.':'');assert.deepEqual(result.result.lastRecall.questions,[]);
    assert.equal(result.result.lastRecall.pending,scenario==='unindexed'?1:0);
});

test('server diagnostics share one ten-stage ring across jobs and never write diagnostic files',async t=>{
    const f=fixture(t),fullMemory='Hospital memory. '.repeat(80)+'FULL_MEMORY_TAIL';atomic(f.book,{entries:{0:{uid:0,content:fullMemory}}});
    for(let i=0;i<4;i++){const input=f.input();input.settings.mode='embedding';input.templates={};const job=await f.service.submit(f.user,i===0?'index':'recall',input,randomUUID());assert.equal((await done(f.service,f.user,job.id)).status,'completed');}
    const runs=await f.service.logList(f.user);assert.equal(runs.reduce((n,r)=>n+r.events.length,0),10);
    assert(!fs.existsSync(path.join(f.root,'archive-lore-server','diagnostics')));
    const text=JSON.stringify(runs);assert(text.includes('Hospital memory.'));assert(!text.includes(fullMemory));assert(!text.includes('\"messages\":'));assert(!text.includes('private-embedding-key'));
    const restarted=createJobService(f.dependencies);assert.deepEqual(await restarted.logList(f.user),[]);
});

for(const generousRecall of [false,true])for(const correct of [false,true])test(`Relay enforces context limits after one repair: generous=${generousRecall}, correct=${correct}`,async t=>{
    const f=fixture(t);
    const lines=Array.from({length:36},(_,i)=>`Recorded hospital visit detail ${i}.`);
    atomic(f.book,{entries:{0:{uid:0,comment:'Hospital visit',content:lines.join('\n')}}});
    const originalBook=fs.readFileSync(f.book,'utf8');
    const service=createJobService({...f.dependencies,countTokens:async(_u,_m,text)=>Math.ceil(text.length/3)});
    const input=f.input();input.settings=normalizeSettings({...input.settings,serverEnabled:true,relayEnabled:true,generousRecall,injectionTokens:3000});
    input.options={generationType:'normal',replyTokenizer:'fixture'};
    const index=await service.submit(f.user,'index',input,randomUUID());assert.equal((await done(service,f.user,index.id)).status,'completed');
    const overflow=payload=>{
        const data=JSON.parse(payload.messages.find(m=>m.role==='user').content);
        assert.equal(data.memories.length,36);
        assert.deepEqual(data.selectionLimits,{contextIds:32,outcomeIds:8});
        if(f.calls.length===2)assert.equal(data.selectionRepair.details.problems[0].code,'too-many-references');
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Hospital visit context',contextIds:data.memories.slice(1,correct&&f.calls.length===2?33:36).map(u=>u.id)}]});
    };
    f.replies.push(overflow,overflow);
    const bridge=createReplyBridge({service,countMessages:async(_u,_m,m)=>Math.ceil(JSON.stringify(m).length/3)});t.after(()=>bridge.close());
    const ticket='d'.repeat(32);bridge.prepareInput(f.user,{ticket,input});
    const slots=await reserveReplySlots(ticket,3000,text=>Math.ceil(text.length/3));
    const payload={messages:[{role:'system',content:slots.text},{role:'system',content:slots.guidance}]};
    const pending=bridge.prepare({user:f.user,ticket,jobId:'relay-overflow',payload,signal:new AbortController().signal});
    if(correct){
        const out=await pending;
        assert.equal(bridge.get(f.user,ticket).state,'completed');
        for(const line of lines.slice(0,33))assert(out.messages[0].content.includes(line));
        assert(!JSON.stringify(out).includes('AL_memory_'));
        const job=service.get(f.user,bridge.get(f.user,ticket).jobId);
        assert.equal(job.status,'completed');assert.equal(job.result.lastRecall.units.length,33);
        assert(job.result.lastRecall.tokens<=3000);
    } else {
        await assert.rejects(pending,/too-many-references/);
        assert.equal(bridge.get(f.user,ticket).state,'error');
        assert.equal(payload.messages[0].content,slots.text);
    }
    assert.equal(f.calls.length,2);assert.equal(fs.readFileSync(f.book,'utf8'),originalBook);
    const audit=JSON.stringify(await readLogs(service,f.user,'test-key'));
    assert.doesNotMatch(audit,/연결 개수 초과 복구/);
});


test('large hidden chat is not uploaded; server recall still uses only configured visible recent messages',async t=>{
    const f=fixture(t);
    const messages=[{name:'Old',mes:'HIDDEN-PRIVATE-'+'가'.repeat(3*1024*1024),is_system:true},
        {name:'A',mes:'OLD-VISIBLE-MARKER',is_user:true},{name:'B',mes:'RECENT-ONE hospital'},
        {name:'A',mes:'RECENT-TWO hospital?',is_user:true}];
    f.writeChat(messages);atomic(f.book,{entries:{0:{uid:0,content:'They visited the hospital.'}}});
    const input=f.input();Object.assign(input.settings,{serverEnabled:true,relayEnabled:true,recentCount:2,mode:'dialogue'});
    input.options={generationType:'normal',replyTokenizer:'test'};
    const service=createJobService({...f.dependencies,countTokens:async(_u,_m,text)=>Math.ceil(text.length/3)});
    const bridge=createReplyBridge({service,countMessages:async(_u,_m,messages)=>Math.ceil(JSON.stringify(messages).length/3)});
    t.after(()=>bridge.close());
    const ticket='c'.repeat(32);
    assert.throws(()=>bridge.prepareInput(f.user,{ticket,input}),/요청 .*한도 8 MiB/);
    input.context=serverChatSnapshot(input.context);
    assert(Buffer.byteLength(JSON.stringify(input))<10000);
    let job=await service.submit(f.user,'index',input,randomUUID());assert.equal((await done(service,f.user,job.id)).status,'completed');
    bridge.prepareInput(f.user,{ticket,input});assert.equal(f.calls.length,0);
    f.replies.push(payload=>{const data=JSON.parse(payload.messages.find(m=>m.role==='user').content);
        assert(data.dialogue.includes('RECENT-ONE'));assert(data.dialogue.includes('RECENT-TWO'));
        assert(!JSON.stringify(data).includes('HIDDEN-PRIVATE'));assert(!data.dialogue.includes('OLD-VISIBLE-MARKER'));
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'hospital'}]});});
    const slots=await reserveReplySlots(ticket,3000,async text=>Math.ceil(text.length/3));
    const output=await bridge.prepare({user:f.user,ticket,jobId:'relay',signal:new AbortController().signal,
        payload:{messages:[{role:'system',content:slots.text},{role:'system',content:slots.guidance},{role:'user',content:'Hospital?'}]}});
    assert(output.messages[0].content.includes('hospital'));assert.equal(f.calls.length,1);
});

test('compact source guards reject unsaved and edited chats, allow collection hiding and persist no bodies',async t=>{
    const f=fixture(t),input=f.input();input.context=serverChatSnapshot(input.context);
    const unsaved=structuredClone(input);unsaved.context.source.hashes[0]='00000000';
    await assert.rejects(f.service.submit(f.user,'collect',unsaved,randomUUID()),/대화 저장/);
    f.replies.push(memory());let job=await f.service.submit(f.user,'collect',input,randomUUID());
    assert.equal((await done(f.service,f.user,job.id)).status,'completed');
    assert(jsonLines(f.file)[1].is_system);
    const saved=json(path.join(f.root,'archive-lore-server','jobs',job.id+'.json'));
    assert.equal(saved.input.context.messages,undefined);
    const other=fixture(t),next=other.input();next.context=serverChatSnapshot(next.context);
    other.replies.push(()=>{other.writeChat([{...other.messages[0],mes:'Edited during request'},other.messages[1]]);return memory();});
    job=await other.service.submit(other.user,'collect',next,randomUUID());
    assert.equal((await done(other.service,other.user,job.id)).status,'error');assert.deepEqual(json(other.book),{entries:{}});
});

for(const generousRecall of [false,true])test(`server applies the caller's review token limit before selection: generous=${generousRecall}`,async t=>{
    const {estimateTokens}=await import('../lore-core.js');
    const f=fixture(t);atomic(f.book,{entries:Object.fromEntries(Array.from({length:8},(_,i)=>[i,{uid:i,comment:`Visit ${i}`,content:(`At hospital visit ${i}, they discussed the treatment and agreed to rest together. `).repeat(40)}]))});
    const input=f.input();Object.assign(input.settings,{reviewTokens:2000,injectionTokens:5000,candidateCount:24,generousRecall});
    const indexed=await f.service.submit(f.user,'index',input,randomUUID());assert.equal((await done(f.service,f.user,indexed.id)).status,'completed');
    let tokens=0;
    for(let i=0;i<10;i++)f.replies.push(payload=>{
        const data=JSON.parse(payload.messages.find(m=>m.role==='user').content);
        assert.match(payload.messages.find(m=>m.role==='system').content,/BOUNDED SOURCE REVIEW/);
        tokens+=data.memories.reduce((sum,u)=>sum+estimateTokens(u.text),0);
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Hospital context',contextIds:[]}]});
    });
    const job=await f.service.submit(f.user,'recall',input,randomUUID()),result=await done(f.service,f.user,job.id);
    assert.equal(result.status,'completed',result.message);assert(tokens>0&&tokens<=2000);assert(result.result.tokens<=5000);
    assert.match(JSON.stringify(await readLogs(f.service,f.user,'test-key')),/\/ 2000/);
});
