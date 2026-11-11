// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildSidePromptHistoryRequest,resolveSidePromptHistory,validateSidePromptHistoryRequest,
    formatSidePromptVersionTitle,SIDE_PROMPT_HISTORY_KEY} from './sidePromptHistory.js';
import {fingerprintRollbackEntry} from './memoryRollback.js';
import {buildSidePromptRegenerationSnapshot} from './memoryRegeneration.js';

const src=fs.readFileSync(new URL('./addlore.js',import.meta.url),'utf8');
function extract(name) {const a=src.search(new RegExp('(?:export )?(?:async )?function '+name+'\\('));return src.slice(a,src.indexOf('\n}',a)+2).replace(/^export /,'');}
function harness() {
    const state={disk:{entries:{}},cache:new Map(),writes:0,notifications:0,progress:0,fail:false};
    const scope={structuredClone,console:{warn(){},error(){}},Date,archiveLoreFork:true,
        SIDE_PROMPT_HISTORY_KEY,resolveSidePromptHistory,validateSidePromptHistoryRequest,formatSidePromptVersionTitle,fingerprintRollbackEntry,
        getRequestHeaders:()=>({}),worldInfoCache:state.cache,eventSource:{emit:async()=>{}},event_types:{WORLDINFO_UPDATED:'update'},
        fetch:async(_url,options)=>{state.writes++;if(state.fail)return {ok:false,status:500,statusText:'failed'};state.disk=JSON.parse(options.body).data;return {ok:true};},
        createWorldInfoEntry:(_name,data)=>{const uid=Math.max(-1,...Object.keys(data.entries).map(Number))+1;return data.entries[uid]={uid};},
        getEntryByTitle:(data,title)=>Object.values(data.entries).find(e=>e.comment===title),
        extension_settings:{STMemoryBooks:{moduleSettings:{refreshEditor:false}}},i18n:(_key,fallback)=>fallback,
        generateEntryTitle:()=> 'Story',sanitizeTitle:s=>s,populateLorebookEntry:(e,m,title)=>Object.assign(e,{content:m.content,comment:title,stmemorybooks:true}),
        isCharacterAwarenessDisabled:()=>false,updateHighestMemoryProcessed:()=>state.progress++,
        toastr:{success:()=>state.notifications++,error(){}},getAutoHideRanges:()=>({mode:'none'}),reloadEditor:async()=>{},MODULE_NAME:'test'};
    vm.createContext(scope);vm.runInContext(['saveSidePromptLorebookChecked','applySidePromptHistory','upsertLorebookEntryByTitle','upsertLorebookEntriesBatch','addMemoryToLorebook'].map(extract).join('\n'),scope);
    return {state,scope};
}
const template={key:'relationship',name:'Relationship',settings:{}};
const history=(tpl=template)=>buildSidePromptHistoryRequest(tpl,{}, {chatId:'chat',chatRef:{type:'character',avatarUrl:'avatar',fileName:'chat'}},tpl.name,[tpl.name+' (STMB SidePrompt)']);
const factory=({entry,priorEntry})=>({STMB_sidePromptRegeneration:buildSidePromptRegenerationSnapshot({templateKey:template.key,priorEntry,writtenEntry:entry,compiledScene:{metadata:{chatId:'chat',sceneStart:0,sceneEnd:1}}})});
test('actual overwrite saves a stable identity, reuses UID after rename, and preserves the story entry',async()=>{
    const {state,scope}=harness();state.disk.entries[0]={uid:0,comment:'Story',content:'Narrative',stmemorybooks:true};
    const save=async(tpl,text)=>scope.upsertLorebookEntryByTitle('book',structuredClone(state.disk),tpl.name+' (STMB SidePrompt)',text,{sidePromptHistory:history(tpl),metadataFactory:factory,refreshEditor:false});
    await save(template,'old');const entry=state.disk.entries[1];assert(entry.STMB_sidePromptHistory);
    await save({...template,name:'Renamed'},'new');assert.equal(Object.keys(state.disk.entries).length,2);
    assert.equal(state.disk.entries[1].content,'new');assert.equal(state.disk.entries[1].comment,'Renamed (STMB SidePrompt)');
    assert.equal(state.disk.entries[1].STMB_sidePromptRegeneration.priorEntryState.content,'old');
    assert.equal(fingerprintRollbackEntry(state.disk.entries[1],{excludeSidePromptSnapshot:true}),state.disk.entries[1].STMB_sidePromptRegeneration.writtenFingerprint);
    assert.equal(state.disk.entries[0].content,'Narrative');
});
test('batch side writes preserve narrative and update existing records instead of allocating new ones',async()=>{
    const {state,scope}=harness();state.disk.entries[0]={uid:0,comment:'Story',content:'Narrative',stmemorybooks:true};
    for(const content of ['first','second'])await scope.upsertLorebookEntriesBatch('book',structuredClone(state.disk),[{title:template.name+' (STMB SidePrompt)',content,sidePromptHistory:history(),metadataFactory:factory}],{refreshEditor:false});
    assert.equal(Object.keys(state.disk.entries).length,2);assert.equal(state.disk.entries[0].content,'Narrative');assert.equal(state.disk.entries[1].content,'second');
});
test('side lookup never adopts a story memory just because it has the same title',()=>{
    const h=history(),book={entries:{0:{comment:h.legacyTitles[0],stmemorybooks:true}}};assert.equal(resolveSidePromptHistory(book,h).latest,null);
});
test('legacy overwrite identity survives a renamed template, but ambiguous matches are rejected',()=>{
    const h=history({...template,name:'Renamed'}),old={comment:'Old (STMB SidePrompt)',STMB_sidePromptRegeneration:{templateKey:template.key,chatId:'chat'}};
    assert.equal(resolveSidePromptHistory({entries:{0:old}},h).latest,old);
    assert.throws(()=>resolveSidePromptHistory({entries:{0:old,1:structuredClone(old)}},h));
    assert.equal(resolveSidePromptHistory({entries:{0:old}},{...h,titleSource:'override'}).latest,null);
});
test('rejected memory write does not advance progress or mutate caller/cache; accepted save updates shared group data',async()=>{
    const {state,scope}=harness(),data={entries:{0:{uid:0,content:'previous side'}}};state.fail=true;
    const call=()=>scope.addMemoryToLorebook({content:'Story',metadata:{}},{valid:true,name:'book',data},{refreshEditor:false});
    assert.equal((await call()).success,false);assert.equal(Object.keys(data.entries).length,1);assert.equal(state.cache.size,0);assert.equal(state.progress,0);assert.equal(state.notifications,0);
    state.fail=false;assert.equal((await call()).success,true);assert.equal(data.entries[1].content,'Story');assert.equal(state.progress,1);assert.equal(state.notifications,1);assert(state.disk.entries[1].STMB_collectedAt);
});
test('explicit version history still appends and disables the older version',async()=>{
    const {state,scope}=harness();const h={...history(),append:true};
    for(const content of ['first','second'])await scope.upsertLorebookEntryByTitle('book',structuredClone(state.disk),template.name+' (STMB SidePrompt)',content,{sidePromptHistory:h,metadataFactory:factory,refreshEditor:false});
    assert.equal(Object.keys(state.disk.entries).length,2);assert.equal(state.disk.entries[0].disable,true);assert.equal(state.disk.entries[1].disable,false);assert.equal(state.disk.entries[1].STMB_sidePromptHistory.sequence,2);
});
