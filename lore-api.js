// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import { getSelectedConnectionProfile, prepareConnectionProfileRequest } from './connectionProfileRequest.js';

export function makeId() {
    const values = crypto.getRandomValues(new Uint8Array(16));
    values[6] = (values[6] & 15) | 64; values[8] = (values[8] & 63) | 128;
    return [...values].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function digest(value) {
    // SillyTavern may run over plain HTTP on a home LAN. SubtleCrypto is
    // unavailable there; an exact, namespaced string key stays collision-free.
    if (!crypto.subtle) return `exact-v1:${String(value)}`;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function completionText(result) {
    const finish = result?.choices?.[0]?.finish_reason || result?.candidates?.[0]?.finishReason;
    if (['length', 'MAX_TOKENS'].includes(finish)) throw new Error('AI 응답이 출력 한도에서 잘렸어. 범위를 줄여서 다시 수집해 줘.');
    if (typeof result === 'string') return result;
    const text = result?.choices?.[0]?.message?.content ?? result?.content ?? result?.text
        ?? result?.candidates?.[0]?.content?.parts?.filter(x => !x.thought).map(x => x.text || '').join('');
    if (typeof text === 'string' && text.trim()) return text;
    if (Array.isArray(text)) {
        const joined = text.filter(x => x.type === 'text').map(x => x.text || '').join('');
        if (joined.trim()) return joined;
    }
    throw new Error('AI가 사용할 수 있는 응답을 반환하지 않았어.');
}
export async function ask(context, profileId, system, data, signal, maxTokens = 4096) {
    const selected = profileId || context.extensionSettings?.connectionManager?.selectedProfile;
    if (!selected) throw new Error('확장 설정에서 연결 프로필을 선택해 줘.');
    const isolated = { ...context, extensionSettings: { ...context.extensionSettings,
        connectionManager: { ...context.extensionSettings?.connectionManager, selectedProfile: selected } } };
    const connection = getSelectedConnectionProfile(isolated);
    const body = { model: connection.profile.model, temperature: .2, max_tokens: maxTokens, stream: false,
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(data) }] };
    const timeout = AbortSignal.timeout(180000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    return completionText(await prepareConnectionProfileRequest(connection, body, combined)());
}
export function embeddingRequest(settings, text, query = false) {
    const key = (settings.embeddingKeys?.[settings.embeddingProvider] ?? settings.embeddingKey ?? '').trim();
    if (!key) throw new Error('확장 설정에 임베딩 API 키를 입력해 줘.');
    const model = String(settings.embeddingModel || '').replace(/^models\//, '').trim();
    if (!model) throw new Error('임베딩 모델을 입력해 줘.');
    if (settings.embeddingProvider === 'vertex') return {
        url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:predict`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: { instances: [{ content: text, task_type: query ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' }], parameters: { autoTruncate: false } },
    };
    if (settings.embeddingProvider === 'gemini') return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: { model: `models/${model}`, content: { parts: [{ text }] }, taskType: query ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' },
    };
    let base;
    try { base = new URL(settings.embeddingUrl); } catch { throw new Error('임베딩 API 주소를 확인해 줘.'); }
    if (base.username || base.password || base.search || base.hash
        || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))))
        throw new Error('임베딩 주소는 HTTPS 또는 로컬 서버 주소로 입력해 줘.');
    return { url: `${base.href.replace(/\/$/, '').replace(/\/embeddings$/, '')}/embeddings`,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: { model, input: text, encoding_format: 'float' } };
}
export async function embed(settings, text, query, signal, request = fetch) {
    const spec = embeddingRequest(settings, text, query);
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
    let response;
    try {
        response = await request(spec.url, { method: 'POST', headers: spec.headers, body: JSON.stringify(spec.body),
            signal: combined, credentials: 'omit', redirect: 'error' });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error('임베딩 연결 실패: API 주소·네트워크·브라우저 CORS 지원을 확인해 줘.');
    }
    if (!response.ok) {
        const details = typeof response.text === 'function' ? await response.text() : '';
        throw Object.assign(new Error(`임베딩 API 오류 (${response.status}). 키·모델·사용 한도를 확인해 줘.`), { details });
    }
    const data = await response.json();
    const vector = settings.embeddingProvider === 'vertex' ? data?.predictions?.[0]?.embeddings?.values
        : settings.embeddingProvider === 'gemini' ? data?.embedding?.values : data?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite) || vector.every(x => x === 0))
        throw new Error('임베딩 API가 유효한 벡터를 반환하지 않았어.');
    return vector;
}
export async function embeddingKey(settings, id, chunk) {
    return digest(JSON.stringify([settings.cacheNamespace, settings.embeddingProvider,
        settings.embeddingProvider === 'openai' ? settings.embeddingUrl : '', settings.embeddingModel, id, chunk]));
}
export function createVectorStore(factory = indexedDB) {
    let opening;
    const database = () => opening ||= new Promise((resolve, reject) => {
        const req = factory.open('archive-lore-v1', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('vectors');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { opening = null; reject(new Error('임베딩 저장소를 열 수 없어. 브라우저 저장 공간을 확인해 줘.')); };
    });
    return {
        async get(key) {
            const db = await database();
            return new Promise((resolve, reject) => {
                const req = db.transaction('vectors').objectStore('vectors').get(key);
                req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
            });
        },
        async put(key, value) {
            const db = await database();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('vectors', 'readwrite'); tx.objectStore('vectors').put(value, key);
                tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('임베딩 저장 취소'));
            });
        },
    };
}
