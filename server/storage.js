// Archive Lore server © 2026 foreverharibo-boop — AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const hash = text => createHash('sha256').update(String(text)).digest('hex');
export function atomic(file,value) {
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    const temp=file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export function inside(root,...parts) {
    const base=fs.realpathSync(root), file=path.resolve(base,...parts);
    if(!file.startsWith(base+path.sep))throw Error('허용되지 않는 파일 경로야.');
    let parent=file;while(!fs.existsSync(parent))parent=path.dirname(parent);
    const real=fs.realpathSync(parent);if(real!==base&&!real.startsWith(base+path.sep))throw Error('외부 경로로 연결된 파일은 사용할 수 없어.');
    return file;
}
export function json(file,fallback) {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e;}}
export function privateStore(root,folder) {
    const dir=path.join(root,folder);fs.mkdirSync(dir,{recursive:true,mode:0o700});
    return {get:async key=>json(inside(dir,hash(key)+'.json'),null),put:async(key,value)=>atomic(inside(dir,hash(key)+'.json'),value)};
}
