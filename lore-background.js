// SPDX-License-Identifier: AGPL-3.0-only
import { makeId } from './lore-api.js';
import { matchesRange,sourceRange } from './lore-core.js';
import { reserveReplySlots,replaceReplySlots,REPLY_PROVIDER } from './lore-reply-slots.js';
import { withAbort } from './lore-cancellation.js';

export function createBackgroundRecall(host) {
    let pending=null;
    const signature=()=>JSON.stringify(host.settings());
    const valid=p=>pending===p && p.key===host.context().key && signature()===p.settings;
    async function prepare(type,trace) {
        const config=host.settings();
        // No plugin probes, extra requests or prompt changes on the public path.
        if(!config.serverEnabled || !config.relayEnabled)return null;
        if(!host.supported(type)||config.keywordActivation){
            await trace?.event('relay.fallback',{reason:'unsupported-generation-or-keyword-policy'});return null;
        }
        const p={ticket:makeId(),key:host.context().key,settings:signature(),abort:new AbortController(),attached:false};
        pending=p;
        const check=()=>{p.abort.signal.throwIfAborted();if(!valid(p))throw new DOMException('서버 답변 준비 중 설정 또는 채팅이 바뀌었어.','AbortError');};
        try {
            if(!await withAbort(()=>host.relay()?.supports?.(REPLY_PROVIDER),p.abort.signal))throw Error('릴레이 연결 유지와 최신 서버 플러그인이 필요해. 서버 답변 연동을 끄면 기존 방식으로 사용할 수 있어.');
            check();
            const tokenizer=await withAbort(host.tokenizer,p.abort.signal);check();
            const input=await withAbort(()=>host.input('recall',{generationType:type||'normal',replyTokenizer:tokenizer},
                (stage,elapsedMs)=>trace?.event('server.input-stage',{stage,elapsedMs})),p.abort.signal);check();
            p.source=sourceRange(input.context.messages,0,input.context.messages.length-1);p.count=input.context.messages.length;
            const result=await withAbort(()=>host.call('/reply/prepare',{ticket:p.ticket,input},{signal:p.abort.signal}),p.abort.signal);check();
            const slots=await withAbort(()=>reserveReplySlots(p.ticket,config.injectionTokens,host.countTokens),p.abort.signal);check();
            await trace?.event('relay.prepared',{ticket:p.ticket,injectionBudget:config.injectionTokens});
            return {...slots,core:result.core,books:input.books,selected:new Set(),deferred:true};
        } catch(error) {
            void host.call('/reply/cancel',{ticket:p.ticket}).catch(()=>{});
            if(pending===p)pending=null;throw error;
        }
    }
    function capture(data,dryRun=false){
        if(pending && !dryRun && Array.isArray(data?.prompt))pending.prompt=data.prompt.filter(m=>m&&typeof m==='object');
    }
    function attach(data){
        const p=pending;
        if(!p || !Array.isArray(data?.messages))return;
        const bound=p.prompt && data.messages.length===p.prompt.length && p.prompt.every((message,i)=>message===data.messages[i]);
        if(!bound && !JSON.stringify(data.messages).includes(`AL_memory_${p.ticket}`))return;
        // ST event dispatchers may log listener errors instead of propagating
        // them. Leave an unusable ticket until every check succeeds, so Relay
        // still blocks the reserved prompt even if the host swallows the error.
        data.__silly_relay_prepare={provider:REPLY_PROVIDER,ticket:''};
        if(!bound)throw Error('기억 주입 자리가 있는 요청의 답장 연결을 확인하지 못했어.');
        if(!valid(p) || !host.relay()?.enabled?.() || host.context().messages.length!==p.count
            || !matchesRange(p.source,host.context().messages))throw Error('대화 또는 릴레이 설정이 바뀌어서 서버 답변을 중단했어.');
        replaceReplySlots(data,p.ticket,{memory:'',guidance:''});
        data.__silly_relay_prepare={provider:REPLY_PROVIDER,ticket:p.ticket};p.attached=true;
    }
    function cancel(){const p=pending;pending=null;if(!p)return;p.abort.abort();void host.call('/reply/cancel',{ticket:p.ticket}).catch(()=>{});}
    return {prepare,capture,attach,cancel,
        detach(){if(!pending?.attached)cancel();else pending=null;},
        async completed(){
            const p=pending;if(!p)return;pending=null;
            if(!p.attached){p.abort.abort();void host.call('/reply/cancel',{ticket:p.ticket}).catch(()=>{});return;}
            const state=await host.call('/reply/get',{ticket:p.ticket});
            if(state.state==='completed' && state.jobId && p.key===host.context().key){
                const job=await host.call('/jobs/get',{id:state.jobId});
                if(p.key===host.context().key)host.accept(job);
            }
        },
    };
}
