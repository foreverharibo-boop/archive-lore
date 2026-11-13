// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Writable,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {privateStore,atomic} from './storage.js';
import {diagnosticFiles,diagnosticStream} from './diagnostics.js';
import {registerRoutes} from './index.js';
import {createJobService} from './jobs.js';
import {resetLegacyHistory} from './retention.js';

function fixture(t){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'al-diagnostics-'));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const store=privateStore(root,'diagnostics');
    const row=(id,chatKey,mode='questions')=>({schemaVersion:1,id,kind:'recall',chatKey,mode,
        chatName:'이름 ,"events":[ 문자열',started:'2026-11-09T00:00:00.000Z',status:'success',
        events:[{stage:'ai.response',data:{text:'줄바꿈\n증거'}}],finished:'2026-11-09T00:00:01.000Z'});
    return {root,store,row};
}
const collect=async stream=>{const chunks=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString();};

test('header-only listing filters chats/modes, and streaming preserves every event and finished timestamp',async t=>{
    const f=fixture(t),a=f.row('a','chat-a'),b=f.row('b','chat-a','dialogue'),other=f.row('c','chat-b');
    for(const row of [a,b,other])await f.store.put(row.id,row);
    const rows=await diagnosticFiles(f.root,'chat-a');
    assert.equal(rows.length,2);assert(rows.every(r=>r.header.events===undefined));
    const streamed=JSON.parse(await collect(diagnosticStream(rows)));
    assert.deepEqual(new Map(streamed.map(r=>[r.id,r])),new Map([a,b].map(r=>[r.id,r])));
    assert.deepEqual(JSON.parse(await collect(diagnosticStream(await diagnosticFiles(f.root,'chat-a','questions')))),[a]);
    assert.deepEqual(await diagnosticFiles(f.root,''),[]);
    assert.deepEqual(await diagnosticFiles(f.root,undefined),[]);
});

test('diagnostic listing does not initialize or parse saved job history',async t=>{
    const f=fixture(t),root=path.join(f.root,'archive-lore-server');fs.mkdirSync(root);resetLegacyHistory(root);
    const store=privateStore(root,'diagnostics');await store.put('a',f.row('a','chat-a'));
    const jobs=path.join(root,'jobs');fs.mkdirSync(jobs);fs.writeFileSync(path.join(jobs,randomUUID()+'.json'),'invalid history must not be read');
    const user={profile:{handle:'owner'},directories:{root:f.root}};
    const service=createJobService({sanitize:s=>s,ask:()=>assert.fail()});
    assert.equal((await service.logList(user,'chat-a')).length,1);
    assert.equal(JSON.parse(await collect(await service.logStream(user,'chat-a'))).length,1);
});

test('stream closes its file on consumer cancellation and does not continue into later files',async t=>{
    const f=fixture(t),row=f.row('a','chat-a');row.events[0].data.text='x'.repeat(2*1024*1024);await f.store.put(row.id,row);
    const rows=await diagnosticFiles(f.root,'chat-a');let chunks=0;
    const sink=new Writable({write(_chunk,_encoding,callback){chunks++;callback(chunks===3?new Error('client disconnected'):undefined);}});
    await assert.rejects(pipeline(Readable.from(diagnosticStream(rows)),sink),/client disconnected/);
    assert.equal(chunks,3);
});

test('legacy and new export routes stream authenticated JSON without calling response.json on success',async()=>{
    const handlers=new Map(),user={profile:{handle:'owner'},directories:{root:'/fixture'}};
    registerRoutes({post:(url,handler)=>handlers.set(url,handler)},{logStream:async(actual,key,mode)=>{
        assert.equal(actual,user);assert.equal(key,'chat');assert.equal(mode,'questions');
        return (async function*(){yield '[{"events":';yield '[1,2,3]}]';})();
    }});
    for(const route of ['/logs','/logs/export']){
        let body='',type;
        const res=new Writable({write(chunk,_encoding,cb){body+=chunk;cb();}});
        res.type=value=>{type=value;return res;};res.json=()=>assert.fail('must stream');
        await handlers.get(route)({user,body:{chatKey:'chat',mode:'questions'}},res);
        assert.deepEqual(JSON.parse(body),[{events:[1,2,3]}]);assert.equal(type,route==='/logs'?'application/json':'text/plain');
    }
    let code;await handlers.get('/logs/export')({body:{}},{status:n=>{code=n;return {json:()=>{}};}});assert.equal(code,401);
});

test('80 MiB of logs and 80 MiB of completed job inputs fit a 64 MiB Node heap without losing bytes',async t=>{
    const f=fixture(t),root=path.join(f.root,'archive-lore-server');fs.mkdirSync(root);resetLegacyHistory(root);
    const store=privateStore(root,'diagnostics'),jobs=path.join(root,'jobs');fs.mkdirSync(jobs);
    const payload='x'.repeat(2*1024*1024);
    for(let i=0;i<40;i++){
        const row=f.row(String(i),'chat-a');row.events[0].data.text=payload;await store.put(row.id,row);
        const id=randomUUID();atomic(path.join(jobs,id+'.json'),{id,requestId:id,kind:'recall',status:'completed',input:{context:{key:'chat-a',messages:[{mes:payload}]},books:[]},result:{text:'saved'}});
    }
    const rows=await diagnosticFiles(root,'chat-a'),expected=createHash('sha256');let bytes=0;
    for await(const chunk of diagnosticStream(rows)){const b=Buffer.from(chunk);expected.update(b);bytes+=b.length;}
    const script=`import {createJobService} from ${JSON.stringify(new URL('./jobs.js',import.meta.url).href)};
        import {createHash} from 'node:crypto';
        import {diagnosticFiles,diagnosticStream} from ${JSON.stringify(new URL('./diagnostics.js',import.meta.url).href)};
        const user={profile:{handle:'owner'},directories:{root:${JSON.stringify(f.root)}}};
        const service=createJobService({sanitize:s=>s});
        const rows=await diagnosticFiles(${JSON.stringify(root)},'chat-a');
        const hash=createHash('sha256');let bytes=0;
        for await(const chunk of diagnosticStream(rows)){const b=Buffer.from(chunk);hash.update(b);bytes+=b.length;}
        if(service.list(user).length!==20)throw Error('retention must keep 20 jobs');
        if(JSON.stringify([...service.state(user).jobs.values()]).length>100000)throw Error('retained full history');
        if((await service.logList(user,'chat-a')).length>=40)throw Error('diagnostic byte limit not enforced');
        console.log(JSON.stringify({bytes,hash:hash.digest('hex')}));`;
    const child=spawnSync(process.execPath,['--max-old-space-size=64','--input-type=module','-e',script],{encoding:'utf8',timeout:30000});
    assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{bytes,hash:expected.digest('hex')});
});

test('server preview reads only recent matching runs and returns bounded text through an authenticated route',async t=>{
    const f=fixture(t),root=path.join(f.root,'archive-lore-server');fs.mkdirSync(root);resetLegacyHistory(root);
    const store=privateStore(root,'diagnostics');
    for(let i=0;i<5;i++){const run=f.row(String(i),'chat-a');run.started=new Date(Date.now()+i).toISOString();run.status='error';run.events=[{stage:'ai.transport.error',data:{message:'permission denied '+i,status:403}},{stage:'response',data:{text:'x'.repeat(100000)}}];await store.put(run.id,run);}
    await store.put('other',f.row('other','chat-b'));
    const user={profile:{handle:'owner'},directories:{root:f.root}},service=createJobService({sanitize:s=>s,ask:()=>assert.fail()});
    const handlers=new Map();registerRoutes({post:(url,fn)=>handlers.set(url,fn)},service);
    let code=200,body;const res={status:n=>{code=n;return res;},json:v=>{body=v;}};
    await handlers.get('/logs/preview')({body:{chatKey:'chat-a'}},res);assert.equal(code,401);
    await handlers.get('/logs/preview')({user,body:{chatKey:'chat-a'}},res);
    assert(body.text.length<=24000);assert(body.text.includes('permission denied 4'));assert(!body.text.includes('permission denied 0'));assert(!body.text.includes('chat-b'));
    assert.equal(body.runs.length,3);assert.equal((body.text.match(/ · recall · error/g)||[]).length,6);
});
