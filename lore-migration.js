// Temporary pre-release importer. The converted books require no legacy reader.
// SPDX-License-Identifier: AGPL-3.0-only
import { NS, materializeEntry, matchesRange, nextStart } from './lore-core.js';
import { consolidationView } from './lore-maintenance.js';
import { normalizeSides } from './lore-side-config.js';

export function convertLegacyBook(original, messages, chatId, config, initialStart = 0) {
    const data=structuredClone(original), sides=normalizeSides(config.sideTemplates);
    const visible=consolidationView(Object.values(original.entries || {}),messages);
    const entries={};
    for(const raw of visible){
        const entry=materializeEntry(structuredClone(raw),messages), legacy=entry[NS];
        if(legacy){
            if(legacy.source && !matchesRange(legacy.source,messages))entry.disable=true;
            if(legacy.sideCategory){
                const side=sides.find(s=>s.id===legacy.sideCategory);
                entry.comment=(side?.title || entry.comment || legacy.sideCategory)+' (STMB SidePrompt)';
                // Side prompts are updated by title; exclude them from ordinary memory consolidation.
                entry.stmemorybooks=false;
            }else{
                entry.stmemorybooks=true;
                if(legacy.source && matchesRange(legacy.source,messages)){
                    entry.STMB_start=legacy.source.start;entry.STMB_end=legacy.source.end;entry.STMB_chatId=chatId;
                }
                if(legacy.tier>0){
                    entry.stmbSummary=true;entry.stmbSummaryTier=legacy.tier;
                    entry.stmbSourceEntryUids=[...new Set((legacy.members || []).map(m=>String(m.uid)))];
                }
            }
            delete entry[NS];
        }
        if(!legacy?.sideCategory && !entry.constant && entry.stmemorybooks===undefined)entry.stmemorybooks=true;
        entries[String(entry.uid)]=entry;
    }
    data.entries=entries;delete data[NS];
    const receipts=(original[NS]?.receipts || []).filter(r=>r.source && matchesRange(r.source,messages));
    return {data,next:nextStart(receipts,initialStart),count:Object.keys(entries).length};
}

export function migrationSideTemplates(config, prefix) {
    return normalizeSides(config.sideTemplates).map(side=>({
        key:`${prefix}-${side.id}`,name:side.title,enabled:config.sideEnabled!==false && side.enabled,
        prompt:`${config.sidePrompt || ''}\n\n${side.prompt}\n\nUpdate this ONE side record using the supplied dialogue and its previous saved content. Preserve unchanged supported facts. Output the COMPLETE updated record in English, not a JSON change list. Do not return memories or other categories. Preserve known relationship start dates; never invent a date. If nothing changes, return the previous record. These output rules override legacy JSON/delta instructions.`,
        responseFormat:'',triggers:{commands:['sideprompt'],onAfterMemory:{enabled:true}},
        settings:{archiveLoreSetOnly:true,lorebook:{entryTitleOverride:side.title,constVectMode:'link',preventRecursion:true}},
    }));
}

// Host operations are injected to make partial failure and retry testable.
export async function migrateLegacyChat(host) {
    const snapshot=host.snapshot();
    if(snapshot.completed)return '이미 이관한 채팅입니다. 새 형식의 책을 계속 사용하시면 됩니다.';
    if(!snapshot.key || !snapshot.books.length)throw Error('이관할 채팅과 로어북을 먼저 선택해 주세요.');
    let stage='원본 로어북 읽기';
    const report=message=>{stage=message;host.report?.(message);};
    try {
        const originals=[];
        for(const name of snapshot.books){report(`원본 로어북 읽기 · ${name}`);originals.push({name,data:await host.load(name)});}
        report('원본 백업 다운로드');
        await host.backup({schema:1,chatKey:snapshot.key,metadata:snapshot.metadata,books:originals});
        const copies=[];let next=0;
        for(const original of originals){
            host.assertCurrent(snapshot.key);
            report(`기억 형식 변환 · ${original.name}`);
            const converted=convertLegacyBook(original.data,snapshot.messages,snapshot.chatId,snapshot.config,snapshot.initialStart || 0);
            report(`복사본 이름 저장 · ${original.name}`);
            const name=await host.destination(original.name,snapshot.key);
            report(`복사본 저장 · ${name}`);
            await host.save(name,converted.data);
            report(`복사본 저장 확인 · ${name}`);
            const saved=await host.load(name);
            if(JSON.stringify(saved.entries)!==JSON.stringify(converted.data.entries))throw Error('복사본 저장 검증에 실패했습니다.');
            report(`기존 임베딩 복사 · ${name}`);
            await host.copyVectors(original.name,name,original.data,converted.data);
            copies.push({from:original.name,name,count:converted.count});
            if(original.name===(snapshot.target || snapshot.books[0]))next=converted.next;
        }
        host.assertCurrent(snapshot.key);
        report('프롬프트·사이드 설정 저장');
        await host.savePrompts(snapshot.config);
        host.assertCurrent(snapshot.key);
        report('채팅 로어북 연결 저장');
        await host.commit(snapshot,copies,next);
        return `${copies.length}개 책 · ${copies.reduce((n,b)=>n+b.count,0)}개 항목 이관 완료. 원본 책은 보관했습니다. 다음 수집은 #${next}부터입니다.`;
    } catch(cause) {
        throw new Error(`이관 중단 — ${stage}: ${cause.message || cause}. 원본 책은 삭제하지 않았습니다.`,{cause});
    }
}
