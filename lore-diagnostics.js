// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import { makeId } from './lore-api.js';
import { expiredHistory,DIAGNOSTIC_BYTES,diagnosticSummary } from './lore-retention.js';

import { redact, environmentInfo } from './lore-telemetry.js';
import { compactDiagnosticRun, formatDiagnosticPreview } from './lore-diagnostic-preview.js';
export { redact } from './lore-telemetry.js';

export function createDiagnosticStore(factory = indexedDB) {
    let opening;
    const db = () => opening ||= new Promise((resolve, reject) => {
        const request = factory.open('archive-lore-diagnostics', 3);let blocked=false;
        request.onupgradeneeded = event => {
            if(event.oldVersion<1)request.result.createObjectStore('runs', { keyPath: 'id' }).createIndex('chatKey', 'chatKey');
            else if(event.oldVersion<2)request.transaction.objectStore('runs').clear();
            const runs=request.transaction.objectStore('runs');
            if(!runs.indexNames.contains('retention'))runs.createIndex('retention',['started','diagnosticBytes']);
            if(!runs.indexNames.contains('chatStarted'))runs.createIndex('chatStarted',['chatKey','started']);
        };
        request.onblocked=()=>{blocked=true;opening=null;reject(Error('이전 진단 기록 정리를 위해 다른 실리 웹앱 탭을 닫고 새로고침해 줘.'));};
        request.onsuccess = () => {
            if(blocked){request.result.close();return;}
            request.result.onversionchange=()=>{request.result.close();opening=null;};
            resolve(request.result);
        };
        request.onerror = () => { opening = null; reject(request.error); };
    });
    const prune=async protectedId=>{
        const database=await db();
        await new Promise((resolve,reject)=>{
            const tx=database.transaction('runs','readwrite'),store=tx.objectStore('runs'),rows=[];
            const request=store.index('retention').openKeyCursor();
            request.onsuccess=()=>{
                const cursor=request.result;
                if(cursor){rows.push({id:cursor.primaryKey,time:Date.parse(cursor.key[0])||0,
                    bytes:cursor.key[1],protected:cursor.primaryKey===protectedId});cursor.continue();}
                else for(const r of expiredHistory(rows,{maxBytes:DIAGNOSTIC_BYTES}))store.delete(r.id);
            };
            tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        });
    };
    return {
        ready:db,
        async put(run) {
            const database = await db();
            await new Promise((resolve, reject) => {
                const tx = database.transaction('runs', 'readwrite');tx.objectStore('runs').put(run);
                tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
            });
            await prune(run.id);
        },
        async preview(chatKey) {
            const database=await db();
            return new Promise((resolve,reject)=>{
                const rows=[],tx=database.transaction('runs'),index=tx.objectStore('runs').index('chatStarted');
                const request=index.openCursor(IDBKeyRange.bound([chatKey,''],[chatKey,'\uffff']),'prev');
                request.onsuccess=()=>{const cursor=request.result;if(!cursor||rows.length>=3){resolve(rows);return;}
                    rows.push(compactDiagnosticRun(cursor.value));if(rows.length>=3)resolve(rows);else cursor.continue();};
                request.onerror=()=>reject(request.error);
            });
        },
        async list(chatKey) {
            await prune();
            const database = await db();
            return new Promise((resolve, reject) => {
                const request = database.transaction('runs').objectStore('runs').index('chatKey').getAll(chatKey);
                request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
            });
        },
    };
}
export function createDiagnostics({ store, secrets = () => [], warning = () => {}, detailed = () => false }) {
    const memory=new Map(),dirty=new Map(),versions=new WeakMap();
    let timer=null,flushing=null,warned=false;
    const warn=()=>{if(!warned){warned=true;try{warning('진단 기록을 저장하지 못했어. 현재 창의 기록은 복사할 수 있어.');}catch{}}};
    const flush=()=>{
        if(timer!==null){clearTimeout(timer);timer=null;}
        if(flushing)return flushing.then(()=>dirty.size?flush():undefined);
        const batch=[...dirty.values()];dirty.clear();
        flushing=(async()=>{
            for(const run of batch){
                const version=versions.get(run);
                // Event data is already redacted and detached at append time.
                // Copy only the event list; never re-redact/stringify the whole history per event.
                const snapshot={...run,events:run.events.slice()};
                try{await store.put(snapshot);if(versions.get(run)===version)memory.delete(run.id);}
                catch{warn();}
            }
        })().finally(()=>{flushing=null;});
        return flushing;
    };
    const persist=run=>{
        versions.set(run,(versions.get(run)||0)+1);memory.set(run.id,run);dirty.set(run.id,run);
        for(const old of expiredHistory([...memory.values()].map(r=>({id:r.id,time:Date.parse(r.events.at(-1)?.at||r.started),bytes:r.diagnosticBytes||0,protected:r.id===run.id})),{maxBytes:DIAGNOSTIC_BYTES})){
            memory.delete(old.id);dirty.delete(old.id);
        }
        if(timer===null){timer=setTimeout(()=>{timer=null;void flush();},1000);timer.unref?.();}
    };
    return {
        begin(meta) {
            const isDetailed=!!detailed();let contentBytes=0;const sizes=new WeakMap();
            const eventData=data=>{
                const summary=()=>redact(diagnosticSummary(data),secrets());
                if(!isDetailed || !detailed())return summary();
                const clean=redact(data,secrets()),bytes=JSON.stringify(clean).length*2;
                if(contentBytes+bytes>8*1024*1024){run.detailTruncated=true;run.detailBytesOmitted=(run.detailBytesOmitted||0)+bytes;return summary();}
                contentBytes+=bytes;return clean;
            };
            const run = { schemaVersion:2, extensionVersion:'0.4.1', environment:environmentInfo(), ...redact(meta, secrets()), id: makeId(), started: new Date().toISOString(), status: 'running', detail:isDetailed?'full':'timing', events: [] };
            run.diagnosticBytes=JSON.stringify(run).length*2+512;
            const append=(stage,data)=>{
                if(run.events.length>=2000){const [removed]=run.events.splice(100,1);run.diagnosticBytes-=sizes.get(removed)||0;run.eventsOmitted=(run.eventsOmitted||0)+1;}
                const event={at:new Date().toISOString(),elapsedMs:Date.now()-Date.parse(run.started),stage,data:eventData(data)};
                const bytes=JSON.stringify(event).length*2+2;sizes.set(event,bytes);run.diagnosticBytes+=bytes;run.events.push(event);
            };
            persist(run);
            return {
                id: run.id,
                async event(stage, data = {}) {
                    append(stage,data);
                    persist(run);if(run.finished)await flush();
                },
                async finish(status, data = {}) {
                    run.status = status;run.finished = new Date().toISOString();
                    append('operation.end',data);persist(run);await flush();
                },
            };
        },
        async list(chatKey) {
            await flush();let saved = [];
            try { saved = await store.list(chatKey); } catch { if (!warned) warning('저장된 진단 기록을 읽지 못했어. 현재 창의 기록만 표시해.');warned=true; }
            return [...new Map([...saved, ...[...memory.values()].filter(r => r.chatKey === chatKey)].map(r => [r.id, r])).values()]
                .sort((a,b) => a.started.localeCompare(b.started));
        },
        async preview(chatKey) {
            // Do not flush or export full histories just to paint settings.
            let saved=[];
            try{saved=store.preview?await store.preview(chatKey):(await store.list(chatKey)).slice(-3).map(compactDiagnosticRun);}catch{warn();}
            const live=[...memory.values()].filter(r=>r.chatKey===chatKey).map(compactDiagnosticRun);
            return formatDiagnosticPreview([...new Map([...saved,...live].map(r=>[r.id,r])).values()]);
        },
        async export(chatKey, mode = 'all') {
            const runs = (await this.list(chatKey)).filter(r => mode === 'all' || r.mode === mode);
            const counts = Object.fromEntries(['dialogue','questions','embedding'].map(m => [m,runs.filter(r=>r.kind==='generation' && r.mode===m).length]));
            return 'ARCHIVE LORE · TURN DIAGNOSTICS\n' + JSON.stringify({ exported:new Date().toISOString(), chatKey, filter:mode, generationAttempts:counts, runs:runs.length },null,2)
                + '\n\nTiming/error diagnostics are the default. Dialogue/API/prompt bodies appear only in opt-in full traces; detailTruncated/detailBytesOmitted mark the 8 MiB per-run body limit; eventsOmitted marks the 2000-event limit. Secrets and provider reasoning are removed. HTTP status/headers are recorded only where the host exposes them; a profile snapshot is not proof of the final upstream URL. History keeps up to 20 recent runs for up to 3 days, with a byte limit. Installed prompts are not proof of the final host request or model compliance. Preview/collection/index operations are separate from RP generation attempts. No hidden model reasoning is requested.\n\n'
                + runs.map((run,i) => `===== ${i+1} · ${run.kind} · ${run.mode} · ${run.status} =====\n${JSON.stringify(redact(run,secrets()),null,2)}`).join('\n\n');
        },
    };
}
