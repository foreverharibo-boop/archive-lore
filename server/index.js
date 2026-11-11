// Archive Lore server © 2026 foreverharibo-boop — AGPL-3.0-only
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { createJobService } from './jobs.js';
import { invokeBackend } from './backend.js';
import { embed } from '../lore-api.js';
import { normalizeSettings } from '../lore-core.js';
export const info={id:'archive-lore-server',name:'Archive Lore Server',description:'Persistent Archive Lore jobs and server-side embeddings.'};
export const VERSION='0.3.11';
export async function init(router) {
    globalThis.crypto ||= webcrypto;
    const require=createRequire(path.join(process.cwd(),'package.json'));
    const sanitize=require('sanitize-filename');
    const {router:backend}=await import(pathToFileURL(path.join(process.cwd(),'src/endpoints/backends/chat-completions.js')).href);
    const service=createJobService({sanitize,ask:(user,payload,signal)=>invokeBackend(backend,user,payload,signal)});
    registerRoutes(router,service);
}
export function registerRoutes(router,service,embedding=embed) {
    const route=(url,callback,cancelOnDisconnect=false)=>router.post(url,async(req,res)=>{
        if(!req.user?.profile?.handle||!req.user?.directories?.root)return res.status(401).json({error:'실리태번 로그인이 필요해.'});
        const abort=new AbortController(),closed=()=>{if(!res.writableEnded)abort.abort();};
        if(cancelOnDisconnect)res.on?.('close',closed);
        try{return res.json(await callback(req.user,req.body || {},abort.signal));}catch(error){if(!abort.signal.aborted)return res.status(400).json({error:error.message});}
        finally{if(cancelOnDisconnect)res.removeListener?.('close',closed);}
    });
    route('/status',()=>({version:VERSION,protocol:1,capabilities:['collect','index','recall','prepareMaintenance','applyMaintenance']}));
    route('/embedding',async(_user,body,signal)=>{
        if(typeof body.text!=='string'||body.text.length>50000)throw Error('임베딩 입력 크기를 확인해 줘.');
        const vector=await embedding(normalizeSettings(body.settings),body.text,!!body.query,signal);return {vector};
    },true);
    route('/embedding-test',async(_user,body)=>({dimensions:(await embedding(normalizeSettings(body.settings),'Archive Lore connection test.',false)).length,model:'gemini-embedding-001'}));
    route('/jobs',async(user,body)=>service.submit(user,body.kind,body.input,body.requestId));
    route('/jobs/list',(user,body)=>service.list(user,body.chatKey));
    route('/jobs/get',(user,body)=>service.get(user,body.id));
    route('/jobs/cancel',(user,body)=>service.cancel(user,body.id,body.requestId));
    route('/vectors/has',async(user,body)=>{
        if(!Array.isArray(body.keys)||body.keys.length>64||body.keys.some(key=>typeof key!=='string'||key.length>100000)||body.keys.join('').length>1000000)throw Error('임베딩 상태 조회 범위를 확인해 줘.');
        const store=service.vectors(user);return {present:await store.hasMany(body.keys)};
    });
    route('/vectors/get',async(user,body)=>{if(typeof body.key!=='string'||body.key.length>100000)throw Error('잘못된 벡터 키야.');return {vector:await service.vectors(user).get(body.key)};});
    route('/vectors/put',async(user,body)=>{if(typeof body.key!=='string'||body.key.length>100000||!Array.isArray(body.vector)||!body.vector.length||body.vector.length>16384||!body.vector.every(Number.isFinite)||body.vector.every(v=>v===0))throw Error('잘못된 벡터야.');await service.vectors(user).put(body.key,body.vector);return {ok:true};});
    route('/logs',(user,body)=>service.logs(user,body.chatKey));
}
