// Archive Lore — AGPL-3.0-only
import { DIAGNOSTIC_EVENT_LIMIT,diagnosticSummary } from './lore-retention.js';
import { redact } from './lore-telemetry.js';
export const PREVIEW_CHARS=Infinity; // Explicit recall originals are never clipped.
export function compactDiagnosticRun(run){return {...run,events:(run.events||[]).slice(-DIAGNOSTIC_EVENT_LIMIT).map(event=>({...event,data:diagnosticSummary(event.data,0,redact)}))};}
export function formatDiagnosticPreview(rows) {
    const recent=rows.flatMap(run=>(run.events||[]).map((event,index)=>({run,event,index})))
        .sort((a,b)=>String(a.event.at||a.run.started).localeCompare(String(b.event.at||b.run.started))||a.index-b.index).slice(-DIAGNOSTIC_EVENT_LIMIT);
    let text='ARCHIVE LORE · 최근 진단 10단계\n선별 검토·주입 원문 전체 + 검색 요약·오류 진단 · API 키 가림 · 새로고침하면 브라우저 기록 초기화\n';
    if(!recent.length)return text+'\n아직 기록이 없어. 디버그 모드를 켜고 채팅을 보내거나 기억 검색을 실행해 줘.';
    for(const {run,event} of recent){
        const {recallReview,recallDetails,...metadata}=diagnosticSummary(event.data,0,redact);
        text+='\n'+event.at+' · '+run.kind+' · '+run.status+'\n'+event.stage+' · '+event.elapsedMs+'ms\n'+(recallDetails?recallDetails+'\n\n':'')+(recallReview?'[검색·선별 요약 · 원문 전체는 위에 표시]\n'+recallReview+'\n':'')+(Object.keys(metadata).length?JSON.stringify(metadata)+'\n':'');
    }
    return text;
}
