// SPDX-License-Identifier: AGPL-3.0-only
// Stop waiting even if a provider ignores abort; its late result is discarded.
export function withAbort(work, signal) {
    if (!signal) return Promise.resolve().then(work);
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const stopped = () => reject(signal.reason);
        signal.addEventListener('abort', stopped, { once: true });
        Promise.resolve().then(() => { signal.throwIfAborted(); return work(); })
            .then(value => { signal.throwIfAborted(); resolve(value); })
            .catch(reject).finally(() => signal.removeEventListener('abort', stopped));
    });
}
