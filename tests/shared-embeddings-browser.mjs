// Archive Lore — AGPL-3.0-only. Real IndexedDB in separate browser contexts.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createJobService} from '../server/jobs.js';
import {registerRoutes} from '../server/index.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source=fileURLToPath(new URL('../',import.meta.url)),root=fs.mkdtempSync(path.join(os.tmpdir(),'al-shared-browser-'));
const user={profile:{handle:'owner'},directories:{root}},service=createJobService({sanitize:s=>s}),handlers=new Map();
registerRoutes({post:(route,fn)=>handlers.set(route,fn)},service);
const server=http.createServer(async(req,res)=>{
    try{
        if(req.method==='POST'){
            let body='';for await(const part of req)body+=part;
            const handler=handlers.get(req.url);if(!handler){res.writeHead(404);return res.end();}
            return await handler({user,body:JSON.parse(body)}, {status(code){res.statusCode=code;return this;},json(data){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}});
        }
        if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>Embedding migration test</title>');}
        if(!/^\/[a-zA-Z0-9-]+\.js$/.test(req.url)){res.writeHead(404);return res.end();}
        res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(source,req.url.slice(1))));
    }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,headless:true});
try{
    const first=await browser.newContext(),page=await first.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const migrated=await page.evaluate(async()=>{
        const {createVectorStore,embeddingKey,digest}=await import('/lore-api.js');
        const {sharedVectorStore}=await import('/lore-shared-embeddings.js');
        const local=createVectorStore(),keys=[];
        for(let i=0;i<130;i++){
            const key=await embeddingKey({cacheNamespace:'n',embeddingProvider:'gemini',embeddingModel:'gemini-embedding-001'},'book',`Original ${i}`);keys.push(key);
            await local.put(i===0?await digest(key.slice(13)):i===1?'exact-v1:'+key.slice(13):key,[i+1,1]);
        }
        const localBulk=await local.getMany([keys[0],keys[1],keys[129],keys[0]]);
        if(JSON.stringify(localBulk)!==JSON.stringify([[1,1],[2,1],[130,1],[1,1]]))throw Error('Local bulk lookup lost legacy keys or ordering');
        const call=async(route,body={})=>{const res=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error);return data;};
        let shared=false;const store=sharedVectorStore({local,call,onShared:()=>{shared=true;}});await store.ready();
        let after,originalCount=0;do{const page=await local.keys(after);originalCount+=page.keys.length;after=page.after;}while(after!==undefined);
        return {keys,originalCount,shared,first:await store.get(keys[0]),second:await store.get(keys[1]),last:await store.get(keys.at(-1))};
    });
    assert.equal(migrated.originalCount,130);assert.equal(migrated.shared,true);assert.deepEqual(migrated.first,[1,1]);assert.deepEqual(migrated.second,[2,1]);assert.deepEqual(migrated.last,[130,1]);
    const app=await browser.newContext(),appPage=await app.newPage();await appPage.goto(page.url());
    const read=await appPage.evaluate(async key=>{
        const {createVectorStore}=await import('/lore-api.js');const {sharedVectorStore}=await import('/lore-shared-embeddings.js');
        const local=createVectorStore();const before=await local.keys();
        const call=async(route,body={})=>{const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();};
        const store=sharedVectorStore({local,call});await store.ready();return {localCount:before.keys.length,vector:await store.get(key),bulk:await store.getMany([key,'missing',key])};
    },migrated.keys.at(-1));
    assert.equal(read.localCount,0);assert.deepEqual(read.vector,[130,1]);
    assert.deepEqual(read.bulk,[[130,1],null,[130,1]]);
    console.log('PASS: 130 real IndexedDB records paginated and migrated; legacy formats recovered; originals preserved; isolated app context reads the common folder.');
}finally{await browser.close();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
