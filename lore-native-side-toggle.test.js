import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {SIDE_AUTO_KEY,sideAutoEnabled} from './lore-native-side-toggle.js';

test('per-chat automatic side switch defaults on and survives serialization without altering prompt settings',()=>{
    const markers={sidePromptAfterMemorySetKey:'six',other:'kept'};
    assert.equal(sideAutoEnabled(markers),true);markers[SIDE_AUTO_KEY]=false;
    assert.equal(sideAutoEnabled(JSON.parse(JSON.stringify(markers))),false);
    assert.equal(sideAutoEnabled({}),true);assert.equal(markers.sidePromptAfterMemorySetKey,'six');
});
test('disabled actual after-memory entry point starts no job, model request, or retry snapshot',async()=>{
    const source=fs.readFileSync(new URL('./sidePrompts.js',import.meta.url),'utf8');
    const start=source.indexOf('export async function runAfterMemory('),end=source.indexOf('\n}\n',start)+2;
    let tasks=0;const markers={[SIDE_AUTO_KEY]:false};
    const scope={sideAutoEnabled,getSceneMarkers:()=>markers,createStmbInFlightTask(){tasks++;throw Error('execution reached');}};
    vm.runInNewContext(source.slice(start,end).replace('export ',''),scope);
    assert.equal(await scope.runAfterMemory({}),0);
    assert.equal(await scope.runAfterMemory({},null,{retryJobSnapshots:[{type:'sidePrompt'}]}),0);assert.equal(tasks,0);
    // A queued memory uses the originating chat snapshot, never another chat's switch.
    await assert.rejects(scope.runAfterMemory({},null,{sceneMarkers:{[SIDE_AUTO_KEY]:true}}),/execution reached/);assert.equal(tasks,1);
});
