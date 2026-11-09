// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import { makeId } from './lore-api.js';
import { expiredHistory,DIAGNOSTIC_BYTES,diagnosticSummary } from './lore-retention.js';

export function redact(value, secrets = []) {
    const hidden = secrets.filter(s => typeof s === 'string' && s.length > 3);
    const clean = text => hidden.reduce((s, key) => s.split(key).join('[REDACTED]'), String(text))
        .replace(/(Bearer\s+)[^\s"'<>]+/gi, '$1[REDACTED]')
        .replace(/([?&](?:key|api_key|token)=)[^&\s"']+/gi, '$1[REDACTED]')
        .replace(/AIza[\w-]{20,}/g, '[REDACTED]');
    const walk = data => {
        if (typeof data === 'string') return clean(data);
        if (data instanceof Set) return [...data].map(walk);
        if (Array.isArray(data)) return data.map(walk);
        if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).map(([key, item]) =>
            [key, /(?:api.?key|authorization|password|secret|embeddingKey|embeddingKeys|cacheKey)/i.test(key) ? '[REDACTED]' : walk(item)]));
        return data;
    };
    return walk(value);
}
export function createDiagnosticStore(factory = indexedDB) {
    let opening;
    const db = () => opening ||= new Promise((resolve, reject) => {
        const request = factory.open('archive-lore-diagnostics', 2);let blocked=false;
        request.onupgradeneeded = event => {
            if(event.oldVersion<1)request.result.createObjectStore('runs', { keyPath: 'id' }).createIndex('chatKey', 'chatKey');
            else if(event.oldVersion<2)request.transaction.objectStore('runs').clear();
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
            const request=store.openCursor();
            request.onsuccess=()=>{
                const cursor=request.result;
                if(cursor){const r=cursor.value;rows.push({id:r.id,time:Date.parse(r.events?.at(-1)?.at||r.finished||r.started)||0,
                    bytes:r.diagnosticBytes||JSON.stringify(r).length*2,protected:r.id===protectedId});cursor.continue();}
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
    const memory = new Map();let queue = Promise.resolve(), warned = false;
    const persist = run => {
        // redact already builds a detached snapshot. Retain only unsaved data;
        // persisted runs remain available from the store after a reload/export.
        const snapshot = redact(run, secrets());memory.set(run.id, snapshot);
        for(const old of expiredHistory([...memory.values()].map(r=>({id:r.id,time:Date.parse(r.events.at(-1)?.at||r.started),bytes:r.diagnosticBytes||0,protected:r.id===run.id})),{maxBytes:DIAGNOSTIC_BYTES}))memory.delete(old.id);
        queue = queue.then(() => store.put(snapshot)).then(() => {
            if(memory.get(run.id)===snapshot)memory.delete(run.id);
        }).catch(() => {
            if (!warned) warning('진단 기록을 브라우저에 저장하지 못했어. 다른 실리 탭을 닫고 새로고침해 줘.');
            warned = true;
        });
        return queue;
    };
    return {
        begin(meta) {
            const isDetailed=!!detailed();let contentBytes=0;
            const eventData=data=>{
                const summary=()=>redact(diagnosticSummary(data),secrets());
                if(!isDetailed)return summary();
                const clean=redact(data,secrets()),bytes=JSON.stringify(clean).length*2;
                if(contentBytes+bytes>2*1024*1024){run.detailTruncated=true;return summary();}
                contentBytes+=bytes;return clean;
            };
            const run = { schemaVersion:1, extensionVersion:'0.4.1', ...redact(meta, secrets()), id: makeId(), started: new Date().toISOString(), status: 'running', detail:isDetailed?'full':'timing', events: [] };
            const append=(stage,data)=>{
                if(run.events.length>=500){run.events.splice(100,1);run.eventsOmitted=(run.eventsOmitted||0)+1;}
                run.events.push({at:new Date().toISOString(),elapsedMs:Date.now()-Date.parse(run.started),stage,data:eventData(data)});
                run.diagnosticBytes=JSON.stringify(run).length*2;
            };
            persist(run);
            return {
                id: run.id,
                async event(stage, data = {}) {
                    append(stage,data);
                    await persist(run);
                },
                async finish(status, data = {}) {
                    run.status = status;run.finished = new Date().toISOString();
                    append('operation.end',data);await persist(run);
                },
            };
        },
        async list(chatKey) {
            await queue;let saved = [];
            try { saved = await store.list(chatKey); } catch { if (!warned) warning('저장된 진단 기록을 읽지 못했어. 현재 창의 기록만 표시해.');warned=true; }
            return [...new Map([...saved, ...[...memory.values()].filter(r => r.chatKey === chatKey)].map(r => [r.id, r])).values()]
                .sort((a,b) => a.started.localeCompare(b.started));
        },
        async export(chatKey, mode = 'all') {
            const runs = (await this.list(chatKey)).filter(r => mode === 'all' || r.mode === mode);
            const counts = Object.fromEntries(['dialogue','questions','embedding'].map(m => [m,runs.filter(r=>r.kind==='generation' && r.mode===m).length]));
            return 'ARCHIVE LORE · TURN DIAGNOSTICS\n' + JSON.stringify({ exported:new Date().toISOString(), chatKey, filter:mode, generationAttempts:counts, runs:runs.length },null,2)
                + '\n\nTiming/error diagnostics are the default. Dialogue/API/prompt bodies appear only in opt-in full traces; detailTruncated marks the per-run size limit. History keeps up to 20 recent runs for up to 3 days, with a byte limit. Installed prompts are not proof of the final host request or model compliance. Preview/collection/index operations are separate from RP generation attempts. No hidden model reasoning is requested.\n\n'
                + runs.map((run,i) => `===== ${i+1} · ${run.kind} · ${run.mode} · ${run.status} =====\n${JSON.stringify(redact(run,secrets()),null,2)}`).join('\n\n');
        },
    };
}
