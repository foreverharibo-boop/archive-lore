// Archive Lore — AGPL-3.0-only
export const HISTORY_AGE_MS=3*24*60*60*1000;
export const HISTORY_COUNT=20;
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
export function diagnosticSummary(data,depth=0) {
    if(!data||typeof data!=='object'||depth>4)return {};
    const result={};
    const strings=new Set(['message','reason','mode','status','kind','stage','id','model','source','serverStarted','serverFinished','visibility','wakeReason']);
    for(const [key,value] of Object.entries(data)) {
        if(typeof value==='number'||typeof value==='boolean'||value===null)result[key]=value;
        else if(typeof value==='string'){
            if(strings.has(key))result[key]=value.slice(0,600);
            else result[key+'Chars']=value.length;
        }else if(Array.isArray(value))result[key+'Count']=value.length;
        else if(value&&typeof value==='object')result[key]=diagnosticSummary(value,depth+1);
    }
    return result;
}
