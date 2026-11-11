// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { replaceReplySlots, REPLY_PROVIDER } from '../lore-reply-slots.js';
import { withAbort } from '../lore-cancellation.js';

const ID=/^[a-f0-9]{32}$/;
const owner=user=>JSON.stringify([user?.profile?.handle,fs.realpathSync(user.directories.root)]);
export function createReplyBridge({service,countMessages,now=Date.now}) {
    const tickets=new Map();
    const prune=()=>{for(const [key,t] of tickets)if(t.state!=='running' && now()-t.created>(t.state==='ready'?120000:3600000))tickets.delete(key);};
    const timer=setInterval(prune,60000);timer.unref();
    function lookup(user,id){prune();const t=tickets.get(JSON.stringify([owner(user),id]));if(!t)throw Error('서버 답변 준비가 만료됐어.');return t;}
    function prepareInput(user,{ticket,input}) {
        prune();if(!ID.test(ticket))throw Error('서버 답변 번호가 잘못됐어.');
        const key=JSON.stringify([owner(user),ticket]);
        const digest=createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const prior=tickets.get(key);
        if(prior){if(prior.state!=='ready'||prior.digest!==digest)throw Error('이미 사용했거나 취소된 서버 답변 번호야.');return {ticket,core:prior.core};}
        if(!['normal','regenerate','swipe'].includes(input?.options?.generationType||'normal')
            || typeof input?.options?.replyTokenizer!=='string' || input.options.replyTokenizer.length>200)
            throw Error('일반 1:1 Chat Completion 답변에서만 서버 연동을 사용할 수 있어.');
        const bytes=Buffer.byteLength(JSON.stringify(input));
        if(bytes>8*1024*1024 || tickets.size>=256
            || [...tickets.values()].filter(t=>t.owner===owner(user)&&['ready','running'].includes(t.state)).length>=4
            || [...tickets.values()].reduce((n,t)=>n+(t.bytes||0),0)+bytes>32*1024*1024)throw Error('서버 답변 준비 보관 한도야.');
        const snapshot=service.replySnapshot(user,input);
        const heldBytes=bytes+Buffer.byteLength(snapshot.core);
        if(heldBytes>8*1024*1024 || [...tickets.values()].reduce((n,t)=>n+(t.bytes||0),0)+heldBytes>32*1024*1024)
            throw Error('코어 기억을 포함한 서버 답변 준비 보관 한도야.');
        tickets.set(key,{ticket,owner:owner(user),digest,input:structuredClone(input),...snapshot,
            created:now(),state:'ready',bytes:heldBytes,abort:new AbortController()});
        return {ticket,core:snapshot.core};
    }
    function cancel(user,id){
        if(!ID.test(id))throw Error('서버 답변 번호가 잘못됐어.');
        const key=JSON.stringify([owner(user),id]);prune();let t=tickets.get(key);
        if(!t){if(tickets.size>=256)throw Error('서버 답변 준비 보관 한도야.');t={ticket:id,owner:owner(user),created:now(),state:'canceled'};tickets.set(key,t);}
        if(['ready','running'].includes(t.state)){t.state='canceled';t.abort.abort();if(t.job)service.cancel(user,t.job);t.input=null;t.core=null;t.bytes=0;}
        return {state:t.state};
    }
    async function prepare({user,ticket,jobId,parentJobId,payload,signal}) {
        const t=lookup(user,ticket);
        // Relay validates this parent against its own account-bound completed job.
        // Active reviewers may still hold the original reserved prompt. Reuse the
        // SAME selected memory, without another recall or a changed chat snapshot.
        if(parentJobId) {
            if(t.state!=='completed'||!t.revisions?.has(parentJobId)||t.revisions.size>=64)
                throw Error('원래 기억 선별 결과를 확인할 수 없어.');
            signal.throwIfAborted();
            const prepared=replaceReplySlots(payload,ticket,t.slots);
            const reserved=await withAbort(()=>countMessages(user,t.tokenModel,payload.messages),signal);
            const actual=await withAbort(()=>countMessages(user,t.tokenModel,prepared.messages),signal);
            if(actual>reserved)throw Error('확보한 기억 자리보다 재검수 요청이 커졌어.');
            signal.throwIfAborted();t.revisions.add(jobId);return prepared;
        }
        // A retry of the SAME relay POST is handled by Relay; a second job may
        // never spend another generation using this ticket.
        if(t.state!=='ready')throw Error('이미 사용했거나 취소된 서버 답변 준비야.');
        t.state='running';t.relayJob=jobId;
        const abort=()=>t.abort.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted)abort();
        const input=t.input, tokenModel=input.options.replyTokenizer;
        try {
            t.abort.signal.throwIfAborted();
            // Validate placement BEFORE spending recall API requests.
            replaceReplySlots(payload,ticket,{memory:'',guidance:''});
            if(service.replySnapshot(user,input).fingerprint!==t.fingerprint)throw Error('대화 또는 로어북이 변경됐어.');
            const reserved=await withAbort(()=>countMessages(user,tokenModel,payload.messages),t.abort.signal);
            const submitted=await service.submit(user,'recall',input,ticket);
            t.job=submitted.id;t.abort.signal.throwIfAborted();
            let job;
            do {
                job=service.get(user,t.job);
                if(!['queued','running'].includes(job.status))break;
                await wait(100,undefined,{signal:t.abort.signal});
            } while(true);
            if(job.status!=='completed')throw Error(job.message||'기억 검색에 실패했어.');
            if(service.replySnapshot(user,input).fingerprint!==t.fingerprint)throw Error('검색 중 대화 또는 로어북이 변경됐어.');
            if(job.result.core!==t.core)throw Error('코어 기억이 변경됐어.');
            const prepared=replaceReplySlots(payload,ticket,{memory:job.result.text,guidance:job.result.guidance});
            const actual=await withAbort(()=>countMessages(user,tokenModel,prepared.messages),t.abort.signal);
            if(actual>reserved)throw Error('확보한 기억 자리보다 요청이 커져 전송을 중단했어.');
            t.abort.signal.throwIfAborted();t.state='completed';
            t.slots={memory:job.result.text,guidance:job.result.guidance};
            t.tokenModel=tokenModel;t.revisions=new Set([jobId]);
            return prepared;
        } catch(error) {
            if(t.state!=='canceled')t.state=t.abort.signal.aborted?'canceled':'error';
            // Keep diagnostic errors free of prompts and credentials.
            t.message=String(error.message||'서버 답변 준비 실패').slice(0,300);
            if(t.job && t.state!=='completed')service.cancel(user,t.job);
            throw error;
        } finally {
            signal.removeEventListener('abort',abort);t.input=null;t.core=null;
            t.bytes=t.slots?Buffer.byteLength(JSON.stringify(t.slots)):0;
        }
    }
    return {apiVersion:1,prepareInput,prepare,cancel,
        get(user,id){const t=lookup(user,id);return {state:t.state,message:t.message,jobId:t.job};},
        close(){clearInterval(timer);for(const t of tickets.values())t.abort?.abort();tickets.clear();},
    };
}
export function registerReplyBridge(bridge) {
    const key=Symbol.for('silly-relay.preparers.v1');
    globalThis[key] ||= new Map();globalThis[key].set(REPLY_PROVIDER,bridge);
    return ()=>{if(globalThis[key].get(REPLY_PROVIDER)===bridge)globalThis[key].delete(REPLY_PROVIDER);bridge.close();};
}
