// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnosticStore} from './lore-diagnostics.js';
test('startup deletes only the old diagnostic database without opening another store',async()=>{
    const deleted=[];const cleanup=createDiagnosticStore({open:()=>assert.fail('no database opens'),deleteDatabase:name=>{deleted.push(name);const r={};queueMicrotask(()=>r.onsuccess());return r;}});
    await cleanup.ready();await cleanup.ready();assert.deepEqual(deleted,['archive-lore-diagnostics']);
});
test('blocked cleanup requests closing other tabs and does not create a replacement database',async()=>{
    let r;const cleanup=createDiagnosticStore({deleteDatabase:()=>{r={};queueMicrotask(()=>r.onblocked());return r;}});
    await assert.rejects(cleanup.ready(),/다른 실리 탭/);r.onsuccess();
});
test('cleanup errors are surfaced rather than claiming old logs were erased',async()=>{
    const cleanup=createDiagnosticStore({deleteDatabase:()=>{const r={error:Error('denied')};queueMicrotask(()=>r.onerror());return r;}});
    await assert.rejects(cleanup.ready(),/denied/);
});
