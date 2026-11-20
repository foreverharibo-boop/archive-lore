// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {recallOutput} from './lore-recall-output.js';
import {completionText} from './lore-api.js';

for(const finish of ['length','MAX_TOKENS'])test(`provider truncation ${finish} rejects even valid-looking partial text`,()=>{
    assert.throws(()=>completionText({choices:[{finish_reason:finish,message:{content:'{"selections":[]}'}}]}),{code:'OUTPUT_TRUNCATED'});
});
test('only explicit truncation retries, once, with a capped output budget',async()=>{
    const signal=new AbortController().signal;
    for(const error of [Error('network'),Object.assign(Error('bad JSON'),{category:'response-format'}),Object.assign(Error('cut'),{code:'OUTPUT_TRUNCATED'})]){
        const limits=[];
        await assert.rejects(recallOutput(async n=>{limits.push(n);throw error;},6000,signal),e=>e===error);
        assert.deepEqual(limits,error.code==='OUTPUT_TRUNCATED'?[6000,12000]:[6000]);
    }
    const limits=[];
    await assert.rejects(recallOutput(async n=>{limits.push(n);throw Object.assign(Error('cut'),{code:'OUTPUT_TRUNCATED'});},24000,signal));
    assert.deepEqual(limits,[24000]);
});
test('cancellation prevents a truncation retry',async()=>{
    const abort=new AbortController();let calls=0;
    await assert.rejects(recallOutput(async()=>{calls++;abort.abort();throw Object.assign(Error('cut'),{code:'OUTPUT_TRUNCATED'});},6000,abort.signal),e=>e.name==='AbortError');
    assert.equal(calls,1);
});
