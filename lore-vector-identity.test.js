// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {embeddingIdentity,renamedEmbeddingKeys} from './lore-vector-identity.js';
import {embeddingKey} from './lore-api.js';
const config={cacheNamespace:'one',embeddingProvider:'vertex',embeddingModel:'gemini-embedding-001',embeddingVertexProjectId:'project',embeddingVertexRegion:'global'};
test('only exact namespace/provider/endpoint/model/input can reuse a renamed entry',async()=>{
    const key=await embeddingKey(config,JSON.stringify(['Old','1']),'Title\nExact text.');
    assert.equal(embeddingIdentity(key),embeddingIdentity(await embeddingKey(config,JSON.stringify(['New','99']),'Title\nExact text.')));
    for(const patch of [{cacheNamespace:'two'},{embeddingProvider:'gemini'},{embeddingModel:'other'},{embeddingVertexProjectId:'other'},{embeddingVertexRegion:'us-central1'}])assert.notEqual(embeddingIdentity(key),embeddingIdentity(await embeddingKey({...config,...patch},JSON.stringify(['New','1']),'Title\nExact text.')));
    assert.notEqual(embeddingIdentity(key),embeddingIdentity(await embeddingKey(config,'id','Title\nChanged text.')));
    assert.equal(embeddingIdentity('exact-v1:'+key.slice(13)),embeddingIdentity(key));
    assert.equal(embeddingIdentity('hash-only'),null);assert.equal(embeddingIdentity('embedding-v2:bad'),null);
    assert.deepEqual(renamedEmbeddingKeys(key,['Old','New','New']),[await embeddingKey(config,JSON.stringify(['New','1']),'Title\nExact text.')]);
});
