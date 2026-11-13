// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import { excludedSidePromptKeys, entrySearchAllowed, normalizeSideSearchExclusions, sideSearchControl } from './lore-side-search.js';

test('only explicit opt-out excludes a stable template key, independently of generation and titles',()=>{
    const templates=[{key:'private',enabled:true,settings:{archiveLoreSearchEnabled:false}},{key:'public'},{key:'disabled',enabled:false,settings:{archiveLoreSearchEnabled:false}}];
    const keys=excludedSidePromptKeys(templates);assert.deepEqual(keys,['disabled','private']);
    for(const field of ['STMB_sidePromptHistory','STMB_sidePromptRegeneration'])for(const title of ['Old name','Renamed','NPC 1','NPC 2']){
        assert.equal(entrySearchAllowed({comment:title,[field]:{templateKey:'private'}},keys),false);
        assert.equal(entrySearchAllowed({comment:title,[field]:{templateKey:'public'}},keys),true);
    }
    assert(entrySearchAllowed({comment:'private'},keys),'ordinary lore is never matched by title');
    assert.deepEqual(normalizeSideSearchExclusions(['private',null,3,'private','']),['private']);
    globalThis.archiveLoreFork=true;
    assert.match(sideSearchControl('stmb-sp-new'),/checked/);
    assert.doesNotMatch(sideSearchControl('stmb-sp-edit',{archiveLoreSearchEnabled:false}),/checked/);
    delete globalThis.archiveLoreFork;assert.equal(sideSearchControl('stmb-sp-new'),'');
});

test('actual template storage preserves opt-out on save, rename, reload, import and generation-enable changes',async()=>{
    const built=await build({entryPoints:[new URL('./sidePromptsManager.js',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node',plugins:[{name:'host-stubs',setup(b){
        b.onResolve({filter:/^\.\.\//},args=>({path:args.path,namespace:'host'}));
        b.onLoad({filter:/.*/,namespace:'host'},()=>({contents:'export const getRequestHeaders=()=>({}),translate=s=>s,t=(s)=>s[0],substituteParamsExtended=s=>s;'}));
    }}]});
    let saved=null,fail=false,clears=0;
    const sandbox={module:{exports:{}},exports:{},console:{log(){},warn(){}},structuredClone,btoa,unescape,encodeURIComponent,
        archiveLoreFork:true,archiveLoreSearch:{clearPrompts(){clears++;},controller:{clearRecall(){}}},
        fetch:async(url,options)=>{
            if(options.method==='GET')return {ok:!!saved,text:async()=>saved};
            if(fail)return {ok:false,status:500,statusText:'failure'};
            saved=Buffer.from(JSON.parse(options.body).data,'base64').toString('utf8');return {ok:true};
        }};
    vm.runInNewContext(built.outputFiles[0].text,sandbox);const m=sandbox.module.exports;
    const key=await m.upsertTemplate({name:'Reading only',enabled:true,prompt:'Keep notes',responseFormat:'Text',triggers:{onAfterMemory:{enabled:true}},settings:{archiveLoreSearchEnabled:false}});
    assert(m.getSideSearchExclusions().includes(key));assert(clears>0);
    await m.upsertTemplate({key,name:'Renamed'});await m.upsertTemplate({key,enabled:false});
    assert.equal((await m.getTemplate(key)).settings.archiveLoreSearchEnabled,false);
    assert.equal((await m.getTemplate(key)).triggers.onAfterMemory.enabled,true);
    m.clearCache();await m.loadSidePrompts();assert(m.getSideSearchExclusions().includes(key));
    const exported=await m.exportToJSON();await m.importFromJSON(exported);
    const copies=(await m.listTemplates()).filter(t=>t.name.startsWith('Renamed'));
    assert(copies.length>=2);assert(copies.every(t=>t.settings.archiveLoreSearchEnabled===false));
    fail=true;await assert.rejects(m.upsertTemplate({key,settings:{archiveLoreSearchEnabled:true}}));
    assert(m.getSideSearchExclusions().includes(key),'failed save cannot publish a changed search preference');
    fail=false;await m.upsertTemplate({key,settings:{archiveLoreSearchEnabled:true}});
    assert(!m.getSideSearchExclusions().includes(key));
    const source=fs.readFileSync(new URL('./sidePromptsPopup.js',import.meta.url),'utf8');
    for(const kind of ['edit','new'])assert(source.includes(`settings.archiveLoreSearchEnabled = dlg.querySelector('#stmb-sp-${kind}-archive-search')?.checked !== false`));
});
