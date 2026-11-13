// Archive Lore server © 2026 foreverharibo-boop — AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, webcrypto } from 'node:crypto';
import { atomic,inside,json,privateStore,hash } from './storage.js';
import { reusableVectorStore,legacyEmbeddingBooks } from './vector-store.js';
import {pruneDiagnostics,pruneJobs,resetLegacyHistory} from './retention.js';
import { entrySearchAllowed } from '../lore-side-search.js';
import { createLoreController } from '../lore-controller.js';
import { createDiagnostics } from '../lore-diagnostics.js';
import { diagnosticFiles,diagnosticStream } from './diagnostics.js';
import { normalizeSettings,NS,sourceRange,matchesRange,estimateTokens,materializeEntry,entryAvailable,isCore } from '../lore-core.js';
import { embed,completionText } from '../lore-api.js';
import { consolidationView } from '../lore-maintenance.js';
import { normalizeCompletionRequest } from '../completionCompatibility.js';
import { observer } from '../lore-telemetry.js';
globalThis.crypto ||= webcrypto;
export function createJobService({sanitize,ask,embedRequest=embed,countTokens}) {
    const users=new Map(),vectorStores=new Map(),exports=new Map();
    const cleanDiagnostics=(root,file)=>{if(!exports.get(root))pruneDiagnostics(root,file);};
    // Keep completed history on disk, not one full chat/template/result per turn
    // in the process heap. Drafts and results are loaded only when requested.
    const archived=job=>({id:job.id,requestId:job.requestId,kind:job.kind,status:job.status,message:job.message,
        started:job.started,finished:job.finished,created:job.created,
        input:{context:{key:job.input.context.key},books:job.input.books,
            options:job.input.options?.replyTokenizer?{replyTokenizer:job.input.options.replyTokenizer}:undefined},
        archived:true,draftAvailable:!!job.draftState});
    const fullJob=(s,id)=>{const job=s.jobs.get(id);return job?.archived?json(inside(s.jobsDir,id+'.json')):job;};
    function vectorStore(user) {
        if(!user?.profile?.handle||!user.directories?.root)throw Error('로그인한 실리태번 사용자만 사용할 수 있어.');
        const owner=fs.realpathSync(user.directories.root);
        if(!vectorStores.has(owner)){
            const root=inside(owner,'archive-lore-server');fs.mkdirSync(root,{recursive:true,mode:0o700});
            resetLegacyHistory(root);
            vectorStores.set(owner,reusableVectorStore(root,{legacyBooks:()=>legacyEmbeddingBooks(root,user.directories.worlds)}));
        }
        return vectorStores.get(owner);
    }
    function state(user) {
        if(!user?.profile?.handle||!user.directories?.root)throw Error('로그인한 실리태번 사용자만 사용할 수 있어.');
        const owner=fs.realpathSync(user.directories.root);if(users.has(owner)){
            const existing=users.get(owner);
            if(Date.now()-(existing.lastPrune||0)>60000){pruneJobs(existing);existing.lastPrune=Date.now();}
            return existing;
        }
        const root=inside(owner,'archive-lore-server');fs.mkdirSync(root,{recursive:true,mode:0o700});
        const jobsDir=inside(root,'jobs');fs.mkdirSync(jobsDir,{recursive:true,mode:0o700});
        const s={root,jobsDir,jobs:new Map(),running:false,controllers:new Map(),canceledRequests:new Map(),vectors:vectorStore(user),user};
        for(const file of fs.readdirSync(jobsDir).filter(f=>/^[a-f0-9-]+\.json$/.test(f))){
            const job=json(inside(jobsDir,file));if(['queued','running'].includes(job.status)){job.status='interrupted';job.message='서버가 재시작됐어. 저장된 구간은 유지돼. 다시 실행해 줘.';atomic(inside(jobsDir,file),job);}s.jobs.set(job.id,archived(job));
        }
        pruneJobs(s);cleanDiagnostics(root);s.lastPrune=Date.now();users.set(owner,s);return s;
    }
    const save=(s,job)=>{
        // A restarted job is marked interrupted, never replayed from its saved input.
        // Keep review settings and draft/result data, not whole chat/preset payloads.
        const stored=structuredClone({...job,input:{context:{key:job.input.context.key},books:job.input.books,
            chat:job.input.chat,settings:job.input.settings,options:job.input.options,target:job.input.target}});
        if(stored.input.settings){delete stored.input.settings.embeddingKey;delete stored.input.settings.embeddingKeys;}
        atomic(inside(s.jobsDir,job.id+'.json'),stored);
        if(!['queued','running'].includes(job.status))s.jobs.set(job.id,archived(job));
    };
    const publicJob=job=>({id:job.id,kind:job.kind,status:job.status,message:job.message,chatKey:job.input.context.key,backgroundReply:!!job.input.options?.replyTokenizer,started:job.started,finished:job.finished,hidden:job.hidden||[],books:job.input.books,result:job.result,draftAvailable:job.archived?job.draftAvailable:!!job.draftState});
    function chatFile(s,input) {
        const d=input.chat;if(!d||typeof d.id!=='string'||!d.id)throw Error('채팅 파일 정보가 없어.');
        if(d.group)return inside(s.user.directories.groupChats,sanitize(d.id+'.jsonl'));
        if(typeof d.avatar!=='string'||!d.avatar.endsWith('.png'))throw Error('캐릭터 파일 정보가 없어.');
        return inside(s.user.directories.chats,d.avatar.replace('.png',''),sanitize(d.id+'.jsonl'));
    }
    function readChat(s,input){const file=chatFile(s,input),raw=fs.readFileSync(file,'utf8'),lines=raw.trimEnd().split('\n').map(line=>JSON.parse(line)),offset=typeof lines[0]?.mes==='string'?0:1;return {file,raw,lines,offset,messages:lines.slice(offset)};}
    function bookFile(s,name){if(typeof name!=='string'||!name.trim())throw Error('로어북 이름이 없어.');return inside(s.user.directories.worlds,sanitize(name+'.json'));}
    function validate(s,input,kind) {
        if(!['collect','index','recall','prepareMaintenance','applyMaintenance'].includes(kind))throw Error('지원하지 않는 서버 작업이야.');
        if(!input?.context?.key||!Array.isArray(input.context.messages)||!Array.isArray(input.books)||input.books.length>100)throw Error('서버 작업 형식을 확인해 줘.');
        for(const book of input.books)if(!fs.existsSync(bookFile(s,book)))throw Error('선택한 로어북 파일이 없어.');
        if(kind==='collect'&&!input.books.includes(input.target))throw Error('저장할 로어북을 검색 대상에 포함해 줘.');
        const live=readChat(s,input).messages;
        if(input.context.messages.length && !matchesRange(sourceRange(input.context.messages,0,input.context.messages.length-1),live))throw Error('대화 저장이 완료되지 않았거나 원본이 바뀌었어. 저장 후 다시 시도해 줘.');
        input.settings=normalizeSettings(input.settings);
        if(kind!=='index' && !(kind==='recall' && input.settings.mode==='embedding') && !input.templates?.collection?.chat_completion_source)throw Error('수집 연결 프로필을 설정해 줘.');
    }
    function backup(s,job,file,raw){const dir=inside(s.root,'backups',job.id);fs.mkdirSync(dir,{recursive:true,mode:0o700});atomic(inside(dir,randomUUID()+'.bak'),raw);}
    async function run(s,job) {
        job.status='running';job.started=new Date().toISOString();save(s,job);
        const input=job.input, config=normalizeSettings(input.settings),expected=new Map();
        const secrets=[config.embeddingKey,...Object.values(config.embeddingKeys||{}),...Object.values(input.templates||{}).map(t=>t.proxy_password).filter(Boolean)];
        const clean=text=>secrets.filter(Boolean).reduce((v,key)=>v.split(key).join('[REDACTED]'),String(text));
        const diagnosticStore=privateStore(s.root,'diagnostics');
        const diagnostics=createDiagnostics({store:{put:async run=>{await diagnosticStore.put(run.id,run);cleanDiagnostics(s.root,inside(s.root,'diagnostics',hash(run.id)+'.json'));}},detailed:()=>config.diagnosticsDetailed,secrets:()=>secrets,warning:message=>{job.diagnosticWarning=message;}});
        const host={
            contextKey:()=>input.context.key,yieldControl:()=>new Promise(resolve=>setImmediate(resolve)),
            settings:()=>config,context:()=>({...input.context,messages:readChat(s,input).messages}),books:()=>input.books,target:()=>input.target,initialStart:()=>input.initialStart||0,
            ensureBook:async()=>input.target,
            loadBook:async name=>{const file=bookFile(s,name),raw=fs.readFileSync(file,'utf8');expected.set(file,raw);return JSON.parse(raw);},
            saveBook:async(name,data)=>{const live=readChat(s,input).messages;if(input.context.messages.length&&!matchesRange(sourceRange(input.context.messages,0,input.context.messages.length-1),live))throw Error('원본 대화가 수정돼서 저장을 멈췄어.');
                const file=bookFile(s,name),raw=fs.readFileSync(file,'utf8');if(raw!==expected.get(file))throw Error('로어북이 다른 곳에서 수정됐어. 다시 시도해 줘.');backup(s,job,file,raw);atomic(file,JSON.stringify(data,null,4));expected.set(file,fs.readFileSync(file,'utf8'));},
            newEntry:data=>{const uid=Math.max(-1,...Object.keys(data.entries).map(Number))+1;return data.entries[uid]={...input.entryTemplate,uid,key:[],keysecondary:[],comment:'',content:'',constant:false,vectorized:false,disable:false};},
            store:s.vectors,embed:(config,text,query,signal,observe)=>embedRequest(config,text,query,signal,undefined,observe),
            ask:async(profile,system,data,signal,tokens,observe)=>{const template=profile===config.searchProfile&&config.searchProfile?input.templates.search:input.templates.collection;
                const log=observer(observe,secrets),payload=normalizeCompletionRequest({...template,stream:false,temperature:.2,max_tokens:tokens,max_completion_tokens:undefined,max_output_tokens:undefined,max_new_tokens:undefined,json_schema:undefined,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(data)}]});
                await log('profile.resolved',{requestedProfile:profile||'current',transport:'server',model:template.model,source:template.chat_completion_source,template});
                await log('ai.transport.prepared',{payload});const response=await ask(s.user,payload,signal,log);
                await log('ai.transport.response',{response});
                try{return completionText(response);}catch(error){error.category='response-format';error.stage='ai.extract';throw error;}},
            countTokens:async text=>{if(input.options?.replyTokenizer){if(!countTokens)throw Error('서버 토크나이저 연결이 없어.');return countTokens(s.user,input.options.replyTokenizer,text);}return estimateTokens(text);},diagnostics,profileInfo:()=>Object.entries(input.templates||{}).map(([role,p])=>({role,model:p.model,source:p.chat_completion_source})),
            hideRange:async(range)=>{const chat=readChat(s,input),source=sourceRange(chat.messages,range.start,range.end);for(let i=range.start;i<=range.end;i++)chat.lines[chat.offset+i].is_system=true;
                if(fs.readFileSync(chat.file,'utf8')!==chat.raw)throw Error('채팅 파일이 바뀌어서 숨기기를 멈췄어.');backup(s,job,chat.file,chat.raw);atomic(chat.file,chat.lines.map(l=>JSON.stringify(l)).join('\n')+'\n');job.hidden.push(source);save(s,job);},
            changed:()=>{
                const message=clean(controller.state().status);
                // Identical selection progress must not rewrite the entire saved chat each batch.
                if(message===job.message)return;
                job.message=message;save(s,job);
            },
        };
        let restoredDraft=false;const controller=createLoreController(host);s.controllers.set(job.id,controller);
        try{
            validate(s,input,job.kind);
            if(job.kind==='applyMaintenance'){const prior=fullJob(s,input.options?.draftJobId);if(!prior?.draftState||prior.input.context.key!==input.context.key)throw Error('서버 초안이 만료됐거나 다른 채팅방의 초안이야.');controller.restoreDraft(prior.draftState);restoredDraft=true;}
            let result=job.kind==='index'?await controller.index(!!input.options?.force):await controller[job.kind](input.options||{});
            if(job.kind==='recall')result={...result,selected:[...result.selected],lastRecall:controller.state().lastRecall,estimatedTokens:!input.options?.replyTokenizer};
            if(job.kind==='prepareMaintenance'){job.draftState=controller.exportDraft();result.serverJobId=job.id;}
            job.result=result;job.status='completed';job.message=controller.state().status;
        }catch(error){job.status=job.cancelRequested?'canceled':'error';job.message=clean(error.message);}finally{if(restoredDraft&&!controller.exportDraft()){const prior=fullJob(s,input.options?.draftJobId);if(prior){delete prior.draftState;save(s,prior);}}s.controllers.delete(job.id);job.finished=new Date().toISOString();save(s,job);pruneJobs(s,job.id);}
    }
    async function drain(s){if(s.running)return;s.running=true;try{let job;while((job=[...s.jobs.values()].find(j=>j.status==='queued'))){try{await run(s,job);}catch{job.status='error';job.message='서버 작업 파일을 저장하지 못했어. 서버 저장 공간과 권한을 확인해 줘.';job.finished=new Date().toISOString();s.controllers.delete(job.id);try{save(s,job);}catch{console.error('[Archive Lore] Could not persist job status:',job.id);}}}}finally{s.running=false;}}
    return {
        replySnapshot(user,input){
            const s=state(user);validate(s,input,'recall');
            if(input.chat.group || !input.settings.serverEnabled || !input.settings.relayEnabled || input.settings.keywordActivation)
                throw Error('서버 답변 연동 설정을 확인해 줘.');
            const live=readChat(s,input).messages;
            if(live.length!==input.context.messages.length)throw Error('대화가 바뀌어서 서버 답변을 중단했어.');
            const excludedKeys=normalizeSettings(input.settings).excludedSidePromptKeys;
            const raw=input.books.map(book=>fs.readFileSync(bookFile(s,book),'utf8'));
            const entries=raw.flatMap(text=>consolidationView(Object.values(JSON.parse(text).entries||{}),live))
                .map(entry=>materializeEntry(entry,live)).filter(entry=>entryAvailable(entry,live) && entrySearchAllowed(entry,excludedKeys));
            return {core:entries.filter(isCore).map(entry=>entry.content).join('\n\n'),
                fingerprint:hash(JSON.stringify([sourceRange(live,0,live.length-1),raw]))};
        },
        async submit(user,kind,input,requestId){const s=state(user);if(typeof requestId!=='string'||!/^[a-f0-9-]{16,80}$/.test(requestId))throw Error('작업 요청 ID가 잘못됐어.');
            for(const [id,time] of s.canceledRequests)if(Date.now()-time>300000)s.canceledRequests.delete(id);
            if(s.canceledRequests.has(requestId))return {requestId,status:'canceled',message:'취소됨'};
            const existing=[...s.jobs.values()].find(j=>j.requestId===requestId);if(existing)return publicJob(fullJob(s,existing.id));
            if([...s.jobs.values()].some(j=>['queued','running'].includes(j.status)))throw Error('이미 서버 작업이 진행 중이야. 작업 내역에서 확인해 줘.');
            input=structuredClone(input);validate(s,input,kind);
            const job={id:randomUUID(),requestId,kind,status:'queued',message:'서버 작업 대기 중',input,hidden:[],created:new Date().toISOString()};s.jobs.set(job.id,job);save(s,job);setImmediate(()=>void drain(s));return publicJob(job);},
        list(user,key){return [...state(user).jobs.values()].filter(j=>key===undefined||j.input.context.key===key).map(job=>{const {result,hidden,...summary}=publicJob(job);return summary;});},
        get(user,id){
            const s=state(user),job=fullJob(s,id);if(!job)throw Error('서버 작업을 찾을 수 없어.');
            const result=publicJob(job);
            // Polling active jobs must not synchronously parse and hash the whole chat.
            // Only completed collection/index results need current hide flags for client sync.
            if(job.status!=='completed'||!['collect','index'].includes(job.kind)){result.hidden=[];return result;}
            let messages;
            try{messages=readChat(s,job.input).messages;}catch(error){
                if(error.code!=='ENOENT')throw error;
                // The job is still completed. Its history must not require restoring
                // an old chat or replaying saved hide flags into a different chat.
                return {...result,hidden:[],sourceChatMissing:true};
            }
            result.hidden=messages.length?[{...sourceRange(messages,0,messages.length-1),indices:messages.map((m,i)=>m.is_system?i:-1).filter(i=>i>=0)}]:[];
            return result;
        },
        cancel(user,id,requestId){
            const s=state(user);
            if(!id && (typeof requestId!=='string'||!/^[a-f0-9-]{16,80}$/.test(requestId)))throw Error('작업 요청 ID가 잘못됐어.');
            const job=id?s.jobs.get(id):[...s.jobs.values()].find(j=>j.requestId===requestId);
            if(!job){
                if(id)throw Error('서버 작업을 찾을 수 없어.');
                // The cancel can arrive before its delayed submission, or before its ID response.
                for(const [key,time] of s.canceledRequests)if(Date.now()-time>300000)s.canceledRequests.delete(key);
                s.canceledRequests.set(requestId,Date.now());return {requestId,status:'canceled',message:'취소됨'};
            }
            if(!['queued','running'].includes(job.status))return publicJob(fullJob(s,job.id));
            job.cancelRequested=true;s.controllers.get(job.id)?.cancel();
            if(job.status==='queued'){job.status='canceled';job.message='취소됨';job.finished=new Date().toISOString();}
            save(s,job);return publicJob(job);
        },
        vectors:vectorStore,
        // Listing/exporting diagnostics must not initialize the full job history.
        async logFiles(user,key,mode='all'){
            vectorStore(user);const root=inside(user.directories.root,'archive-lore-server');cleanDiagnostics(root);
            exports.set(root,(exports.get(root)||0)+1);
            try{return await diagnosticFiles(root,key,mode);}finally{exports.set(root,exports.get(root)-1);}
        },
        async logList(user,key){return (await this.logFiles(user,key)).map(({header})=>({...header,details:'전체 내용은 진단 TXT에 포함돼.'}));},
        async logStream(user,key,mode='all'){
            vectorStore(user);const root=inside(user.directories.root,'archive-lore-server');cleanDiagnostics(root);
            return (async function*(){exports.set(root,(exports.get(root)||0)+1);try{yield* diagnosticStream(await diagnosticFiles(root,key,mode));}finally{exports.set(root,exports.get(root)-1);}})();
        },
        state,
    };
}
