// Archive Lore server — AGPL-3.0-only
import fs from 'node:fs';
import {inside} from './storage.js';
import {expiredHistory,DIAGNOSTIC_BYTES,JOB_BYTES} from '../lore-retention.js';
export function pruneDiagnostics(root,protectedFile) {
    const dir=inside(root,'diagnostics');if(!fs.existsSync(dir))return;
    const rows=fs.readdirSync(dir).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>{
        const file=inside(dir,name),stat=fs.statSync(file);return {file,time:stat.mtimeMs,bytes:stat.size,protected:file===protectedFile};
    });
    for(const row of expiredHistory(rows,{maxBytes:DIAGNOSTIC_BYTES}))fs.unlinkSync(row.file);
}
function directoryBytes(dir) {
    if(!fs.existsSync(dir))return 0;
    return fs.readdirSync(dir,{withFileTypes:true}).reduce((bytes,e)=>{
        if(e.isSymbolicLink())return bytes;
        const file=inside(dir,e.name);return bytes+(e.isDirectory()?directoryBytes(file):fs.statSync(file).size);
    },0);
}
export function pruneJobs(s,protectId) {
    const rows=[...s.jobs.values()].map(job=>{
        const file=inside(s.jobsDir,job.id+'.json'),backup=inside(s.root,'backups',job.id);
        const stat=fs.existsSync(file)?fs.statSync(file):null;
        return {id:job.id,file,backup,time:Date.parse(job.finished||job.created||job.started)||stat?.mtimeMs||Date.now(),
            bytes:(stat?.size||0)+directoryBytes(backup),protected:job.id===protectId||['queued','running'].includes(job.status)};
    });
    for(const row of expiredHistory(rows,{maxBytes:JOB_BYTES})) {
        if(fs.existsSync(row.file))fs.unlinkSync(row.file);
        if(fs.existsSync(row.backup))fs.rmSync(row.backup,{recursive:true});
        s.jobs.delete(row.id);
    }
}
