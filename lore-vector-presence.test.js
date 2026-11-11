// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createVectorStore,digest} from './lore-api.js';

test('local counts read keys in batches, include both legacy formats, and never load vectors',async()=>{
    const keys=['embedding-v2:current','embedding-v2:hashed','embedding-v2:exact','embedding-v2:missing'];
    const saved=new Set([keys[0],await digest('hashed'),'exact-v1:exact']);let transactions=0;
    const database={transaction(){transactions++;const tx={};let pending=0;
        tx.objectStore=()=>({getKey(key){pending++;const req={};queueMicrotask(()=>{req.result=saved.has(key)?key:undefined;req.onsuccess();if(!--pending)tx.oncomplete();});return req;},get:()=>assert.fail('must not load vectors')});return tx;
    }};
    const factory={open(){const request={result:database};queueMicrotask(()=>request.onsuccess());return request;}};
    const store=createVectorStore(factory);
    assert.deepEqual(await store.hasMany(keys),[true,true,true,false]);assert.equal(transactions,2);
    assert.deepEqual(await store.hasMany([]),[]);assert.equal(transactions,2);
});
