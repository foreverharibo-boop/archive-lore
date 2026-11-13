// Archive Lore — AGPL-3.0-only
import { redact } from './lore-telemetry.js';
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
    const important=events.filter(e=>/error|profile\.(requested|resolved)|operation.end/.test(e.stage||'')).slice(-12);
    const picked=[...new Set([...important,...events.slice(-40)])];
    return {id:run.id,kind:run.kind,mode:run.mode,status:run.status,started:run.started,finished:run.finished,
        detail:run.detail,eventCount:events.length,eventsOmitted:run.eventsOmitted||0,detailTruncated:!!run.detailTruncated,
        events:picked.map(e=>({at:e.at,stage:e.stage,elapsedMs:e.elapsedMs,data:redact(compactData(e.data))}))};
}
export function formatDiagnosticPreview(rows) {
    const runs=[...rows].sort((a,b)=>String(b.started).localeCompare(String(a.started))).slice(0,3);
    const header='ARCHIVE LORE · 최근 진단 요약\n최근 작업 3개 · 긴 본문/배열 생략 · 최대 24,000자 (복사도 이 요약만)\n';
    if(!runs.length)return header+'\n아직 기록이 없어. 디버그 모드를 켜고 오류가 난 동작을 다시 실행해 줘.';
    const parts=runs.map(run=>{
        const {events,...meta}=run;
        const important=events.filter(e=>/error|profile\.(requested|resolved)|operation.end/.test(e.stage||''));
        const rest=events.filter(e=>!important.includes(e)).reverse();
        let text='\n===== '+run.kind+' · '+run.status+' =====\n'+JSON.stringify(meta,null,2)+'\n';
        for(const event of [...important,...rest]){
            const line=event.at+' · '+event.stage+' · '+event.elapsedMs+'ms\n'+clip(JSON.stringify(event.data),1300)+'\n';
            if(text.length+line.length>7600){text+='[나머지 단계 표시 생략]\n';break;}text+=line;
        }
        return text;
    });
    return clip(header+parts.join('\n'),PREVIEW_CHARS-10);
}
