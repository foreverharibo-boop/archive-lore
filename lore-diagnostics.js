// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import { makeId } from './lore-api.js';

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
        const request = factory.open('archive-lore-diagnostics', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('runs', { keyPath: 'id' }).createIndex('chatKey', 'chatKey');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { opening = null; reject(request.error); };
    });
    return {
        async put(run) {
            const database = await db();
            await new Promise((resolve, reject) => {
                const tx = database.transaction('runs', 'readwrite');tx.objectStore('runs').put(run);
                tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
            });
        },
        async list(chatKey) {
            const database = await db();
            return new Promise((resolve, reject) => {
                const request = database.transaction('runs').objectStore('runs').index('chatKey').getAll(chatKey);
                request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
            });
        },
    };
}
export function createDiagnostics({ store, secrets = () => [], warning = () => {} }) {
    const memory = new Map();let queue = Promise.resolve(), warned = false;
    const persist = run => {
        const snapshot = redact(structuredClone(run), secrets());memory.set(run.id, snapshot);
        queue = queue.then(() => store.put(snapshot)).catch(() => {
            if (!warned) warning('진단 기록을 브라우저에 저장하지 못했어. 창을 닫기 전에 TXT로 내려받아 줘.');
            warned = true;
        });
        return queue;
    };
    return {
        begin(meta) {
            const run = { schemaVersion:1, extensionVersion:'0.1.2', ...redact(meta, secrets()), id: makeId(), started: new Date().toISOString(), status: 'running', events: [] };
            persist(run);
            return {
                id: run.id,
                async event(stage, data = {}) {
                    run.events.push({ at: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(run.started), stage, data: redact(data, secrets()) });
                    await persist(run);
                },
                async finish(status, data = {}) {
                    run.status = status;run.finished = new Date().toISOString();
                    run.events.push({ at:run.finished, elapsedMs:Date.now()-Date.parse(run.started), stage:'operation.end', data:redact(data,secrets()) });await persist(run);
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
            const counts = Object.fromEntries(['dialogue','questions'].map(m => [m,runs.filter(r=>r.kind==='generation' && r.mode===m).length]));
            return 'ARCHIVE LORE · TURN DIAGNOSTICS\n' + JSON.stringify({ exported:new Date().toISOString(), chatKey, filter:mode, generationAttempts:counts, runs:runs.length },null,2)
                + '\n\nIncludes dialogue, API text responses and installed Archive Lore prompts. Installed prompts are not proof of the final host request or model compliance. Preview/collection/index operations are separate from RP generation attempts. No hidden model reasoning is requested.\n\n'
                + runs.map((run,i) => `===== ${i+1} · ${run.kind} · ${run.mode} · ${run.status} =====\n${JSON.stringify(redact(run,secrets()),null,2)}`).join('\n\n');
        },
    };
}
