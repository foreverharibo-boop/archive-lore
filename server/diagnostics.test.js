// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createJobService} from './jobs.js';
import {registerRoutes} from './index.js';
import {resetLegacyHistory,clearLegacyDiagnostics} from './retention.js';
function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'al-memory-diagnostics-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const root=path.join(base,'archive-lore-server');fs.mkdirSync(root);resetLegacyHistory(root);
 return {base,root,user:{profile:{handle:'owner'},directories:{root:base}}};
}
test('migration removes old debug files without reading their bodies or touching job/backup/vector files',t=>{
 const f=fixture(t);for(const folder of ['diagnostics','jobs','backups','vectors']){fs.mkdirSync(path.join(f.root,folder),{recursive:true});fs.writeFileSync(path.join(f.root,folder,'preserve.json'),'not valid JSON');}
 clearLegacyDiagnostics(f.root);assert(!fs.existsSync(path.join(f.root,'diagnostics')));
 for(const folder of ['jobs','backups','vectors'])assert.equal(fs.readFileSync(path.join(f.root,folder,'preserve.json'),'utf8'),'not valid JSON');
 clearLegacyDiagnostics(f.root);
});
test('debug cleanup unlinks a diagnostics symlink without following its target',t=>{
 const f=fixture(t),outside=path.join(f.base,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep'),'safe');fs.symlinkSync(outside,path.join(f.root,'diagnostics'));
 clearLegacyDiagnostics(f.root);assert.equal(fs.readFileSync(path.join(outside,'keep'),'utf8'),'safe');
});
test('server debug listing clears old logs, never loads job history and never recreates a diagnostic directory',async t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.root,'diagnostics'));fs.writeFileSync(path.join(f.root,'diagnostics','legacy.json'),'x'.repeat(1024*1024));
 fs.mkdirSync(path.join(f.root,'jobs'));fs.writeFileSync(path.join(f.root,'jobs','bad.json'),'must not parse');
 const service=createJobService({sanitize:s=>s});assert.deepEqual(await service.logList(f.user),[]);
 assert(!fs.existsSync(path.join(f.root,'diagnostics')));assert(fs.existsSync(path.join(f.root,'jobs','bad.json')));
 const preview=await service.logPreview(f.user);assert.equal(preview.diagnosticMode,'memory-errors-v1');assert.deepEqual(preview.runs,[]);
 let exported='';for await(const chunk of await service.logStream(f.user))exported+=chunk;assert.equal(exported,'[]');assert(!fs.existsSync(path.join(f.root,'diagnostics')));
});
test('new debug endpoint authenticates and calls only the in-memory diagnostic source',async()=>{
 const routes=new Map();let calls=0;registerRoutes({post:(url,fn)=>routes.set(url,fn)},{logPreview:async()=>{calls++;return {diagnosticMode:'memory-errors-v1',runs:[],text:'empty'};}});
 let code=200,body;const res={status:n=>{code=n;return res;},json:value=>{body=value;}};
 await routes.get('/debug/recent')({body:{}},res);assert.equal(code,401);assert.equal(calls,0);
 await routes.get('/debug/recent')({user:{profile:{handle:'owner'},directories:{root:'/fixture'}},body:{}},res);assert.equal(calls,1);assert.equal(body.diagnosticMode,'memory-errors-v1');
});
