// Archive Lore server © 2026 foreverharibo-boop — AGPL-3.0-only
import fs from 'node:fs';
import { inside } from './storage.js';

// Diagnostic files are compact JSON written atomically by privateStore. All
// identity fields precede events; never parse the potentially huge event body
// merely to list/filter runs. Escaped quotes inside strings cannot match this
// literal property delimiter.
export async function diagnosticFiles(root,chatKey,mode='all') {
    if(typeof chatKey!=='string'||!chatKey) return [];
    const dir=inside(root,'diagnostics');
    if(!fs.existsSync(dir))return [];
    const rows=[];
    for(const name of await fs.promises.readdir(dir)) {
        if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
        const file=inside(dir,name),handle=await fs.promises.open(file,'r');
        let header;
        try {
            const buffer=Buffer.alloc(65536);
            const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
            const prefix=buffer.toString('utf8',0,bytesRead),end=prefix.indexOf(',"events":[');
            if(end<0)throw Error('진단 기록의 머리말을 읽지 못했어. 파일: '+name);
            header=JSON.parse(prefix.slice(0,end)+'}');
        } finally {await handle.close();}
        if(header.chatKey===chatKey&&(mode==='all'||header.mode===mode))rows.push({file,header});
    }
    return rows.sort((a,b)=>a.header.started.localeCompare(b.header.started));
}

export async function* diagnosticStream(rows) {
    yield '[\n';
    for(let i=0;i<rows.length;i++) {
        if(i)yield ',\n';
        // Backpressure and iterator cancellation keep at most a file chunk in
        // memory and close the current file when the HTTP client disconnects.
        const stream=fs.createReadStream(rows[i].file,{highWaterMark:65536});
        try {for await(const chunk of stream)yield chunk;} finally {stream.destroy();}
    }
    yield '\n]';
}
