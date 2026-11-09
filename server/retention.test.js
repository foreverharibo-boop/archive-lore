// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pruneJobs,pruneDiagnostics} from './retention.js';
import {atomic,privateStore,hash} from './storage.js';
import {HISTORY_AGE_MS} from '../lore-retention.js';

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
