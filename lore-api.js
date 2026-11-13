// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import { embeddingIdentity } from './lore-vector-identity.js';
import { getSelectedConnectionProfile, prepareConnectionProfileRequest } from './connectionProfileRequest.js';
import { observer, errorInfo } from './lore-telemetry.js';

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
export function resolveConnection(context, profileId) {
    const selected = profileId || context.extensionSettings?.connectionManager?.selectedProfile;
    if (!selected) throw Object.assign(new Error('확장 설정에서 연결 프로필을 선택해 줘.'), {category:'profile',stage:'profile.resolve'});
    const isolated = { ...context, extensionSettings: { ...context.extensionSettings,
        connectionManager: { ...context.extensionSettings?.connectionManager, selectedProfile: selected } } };
    try { return getSelectedConnectionProfile(isolated); }
    catch(error) { error.category='profile';error.stage='profile.resolve';throw error; }
}
export function connectionInfo(context, profileId, connection) {
    return { requestedProfile:profileId || 'current', currentProfile:context.extensionSettings?.connectionManager?.selectedProfile,
        resolvedProfile:connection.profileId, name:connection.profile.name, source:connection.source,
        model:connection.profile.model, preset:connection.profile.preset, profile:connection.profile,
        transport:'SillyTavern.ConnectionManagerRequestService', endpoint:'/api/backends/chat-completions/generate',
        upstreamHttpMetadata:'not exposed by ConnectionManagerRequestService' };
}
export async function ask(context, profileId, system, data, signal, maxTokens = 4096, observe) {
    const log=observer(observe),started=Date.now();let combined=signal,stage='profile.resolve';
    try {
        await log('profile.requested',{requestedProfile:profileId || 'current',currentProfile:context.extensionSettings?.connectionManager?.selectedProfile});
        const connection = resolveConnection(context,profileId);
        await log('profile.resolved',connectionInfo(context,profileId,connection));
        const body = { model: connection.profile.model, temperature: .2, max_tokens: maxTokens, stream: false,
            messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(data) }] };
        const timeout = AbortSignal.timeout(180000);
        combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        stage='ai.transport';combined.throwIfAborted();
        await log('ai.transport.request',{body,timeoutMs:180000});
        const result=await prepareConnectionProfileRequest(connection, body, combined,prepared=>log('ai.transport.prepared',prepared))();
        await log('ai.transport.response',{response:result,elapsedMs:Date.now()-started});
        stage='ai.extract';combined.throwIfAborted();
        try { return completionText(result); }
        catch(error) { error.category='response-format';error.stage=stage;throw error; }
    } catch(error) { await log('ai.transport.error',{...errorInfo(error,combined),stage,elapsedMs:Date.now()-started});throw error; }
}
export function embeddingRequest(settings, text, query = false) {
    const key = (settings.embeddingKeys?.[settings.embeddingProvider] ?? settings.embeddingKey ?? '').trim();
    if (!key) throw new Error('확장 설정에 임베딩 API 키를 입력해 줘.');
    const model = String(settings.embeddingModel || '').replace(/^models\//, '').trim();
    if (!model) throw new Error('임베딩 모델을 입력해 줘.');
    if (settings.embeddingProvider === 'vertex') {
        const project = String(settings.embeddingVertexProjectId || '').trim();
        const location = String(settings.embeddingVertexRegion || 'global').trim() || 'global';
        if (!project) throw new Error('Vertex 임베딩에 사용할 Google Cloud 프로젝트 ID를 입력해 줘.');
        if (!/^[a-z0-9][a-z0-9-]*$/.test(project)) throw new Error('Google Cloud 프로젝트 ID 형식을 확인해 줘.');
        if (!/^[a-z0-9-]+$/.test(location)) throw new Error('Vertex 리전을 확인해 줘.');
        const url = new URL(`https://${location === 'global' ? '' : location + '-'}aiplatform.googleapis.com`);
        url.pathname = `/v1/projects/${encodeURIComponent(project)}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:predict`;
        return { url: url.href, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: { instances: [{ content: text, task_type: query ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' }],
                parameters: { autoTruncate: false, outputDimensionality: 768 } } };
    }
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
export async function embed(settings, text, query, signal, request = fetch, observe) {
    const log=observer(observe,[settings.embeddingKey,...Object.values(settings.embeddingKeys||{})]),started=Date.now();let combined=signal,stage='embedding.configure';
    try {
        const spec = embeddingRequest(settings, text, query);
        combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
        stage='embedding.transport';combined.throwIfAborted();
        await log('embedding.transport.request',{...spec,query,timeoutMs:60000});
        let response;
        try {
            response = await request(spec.url, { method: 'POST', headers: spec.headers, body: JSON.stringify(spec.body),
                signal: combined, credentials: 'omit', redirect: 'error' });
        } catch (error) {
            if (signal?.aborted) throw error;
            throw Object.assign(new Error(combined.aborted ? '임베딩 요청 시간이 초과됐어. 연결 확인 후 다시 시도해 줘.' : '임베딩 연결 실패: 네트워크 또는 브라우저 CORS 제한일 수 있어. 서버 플러그인을 연결해서 다시 시도해 줘.',{cause:error}),{category:combined.aborted?'timeout':'network'});
        }
        await log('embedding.transport.headers',{status:response.status,statusText:response.statusText,url:response.url || spec.url,
            headers:response.headers?.entries?Object.fromEntries(response.headers.entries()):undefined,elapsedMs:Date.now()-started});
        if (!response.ok) {
            const details = typeof response.text === 'function' ? await response.text() : '';
            await log('embedding.transport.response',{status:response.status,response:details});
            let message;try{const parsed=JSON.parse(details);message=parsed.error?.message || parsed.message;}catch{}
            const key=settings.embeddingKeys?.[settings.embeddingProvider] || settings.embeddingKey;
            message=String(message || '키·모델·사용 한도를 확인해 줘.').split(key || '__no_key__').join('[REDACTED]').slice(0,600);
            throw Object.assign(new Error(`임베딩 API 오류 (${response.status}): ${message}`), { details:message,status:response.status });
        }
        stage='embedding.decode';
        let data;
        if(typeof response.text==='function') {
            const raw=await response.text();
            try { data=JSON.parse(raw); }
            catch(error) { await log('embedding.transport.response',{response:raw});error.category='response-format';throw error; }
        } else data=await response.json();
        await log('embedding.transport.response',{response:data,elapsedMs:Date.now()-started});
        combined.throwIfAborted();stage='embedding.validate';
        const vector = settings.embeddingProvider === 'vertex' ? data?.predictions?.[0]?.embeddings?.values
            : settings.embeddingProvider === 'gemini' ? data?.embedding?.values : data?.data?.[0]?.embedding;
        if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite) || vector.every(x => x === 0))
            throw Object.assign(new Error('임베딩 API가 유효한 벡터를 반환하지 않았어.'),{category:'response-format'});
        return vector;
    } catch(error) { await log('embedding.transport.error',{...errorInfo(error,combined),stage,elapsedMs:Date.now()-started});throw error; }
}
export async function embeddingKey(settings, id, chunk) {
    return 'embedding-v2:' + JSON.stringify([settings.cacheNamespace, settings.embeddingProvider,
        settings.embeddingProvider === 'openai' ? settings.embeddingUrl : settings.embeddingProvider === 'vertex' ? JSON.stringify([String(settings.embeddingVertexProjectId || '').trim(), String(settings.embeddingVertexRegion || 'global').trim() || 'global', 768]) : '', settings.embeddingModel, id, chunk]);
}
export function createVectorStore(factory = indexedDB) {
    let opening,identityIndex;
    const database = () => opening ||= new Promise((resolve, reject) => {
        const req = factory.open('archive-lore-v1', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('vectors');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { opening = null; reject(new Error('임베딩 저장소를 열 수 없어. 브라우저 저장 공간을 확인해 줘.')); };
    });
    async function presentKeys(keys) {
        if(!keys.length)return [];
        const db=await database();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction('vectors'),store=tx.objectStore('vectors'),found=new Array(keys.length);
            keys.forEach((key,index)=>{const req=store.getKey(key);req.onsuccess=()=>{found[index]=req.result!==undefined;};});
            tx.oncomplete=()=>resolve(found);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('임베딩 개수 조회가 중단되었습니다.'));
        });
    }
    async function identities() {
        if(identityIndex)return identityIndex;
        identityIndex=(async()=>{
            const db=await database();
            return new Promise((resolve,reject)=>{
                const index=new Map(),tx=db.transaction('vectors');
                const req=tx.objectStore('vectors').openKeyCursor();
                req.onsuccess=()=>{const cursor=req.result;if(!cursor)return;const identity=embeddingIdentity(cursor.key);if(identity&&!index.has(identity))index.set(identity,cursor.key);cursor.continue();};
                tx.oncomplete=()=>resolve(index);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('임베딩 연결 조회가 중단되었습니다.'));
            });
        })().catch(error=>{identityIndex=null;throw error;});
        return identityIndex;
    }
    async function matchingKey(key) {
        const identity=embeddingIdentity(key);return identity?(await identities()).get(identity):undefined;
    }
    return {
        async hasMany(keys) {
            const found=await presentKeys(keys),missing=[];
            keys.forEach((key,index)=>{if(!found[index]&&key.startsWith('embedding-v2:'))missing.push({key,index});});
            // Legacy keys still count, without loading their vector arrays or writing them back.
            const aliases=await Promise.all(missing.map(async({key})=>{const raw=key.slice(13);return [await digest(raw),'exact-v1:'+raw];}));
            const old=await presentKeys(aliases.flat());
            missing.forEach(({index},i)=>{found[index]=old[i*2]||old[i*2+1];});
            const reusable=missing.filter(({index,key})=>!found[index]&&embeddingIdentity(key));
            if(reusable.length){const index=await identities();for(const item of reusable)found[item.index]=index.has(embeddingIdentity(item.key));}
            return found;
        },
        async get(key) {
            const db = await database();
            return new Promise((resolve, reject) => {
                const req = db.transaction('vectors').objectStore('vectors').get(key);
                req.onsuccess = async () => {
                    if(req.result || !key.startsWith('embedding-v2:')){resolve(req.result);return;}
                    try{const raw=key.slice(13),oldKeys=[await digest(raw),'exact-v1:'+raw];let found;
                        for(const old of oldKeys){found=await new Promise((ok,bad)=>{const r=db.transaction('vectors').objectStore('vectors').get(old);r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error);});if(found)break;}
                        if(!found){const match=await matchingKey(key);if(match)found=await new Promise((ok,bad)=>{const r=db.transaction('vectors').objectStore('vectors').get(match);r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error);});}
                        resolve(found);
                    }catch(error){reject(error);}
                }; req.onerror = () => reject(req.error);
            });
        },
        async put(key, value) {
            const db = await database();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('vectors', 'readwrite'); tx.objectStore('vectors').put(value, key);
                tx.oncomplete = () => {if(identityIndex){const identity=embeddingIdentity(key);if(identity)void identityIndex.then(index=>index.set(identity,key)).catch(()=>{});}resolve();}; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('임베딩 저장 취소'));
            });
        },
    };
}
