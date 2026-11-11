import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8');
const extract=(name,async=false)=>{const start=source.indexOf(`${async?'async ':''}function ${name}(`);return source.slice(start,source.indexOf('\n}\n',start)+2);};
function harness() {
 const calls=[];let busy=false,epoch=1,key='origin';
 const scope={archiveLoreFork:true,archiveSideIntervalRetry:null,autoSummaryJobRetryInFlight:false,
  getStmbChatKey:()=>key,getStmbStopEpoch:()=>epoch,isMemoryProcessing:()=>busy,
  setTimeout(){},validateSceneMarkers(){},refreshMemoryBoundaryUi(){},SCENE_MANAGEMENT:{VALIDATION_DELAY_MS:0},
  handleAutoSummaryMessageReceived:async()=>calls.push('memory check'),
  evaluateTrackers:async()=>calls.push('interval check'),getMemoryReminderController:()=>({check(){}}),
  hasPendingProgress:()=>false,hasActiveStmbJobs:()=>busy,retryAutoSummaryAfterJobIdle:async()=>{},
  console,translate:s=>s,
 };
 vm.createContext(scope);vm.runInContext(extract('handleMessageReceived',true)+'\n'+extract('handleStmbJobStateChanged'),scope);
 return {scope,calls,set busy(v){busy=v},stop(){epoch++},changeChat(){key='other'}};
}
test('independent interval follows the memory eligibility check when no memory is due',async()=>{
 const h=harness();await h.scope.handleMessageReceived();assert.deepEqual(h.calls,['memory check','interval check']);
});
test('queued memory defers interval until idle, then consumes pending evaluation once',async()=>{
 const h=harness();h.scope.handleAutoSummaryMessageReceived=async()=>{h.calls.push('memory queued');h.busy=true};
 await h.scope.handleMessageReceived();assert.deepEqual(h.calls,['memory queued']);
 h.busy=false;h.scope.handleStmbJobStateChanged();await new Promise(setImmediate);
 assert.deepEqual(h.calls,['memory queued','interval check']);
 h.scope.handleStmbJobStateChanged();await new Promise(setImmediate);
 assert.deepEqual(h.calls,['memory queued','interval check']);
});
test('direct memory save completes before interval evaluation',async()=>{
 const h=harness();h.scope.handleAutoSummaryMessageReceived=async()=>{h.calls.push('memory saved');h.calls.push('merged after-memory sides')};
 await h.scope.handleMessageReceived();assert.deepEqual(h.calls,['memory saved','merged after-memory sides','interval check']);
});
test('stop does not immediately restart a deferred interval',async()=>{
 const h=harness();h.busy=true;await h.scope.handleMessageReceived();h.stop();h.busy=false;
 h.scope.handleStmbJobStateChanged();await new Promise(setImmediate);assert(!h.calls.includes('interval check'));
});
test('changing chat during memory check cannot evaluate the new chat as the old event',async()=>{
 const h=harness();h.scope.handleAutoSummaryMessageReceived=async()=>h.changeChat();
 await h.scope.handleMessageReceived();assert(!h.calls.includes('interval check'));
});
