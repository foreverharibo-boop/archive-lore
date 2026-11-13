import { diagnosticSummary } from './lore-retention.js';
// Archive Lore — AGPL-3.0-only
// Shared by browser and server. Never patch global fetch or other extensions.
const sensitive = /(?:api.?key|authorization|password|secret|embeddingKeys?|cacheKey|access.?token|refresh.?token|id.?token|^token$|cookie|credential|private.?key)/i;
export function redact(value, secrets = []) {
    const hidden = secrets.filter(s => typeof s === 'string' && s.length > 3);
    const clean = text => hidden.reduce((s, key) => s.split(key).join('[REDACTED]'), String(text))
        .replace(/((?:Bearer|Basic)\s+)[^\s"'<>]+/gi, '$1[REDACTED]')
        .replace(/([?&](?:key|api[_-]?key|(?:access_|refresh_|id_)?token|password|secret)=)[^&\s"']+/gi, '$1[REDACTED]')
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
        .replace(/(["']?(?:x-goog-api-key|api[_-]?key|authorization|password|proxy_password|access_token|refresh_token|secret|cookie)["']?\s*[:=]\s*["'])[^"']*/gi, '$1[REDACTED]')
        .replace(/AIza[\w-]{20,}|\bsk-[\w-]{16,}/g, '[REDACTED]');
    const ancestors = new Set();
    const walk = data => {
        if (typeof data === 'string') {
            // Also sanitize JSON embedded in error messages / HTTP response bodies.
            try { const parsed = JSON.parse(data); if (parsed && typeof parsed === 'object') return JSON.stringify(walk(parsed)); } catch {}
            return clean(data);
        }
        if (typeof data === 'bigint') return String(data);
        if (!data || typeof data !== 'object') return data;
        if (ancestors.has(data)) return '[Circular]';
        ancestors.add(data);
        let result;
        if (data instanceof Error) result = walk({ name:data.name, message:data.message, stack:data.stack, ...data, cause:data.cause });
        else if (data instanceof Set || Array.isArray(data)) result = [...data].map(walk);
        else result = Object.fromEntries(Object.entries(data).map(([key,item]) => [key,
            sensitive.test(key) ? '[REDACTED]' : /^(?:reasoning|reasoning_content|thoughtSignature)$/i.test(key) || (key === 'text' && data.thought === true) ? '[OMITTED]' : walk(item)]));
        ancestors.delete(data);
        return result;
    };
    return walk(value);
}
export function errorInfo(error, signal) {
    const category = signal?.aborted ? (signal.reason?.name === 'TimeoutError' ? 'timeout' : 'canceled')
        : error?.category || (error?.name === 'AbortError' ? 'canceled' : error?.name === 'TimeoutError' || error?.code === 'SERVER_TIMEOUT' ? 'timeout'
            : [401,403].includes(error?.status) ? 'authentication' : error?.status === 429 ? 'rate-limit' : error?.status >= 400 ? 'http' : 'unknown');
    return { category, name:error?.name, message:error?.message || String(error), code:error?.code, status:error?.status,
        stage:error?.stage, details:error?.details, stack:error?.stack, cause:error?.cause,
        aborted:!!signal?.aborted, abortReason:signal?.reason };
}
export function observer(sink, secrets = []) {
    // Diagnostics must not change success, failure or cancellation of real work.
    return async (stage, data) => { if (sink) { try { await sink(stage, diagnosticSummary(data,0,value=>redact(value,secrets))); } catch {} } };
}
export function environmentInfo() {
    return typeof window === 'undefined' ? { runtime:'server', node:globalThis.process?.version, platform:globalThis.process?.platform }
        : { runtime:'browser', userAgent:globalThis.navigator?.userAgent, online:globalThis.navigator?.onLine,
            visibility:globalThis.document?.visibilityState, secureContext:globalThis.isSecureContext, language:globalThis.navigator?.language };
}
