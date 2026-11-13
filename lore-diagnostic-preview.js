// Archive Lore — AGPL-3.0-only
import { redact } from './lore-telemetry.js';
import { DIAGNOSTIC_EVENT_LIMIT } from './lore-retention.js';
export const PREVIEW_CHARS=24000;
const clip=(value,limit)=>value.length>limit?value.slice(0,limit)+' … [생략]':value;
// Bound traversal before redaction/stringification. Arrays show counts instead of
// expanding dialogues, vectors and candidate memories in the settings textarea.
function compactData(data,depth=0) {
    if(typeof data==='string')return clip(data,700);
    if(data===null||typeof data==='number'||typeof data==='boolean')return data;
    if(Array.isArray(data))return {count:data.length};
    if(!data||typeof data!=='object')return String(data??'');
    if(depth>=4)return '[하위 내용 생략]';
    const result={};let count=0;
    for(const key in data){if(!Object.hasOwn(data,key))continue;if(count++>=30){result.fieldsOmitted=true;break;}
        const value=data[key];
        // Only persisted/redacted records enter this helper. Re-redact bounded
        // values below as defense in depth before copying to the clipboard.
        result[key]=compactData(value,depth+1);
    }
    return result;
}
export function compactDiagnosticRun(run) {
    const events=run.events||[];
    const picked=events.slice(-DIAGNOSTIC_EVENT_LIMIT);
    return {id:run.id,kind:run.kind,mode:run.mode,status:run.status,started:run.started,finished:run.finished,
        detail:run.detail,eventCount:events.length,eventsOmitted:run.eventsOmitted||0,detailTruncated:!!run.detailTruncated,
        events:picked.map(e=>{const data=redact(compactData(e.data)),text=JSON.stringify(data);return {at:e.at,stage:e.stage,elapsedMs:e.elapsedMs,data:text.length>1300?{excerpt:clip(text,1300)}:data};})};
}
export function formatDiagnosticPreview(rows) {
    const runs=[...rows].sort((a,b)=>String(b.started).localeCompare(String(a.started)));
    const header='ARCHIVE LORE · 최근 진단 10단계\n작업마다 최근 10단계만 보관 · 화면/복사도 합쳐서 최신 10단계 · 긴 본문 생략\n';
    const recent=runs.flatMap(run=>(run.events||[]).map((event,index)=>({run,event,index})))
        .sort((a,b)=>String(a.event.at||a.run.started).localeCompare(String(b.event.at||b.run.started)) || String(a.run.started).localeCompare(String(b.run.started)) || a.index-b.index)
        .slice(-DIAGNOSTIC_EVENT_LIMIT);
    if(!recent.length)return header+'\n아직 기록이 없어. 디버그 모드를 켜고 오류가 난 동작을 다시 실행해 줘.';
    let text=header;
    for(const {run,event} of recent){
        text+='\n'+(event.at||run.started)+' · '+run.kind+' · '+run.status+'\n'+event.stage+' · '+(event.elapsedMs??'?')+'ms\n'+clip(JSON.stringify(event.data),1300)+'\n';
    }
    return clip(text,PREVIEW_CHARS-10);
}
