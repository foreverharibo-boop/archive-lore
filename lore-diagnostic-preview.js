// Archive Lore — AGPL-3.0-only
import { DIAGNOSTIC_EVENT_LIMIT,diagnosticSummary } from './lore-retention.js';
import { redact } from './lore-telemetry.js';
export const PREVIEW_CHARS=24000;
export function compactDiagnosticRun(run){return {...run,events:(run.events||[]).slice(-DIAGNOSTIC_EVENT_LIMIT).map(event=>({...event,data:diagnosticSummary(event.data,0,redact)}))};}
export function formatDiagnosticPreview(rows) {
    const recent=rows.flatMap(run=>(run.events||[]).map((event,index)=>({run,event,index})))
        .sort((a,b)=>String(a.event.at||a.run.started).localeCompare(String(b.event.at||b.run.started))||a.index-b.index).slice(-DIAGNOSTIC_EVENT_LIMIT);
    let text='ARCHIVE LORE · 최근 진단 10단계\n임시 오류 진단만 · 긴 본문/배열 저장 없음 · 새로고침하면 초기화\n';
    if(!recent.length)return text+'\n아직 기록이 없어. 디버그 모드를 켜고 오류가 난 동작을 다시 실행해 줘.';
    for(const {run,event} of recent)text+='\n'+event.at+' · '+run.kind+' · '+run.status+'\n'+event.stage+' · '+event.elapsedMs+'ms\n'+JSON.stringify(event.data)+'\n';
    return text;
}
