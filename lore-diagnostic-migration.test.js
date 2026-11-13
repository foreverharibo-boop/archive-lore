// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnosticStore} from './lore-diagnostics.js';

// Controlled IndexedDB upgrade events test the migration boundaries; these do
// not claim browser UI/IndexedDB engine integration coverage.
function factoryAt(initialVersion) {
    const state={version:initialVersion,clears:0,creates:0,closed:0,opens:0,indexes:new Map()};
    const store={clear(){state.clears++;},indexNames:{contains:name=>state.indexes.has(name)},createIndex(name,key){state.indexes.set(name,key);}};
    const factory={open(name,version){
        assert.equal(name,'archive-lore-diagnostics');state.opens++;
        const request={result:{close(){state.closed++;},createObjectStore(name,options){
            assert.equal(name,'runs');assert.equal(options.keyPath,'id');state.creates++;
            return store;
        }},transaction:{objectStore(name){assert.equal(name,'runs');return store;}}};
        queueMicrotask(()=>{if(state.version<version){request.onupgradeneeded({oldVersion:state.version});state.version=version;}request.onsuccess();});
        return request;
    }};
    return {factory,state};
}
test('existing browser history is cleared exactly once by version 2, before new records can be stored',async()=>{
    const {factory,state}=factoryAt(1),store=createDiagnosticStore(factory);
    const db=await store.ready();await store.ready();
    assert.equal(state.clears,1);assert.equal(state.creates,0);assert.equal(state.opens,1);
    await createDiagnosticStore(factory).ready();assert.equal(state.clears,1);
    db.onversionchange();assert.equal(state.closed,1);
});
test('fresh browser storage creates its run index without clearing a nonexistent history',async()=>{
    const {factory,state}=factoryAt(0);await createDiagnosticStore(factory).ready();
    assert.equal(state.version,3);assert.equal(state.creates,1);assert.equal(state.clears,0);
});
test('a blocking older tab gives an actionable error instead of hanging forever',async()=>{
    let request;
    const store=createDiagnosticStore({open(){request={result:{close(){request.closed=true;}}};queueMicrotask(()=>request.onblocked());return request;}});
    await assert.rejects(store.ready(),/다른 실리 웹앱 탭/);
    request.onsuccess();assert.equal(request.closed,true);
});

test('version 3 adds lightweight lookup indexes while preserving version 2 history',async()=>{
    const {factory,state}=factoryAt(2);await createDiagnosticStore(factory).ready();
    assert.equal(state.version,3);assert.equal(state.clears,0);
    assert.deepEqual(state.indexes.get('retention'),['started','diagnosticBytes']);
    assert.deepEqual(state.indexes.get('chatStarted'),['chatKey','started']);
});
