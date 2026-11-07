import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const script=new URL('./enable.mjs',import.meta.url);
test('installer backs up config, enables plugins idempotently and rejects a different application',()=>{
    const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'archive-lore-enable-'));
    try{
        fs.writeFileSync(path.join(cwd,'package.json'),JSON.stringify({name:'SillyTavern'}));
        const original='port: 8000\nenableServerPlugins: false # keep comment\n';
        fs.writeFileSync(path.join(cwd,'config.yaml'),original);
        const run=()=>execFileSync(process.execPath,[script.pathname],{cwd,stdio:'pipe'});
        run();run();
        assert.equal(fs.readFileSync(path.join(cwd,'config.yaml'),'utf8'),'port: 8000\nenableServerPlugins: true # keep comment\n');
        const backups=fs.readdirSync(cwd).filter(f=>f.endsWith('.bak'));assert.equal(backups.length,1);assert.equal(fs.readFileSync(path.join(cwd,backups[0]),'utf8'),original);
        fs.writeFileSync(path.join(cwd,'package.json'),JSON.stringify({name:'another-app'}));assert.throws(run);
    }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
