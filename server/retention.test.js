// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pruneJobs,pruneDiagnostics,resetLegacyHistory,LEGACY_HISTORY_RESET} from './retention.js';
import {atomic,privateStore,hash} from './storage.js';
import {HISTORY_AGE_MS} from '../lore-retention.js';
import {createJobService} from './jobs.js';
import {registerRoutes} from './index.js';

test('one-time reset clears all legacy history including malformed jobs/orphan backups without touching source data',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'al-reset-'));
    try {
        for(const name of ['diagnostics/old.json','jobs/broken.json','jobs/unfinished.json.temp','backups/orphan/copy.bak'])atomic(path.join(root,name),'not JSON');
        for(const name of ['vectors/saved.json','chats/chat.jsonl','worlds/book.json','other.json'])atomic(path.join(root,name),'preserve');
        assert.equal(resetLegacyHistory(root),true);
        for(const name of ['diagnostics','jobs','backups'])assert.deepEqual(fs.readdirSync(path.join(root,name)),[]);
        for(const name of ['vectors/saved.json','chats/chat.jsonl','worlds/book.json','other.json'])assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'preserve');
        assert.equal(JSON.parse(fs.readFileSync(path.join(root,LEGACY_HISTORY_RESET))).version,1);
        atomic(path.join(root,'diagnostics/new.json'),'new trace');atomic(path.join(root,'jobs/new.json'),'new job');
        assert.equal(resetLegacyHistory(root),false);
        assert.equal(fs.readFileSync(path.join(root,'diagnostics/new.json'),'utf8'),'new trace');
        assert.equal(fs.readFileSync(path.join(root,'jobs/new.json'),'utf8'),'new job');
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('reset unlinks child symlinks without following them and rejects linked history directories',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'al-reset-links-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'al-keep-'));
    try {
        atomic(path.join(outside,'keep.txt'),'preserve');fs.mkdirSync(path.join(root,'backups'));
        fs.symlinkSync(outside,path.join(root,'backups','linked-child'),'dir');
        assert.equal(resetLegacyHistory(root),true);assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'preserve');
        fs.unlinkSync(path.join(root,LEGACY_HISTORY_RESET));fs.symlinkSync(outside,path.join(root,'diagnostics'),'dir');
        assert.throws(()=>resetLegacyHistory(root));assert(!fs.existsSync(path.join(root,LEGACY_HISTORY_RESET)));
        assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'preserve');
    } finally {fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});

test('authenticated startup status resets old data before jobs load; later initialization preserves new records',async()=>{
    const owner=fs.mkdtempSync(path.join(os.tmpdir(),'al-reset-status-')),root=path.join(owner,'archive-lore-server');
    try {
        atomic(path.join(root,'jobs',randomUUID()+'.json'),'malformed old job must not be parsed');
        atomic(path.join(root,'diagnostics','old.json'),'old diagnostic');
        const user={profile:{handle:'owner'},directories:{root:owner}},service=createJobService({sanitize:s=>s});
        const handlers=new Map();registerRoutes({post:(url,fn)=>handlers.set(url,fn)},service);
        const res={status:()=>res,json:data=>{res.data=data;return res;}};
        await handlers.get('/status')({user,body:{}},res);
        assert.equal(res.data.version,'0.3.14');assert.deepEqual(fs.readdirSync(path.join(root,'jobs')),[]);
        assert.equal(service.list(user).length,0);
        const id=randomUUID(),job={id,kind:'recall',status:'completed',input:{context:{key:'chat'},books:[]},created:new Date().toISOString()};
        atomic(path.join(root,'jobs',id+'.json'),job);
        assert.equal(createJobService({sanitize:s=>s}).list(user).length,1);
    } finally {fs.rmSync(owner,{recursive:true,force:true});}
});

test('cleanup removes only expired plugin jobs/backups and keeps active jobs, chat, world and vectors',async t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'al-retention-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const jobsDir=path.join(root,'jobs');fs.mkdirSync(jobsDir);const jobs=new Map();
    const add=(status,created)=>{const id=randomUUID(),job={id,status,created};jobs.set(id,job);atomic(path.join(jobsDir,id+'.json'),job);atomic(path.join(root,'backups',id,'copy.bak'),'backup');return id;};
    const stale=new Date(Date.now()-HISTORY_AGE_MS-10000).toISOString();
    const old=add('completed',stale),active=add('running',stale),draft=add('completed',new Date().toISOString());
    jobs.get(draft).draftAvailable=true;
    for(const name of ['chats/current.jsonl','worlds/book.json','vectors/entry.json'])atomic(path.join(root,name),'preserve');
    pruneJobs({root,jobsDir,jobs});
    assert(!jobs.has(old));assert(!fs.existsSync(path.join(root,'backups',old)));
    assert(jobs.has(active));assert(jobs.has(draft));
    for(const name of ['chats/current.jsonl','worlds/book.json','vectors/entry.json'])assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'preserve');
});

test('diagnostics prune existing files by age/count while preserving the current writer',async t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'al-diag-retention-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const store=privateStore(root,'diagnostics');
    for(let i=0;i<25;i++){await store.put(String(i),{id:String(i)});const time=new Date(Date.now()-i*1000);fs.utimesSync(path.join(root,'diagnostics',hash(String(i))+'.json'),time,time);}
    await store.put('expired',{id:'expired'});const old=path.join(root,'diagnostics',hash('expired')+'.json'),date=new Date(Date.now()-HISTORY_AGE_MS-1000);fs.utimesSync(old,date,date);
    const protectedFile=path.join(root,'diagnostics',hash('24')+'.json');pruneDiagnostics(root,protectedFile);
    assert(!fs.existsSync(old));assert(fs.existsSync(protectedFile));assert.equal(fs.readdirSync(path.join(root,'diagnostics')).length,20);
});
