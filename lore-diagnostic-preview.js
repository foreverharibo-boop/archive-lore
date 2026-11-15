// Archive Lore — AGPL-3.0-only
import { DIAGNOSTIC_EVENT_LIMIT,diagnosticSummary } from './lore-retention.js';
import { redact } from './lore-telemetry.js';
export const PREVIEW_CHARS=280000;
export function compactDiagnosticRun(run){return {...run,events:(run.events||[]).slice(-DIAGNOSTIC_EVENT_LIMIT).map(event=>({...event,data:diagnosticSummary(event.data,0,redact)}))};}
export function formatDiagnosticPreview(rows) {
    const recent=rows.flatMap(run=>(run.events||[]).map((event,index)=>({run,event,index})))
        .sort((a,b)=>String(a.event.at||a.run.started).localeCompare(String(b.event.at||b.run.started))||a.index-b.index).slice(-DIAGNOSTIC_EVENT_LIMIT);
    let text='ARCHIVE LORE · 최근 진단 10단계\n검색·선별·주입 요약 + 오류 진단 · 긴 본문/배열 중복 저장 없음 · 새로고침하면 브라우저 기록 초기화\n';
    if(!recent.length)return text+'\n아직 기록이 없어. 디버그 모드를 켜고 채팅을 보내거나 기억 검색을 실행해 줘.';
    for(const {run,event} of recent){
        const {recallReview,...metadata}=diagnosticSummary(event.data,0,redact);
        text+='\n'+event.at+' · '+run.kind+' · '+run.status+'\n'+event.stage+' · '+event.elapsedMs+'ms\n'+(recallReview?recallReview+'\n':'')+(Object.keys(metadata).length?JSON.stringify(metadata)+'\n':'');
    }
    return text;
}
