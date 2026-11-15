// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeStoryDate,storyDateMarker,planDateCollection,validateDateRanges,dateCollectionSource,runDateCollection,withCollectionDate,splitDateMemoryResult,validateDateCollectionResponse} from './lore-date-collection.js';
import {saveCollectionUndo} from './lore-collection-undo.js';
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
test('bulk orchestration calls collection exactly once with all ranges; failed generation saves nothing',async()=>{
 const ranges=[0,1,2].map(start=>({start,end:start,date:null})), calls=[];
 await assert.rejects(runDateCollection({ranges,assertCurrent(){},collect:async(r)=>{calls.push(r);return false;}}),/취소되었거나 실패/);
 assert.equal(calls.length,1);assert.equal(calls[0],ranges);
 calls.length=0;assert.equal((await runDateCollection({ranges,assertCurrent(){},collect:async(r)=>{calls.push(r);return true;}})).saved,3);
 assert.equal(calls.length,1);
});
test('bulk response must contain every group once in order with nonempty text and keyword arrays',()=>{
 const ranges=[{start:0,end:1,date:'2028-11-12'},{start:2,end:3,date:null}];
 const valid={memories:[{id:0,content:'Full detail A',keywords:['A']},{id:1,content:'Full detail B',keywords:['B']}]};
 const split=splitDateMemoryResult({metadata:{sceneRange:'0-3',chatId:'chat'},titleFormat:ARCHIVE_LORE_TITLE_FORMAT},valid,ranges);
 assert.equal(split.dateMemories[0].metadata.sceneRange,'0-1');assert.equal(split.dateMemories[1].extractedTitle,'날짜 미상');
 assert.equal(split.metadata.sceneRange,'0-3');assert.deepEqual(split.suggestedKeys,['A','B']);
 for(const mutate of [m=>m.pop(),m=>m.push(m[0]),m=>m.reverse(),m=>m[1].id=0,m=>m[0].content=' ',m=>m[1].keywords=null]){
  const invalid=structuredClone(valid);mutate(invalid.memories);assert.throws(()=>validateDateCollectionResponse(invalid,ranges));
 }
 const prompt=withCollectionDate('CUSTOM FULL DETAIL',{archiveLoreDateRanges:ranges});
 assert.match(prompt,/CUSTOM FULL DETAIL/);assert.match(prompt,/one response/);assert.match(prompt,/unknown/);
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
 const counts={confirm:0,generate:0,write:0};let disk={entries:{}};
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
   identifyMemoryEntries:()=>[],showAndGetMemorySettings:async()=>{counts.confirm++;return {profileSettings:{connection:{}},summaryCount:0,tokenThreshold:30000,settings};},
   areStmbJobsEnabled:()=>true,enqueueStmbJob:()=>assert.fail('date batches must await real saves, not queue acceptance'),
   getMemoryReminderController:()=>({check(){}}),throwIfStmbStopped:()=>task.throwIfStopped(),
   validateCompiledScene:()=>({valid:true}),resolveAdditionalContextSnapshot:async()=>({entries:[]}),getSceneStats:async()=>({estimatedTokens:1}),
   createMemory:async(scene,profile)=>{counts.generate++;return splitDateMemoryResult({content:'',metadata:{sceneRange:`${scene.metadata.sceneStart}-${scene.metadata.sceneEnd}`},titleFormat:profile.titleFormat},
     {memories:scene.metadata.archiveLoreDateRanges.map((r,id)=>({id,content:messages.slice(r.start,r.end+1).map(m=>m.mes).join('\n'),keywords:[]}))},scene.metadata.archiveLoreDateRanges);},
   shouldWriteMultiCharacterLorebooks:()=>false,getAutomaticGroupMemoryAddOptions:()=>({}),withStmbWriteLane:async(_key,fn)=>fn(),withLorebookWriteLanes:async(_names,fn)=>fn(),saveCollectionUndo,reloadEditor:async()=>{},
   loadWorldInfo:async()=>structuredClone(disk),
   addMemoryToLorebook:async(result,validation,options)=>{assert.equal(options.stageOnly,true);const uid=Object.keys(validation.data.entries).length;validation.data.entries[uid]={uid,...structuredClone(result),...options.entryMetadata};return{success:true,entryId:uid,lorebookName:validation.name,entryTitle:result.extractedTitle};},
   saveSidePromptLorebookChecked:async(_name,data)=>{counts.write++;disk=structuredClone(data);saved.push(...Object.values(data.entries));},
   recordCollectionResult:(_key,r)=>({...r,id:'receipt'}),runAfterMemory:async(scene)=>sides.push(structuredClone(scene)),runClipReviewAfterMemory:async()=>{},getMemoryWriteResultLorebookNames:()=>['Book'],
   applySavedMemoryAutoHide:async()=>{for(let i=markers.sceneStart;i<=markers.sceneEnd;i++)messages[i].is_system=true;},
   advanceCollectionCheckpoint:(m,end)=>m.highestMemoryProcessed=end,saveMetadataForCurrentContext(){},refreshMemoryBoundaryUi(){},clearAutoSummaryState(){},maybePromptSelectedAutoConsolidation:async()=>{},
   MEMORY_GENERATION:{MAX_RETRIES:0},isStmbStopError:e=>e.message==='aborted',isRetryableError:()=>false,
   translate:s=>s,__st_t_tag:(strings,...values)=>strings.reduce((s,v,i)=>s+v+(values[i]??''),''),
   toastr:{info(){},success(){},warning(){},clear(){},error:m=>errors.push(m)},console:{debug(){},log(){},warn(){},error:(...e)=>errors.push(e.map(String).join(' '))},
 };
 vm.createContext(scope);
 for(const name of ['collectArchiveDates','saveArchiveDateMemories','runSceneMemoryRange','initiateMemoryCreation','executeMemoryGeneration'])vm.runInContext(extract(name),scope);
 return{scope,messages,saved,sides,markers,task,errors,counts,run:()=>scope.collectArchiveDates({start:0,end:3,ranges:planDateCollection(messages,0,3)})};
}
test('native date batch saves each day, retains custom profiles, skips queueing, and sends all source messages to sides once',async()=>{
 const h=nativeHarness();const result=await h.run();
 assert.equal(result.saved,2,h.errors.join('\n'));assert.equal(h.errors.length,0,h.errors.join('\n'));
 assert.deepEqual(h.saved.map(m=>m.extractedTitle),['2028-11-12','2028-11-13']);
 assert.deepEqual(h.saved.map(m=>m.metadata.sceneRange),['0-1','2-3']);
 assert.deepEqual(h.counts,{confirm:1,generate:1,write:1});
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

test('provider or storage failure leaves no entries, hides, side work or advanced checkpoint',async()=>{
 for(const failure of ['provider','storage']){
  const h=nativeHarness();
  if(failure==='provider')h.scope.createMemory=async()=>{throw Error('provider failed');};
  else h.scope.saveSidePromptLorebookChecked=async()=>{throw Error('storage failed');};
  await assert.rejects(h.run(),/취소되었거나 실패/);
  assert.equal(h.saved.length,0);assert.equal(h.markers.highestMemoryProcessed,undefined);assert.equal(h.sides.length,0);
  assert(h.messages.every(m=>!m.is_system));assert.equal(h.scope.archiveDateCollection,null);
 }
});
test('all-date preview opens once; retry regenerates the batch without reopening profile settings',async()=>{
 const h=nativeHarness();h.scope.initializeSettings().moduleSettings.showMemoryPreviews=true;
 let previews=0;h.scope.showMemoryPreviewPopup=async(result)=>{assert.equal(result.dateMemories.length,2);return{action:++previews===1?'retry':'accept'};};
 assert.equal((await h.run()).saved,2,h.errors.join('\n'));assert.equal(previews,2);assert.deepEqual(h.counts,{confirm:1,generate:2,write:1});assert.equal(h.sides.length,1);
});
test('group copies stage every date and write once per book; secondary-book failure compensates the primary',async()=>{
 for(const fail of [false,true]){
  const h=nativeHarness(),s=h.scope,disk=new Map([['Book',{entries:{}}],['Other',{entries:{}}]]),writes=[];
  Object.assign(s,{
   getManualGroupTouchedLorebookNames:(name,targets)=>[name,...targets.map(t=>t.lorebookName)],
   ensureGroupMemoryParticipantFilters(){},createCanonicalMemoryInclusionGroup:m=>'group-'+m.metadata.sceneRange,
   getCanonicalMemoryCopyMetadata:({inclusionGroup,canonicalLorebookName,canonicalEntryId})=>({STMB_inclusionGroup:inclusionGroup,STMB_canonicalLorebook:canonicalLorebookName,...canonicalEntryId!==undefined?{STMB_canonicalEntryUid:canonicalEntryId}:{}}),
   buildManualGroupRoleMetadata:role=>({role}),getManualGroupCopyTargetSpeakerNames:()=>['Char'],deepClone:structuredClone,
   loadWorldInfo:async name=>structuredClone(disk.get(name)),saveWorldInfo:()=>assert.fail('staging must not save'),
   saveSidePromptLorebookChecked:async(name,data)=>{writes.push(name);if(fail&&name==='Other')throw Error('secondary failed');disk.set(name,structuredClone(data));},
  });
  vm.runInContext(extract('addMemoryToManualGroupLorebooks'),s);
  const ranges=planDateCollection(h.messages,0,3),scene=s.compileScene({sceneStart:0,sceneEnd:3});scene.metadata.archiveLoreDateRanges=ranges;
  const memoryResult=await s.createMemory(scene,{});
  const save=()=>s.saveArchiveDateMemories({memoryResult,lorebookValidation:{valid:true,name:'Book',data:{entries:{}}},settings:s.initializeSettings(),sceneData:{sceneStart:0,sceneEnd:3},
    dateCollection:{ranges,assertCurrent(){}},automaticGroupAddOptions:{},groupOptions:{copyTargets:[{lorebookName:'Other'}]}});
  if(fail){await assert.rejects(save(),/secondary failed/);assert.equal(Object.keys(disk.get('Book').entries).length,0);assert.deepEqual(writes,['Book','Other','Book']);}
  else {
   assert.equal((await save()).memoryCount,4);assert.deepEqual(writes,['Book','Other']);
   for(const book of disk.values())assert.equal(Object.keys(book.entries).length,2);
   assert.equal(disk.get('Other').entries[1].STMB_canonicalEntryUid,1);
   assert.equal(disk.get('Book').entries[0].STMB_dateCollection.id,disk.get('Other').entries[1].STMB_dateCollection.id);
  }
 }
});
test('an entirely hidden date range stops before generation instead of fabricating its content',async()=>{
 const h=nativeHarness(),compile=h.scope.compileScene;
 h.scope.compileScene=(...args)=>{const scene=compile(...args);scene.messages=scene.messages.filter(m=>m.id<2);return scene;};
 await assert.rejects(h.run());assert.equal(h.counts.generate,0);assert.equal(h.counts.write,0);assert.equal(h.sides.length,0);
 assert(h.errors.some(e=>String(e).includes('포함할 본문이 없습니다')));
});
