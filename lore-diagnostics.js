// Archive Lore — AGPL-3.0-only
import { makeId } from './lore-api.js';
import { DIAGNOSTIC_EVENT_LIMIT, diagnosticSummary } from './lore-retention.js';
import { redact } from './lore-telemetry.js';
import { formatDiagnosticPreview } from './lore-diagnostic-preview.js';
import { createRecallAudit } from './lore-recall-diagnostics.js';
export { redact } from './lore-telemetry.js';

// Migration only: never open, read or write a diagnostic database again.
export function createDiagnosticStore(factory=globalThis.indexedDB) {
    let removal;
    return {ready:()=>removal ||= new Promise((resolve,reject)=>{
        if(!factory?.deleteDatabase){resolve();return;}
        const request=factory.deleteDatabase('archive-lore-diagnostics');
        request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);
        request.onblocked=()=>reject(Error('이전 디버그 기록을 지우려면 다른 실리 탭을 닫고 새로고침해 줘.'));
    })};
}

// One ring for the whole extension session, shared across chats and operations.
// Active traces retain recall evidence as strings, never raw API/vector arrays.
// No disk snapshots, IndexedDB, timers or separate export archive.
export function createDiagnostics({secrets=()=>[],detailed=()=>true}={}) {
    const recent=[];
    let revision=0;
    const rows=(chatKey,mode='all')=>{
        const grouped=new Map();
        for(const item of recent){
            if(chatKey!==undefined&&item.meta.chatKey!==chatKey||mode!=='all'&&item.meta.mode!==mode)continue;
            let run=grouped.get(item.meta.id);
            if(!run){run={...item.meta,detail:'recall-and-errors',events:[]};grouped.set(run.id,run);}
            run.status=item.status;run.events.push({...item.event,data:{...item.event.data}});
        }
        return [...grouped.values()];
    };
    return {
        begin(meta={},options={}) {
            const enabled=options.enabled||detailed,hidden=options.secrets||secrets;
            const info={id:makeId(),chatKey:String(meta.chatKey||'').slice(0,512),kind:String(meta.kind||'operation').slice(0,80),mode:String(meta.mode||'').slice(0,80),started:new Date().toISOString()};
            let status='running',audit=null,seenRevision=revision;
            const appendRaw=(stage,data)=>{
                if(stage==='recall.review'){
                    const previous=recent.findIndex(row=>row.meta.id===info.id&&row.event.stage===stage);
                    if(previous>=0)recent.splice(previous,1);
                }
                const event={eventId:makeId(),at:new Date().toISOString(),stage:String(stage).slice(0,100),elapsedMs:Date.now()-Date.parse(info.started),data:diagnosticSummary(data,0,value=>redact(value,hidden()))};
                recent.push({meta:info,status,event});if(recent.length>DIAGNOSTIC_EVENT_LIMIT)recent.shift();
            };
            const append=(stage,data)=>{
                if(seenRevision!==revision){audit=null;seenRevision=revision;}
                if(!enabled()){audit=null;return;}
                audit ||= createRecallAudit(value=>redact(value,hidden()));
                try{
                    if(audit.capture(stage,data))appendRaw('recall.review',{recallReview:audit.text(),recallDetails:audit.details()});
                    else appendRaw(stage,data);
                }catch{appendRaw('diagnostic.summary-error',{message:'진단 요약 일부를 표시하지 못했어. 실제 검색·선별은 계속 진행돼.'});}
            };
            return {id:info.id,event:async(stage,data={})=>append(stage,data),finish:async(next,data={})=>{
                status=next;for(const row of recent)if(row.meta.id===info.id)row.status=status;
                // Refresh recall evidence after long API phases, including errors.
                if(enabled()&&seenRevision===revision&&audit?.text())appendRaw('recall.review',{recallReview:audit.text(),recallDetails:audit.details()});
                append('operation.end',{...data,...(typeof data.status==='number'?{httpStatus:data.status}:{}),status});
            }};
        },
        async list(chatKey){return rows(chatKey);},
        async previewRuns(){return rows();},
        async preview(){return formatDiagnosticPreview(rows());},
        // Compatibility consumers receive exactly the same small diagnostic list.
        async export(_chatKey,_mode){return formatDiagnosticPreview(rows());},
        clear(){recent.length=0;revision++;},
    };
}
