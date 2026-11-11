// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(import.meta.dirname,'..');
const server=http.createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8">');return;}const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))throw Error('path');res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined});
try{
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(async()=>{
        const {createVectorStore,embeddingKey}=await import('/lore-api.js');
        const {embeddingChunks,entryId}=await import('/lore-core.js');
        const {createLoreController}=await import('/lore-controller.js');
        const config={enabled:true,cacheNamespace:'rename',embeddingProvider:'gemini',embeddingModel:'gemini-embedding-001',mode:'embedding',injectionTokens:3000};
        const entry={uid:1,comment:'Busan',content:'He visited Busan. He wore a bracelet.'};
        const chunks=embeddingChunks(entry);const store=createVectorStore();
        // Seed the exact pre-update key, not a newly written content alias.
        for(const chunk of chunks)await store.put(await embeddingKey(config,entryId('Old Book',1),chunk.text),[1,0]);
        let reads=0,scans=0;
        const get=IDBObjectStore.prototype.get,cursor=IDBObjectStore.prototype.openKeyCursor;
        IDBObjectStore.prototype.get=function(...args){reads++;return get.apply(this,args);};
        IDBObjectStore.prototype.openKeyCursor=function(...args){scans++;return cursor.apply(this,args);};
        const renamed=createVectorStore(),keys=await Promise.all(chunks.map(c=>embeddingKey(config,entryId('New Book',1),c.text)));
        const presence=await renamed.hasMany(keys),countReads=reads;
        const repeated=await renamed.hasMany(keys),scanCount=scans;
        const vectors=await Promise.all(keys.map(k=>renamed.get(k)));
        let documentEmbeds=0,queryEmbeds=0;
        const controller=createLoreController({settings:()=>config,context:()=>({key:'chat',messages:[{name:'A',is_user:true,mes:'Which bracelet did he wear in Busan?'}]}),books:()=>['New Book'],loadBook:async()=>({entries:{1:entry}}),target:()=>'',store:renamed,
            embed:async(_config,_text,query)=>{if(query)queryEmbeds++;else documentEmbeds++;return [1,0];},countTokens:s=>Math.ceil(s.length/4),ask:()=>{throw Error('No AI selection in embedding mode');},changed(){}});
        const counts=await controller.embeddingCounts();await controller.index();const recalled=await controller.recall();
        const modified=await renamed.hasMany([await embeddingKey(config,entryId('New Book',1),'Busan\nChanged fact.')]);
        const namespace=await renamed.hasMany([await embeddingKey({...config,cacheNamespace:'other'},entryId('New Book',1),chunks[0].text)]);
        const recreated=await createVectorStore().get(keys[0]);
        // New writes remain visible after the one-time key index has been built.
        const laterOld=await embeddingKey(config,entryId('Old Book',2),'New exact input');await renamed.put(laterOld,[0,1]);
        const later=await renamed.get(await embeddingKey(config,entryId('Next Book',2),'New exact input'));
        return {presence,repeated,countReads,scanCount,vectors,counts,documentEmbeds,queryEmbeds,text:recalled.text,modified,namespace,recreated,later};
    });
    assert(result.presence.every(Boolean));assert(result.repeated.every(Boolean));assert.equal(result.countReads,0);assert.equal(result.scanCount,1);
    assert(result.vectors.every(v=>v[0]===1));assert.deepEqual(result.counts,{embedded:1,pending:0});assert.equal(result.documentEmbeds,0);assert(result.queryEmbeds>0);assert.match(result.text,/bracelet/);
    assert.deepEqual(result.modified,[false]);assert.deepEqual(result.namespace,[false]);assert.deepEqual(result.recreated,[1,0]);assert.deepEqual(result.later,[0,1]);
    console.log('Real IndexedDB rename recovery: counts, index, recall, reload, strict identity and zero document re-embedding passed.');
}finally{await browser.close();server.close();}
