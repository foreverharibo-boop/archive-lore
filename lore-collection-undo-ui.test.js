// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {COLLECTION_UNDO_PENDING,planCollectionUndo,saveCollectionUndo} from './lore-collection-undo.js';
import {matchesRange} from './lore-core.js';
const text=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8');
const start=text.indexOf('async function undoLastArchiveCollection(');
const code=text.slice(start,text.indexOf('\nfunction getLorebookDataFingerprint(',start))
    .replace("const manager=await import('./sidePromptsManager.js');",'const manager=sideManager;');
function harness() {
    const state={chatKey:'chat',messages:[{mes:'a',is_system:true},{mes:'b',is_system:true}],markers:{highestMemoryProcessed:1},
        disk:{entries:{0:{uid:0,stmemorybooks:true,STMB_chatId:'chat',STMB_start:0,STMB_end:1,comment:'Latest story',content:'memory'}}},
        events:[],accept:true,failSave:false,failUnhide:false,busy:false};
    const search={books:()=>['book'],loadBook:async()=>structuredClone(state.disk),saveBook:async(_name,data)=>{if(state.failSave)throw Error('disk failed');state.disk=structuredClone(data);state.events.push('book');},
        clearPrompts:()=>state.events.push('clear-prompts'),controller:{state:()=>({busy:state.busy}),restore:async()=>{},clearRecall(){},invalidateEmbeddingCounts(){}}};
    const scope={structuredClone,Date,Math,console,planCollectionUndo,saveCollectionUndo,COLLECTION_UNDO_PENDING,matchesUndoSource:matchesRange,
        archiveLoreSearch:search,sideManager:{listTemplates:async()=>[]},streamingProcessor:null,
        getStmbInFlightCount:()=>0,hasActiveStmbJobs:()=>false,getContext:()=>({saveMetadata:async()=>state.events.push('metadata'),saveChat:async()=>state.events.push('chat')}),
        getStmbChatKey:()=>state.chatKey,getMemoryRollbackChatId:()=>state.chatKey,chat:state.messages,
        initializeSettings:()=>({}),getSceneMarkers:()=>state.markers,getCurrentChatLorebookNames:()=>['book'],world_names:['book'],
        document:{createElement:()=>({append(){}})},Popup:class{async show(){state.onPreview?.();return state.accept?1:0;}},POPUP_TYPE:{CONFIRM:1},POPUP_RESULT:{AFFIRMATIVE:1},markStmbPopup(){},
        withLorebookWriteLanes:async(_names,run)=>run(),invalidatePendingProgress:()=>state.events.push('invalidate'),
        executeSlashCommands:async cmd=>{if(state.failUnhide)throw Error('unhide failed');state.events.push(cmd);for(const m of state.messages)m.is_system=false;},
        clearAutoSummaryState(){},refreshMemoryBoundaryUi(){},reloadEditor:async()=>{},refreshPopupContent:async()=>{},toastr:{success:()=>state.events.push('success')}};
    scope.isMemoryProcessing=()=>!!scope.archiveLoreUndoing;
    vm.createContext(scope);vm.runInContext(code,scope);return {state,scope,undo:()=>scope.undoLastArchiveCollection()};
}
test('actual UI command deletes the lorebook entry, rewinds progress, unhides and clears recall without retaining a log',async()=>{
    const {state,scope,undo}=harness();await undo();assert.deepEqual(state.disk.entries,{});assert.equal(state.markers.highestMemoryProcessed,undefined);
    assert(!state.disk[COLLECTION_UNDO_PENDING]);assert(state.messages.every(m=>!m.is_system));assert(state.events.includes('clear-prompts'));assert(state.events.includes('success'));assert.equal(scope.archiveLoreUndoing,false);
});
test('cancel and changed chat/source during confirmation do not write or rewind',async()=>{
    const cancelled=harness();cancelled.state.accept=false;await cancelled.undo();assert.equal(cancelled.state.events.length,0);assert.equal(cancelled.state.markers.highestMemoryProcessed,1);
    const changed=harness();changed.state.onPreview=()=>changed.state.messages[0].mes='edited';await assert.rejects(changed.undo(),/수정/);assert.equal(changed.state.events.length,0);
    const switched=harness();switched.state.onPreview=()=>switched.state.chatKey='other';await assert.rejects(switched.undo(),/채팅/);assert.equal(switched.state.events.length,0);
});
test('failed book save leaves progress and visibility intact',async()=>{
    const {state,undo}=harness();state.failSave=true;await assert.rejects(undo(),/disk failed/);assert.equal(state.markers.highestMemoryProcessed,1);assert(state.disk.entries[0]);assert(state.messages.every(m=>m.is_system));
});
test('retry after unhide failure resumes the pending receipt, never removes an earlier collection',async()=>{
    const {state,undo}=harness();state.failUnhide=true;await assert.rejects(undo(),/unhide failed/);assert(state.disk[COLLECTION_UNDO_PENDING]);assert(!state.disk.entries[0]);
    state.failUnhide=false;state.accept=false;await undo();assert(!state.disk[COLLECTION_UNDO_PENDING]);assert(state.events.includes('success'));
});
test('active work blocks undo before reading or deleting any entries',async()=>{
    const {state,undo}=harness();state.busy=true;await assert.rejects(undo(),/진행 중/);assert(state.disk.entries[0]);assert.equal(state.events.length,0);
});
