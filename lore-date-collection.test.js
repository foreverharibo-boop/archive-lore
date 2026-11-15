// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeStoryDate,storyDateMarker,planDateCollection,validateDateRanges,dateCollectionSource,runDateCollection,withCollectionDate} from './lore-date-collection.js';
import {ARCHIVE_LORE_TITLE_FORMAT} from './lore-native-title.js';
const msg=mes=>({mes,name:'Character'});

test('calendar-valid Korean, ISO and English story dates; never guess missing years',()=>{
 for(const value of ['2028-11-12','2028.11.12','2028/11/12','2028년 11월 12일','November 12, 2028','12 Nov 2028','Sunday, November 12, 2028'])assert.equal(normalizeStoryDate(value),'2028-11-12',value);
 for(const value of ['2027-02-29','2028-02-30','11/12','November 12','tomorrow','2028-13-12'])assert.equal(normalizeStoryDate(value),null,value);
 assert.equal(normalizeStoryDate('2028-02-29'),'2028-02-29');
});
test('headings and HTML/Markdown info fields are recognized, quoted narrative and send timestamps are not',()=>{
 for(const text of ['### 2028-11-12','**Date:** November 12, 2028 | 11:00 PM','📅 날짜: 2028년 11월 12일','<div><b>Date:</b> 2028-11-12</div>'])assert.equal(storyDateMarker(msg(text))?.date,'2028-11-12',text);
 assert.equal(storyDateMarker({...msg('She remembered November 12, 2028.'),send_date:'2028-11-12'}),null);
 assert.equal(storyDateMarker(msg('```info\nDate: 2028-11-12\n```')).date,'2028-11-12');
 assert.equal(storyDateMarker(msg('Date: 2028-11-12\nDate: 2028-11-13')).ambiguous,true);
 assert.equal(storyDateMarker(msg('Date: November 12')).date,null);
});
test('continuous ranges preserve unknowns and all messages; selected start inherits a previous explicit date',()=>{
 const messages=['Undated','### 2028-11-12','Same evening','Date: 2028-11-13','Still morning'].map(msg);
 const plan=planDateCollection(messages,0,4);
 assert.deepEqual(plan.map(({start,end,date})=>({start,end,date})),[{start:0,end:0,date:null},{start:1,end:2,date:'2028-11-12'},{start:3,end:4,date:'2028-11-13'}]);
 assert.equal(planDateCollection(messages,2,4)[0].date,'2028-11-12');
 const recurring=planDateCollection(['Date: 2028-11-12','Date: 2028-11-13','Date: 2028-11-12'].map(msg),0,2);
 assert.equal(recurring.length,3,'do not reorder or merge noncontiguous dates');
});
test('date review rejects gaps, overlaps, invalid days and omitted messages',()=>{
 for(const ranges of [[{start:0,end:1,date:'2028-02-30'}],[{start:1,end:2}],[{start:0,end:0},{start:2,end:2}],[{start:0,end:1},{start:1,end:2}],[{start:0,end:1}]])assert.throws(()=>validateDateRanges(ranges,0,2));
 assert.equal(validateDateRanges([{start:0,end:2,date:null}],0,2).length,1);
});
test('batch stops on failure before later days and runs side work only for the last successful day',async()=>{
 const ranges=[0,1,2].map(start=>({start,end:start,date:null})), calls=[];
 await assert.rejects(runDateCollection({ranges,assertCurrent(){},collect:async(r,last)=>{calls.push([r.start,last]);return r.start===0;}}),/1\/3.*#1/);
 assert.deepEqual(calls,[[0,false],[1,false]]);
 calls.length=0;assert.equal((await runDateCollection({ranges,assertCurrent(){},collect:async(r,last)=>{calls.push(last);return true;}})).saved,3);
 assert.deepEqual(calls,[false,false,true]);
});
test('source guard permits our own hiding but detects swipes, edits and removals',()=>{
 const messages=[msg('one'),msg('two')],source=dateCollectionSource(messages,0,1);
 messages[0].is_system=true;assert.equal(dateCollectionSource(messages,0,1),source);
 messages[0].mes='changed';assert.notEqual(dateCollectionSource(messages,0,1),source);
 assert.notEqual(dateCollectionSource(messages.slice(0,1),0,1),source);
 assert.match(withCollectionDate('custom',{archiveLoreCollectionDate:null}),/날짜 미상/);
 assert.equal(withCollectionDate('custom',{}),'custom');
});

const source=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8');
const extract=name=>{const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));return source.slice(start,source.indexOf('\n}\n',start)+2);};
function nativeHarness() {
 const messages=['Date: 2028-11-12','One','Date: 2028-11-13','Two'].map(msg), markers={},saved=[],sides=[],errors=[];
 const settings={moduleSettings:{allowSceneOverlap:true},profiles:[]};
 const task={epoch:0,signal:new AbortController().signal,throwIfStopped(){if(task.stopped)throw Error('aborted');},finish(){}};
 const context={chatId:'chat',characterName:'Char',isGroupChat:false};
 const scope={archiveLoreFork:true,archiveDateCollection:null,isProcessingMemory:false,currentPopupInstance:null,
   validateDateRanges,dateCollectionSource,runDateCollection,ARCHIVE_LORE_TITLE_FORMAT,
   chat:messages,characters:[{}],this_chid:0,chat_metadata:{},structuredClone,
   getCurrentCanonicalLorebookName:()=> 'Book',getStmbChatKey:()=> 'chat',getStmbChatKeySafe:()=> 'chat',guardPendingProgress:()=>false,validateSceneMemoryRange:()=>true,
   isMemoryProcessing:()=>!!scope.archiveDateCollection||scope.isProcessingMemory,
   createStmbInFlightTask:()=>task,initializeSettings:()=>settings,
   createSceneRequest:(sceneStart,sceneEnd)=>({sceneStart,sceneEnd}),
   compileScene:r=>({metadata:{...r,messageCount:r.sceneEnd-r.sceneStart+1},messages:messages.slice(r.sceneStart,r.sceneEnd+1).map((m,i)=>({...m,id:r.sceneStart+i}))}),
   captureIntervalScene(){},applyNarratorSceneMetadata(){},applyGroupMemoryPolicy(){},getCurrentMemoryBooksContext:()=>context,
   refreshCollectionStatus(){},notifyCollectionCompletion(){},setSceneRange:(sceneStart,sceneEnd)=>Object.assign(markers,{sceneStart,sceneEnd}),
   getSceneMarkers:()=>markers,getSceneData:async()=>({...markers}),
   captureMemoryOriginSnapshot:()=>({chatKey:'chat',chatRef:{},sceneContext:context,sceneMarkers:{}}),
   validateLorebook:async()=>({valid:true,name:'Book',data:{entries:{}}}),validateMultiCharacterLorebookBindingsForMemory:async()=>({valid:true}),
   identifyMemoryEntries:()=>[],showAndGetMemorySettings:async()=>({profileSettings:{connection:{}},summaryCount:0,tokenThreshold:30000,settings}),
   areStmbJobsEnabled:()=>true,enqueueStmbJob:()=>assert.fail('date batches must await real saves, not queue acceptance'),
   getMemoryReminderController:()=>({check(){}}),throwIfStmbStopped:()=>task.throwIfStopped(),
   validateCompiledScene:()=>({valid:true}),resolveAdditionalContextSnapshot:async()=>({entries:[]}),getSceneStats:async()=>({estimatedTokens:1}),
   createMemory:async(scene,profile)=>({content:scene.messages.map(m=>m.mes).join('\n'),extractedTitle:'Model title',metadata:{sceneRange:`${scene.metadata.sceneStart}-${scene.metadata.sceneEnd}`},titleFormat:profile.titleFormat}),
   shouldWriteMultiCharacterLorebooks:()=>false,getAutomaticGroupMemoryAddOptions:()=>({}),withStmbWriteLane:async(_key,fn)=>fn(),
   loadWorldInfo:async()=>({entries:{}}),addMemoryToLorebook:async(result)=>{saved.push(structuredClone(result));return{success:true,entryTitle:result.extractedTitle};},
   recordCollectionResult:(_key,r)=>({...r,id:'receipt'}),runAfterMemory:async(scene)=>sides.push(structuredClone(scene)),runClipReviewAfterMemory:async()=>{},getMemoryWriteResultLorebookNames:()=>['Book'],
   applySavedMemoryAutoHide:async()=>{for(let i=markers.sceneStart;i<=markers.sceneEnd;i++)messages[i].is_system=true;},
   advanceCollectionCheckpoint:(m,end)=>m.highestMemoryProcessed=end,saveMetadataForCurrentContext(){},refreshMemoryBoundaryUi(){},clearAutoSummaryState(){},maybePromptSelectedAutoConsolidation:async()=>{},
   MEMORY_GENERATION:{MAX_RETRIES:0},isStmbStopError:e=>e.message==='aborted',isRetryableError:()=>false,
   translate:s=>s,__st_t_tag:(strings,...values)=>strings.reduce((s,v,i)=>s+v+(values[i]??''),''),
   toastr:{info(){},success(){},warning(){},clear(){},error:m=>errors.push(m)},console:{debug(){},log(){},warn(){},error:(...e)=>errors.push(e.map(String).join(' '))},
 };
 vm.createContext(scope);
 for(const name of ['collectArchiveDates','runSceneMemoryRange','initiateMemoryCreation','executeMemoryGeneration'])vm.runInContext(extract(name),scope);
 return{scope,messages,saved,sides,markers,task,errors,run:()=>scope.collectArchiveDates({start:0,end:3,ranges:planDateCollection(messages,0,3)})};
}
test('native date batch saves each day, retains custom profiles, skips queueing, and sends all source messages to sides once',async()=>{
 const h=nativeHarness();const result=await h.run();
 assert.equal(result.saved,2,h.errors.join('\n'));assert.equal(h.errors.length,0,h.errors.join('\n'));
 assert.deepEqual(h.saved.map(m=>m.extractedTitle),['2028-11-12','2028-11-13']);
 assert.deepEqual(h.saved.map(m=>m.metadata.sceneRange),['0-1','2-3']);
 assert.equal(h.sides.length,1);assert.equal(h.sides[0].messages.length,4);
 assert.equal(h.markers.highestMemoryProcessed,3);assert.equal(h.scope.archiveDateCollection,null);
});
test('native date batch stops before writing a provider response if source changed or user stopped',async()=>{
 for(const stop of [false,true]){
  const h=nativeHarness(),original=h.scope.createMemory;
  h.scope.createMemory=async(...args)=>{const result=await original(...args);if(stop)h.task.stopped=true;else h.messages[0].mes='Edited';return result;};
  await assert.rejects(h.run());assert.equal(h.saved.length,0);assert.equal(h.sides.length,0);assert.equal(h.scope.archiveDateCollection,null);
 }
});

test('native failure on a later date retains prior saved memory and checkpoint without side updates',async()=>{
 const h=nativeHarness(),original=h.scope.createMemory;
 h.scope.createMemory=async(scene,...args)=>{if(scene.metadata.sceneStart===2)throw Error('provider failed');return original(scene,...args);};
 await assert.rejects(h.run(),/1\/2.*#2/);
 assert.equal(h.saved.length,1);assert.equal(h.markers.highestMemoryProcessed,1);assert.equal(h.sides.length,0);assert.equal(h.scope.archiveDateCollection,null);
});
