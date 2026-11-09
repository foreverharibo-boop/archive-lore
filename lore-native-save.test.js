// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildSidePromptHistoryRequest,resolveSidePromptHistory,validateSidePromptHistoryRequest,
    formatSidePromptVersionTitle,SIDE_PROMPT_HISTORY_KEY} from './sidePromptHistory.js';
import {fingerprintRollbackEntry,applySidePromptRestoration} from './memoryRollback.js';
import {buildSidePromptRegenerationSnapshot} from './memoryRegeneration.js';

const src=fs.readFileSync(new URL('./addlore.js',import.meta.url),'utf8');
function extract(name) {const a=src.search(new RegExp('(?:export )?(?:async )?function '+name+'\\('));return src.slice(a,src.indexOf('\n}',a)+2).replace(/^export /,'');}
function harness() {
    const state={disk:{entries:{}},cache:new Map(),writes:0,notifications:0,progress:0,fail:false};
    const scope={structuredClone,console:{warn(){},error(){}},Date,archiveLoreFork:true,
        SIDE_PROMPT_HISTORY_KEY,resolveSidePromptHistory,validateSidePromptHistoryRequest,formatSidePromptVersionTitle,fingerprintRollbackEntry,
        getRequestHeaders:()=>({}),worldInfoCache:state.cache,eventSource:{emit:async()=>{}},event_types:{WORLDINFO_UPDATED:'update'},
        fetch:async(_url,options)=>{state.writes++;if(state.fail)return {ok:false,status:500,statusText:'failed'};state.disk=JSON.parse(options.body).data;return {ok:true};},
        saveWorldInfo:async(_name,data)=>{state.disk=structuredClone(data);state.writes++;},
        createWorldInfoEntry:(_name,data)=>{let uid=0;while(Object.hasOwn(data.entries,uid))uid++;return data.entries[uid]={uid};},
        getEntryByTitle:(data,title)=>Object.values(data.entries).find(e=>e.comment===title),
        extension_settings:{STMemoryBooks:{moduleSettings:{refreshEditor:false}}},i18n:(_key,fallback)=>fallback,
        generateEntryTitle:()=> 'Story',sanitizeTitle:s=>s,populateLorebookEntry:(e,m,title)=>Object.assign(e,{content:m.content,comment:title,stmemorybooks:true}),
        isCharacterAwarenessDisabled:()=>false,updateHighestMemoryProcessed:()=>state.progress++,
        toastr:{success:()=>state.notifications++,error(){}},getAutoHideRanges:()=>({mode:'none'}),reloadEditor:async()=>{},MODULE_NAME:'test'};
    vm.createContext(scope);vm.runInContext(['createLorebookEntryAtEnd','saveSidePromptLorebookChecked','applySidePromptHistory','upsertLorebookEntryByTitle','upsertLorebookEntriesBatch','addMemoryToLorebook'].map(extract).join('\n'),scope);
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

for (const batch of [false, true]) test(`imported chat reuses legacy and stamped side UID, preserves facts for generation and undo (${batch ? 'batch' : 'single'})`,async()=>{
    const {state,scope}=harness();
    const tpl={...template,settings:{lorebook:{entryTitleOverride:'Relationship'}}};
    const h=history(tpl),title='Relationship (STMB SidePrompt)';
    const original={uid:1,comment:title,content:'Established earlier facts',STMB_sidePromptRegeneration:{templateKey:tpl.key,chatId:'parent-chat'}};
    state.disk.entries={0:{uid:0,comment:'Story',content:'Narrative',stmemorybooks:true},1:structuredClone(original)};
    const originalBook=structuredClone(state.disk);
    const save=async(request,content)=>{
        const previous=resolveSidePromptHistory(state.disk,request).latest;
        const options={sidePromptHistory:request,metadataFactory:({entry,priorEntry})=>({STMB_sidePromptRegeneration:buildSidePromptRegenerationSnapshot({
            templateKey:tpl.key,priorContent:previous?.content,priorEntry,writtenEntry:entry,
            compiledScene:{metadata:{chatId:request.chatId,sceneStart:2,sceneEnd:3}},
        })})};
        return batch
            ? scope.upsertLorebookEntriesBatch('book',structuredClone(state.disk),[{title,content,...options}],{refreshEditor:false})
            : scope.upsertLorebookEntryByTitle('book',structuredClone(state.disk),title,content,{...options,refreshEditor:false});
    };
    await save(h,'Updated facts');
    assert.equal(Object.keys(state.disk.entries).length,2);
    assert.equal(state.disk.entries[1].STMB_sidePromptRegeneration.priorContent,original.content);
    assert.equal(state.disk.entries[1].STMB_sidePromptRegeneration.priorEntryExisted,true);
    assert.deepEqual(state.disk.entries[0],originalBook.entries[0]);
    const undoBook=structuredClone(state.disk);
    assert.equal(applySidePromptRestoration(undoBook,{entryKey:'1'}).deleted,false);
    assert.equal(undoBook.entries[1].content,original.content);
    const next={...h,chatId:'imported-again',chatKey:JSON.stringify(['character','avatar','imported-again'])};
    await save(next,'Updated again');
    assert.equal(Object.keys(state.disk.entries).length,2);
    assert.equal(state.disk.entries[1].STMB_sidePromptRegeneration.priorContent,'Updated facts');
    assert.equal(state.disk.entries[1].STMB_sidePromptHistory.chatId,next.chatId);
    assert.deepEqual(originalBook.entries[1],original);
});

test('new memories append after custom display positions even when SillyTavern reuses a low UID',async()=>{
    const {state,scope}=harness();
    const data={entries:{3:{uid:3,comment:'Earlier memory',displayIndex:2030,content:'Keep me'},4:{uid:4,comment:'Side',displayIndex:4}}};
    const before=structuredClone(data);
    assert.equal((await scope.addMemoryToLorebook({content:'New memory',metadata:{}},{valid:true,name:'book',data},{refreshEditor:false})).success,true);
    assert.equal(state.disk.entries[0].displayIndex,2031);
    assert.deepEqual(data.entries[3],before.entries[3]);
    assert.deepEqual(data.entries[4],before.entries[4]);
});

for(const batch of [false,true])test(`new sides append, overwrites stay put and explicit versions append (${batch?'batch':'single'})`,async()=>{
    const {state,scope}=harness();
    state.disk.entries={5:{uid:5,comment:'Existing',displayIndex:2030,order:100}};
    const save=async(content,h=history())=>{
        const item={title:'Relationship (STMB SidePrompt)',content,sidePromptHistory:h};
        return batch
            ? scope.upsertLorebookEntriesBatch('book',structuredClone(state.disk),[item],{refreshEditor:false})
            : scope.upsertLorebookEntryByTitle('book',structuredClone(state.disk),item.title,item.content,{...item,refreshEditor:false});
    };
    await save('First');assert.equal(state.disk.entries[0].displayIndex,2031);
    await save('Second');assert.equal(state.disk.entries[0].displayIndex,2031);assert.equal(Object.keys(state.disk.entries).length,2);
    await save('Third',{...history(),append:true});assert.equal(state.disk.entries[1].displayIndex,2032);
    assert.equal(state.disk.entries[0].displayIndex,2031);assert.equal(state.disk.entries[5].displayIndex,2030);
});

test('batched summary-style upserts append in saved order and preserve position on update',async()=>{
    const {state,scope}=harness();state.disk.entries={8:{uid:8,displayIndex:500,comment:'Existing'}};
    const items=['[ARC 001]','[ARC 002]'].map((title,index)=>({title,content:'Summary',entryOverrides:{order:index+1,stmemorybooks:true}}));
    await scope.upsertLorebookEntriesBatch('book',state.disk,items,{refreshEditor:false});
    assert.equal(state.disk.entries[0].displayIndex,501);assert.equal(state.disk.entries[1].displayIndex,502);
    await scope.upsertLorebookEntriesBatch('book',state.disk,[{...items[0],content:'Updated'}],{refreshEditor:false});
    assert.equal(state.disk.entries[0].displayIndex,501);assert.equal(state.disk.entries[0].order,1);
});

test('title numbering and insertion order settings never overwrite editor position',()=>{
    const scope={normalizeLorebookEntrySettings:s=>s,computeLorebookEntryOrder:(s,n)=>s.orderMode==='manual'?s.orderValue:n,
        CONTROLLED_WORLD_INFO_DEFAULT_FIELDS:[],getWorldInfoDefaultValue:()=>null};
    vm.createContext(scope);vm.runInContext(extract('applyLorebookEntrySettings'),scope);
    const entry={displayIndex:2031};
    scope.applyLorebookEntrySettings(entry,{constVectMode:'link',position:1,orderMode:'auto'},{orderNumber:24});
    assert.equal(entry.displayIndex,2031);assert.equal(entry.order,24);
    scope.applyLorebookEntrySettings(entry,{constVectMode:'link',position:1,orderMode:'manual',orderValue:900},{orderNumber:25});
    assert.equal(entry.displayIndex,2031);assert.equal(entry.order,900);
    const summaryOverrides={};scope.applyLorebookEntrySettings(summaryOverrides,{}, {orderNumber:1});
    assert.equal(Object.hasOwn(summaryOverrides,'displayIndex'),false);
});
