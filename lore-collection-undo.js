// Archive Lore — AGPL-3.0-only. Reuse existing per-entry receipts; no growing undo log.
import {NS, matchesRange, sourceRange} from './lore-core.js';
import {getSidePromptRegenerationSnapshot} from './memoryRegeneration.js';
import {isRollbackBaseMemory, getRollbackEntryRange, collectConsolidationRollbackPlan,
    validateAndExpandLinkedRollbackSelections, applySidePromptRestoration,
    reconcileSidePromptHistoryStates, fingerprintRollbackEntry} from './memoryRollback.js';
import {getSidePromptHistoryStreamKey} from './sidePromptHistory.js';
import {maintainArchiveDisplayOrder} from './lore-display-order.js';

export const COLLECTION_UNDO_PENDING='archiveLorePendingCollectionUndo';
const same=(a,b)=>a?.start===b?.start && a?.end===b?.end;
const time=value=>Date.parse(value)||0;
const sideRange=s=>({start:s.sceneStart,end:s.sceneEnd});

export function planCollectionUndo(books,{chatId,messages,checkpoint}) {
    if(!chatId || !messages?.length)throw Error('대화가 있는 채팅방에서 되돌려 줘.');
    const states=books.map(({name,data})=>({name,data:structuredClone(data),originalData:data}));
    const candidates=[];
    for(const state of states) {
        for(const entry of Object.values(state.data.entries || {})) {
            const range=getRollbackEntryRange(entry);
            if(isRollbackBaseMemory(entry) && entry.STMB_chatId===chatId && range)
                candidates.push({range,at:time(entry.STMB_collectedAt)});
            const s=getSidePromptRegenerationSnapshot(entry);
            if(s?.chatId===chatId)candidates.push({range:sideRange(s),at:Math.max(0,...Object.entries(entry)
                .filter(([k])=>/^STMB_sp_.+_lastRunAt$/.test(k)).map(([,v])=>time(v)))});
        }
        for(const r of state.data[NS]?.receipts || [])if(matchesRange(r.source,messages))candidates.push({range:r.source,at:time(r.created)});
    }
    candidates.sort((a,b)=>b.at-a.at || b.range.end-a.range.end || b.range.start-a.range.start);
    const range=candidates[0]?.range;
    if(!range)throw Error('현재 채팅의 수집 범위·복원 정보를 찾지 못했어. 로어북 파일을 확인해야 해.');
    if(range.end>=messages.length)throw Error('수집 이후 대화가 삭제돼서 범위를 확인할 수 없어.');
    const selected=new Map(states.map(s=>[s.name,new Set(Object.entries(s.data.entries || {})
        .filter(([,e])=>isRollbackBaseMemory(e)&&e.STMB_chatId===chatId&&same(getRollbackEntryRange(e),range))
        .map(([k,e])=>String(e.uid??k)))]));
    const issues=validateAndExpandLinkedRollbackSelections(states,selected,chatId);
    if(issues.length)throw Error('연결된 기억 사본이 빠져 있어서 되돌리기를 멈췄어. 연결된 로어북을 확인해 줘.');
    const rows=[];
    for(const state of states) {
        const rowsBefore=rows.length;
        const data=state.data, streams=new Set();
        // Range-only legacy receipts cannot distinguish repeated runs of the
        // same stream. Never guess and delete several independent collections.
        const baseEntries=Object.values(data.entries || {}).filter(e=>selected.get(state.name).has(String(e.uid)));
        if(baseEntries.length>1 && !baseEntries.every(e=>e.STMB_inclusionGroup && e.STMB_inclusionGroup===baseEntries[0].STMB_inclusionGroup))
            throw Error('같은 범위가 여러 번 수집되어 직전 항목을 구별할 수 없어. 로어북에서 중복 항목을 먼저 확인해 줘.');
        const sideKeys=new Set();
        for(const e of Object.values(data.entries || {})) {
            const s=e.STMB_sidePromptRegeneration;
            if(s?.chatId!==chatId || !same(sideRange(s),range))continue;
            const key=getSidePromptHistoryStreamKey(e.STMB_sidePromptHistory) || JSON.stringify([s.templateKey,s.runtimeMacros]);
            if(sideKeys.has(key))throw Error('같은 범위의 사이드 버전이 여러 개라 직전 실행을 구별할 수 없어. 로어북에서 버전을 먼저 확인해 줘.');
            sideKeys.add(key);
        }
        const dependency=collectConsolidationRollbackPlan(data,selected.get(state.name));
        if(dependency.parents.length || dependency.issues.length)throw Error('이 기억을 사용한 아크·통합 기록이 있어. 통합 기록을 먼저 정리한 뒤 되돌려 줘.');
        for(const [key,entry] of Object.entries(data.entries || {})) {
            if(selected.get(state.name).has(String(entry.uid??key))) {
                rows.push({book:state.name,title:entry.comment,action:'삭제'});delete data.entries[key];continue;
            }
            const raw=entry.STMB_sidePromptRegeneration;
            if(raw?.chatId===chatId && same(sideRange(raw),range)) {
                const snapshot=getSidePromptRegenerationSnapshot(entry);
                if(snapshot?.version!==2)throw Error('이전 사이드 내용의 복원 정보가 부족해서 자동 삭제하지 않았어.');
                const stream=getSidePromptHistoryStreamKey(entry.STMB_sidePromptHistory);if(stream)streams.add(stream);
                const result=applySidePromptRestoration(data,{entryKey:key});
                if(!result.changed)throw Error('수집 후 수정된 사이드 항목이 있어서 덮어쓰지 않았어: '+(entry.comment || key));
                rows.push({book:state.name,title:entry.comment,action:result.deleted?'삭제':'이전 내용 복원'});
                continue;
            }
            const meta=entry[NS];
            if(meta?.source && same(meta.source,range) && matchesRange(meta.source,messages)) {
                if(meta.members?.length)throw Error('통합된 기억은 먼저 통합을 정리한 뒤 되돌려 줘.');
                if(meta.sideCategory && meta.history?.length) {
                    const history=[...meta.history],previous=history.pop();
                    entry.content=previous.content;entry[NS]={...meta,...previous,history};delete entry[NS].content;
                    rows.push({book:state.name,title:entry.comment,action:'이전 내용 복원'});
                } else {
                    delete data.entries[key];rows.push({book:state.name,title:entry.comment,action:'삭제'});
                }
            }
        }
        if(streams.size)reconcileSidePromptHistoryStates({entries:Object.fromEntries(Object.entries(data.entries || {})
            .filter(([,e])=>streams.has(getSidePromptHistoryStreamKey(e.STMB_sidePromptHistory))))});
        if(rows.length>rowsBefore)maintainArchiveDisplayOrder(data);
        if(data[NS])for(const field of ['receipts','storyDates'])if(Array.isArray(data[NS][field]))
            data[NS][field]=data[NS][field].filter(r=>!same(r.source,range)||!matchesRange(r.source,messages));
    }
    const changed=states.filter(s=>fingerprintRollbackEntry(s.data)!==fingerprintRollbackEntry(s.originalData));
    if(!changed.length)throw Error('되돌릴 수 있는 저장 항목을 찾지 못했어.');
    // Never rewind unrelated later progress when the last operation re-collected an earlier range.
    const nextCheckpoint=Number.isInteger(checkpoint)&&checkpoint>range.end?checkpoint:range.start-1;
    return {states:changed,rows,range:{start:range.start,end:range.end},source:sourceRange(messages,range.start,range.end),checkpoint:nextCheckpoint};
}

/** Caller holds all book write lanes. Recheck before writes and compensate only our own bytes. */
export async function saveCollectionUndo(states,{load,save,assertCurrent=()=>{}}) {
    for(const s of states){assertCurrent();if(fingerprintRollbackEntry(await load(s.name))!==fingerprintRollbackEntry(s.originalData))throw Error('로어북이 변경됐어. 다시 열어서 확인해 줘.');}
    const saved=[];
    try {
        for(const s of states){
            assertCurrent();
            if(fingerprintRollbackEntry(await load(s.name))!==fingerprintRollbackEntry(s.originalData))throw Error('저장 직전에 로어북이 변경됐어. 다시 확인해 줘.');
            assertCurrent();await save(s.name,s.data);saved.push(s);
        }
    } catch(error) {
        const failed=[];
        for(const s of saved.reverse())try {
            if(fingerprintRollbackEntry(await load(s.name))!==fingerprintRollbackEntry(s.data))throw Error('다른 변경 발견');
            await save(s.name,s.originalData);
        }catch{failed.push(s.name);}
        if(failed.length)throw Error(`${error.message} · 일부 책의 복원이 필요해: ${failed.join(', ')}`);
        throw error;
    }
}
