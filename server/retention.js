// Archive Lore server — AGPL-3.0-only
import fs from 'node:fs';
import {inside,atomic} from './storage.js';
import {expiredHistory,DIAGNOSTIC_BYTES,JOB_BYTES} from '../lore-retention.js';
export const LEGACY_HISTORY_RESET='legacy-history-reset-v1.json';
// Run before this process accepts any work for the user. No job/diagnostic body
// is parsed, and the completion marker is written only after all three owned
// history directories have been emptied. A failed reset is safely retried.
export function resetLegacyHistory(root) {
    const marker=inside(root,LEGACY_HISTORY_RESET);
    if(fs.existsSync(marker))return false;
    for(const name of ['diagnostics','jobs','backups']) {
        const dir=inside(root,name);
        if(!fs.existsSync(dir))continue;
        if(fs.lstatSync(dir).isSymbolicLink()||!fs.statSync(dir).isDirectory())throw Error('이전 기록 폴더가 일반 폴더가 아니어서 정리를 중지했어: '+name);
        for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
            // Do not resolve child symlinks: unlink the link itself, never its target.
            const file=dir+'/'+entry.name;
            fs.rmSync(file,{recursive:entry.isDirectory()&&!entry.isSymbolicLink(),force:true});
        }
    }
    atomic(marker,{version:1,completed:new Date().toISOString()});
    return true;
}
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

// Only obsolete debug files are removed. Jobs, backups and vector data are not touched.
export function clearLegacyDiagnostics(root) {
    const dir=fs.realpathSync(root)+'/diagnostics';
    if(fs.existsSync(dir)||(()=>{try{return fs.lstatSync(dir).isSymbolicLink();}catch{return false;}})())fs.rmSync(dir,{recursive:true,force:true});
}
