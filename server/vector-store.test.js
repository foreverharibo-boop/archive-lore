// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {reusableVectorStore,legacyEmbeddingBooks} from './vector-store.js';
import {privateStore,atomic} from './storage.js';
import {embeddingKey} from '../lore-api.js';
const config={cacheNamespace:'test',embeddingProvider:'gemini',embeddingModel:'gemini-embedding-001'};
const key=(book,text='Fact.')=>embeddingKey(config,JSON.stringify([book,'1']),text);
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'al-vector-rename-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
test('saved content aliases survive renames and server restart without copying vectors',async t=>{
    const root=fixture(t),old=await key('Old'),next=await key('New');
    await reusableVectorStore(root).put(old,[1,2,3]);
    const store=reusableVectorStore(root);assert.deepEqual(await store.hasMany([next,await key('New','Changed.')]),[true,false]);
    assert.deepEqual(await store.get(next),[1,2,3]);assert.equal(fs.readdirSync(path.join(root,'vectors')).length,1);
    const other=reusableVectorStore(fixture(t));assert.deepEqual(await other.hasMany([next]),[false]);
});
test('pre-update hashed files recover using retained old names; counts never load vector payloads',async t=>{
    const root=fixture(t),old=await key('Old'),next=await key('New');await privateStore(root,'vectors').put(old,[3,2,1]);
    atomic(path.join(root,'jobs','abc.json'),{input:{books:['Old']}});
    const store=reusableVectorStore(root,{legacyBooks:()=>legacyEmbeddingBooks(root)});
    const read=fs.readFileSync;let vectorReads=0;
    fs.readFileSync=function(file,...args){if(String(file).includes(path.sep+'vectors'+path.sep))vectorReads++;return read.call(this,file,...args);};
    try{assert.deepEqual(await store.hasMany([next]),[true]);assert.equal(vectorReads,0);}finally{fs.readFileSync=read;}
    assert.deepEqual(await store.get(next),[3,2,1]);
    fs.rmSync(path.join(root,'jobs'),{recursive:true});assert.deepEqual(await reusableVectorStore(root).get(await key('Third')),[3,2,1]);
});
test('unidentifiable legacy files remain intact and are never guessed',async t=>{
    const root=fixture(t);await privateStore(root,'vectors').put(await key('Unknown'),[1,2]);
    assert.equal(await reusableVectorStore(root).get(await key('New')),null);assert.equal(fs.readdirSync(path.join(root,'vectors')).length,1);
});
