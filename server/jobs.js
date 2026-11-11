// Archive Lore server © 2026 foreverharibo-boop — AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, webcrypto } from 'node:crypto';
import { atomic,inside,json,privateStore } from './storage.js';
import { createLoreController } from '../lore-controller.js';
import { createDiagnostics } from '../lore-diagnostics.js';
import { normalizeSettings,NS,sourceRange,matchesRange,estimateTokens } from '../lore-core.js';
import { embed,completionText } from '../lore-api.js';
globalThis.crypto ||= webcrypto;
export function createJobService({sanitize,ask,embedRequest=embed}) {
    const users=new Map();
    function state(user) {
        if(!user?.profile?.handle||!user.directories?.root)throw Error('로그인한 실리태번 사용자만 사용할 수 있어.');
        const owner=fs.realpathSync(user.directories.root);if(users.has(owner))return users.get(owner);
        const root=inside(owner,'archive-lore-server');fs.mkdirSync(root,{recursive:true,mode:0o700});
        const jobsDir=inside(root,'jobs');fs.mkdirSync(jobsDir,{recursive:true,mode:0o700});
        const s={root,jobsDir,jobs:new Map(),running:false,controllers:new Map(),vectors:privateStore(root,'vectors'),user};
        for(const file of fs.readdirSync(jobsDir).filter(f=>/^[a-f0-9-]+\.json$/.test(f))){
            const job=json(inside(jobsDir,file));if(['queued','running'].includes(job.status)){job.status='interrupted';job.message='서버가 재시작됐어. 저장된 구간은 유지돼. 다시 실행해 줘.';atomic(inside(jobsDir,file),job);}s.jobs.set(job.id,job);
        }
        users.set(owner,s);return s;
    }
    const save=(s,job)=>{const stored=structuredClone(job);if(stored.input?.settings){delete stored.input.settings.embeddingKey;delete stored.input.settings.embeddingKeys;}for(const template of Object.values(stored.input?.templates||{}))delete template.proxy_password;atomic(inside(s.jobsDir,job.id+'.json'),stored);};
    const publicJob=job=>({id:job.id,kind:job.kind,status:job.status,message:job.message,chatKey:job.input.context.key,started:job.started,finished:job.finished,hidden:job.hidden||[],books:job.input.books,result:job.result,draftAvailable:!!job.draftState});
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
        const diagnostics=createDiagnostics({store:{put:run=>diagnosticStore.put(run.id,run)},secrets:()=>secrets,warning:message=>{job.diagnosticWarning=message;}});
        const host={
            settings:()=>config,context:()=>({...input.context,messages:readChat(s,input).messages}),books:()=>input.books,target:()=>input.target,initialStart:()=>input.initialStart||0,
            ensureBook:async()=>input.target,
            loadBook:async name=>{const file=bookFile(s,name),raw=fs.readFileSync(file,'utf8');expected.set(file,raw);return JSON.parse(raw);},
            saveBook:async(name,data)=>{const live=readChat(s,input).messages;if(input.context.messages.length&&!matchesRange(sourceRange(input.context.messages,0,input.context.messages.length-1),live))throw Error('원본 대화가 수정돼서 저장을 멈췄어.');
                const file=bookFile(s,name),raw=fs.readFileSync(file,'utf8');if(raw!==expected.get(file))throw Error('로어북이 다른 곳에서 수정됐어. 다시 시도해 줘.');backup(s,job,file,raw);atomic(file,JSON.stringify(data,null,4));expected.set(file,fs.readFileSync(file,'utf8'));},
            newEntry:data=>{const uid=Math.max(-1,...Object.keys(data.entries).map(Number))+1;return data.entries[uid]={...input.entryTemplate,uid,key:[],keysecondary:[],comment:'',content:'',constant:false,vectorized:false,disable:false};},
            store:s.vectors,embed:embedRequest,
            ask:async(profile,system,data,signal,tokens)=>{const template=profile===config.searchProfile&&config.searchProfile?input.templates.search:input.templates.collection;
                return completionText(await ask(s.user,{...template,stream:false,temperature:.2,max_tokens:tokens,max_completion_tokens:undefined,max_output_tokens:undefined,max_new_tokens:undefined,json_schema:undefined,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(data)}]},signal));},
            countTokens:async text=>estimateTokens(text),diagnostics,profileInfo:()=>Object.entries(input.templates||{}).map(([role,p])=>({role,model:p.model,source:p.chat_completion_source})),
            hideRange:async(range)=>{const chat=readChat(s,input),source=sourceRange(chat.messages,range.start,range.end);for(let i=range.start;i<=range.end;i++)chat.lines[chat.offset+i].is_system=true;
                if(fs.readFileSync(chat.file,'utf8')!==chat.raw)throw Error('채팅 파일이 바뀌어서 숨기기를 멈췄어.');backup(s,job,chat.file,chat.raw);atomic(chat.file,chat.lines.map(l=>JSON.stringify(l)).join('\n')+'\n');job.hidden.push(source);save(s,job);},
            changed:()=>{job.message=clean(controller.state().status);save(s,job);},
        };
        let restoredDraft=false;const controller=createLoreController(host);s.controllers.set(job.id,controller);
        try{
            validate(s,input,job.kind);
            if(job.kind==='applyMaintenance'){const prior=s.jobs.get(input.options?.draftJobId);if(!prior?.draftState||prior.input.context.key!==input.context.key)throw Error('서버 초안이 만료됐거나 다른 채팅방의 초안이야.');controller.restoreDraft(prior.draftState);restoredDraft=true;}
            let result=job.kind==='index'?await controller.index(!!input.options?.force):await controller[job.kind](input.options||{});
            if(job.kind==='recall')result={...result,selected:[...result.selected],lastRecall:controller.state().lastRecall,estimatedTokens:true};
            if(job.kind==='prepareMaintenance'){job.draftState=controller.exportDraft();result.serverJobId=job.id;}
            job.result=result;job.status='completed';job.message=controller.state().status;
        }catch(error){job.status=job.cancelRequested?'canceled':'error';job.message=clean(error.message);}finally{if(restoredDraft&&!controller.exportDraft()){const prior=s.jobs.get(input.options?.draftJobId);if(prior){delete prior.draftState;save(s,prior);}}s.controllers.delete(job.id);job.finished=new Date().toISOString();save(s,job);}
    }
    async function drain(s){if(s.running)return;s.running=true;try{let job;while((job=[...s.jobs.values()].find(j=>j.status==='queued'))){try{await run(s,job);}catch{job.status='error';job.message='서버 작업 파일을 저장하지 못했어. 서버 저장 공간과 권한을 확인해 줘.';job.finished=new Date().toISOString();s.controllers.delete(job.id);try{save(s,job);}catch{console.error('[Archive Lore] Could not persist job status:',job.id);}}}}finally{s.running=false;}}
    return {
        async submit(user,kind,input,requestId){const s=state(user);if(typeof requestId!=='string'||!/^[a-f0-9-]{16,80}$/.test(requestId))throw Error('작업 요청 ID가 잘못됐어.');
            const existing=[...s.jobs.values()].find(j=>j.requestId===requestId);if(existing)return publicJob(existing);
            if([...s.jobs.values()].some(j=>['queued','running'].includes(j.status)))throw Error('이미 서버 작업이 진행 중이야. 작업 내역에서 확인해 줘.');
            input=structuredClone(input);validate(s,input,kind);
            const job={id:randomUUID(),requestId,kind,status:'queued',message:'서버 작업 대기 중',input,hidden:[],created:new Date().toISOString()};s.jobs.set(job.id,job);save(s,job);setImmediate(()=>void drain(s));return publicJob(job);},
        list(user,key){return [...state(user).jobs.values()].filter(j=>!key||j.input.context.key===key).map(job=>{const {result,hidden,...summary}=publicJob(job);return summary;});},
        get(user,id){const s=state(user),job=s.jobs.get(id);if(!job)throw Error('서버 작업을 찾을 수 없어.');const result=publicJob(job),messages=readChat(s,job.input).messages;result.hidden=messages.length?[{...sourceRange(messages,0,messages.length-1),indices:messages.map((m,i)=>m.is_system?i:-1).filter(i=>i>=0)}]:[];return result;},
        cancel(user,id){const s=state(user),job=s.jobs.get(id);if(!job)throw Error('서버 작업을 찾을 수 없어.');job.cancelRequested=true;s.controllers.get(id)?.cancel();if(job.status==='queued'){job.status='canceled';job.message='취소됨';}save(s,job);return publicJob(job);},
        vectors(user){return state(user).vectors;},
        async logs(user,key){const s=state(user),dir=inside(s.root,'diagnostics');if(!fs.existsSync(dir))return [];return fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>json(inside(dir,f))).filter(r=>!key||r.chatKey===key).sort((a,b)=>a.started.localeCompare(b.started));},
        state,
    };
}
