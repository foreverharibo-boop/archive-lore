import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { captureIntervalScene, intervalSceneAfterMemory, mergeAfterMemoryItems } from './lore-side-after-memory.js';
import { sideAutoEnabled } from './lore-native-side-toggle.js';
import { filterAutomaticSidePromptSetItems } from './sidePromptSetDefaults.js';
const source = fs.readFileSync(new URL('./sidePrompts.js', import.meta.url), 'utf8');
const extract = name => { const start=source.indexOf(`export async function ${name}(`); return source.slice(start, source.indexOf('\n}\n',start)+2).replace('export ',''); };
const template = (key, count=3, after=false) => ({key,name:key,enabled:true,triggers:{onInterval:{visibleMessages:count},onAfterMemory:{enabled:after}}});
function sceneFixture() {
 const chat=Array.from({length:12},(_,id)=>({mes:`text ${id}`,is_system:id===1}));
 const compileScene=({sceneStart,sceneEnd})=>({metadata:{sceneStart,sceneEnd,chatId:'origin'},messages:chat.flatMap((m,id)=>id>=sceneStart&&id<=sceneEnd&&!m.is_system?[{id,mes:m.mes}]:[])});
 const scene=compileScene({sceneStart:5,sceneEnd:9});
 captureIntervalScene(scene,{chat,compileScene,createSceneRequest:(sceneStart,sceneEnd)=>({sceneStart,sceneEnd})});
 return {scene,chat};
}
test('interval keeps the pre-hide origin snapshot and excludes messages after the saved memory',()=>{
 const {scene,chat}=sceneFixture();chat.forEach(m=>{m.is_system=true;m.mes='different chat';});
 const result=intervalSceneAfterMemory(scene,template('a',3),{STMB_sp_a_lastMsgId:4});
 assert.deepEqual(result.messages.map(m=>m.id),[5,6,7,8,9]);
 assert.equal(result.messages[0].mes,'text 5');assert.equal(result.metadata.chatId,'origin');
 assert.equal(intervalSceneAfterMemory(scene,template('a',6),{STMB_sp_a_lastMsgId:4}),null);
 assert.equal(intervalSceneAfterMemory(scene,template('a'),{STMB_sp_a_lastMsgId:9}),null);
 assert.doesNotThrow(()=>JSON.stringify(scene));
});
test('empty visible history fallback is serializable and interval snapshot input remains capped',()=>{
 const chat=Array.from({length:500},()=>({}));let bounds;
 const scene={metadata:{sceneStart:490,sceneEnd:499},messages:[{id:499}]};
 captureIntervalScene(scene,{chat,createSceneRequest:(a,b)=>({sceneStart:a,sceneEnd:b}),compileScene:r=>(bounds=r,{metadata:r,messages:[{id:499}]})});
 assert.equal(bounds.sceneStart,300);assert.equal(scene.archiveLoreInterval.visibleIds.length,500);
 const hidden={metadata:{sceneStart:0,sceneEnd:0},messages:[{id:0}]};
 captureIntervalScene(hidden,{chat:[{is_system:true}],compileScene:()=>{throw Error('not needed');}});
 assert.doesNotThrow(()=>JSON.stringify(hidden));
});
function harness({queued=true, fork=true, after=[], intervals=[], set=false, enabled=true,existing={}}={}) {
 const jobs=[],requests=[],saves=[],errors=[];let tasks=0;
 const scope={archiveLoreFork:fork,sideAutoEnabled,intervalSceneAfterMemory,mergeAfterMemoryItems,filterAutomaticSidePromptSetItems,
  getSceneMarkers:()=>({archiveLoreSideAfterMemoryEnabled:enabled}),
  createStmbInFlightTask:()=>{tasks++;return {epoch:1,finish(){}};},throwIfStmbStopped(){},
  getCurrentMemoryBooksContext:()=>({}),extension_settings:{STMemoryBooks:{moduleSettings:{showNotifications:false}}},
  resolveAutomaticSidePromptSet:()=>({setKey:set?'set':''}),
  resolveSetItemsForRun:async()=>({set:{key:'set'},skipped:[],runnable:[...new Set([...after,...intervals])].map(tpl=>({tpl,baseTpl:tpl,runtimeMacros:{},item:{id:tpl.key}}))}),
  getAutomaticSetSkippedItems:()=>[],logSkippedSetItems(){},summarizeMissingSetMacros:()=>[],
  listByTrigger:async trigger=>trigger==='onAfterMemory'?after:intervals,
  resolveSidePromptConnection:()=>({}),clampInt:n=>n,areStmbJobsEnabled:()=>queued,
  resolveSidePromptLorebook:async()=>({name:'origin-book',data:{entries:{}}}),
  getSidePromptHistory:tpl=>({key:tpl.key}),resolveSidePromptHistory:(_data,h)=>({latest:existing[h.key]}),
  reportSidePromptHistoryConflict:()=>false,isStmbStopError:()=>false,
  ensureSidePromptJobExecutorRegistered(){},makeUpsertParamsFromLorebook:()=>({}),getEffectiveLorebookSettingsForTemplate:()=>({}),
  prepareSidePromptRun:async args=>({unifiedTitle:args.tpl.key,conn:{},finalPrompt:JSON.stringify(args.compiledScene.messages),prior:''}),
  buildSidePromptJob:args=>args,enqueueStmbJob:job=>{jobs.push(job);return job;},
  runSidePromptAttempt:async args=>{requests.push(args);return 'updated';},ensureSidePromptTextNotBlank:()=>true,
  resolveSidePromptPreview:async()=>({approved:true,text:'updated'}),createSidePromptRegenerationMetadataFactory:()=>()=>({}),
  withFreshSidePromptLorebook:async(_name,fn)=>fn({entries:{}}),upsertLorebookEntriesBatch:async(_name,_data,items)=>saves.push(...items),
  console:{debug(){},log(){},warn(...args){errors.push(args)},error(...args){errors.push(args)}},MODULE_NAME:'test',performance,Date,
  toastr:{info(){},success(){},error(...args){errors.push(args)}}};
 vm.createContext(scope);vm.runInContext(extract('evaluateTrackers')+'\n'+extract('runAfterMemory'),scope);
 return {scope,jobs,requests,saves,errors,get tasks(){return tasks}};
}
test('message arrival cannot launch or queue an Archive interval before a memory save',async()=>{
 const h=harness({intervals:[template('a')]});assert.equal(await h.scope.evaluateTrackers(),0);
 assert.equal(h.tasks,0);assert.equal(h.jobs.length,0);assert.equal(h.requests.length,0);
});
for(const queued of [true,false])for(const set of [true,false])test(`after-memory executes due intervals once and retains threshold / origin (${queued}, ${set})`,async()=>{
 const both=template('both',3,true),interval=template('interval'),later=template('later',99);
 const h=harness({queued,set,after:[both],intervals:[both,interval,later]});
 await h.scope.runAfterMemory(sceneFixture().scene,null,{parentJobId:'saved-memory',chatKey:'origin',chatRef:{fileName:'origin'}});
 assert.deepEqual(h.errors,[]);
 if(queued){assert.deepEqual(h.jobs.map(j=>j.tpl.key),['both','interval']);assert(h.jobs.every(j=>j.parentJobId==='saved-memory'&&j.chatKey==='origin'));assert.equal(h.jobs[1].compiledScene.metadata.sceneEnd,9);}
 else {assert.equal(h.requests.length,2);assert.equal(h.saves.length,2);assert(h.saves.every(s=>Object.values(s.metadataUpdates).includes(9)));}
});
test('switch off and original Memory Books mode preserve their execution boundaries',async()=>{
 const off=harness({enabled:false,intervals:[template('a')]});assert.equal(await off.scope.runAfterMemory(sceneFixture().scene),0);assert.equal(off.tasks,0);
 const original=harness({fork:false,intervals:[template('a')]});await original.scope.runAfterMemory(sceneFixture().scene);assert.equal(original.jobs.length,0);
});
