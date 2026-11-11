// Archive Lore — AGPL-3.0-only
// A browser can suspend JS in the background. Once it resumes, wake a pending
// poll immediately instead of relying only on a throttled timeout.
export function waitForServerPoll(ms,signal,doc=globalThis.document,win=globalThis.window) {
    signal?.throwIfAborted();
    return new Promise((resolve,reject)=>{
        let timer;
        const cleanup=()=>{clearTimeout(timer);doc?.removeEventListener('visibilitychange',visible);for(const name of ['focus','pageshow','online'])win?.removeEventListener(name,wake);signal?.removeEventListener('abort',abort);};
        const finish=reason=>{cleanup();resolve({wakeReason:reason,visibility:doc?.visibilityState||'unknown'});};
        const visible=()=>{if(doc.visibilityState==='visible')finish('visible');};
        const wake=()=>finish('foreground');
        const abort=()=>{cleanup();reject(signal.reason);};
        doc?.addEventListener('visibilitychange',visible);
        for(const name of ['focus','pageshow','online'])win?.addEventListener(name,wake);
        signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>finish('timer'),ms);
    });
}
