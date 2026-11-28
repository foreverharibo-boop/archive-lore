// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sharedVectorStore} from './lore-shared-embeddings.js';
import {embeddingKey,digest} from './lore-api.js';
import {createJobService} from './server/jobs.js';
import {registerRoutes} from './server/index.js';
import {atomic,hash,privateStore} from './server/storage.js';
import {sharedEmbeddings,EMBEDDING_FOLDER} from './server/shared-embeddings.js';

function browserLocal(initial=[]){
    const data=new Map(initial);let reads=0;
    return {data,get reads(){return reads;},keys:async after=>{const keys=[...data.keys()].sort().filter(k=>after===undefined||k>after).slice(0,64);return {keys,after:keys.length===64?keys.at(-1):undefined};},
        get:async key=>{reads++;return data.get(key);},put:async(k,v)=>data.set(k,v),hasMany:async keys=>keys.map(k=>data.has(k))};
}
function fixture(t){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'al-shared-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const user={profile:{handle:'owner'},directories:{root}},service=createJobService({sanitize:s=>s}),handlers=new Map(),calls=[];
    registerRoutes({post:(url,fn)=>handlers.set(url,fn)},service);
    const call=async(route,body={})=>{
        calls.push({route,body});const res={code:200,status(code){this.code=code;return this;},json(value){this.data=value;return this;}};
        await handlers.get(route)({user,body},res);if(res.code!==200)throw Object.assign(Error(res.data.error),{status:res.code});return res.data;
    };
    return {root,user,service,call,calls,handlers};
}
const key=(text='Same source',book='Book')=>embeddingKey({cacheNamespace:'n',embeddingProvider:'gemini',embeddingModel:'gemini-embedding-001'},JSON.stringify([book,'1']),text);

test('startup copies legacy server embeddings and aliases; local execution and another app share them',async t=>{
    const f=fixture(t),k=await key(),old=path.join(f.root,'archive-lore-server');fs.mkdirSync(old);
    await privateStore(old,'vectors').put(k,[1,2]);
    const local=browserLocal();let enabled=false,selected=false;
    const store=sharedVectorStore({local,call:f.call,required:()=>enabled||selected,onShared:()=>{selected=true;}});
    await store.ready();assert(selected);assert.deepEqual(await store.get(k),[1,2]);
    assert(fs.existsSync(path.join(f.root,EMBEDDING_FOLDER,'vectors',hash(k)+'.json')));
    assert(fs.existsSync(path.join(old,'vectors',hash(k)+'.json')));
    enabled=true;assert.deepEqual(await store.get(k),[1,2]);enabled=false;
    const next=await key('New source');await store.put(next,[3,4]);assert.equal(local.data.size,0);
    const app=sharedVectorStore({local:browserLocal(),call:f.call});await app.ready();
    assert.deepEqual(await app.get(next),[3,4]);assert.deepEqual(await f.service.vectors(f.user).get(next),[3,4]);
    const restarted=createJobService({sanitize:s=>s});assert.deepEqual(await restarted.vectors(f.user).get(next),[3,4]);
});
test('migration batches all local records without overwrites, re-embedding or deleting browser originals',async t=>{
    const f=fixture(t),items=await Promise.all(Array.from({length:130},async(_,i)=>[await key('Source '+i),[i+1,1]]));
    const local=browserLocal(items);await f.service.vectors(f.user).put(items[0][0],[99,99]);
    const store=sharedVectorStore({local,call:f.call});
    await Promise.all([store.ready(),store.ready(),store.peekMany([items[0][0]])]);
    assert.equal(f.calls.filter(c=>c.route==='/status').length,1);
    assert.equal(local.reads,129);assert.equal(local.data.size,130);
    assert.deepEqual(await store.get(items[0][0]),[99,99]);
    assert.deepEqual(await store.get(items.at(-1)[0]),items.at(-1)[1]);
    for(const c of f.calls.filter(c=>c.route==='/vectors/import'))assert(c.body.entries.length<=8);
    assert(!f.calls.some(c=>c.route.includes('embedding')||c.route==='/jobs'));
    const reads=local.reads;
    await sharedVectorStore({local,call:f.call}).ready();assert.equal(local.reads,reads);
});
test('both legacy browser key formats resolve after import and exact input/provider remains isolated',async t=>{
    const f=fixture(t),a=await key('A'),b=await key('B');
    const local=browserLocal([[await digest(a.slice(13)),[1,2]],['exact-v1:'+b.slice(13),[3,4]]]);
    const store=sharedVectorStore({local,call:f.call});await store.ready();
    assert.deepEqual(await store.peekMany([a,b,await key('C')]),[true,true,false]);
    assert.deepEqual(await store.get(a),[1,2]);assert.deepEqual(await store.get(b),[3,4]);
    assert.deepEqual(await store.get(await key('B','Renamed')),[3,4]);
    const different=a.replace('gemini-embedding-001','other-model');assert.equal((await store.get(different))??null,null);
});
test('partial browser migration retries and never reports success on failed verification',async t=>{
    const f=fixture(t),k=await key(),local=browserLocal([[k,[1,2]]]);let broken=true;
    const store=sharedVectorStore({local,call:async(route,body)=>route==='/vectors/import'&&broken?{confirmed:0}:f.call(route,body)});
    await assert.rejects(store.ready(),/완료/);assert.deepEqual(local.data.get(k),[1,2]);
    broken=false;await store.ready();assert.deepEqual(await store.get(k),[1,2]);
});
test('missing plugin preserves old local-only installs, but selected shared storage never silently falls back',async()=>{
    const local=browserLocal([['key',[1,2]]]);let required=false;
    const missing=async()=>{throw Object.assign(Error('plugin missing'),{status:404});};
    const store=sharedVectorStore({local,call:missing,required:()=>required});
    assert.equal(await store.ready(),false);assert.deepEqual(await store.get('key'),[1,2]);
    required=true;await assert.rejects(store.get('key'),/plugin missing/);
    await assert.rejects(sharedVectorStore({local,call:async()=>{throw Error('offline');}}).ready(),/offline/);
    await assert.rejects(sharedVectorStore({local,call:async()=>({capabilities:[]})}).ready(),/업데이트/);
});
test('authenticated imports reject invalid vectors; existing server records and other users remain isolated',async t=>{
    const f=fixture(t);await f.call('/vectors/import',{entries:[{key:'key',vector:[1,2]}]});
    await f.call('/vectors/import',{entries:[{key:'key',vector:[9,9]}]});assert.deepEqual(await f.service.vectors(f.user).get('key'),[1,2]);
    await assert.rejects(f.call('/vectors/import',{entries:[{key:'bad',vector:[0,0]}]}),/형식/);
    const res={status(c){this.code=c;return this;},json(d){this.data=d;}};
    await f.handlers.get('/vectors/import')({body:{entries:[]}},res);assert.equal(res.code,401);
    const other=fixture(t);assert.equal(await other.service.vectors(other.user).get('key'),null);
});
test('two simultaneous browser imports preserve the first confirmed vector',async t=>{
    const f=fixture(t);
    await Promise.all([
        f.call('/vectors/import',{entries:[{key:'same',vector:[1,2]}]}),
        f.call('/vectors/import',{entries:[{key:'same',vector:[3,4]}]}),
    ]);
    assert.deepEqual(await f.service.vectors(f.user).get('same'),[1,2]);
});
test('interrupted disk migration resumes, preserves originals/destination, and retains old book names',async t=>{
    const f=fixture(t),legacy=path.join(f.root,'archive-lore-server');fs.mkdirSync(legacy);
    const k=await key('Source','Old');await privateStore(legacy,'vectors').put(k,[1,2]);
    atomic(path.join(legacy,'jobs','abc.json'),{input:{books:['Old']}});
    const bad=path.join(legacy,'vectors','f'.repeat(64)+'.json');fs.writeFileSync(bad,'bad json');
    assert.throws(()=>sharedEmbeddings(f.root,legacy));
    assert(!fs.existsSync(path.join(f.root,EMBEDDING_FOLDER,'migration-v1.json')));
    fs.unlinkSync(bad);const first=sharedEmbeddings(f.root,legacy);await first.put(k,[8,8]);
    fs.rmSync(path.join(legacy,'jobs'),{recursive:true});
    const next=sharedEmbeddings(f.root,legacy);assert.deepEqual(await next.get(await key('Source','New')),[8,8]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(legacy,'vectors',hash(k)+'.json'))),[1,2]);
});
test('migration rejects directories that escape the authenticated user root',t=>{
    const f=fixture(t),other=fixture(t),legacy=path.join(f.root,'archive-lore-server');fs.mkdirSync(legacy);
    fs.symlinkSync(other.root,path.join(f.root,EMBEDDING_FOLDER),'dir');
    assert.throws(()=>sharedEmbeddings(f.root,legacy),/외부/);
});
