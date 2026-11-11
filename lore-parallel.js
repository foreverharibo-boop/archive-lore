// SPDX-License-Identifier: AGPL-3.0-only
// Bounded concurrency; retain input order even when later batches finish first.
// Drain canceled workers before the caller releases its trace/timing state.
export async function mapOrdered(items, concurrency, work, signal) {
    const abort = new AbortController(), results = new Array(items.length);
    const stop = () => abort.abort(signal.reason);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    let next = 0, failure;
    async function worker() {
        while (!abort.signal.aborted) {
            const index = next++;
            if (index >= items.length) return;
            try { results[index] = await work(items[index], index, abort.signal); }
            catch (error) { failure ||= error; abort.abort(error); return; }
        }
    }
    try {
        await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, Math.min(2, Number(concurrency)||1))) }, worker));
        if (failure) throw failure;
        abort.signal.throwIfAborted();
        return results;
    } finally { signal?.removeEventListener('abort', stop); }
}
