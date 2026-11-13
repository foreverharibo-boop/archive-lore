// Archive Lore — AGPL-3.0-only
export const HISTORY_AGE_MS=3*24*60*60*1000;
export const HISTORY_COUNT=20;
export const DIAGNOSTIC_EVENT_LIMIT=10;
export const DIAGNOSTIC_BYTES=20*1024*1024;
export const JOB_BYTES=100*1024*1024;
// Active work is protected. Other rows are newest-first within age/count/bytes.
export function expiredHistory(rows,{now=Date.now(),maxAge=HISTORY_AGE_MS,maxCount=HISTORY_COUNT,maxBytes=Infinity}={}) {
    let count=rows.filter(r=>r.protected).length,bytes=rows.filter(r=>r.protected).reduce((n,r)=>n+r.bytes,0);
    return [...rows].sort((a,b)=>b.time-a.time).filter(row=>{
        if(row.protected)return false;
        if(now-row.time>maxAge||count>=maxCount||bytes+row.bytes>maxBytes)return true;
        count++;bytes+=row.bytes;return false;
    });
}
// Only diagnostic metadata is allowed into a log. Never traverse dialogue,
// prompt, memory, vector or successful response bodies.
export function diagnosticSummary(data, _depth=0, sanitize=value=>value) {
    const result={};let budget=1800,fields=0;
    const names=new Set(['message','reason','mode','status','statusText','kind','stage','id','model','source','category','name','code','requestId','phase','resolvedProfile','requestedProfile','currentProfile','transport','endpoint','url','route','method','runtime','preset','finish_reason','finishReason','blockReason','error_description','type','elapsedMs','timeoutMs','aborted','formatValid','connected','query','dimensions','max_tokens','max_completion_tokens','totalTokenCount','promptTokenCount','candidatesTokenCount','total_tokens','prompt_tokens','completion_tokens','x-request-id','x-goog-request-id','retry-after','profile','searchProfile','serverObservedAt','eventId','responseType','custom_url','reverse_proxy','api-url','vertexai_region','stack']);
    const containers=new Set(['error','details','cause','abortReason','profile','body','payload','template','overrides','headers','response','usageMetadata','usage','data']);
    const put=(key,value)=>{
        if(fields>=24||budget<40)return;
        if(typeof value==='string')value=String(sanitize(value)).slice(0,Math.min(key.endsWith('message')?600:240,budget-40));
        else if(typeof value!=='number'&&typeof value!=='boolean'&&value!==null)return;
        let cost=JSON.stringify({[key]:value}).length;
        while(cost>budget&&typeof value==='string'&&value.length){value=value.slice(0,Math.floor(value.length/2));cost=JSON.stringify({[key]:value}).length;}
        if(cost>budget)return;result[key]=value;fields++;budget-=cost;
    };
    const visit=(value,path='',depth=0)=>{
        if(!value||typeof value!=='object'||depth>3||Array.isArray(value))return;
        // Iterate the allowlist, not all input fields or large arrays.
        for(const key of names){const item=value[key];if(item===undefined||typeof item==='object'&&item!==null)continue;put(path+key,item);}
        for(const key of ['choices','candidates']){const item=value[key]?.[0];if(item)for(const field of ['finish_reason','finishReason'])if(item[field]!==undefined)put(path+field,item[field]);}
        let inspected=0;
        for(const key in value){if(++inspected>64)break;if(!Object.hasOwn(value,key)||!key.includes('.'))continue;
            const parts=key.split('.');if(parts.length<=5&&names.has(parts.at(-1))&&parts.slice(0,-1).every(part=>containers.has(part)))put(path+key,value[key]);
        }
        for(const key of containers){const item=value[key];
            if(item&&typeof item==='object'&&!Array.isArray(item))visit(item,path+key+'.',depth+1);
            else if(key==='response'&&typeof item==='string'){
                // Small provider error envelopes only; text/HTML/chat replies are not retained.
                if(item.length<=16384){try{const parsed=JSON.parse(item);if(parsed?.error)visit(parsed.error,path+'error.',depth+1);}catch{}}
                put(path+'responseType',/^\s*</.test(item)?'html':'text');
            }
        }
    };
    visit(data);
    return result;
}
