// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {queryVectors} from './lore-query-vectors.js';
import {embeddingChunks} from './lore-core.js';
import {serverVectorStore} from './lore-server.js';
import {diagnosticSummary} from './lore-retention.js';
const pause=()=>new Promise(resolve=>setImmediate(resolve));

test('parallel query lanes preserve serial content, order and duplicate weighting with no extra API calls',async()=>{
    const inputs={focus:['Shared query'],questions:['Shared query','Second question',('long context. ').repeat(300)],context:['Recent dialogue'],emphasis:['Second question']};
    const vector=text=>[text.length,1],seen=new Set(),expected={};
    for(const [lane,texts] of Object.entries(inputs)){
        expected[lane]=[];
        for(const text of texts)for(const chunk of embeddingChunks({content:text},1000)){seen.add(chunk.text);expected[lane].push(vector(chunk.text));}
    }
    for(const concurrency of [1,2]){
        let active=0,peak=0;const calls=[];
        const result=await queryVectors(inputs,async(text,signal)=>{
            assert(!signal.aborted);calls.push(text);peak=Math.max(peak,++active);await pause();active--;return vector(text);
        },concurrency,new AbortController().signal);
        assert.equal(peak,concurrency);assert.equal(calls.length,seen.size);assert.deepEqual(new Set(calls),seen);assert.deepEqual(result.lanes,expected);
    }
});
test('query cancellation stops pending lanes and drains in-flight requests',async()=>{
    const abort=new AbortController();let calls=0,active=0;
    const pending=queryVectors({questions:['one','two','three','four']},async(_text,signal)=>{
        calls++;active++;
        try{await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}
        finally{active--;}
    },2,abort.signal);
    await pause();assert.equal(calls,2);abort.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(calls,2);assert.equal(active,0);
});
test('393 stored vectors take 13 bounded requests, preserve order and refresh existing cache entries',async()=>{
    let active=0,peak=0,revision=1;const calls=[];
    const store=serverVectorStore({enabled:()=>true,local:{get:async()=>null},call:async(route,{keys})=>{
        assert.equal(route,'/vectors/get-many');assert(keys.length<=32);calls.push(keys);peak=Math.max(peak,++active);await pause();active--;
        return {vectors:keys.map(key=>[Number(key),revision])};
    }});
    const keys=Array.from({length:393},(_,i)=>String(i));
    assert.deepEqual(await store.getMany(keys),keys.map(k=>[Number(k),1]));assert.equal(calls.length,13);assert.equal(peak,2);
    revision=2;assert.deepEqual(await store.getMany(['0','392','0']),[[0,2],[392,2],[0,2]]);
});
test('batch reads enforce the request key budget, preserve missing-local migration and support older plugins',async()=>{
    const keys=Array.from({length:24},(_,i)=>String(i)+'x'.repeat(60000));let requests=0;
    const store=serverVectorStore({enabled:()=>true,local:{get:async()=>[1,2]},call:async(route,body)=>{
        if(route==='/vectors/put')return {ok:true};assert.equal(route,'/vectors/get-many');requests++;
        assert(body.keys.join('').length<=1000000);return {vectors:body.keys.map(()=>null)};
    }});
    assert.deepEqual(await store.getMany(keys),keys.map(()=>[1,2]));assert.equal(requests,2);
    const legacy=serverVectorStore({enabled:()=>true,local:{get:async()=>null},call:async route=>{
        if(route==='/vectors/get-many')throw Object.assign(Error('old plugin'),{status:404});assert.equal(route,'/vectors/get');return {vector:[3,4]};
    }});
    assert.deepEqual(await legacy.getMany(['a','b']),[[3,4],[3,4]]);
});
test('malformed or failed bulk responses never become empty-memory results',async()=>{
    for(const response of [{},{vectors:[]},{vectors:[null,null]},{vectors:[[0,0]]},{vectors:[[NaN]]}]){
        const store=serverVectorStore({enabled:()=>true,local:{get:()=>assert.fail()},call:async()=>response});
        await assert.rejects(store.getMany(['key']),/응답/);
    }
    const store=serverVectorStore({enabled:()=>true,local:{get:()=>assert.fail()},call:async()=>{throw Error('offline');}});
    await assert.rejects(store.getMany(['key']),/offline/);
});
test('batch cancellation aborts both requests and never starts later batches',async()=>{
    const abort=new AbortController();let calls=0;
    const store=serverVectorStore({enabled:()=>true,local:{get:()=>assert.fail()},call:async(_route,_body,{signal})=>{
        calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    }});
    const pending=store.getMany(Array(100).fill('key'),{signal:abort.signal});await pause();assert.equal(calls,2);
    abort.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(calls,2);
});
test('stage timings survive diagnostic compaction without exposing vectors or prompts',()=>{
    const timing={totalMs:9000,cacheMs:1000,questionMs:2000,embeddingMs:2500,embeddingRequestMs:5000,selectionMs:3000,selectionRequestMs:4500,otherMs:500};
    assert.deepEqual(diagnosticSummary({...timing,vectors:[1,2],system:'private'}),timing);
});
