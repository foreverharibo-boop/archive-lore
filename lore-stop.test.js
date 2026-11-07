// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./archive-lore.js',import.meta.url),'utf8');
test('real RP stop listener cancels before recall finishes, blocks stale injection, and permits the next generation',async()=>{
    const listeners=new Map(),injections=[];let resolve,entered,cancels=0,schedules=0;
    const gate=new Promise(r=>resolve=r),started=new Promise(r=>entered=r);
    const trace={finish:async()=>{},event:async()=>{}};
    const result={books:['book'],selected:new Set(['e']),text:'Fact',core:''};
    const scope={Date,DOMException,Set,pendingGeneration:null,generationEpoch:0,generationStopped:false,
        generationInFlight:false,autoTimer:null,autoPending:true,writing:false,
        settings:()=>({enabled:true,mode:'questions'}),books:()=>['book'],chatContext:()=>({key:'chat',messages:[]}),
        diagnostics:{begin:()=>trace},getContext:()=>({setExtensionPrompt:(_key,text)=>injections.push(text)}),
        extension_prompt_types:{IN_CHAT:1},PROMPT:'recalled',CORE_PROMPT:'core',
        controller:{recall:()=>{entered();return gate;},cancel:()=>cancels++,clearRecall(){},markInjected(){},state:()=>({})},
        clearPrompts(){},clearTimeout(){},scheduleAutomatic:()=>schedules++,error:()=>assert.fail('silent cancellation'),
        ui:{refresh:async()=>{}},eventSource:{on:(name,fn)=>listeners.set(name,fn)},
        event_types:{GENERATION_STARTED:'start',GENERATION_ENDED:'end',GENERATION_STOPPED:'stop'}};
    vm.createContext(scope);
    vm.runInContext(source.slice(source.indexOf('async function intercept('),source.indexOf('\nfunction nativePolicy(')),scope);
    const start=source.indexOf('    if(event_types.GENERATION_STARTED)');
    vm.runInContext(source.slice(start,source.indexOf('\n',start)),scope);
    const stop=source.indexOf("    for(const name of ['GENERATION_ENDED','GENERATION_STOPPED'])");
    vm.runInContext(source.slice(stop,source.indexOf('\n    if(!globalThis.archiveLoreFork)for',stop)),scope);
    listeners.get('start')('normal',{},false);
    const pending=scope.intercept([],0,()=>{},'normal');await started;
    await listeners.get('stop')();assert.equal(cancels,1);assert.equal(scope.autoPending,false);
    await listeners.get('end')();assert.equal(schedules,0);
    resolve(result);await pending;assert.deepEqual(injections,[]);assert.equal(scope.pendingGeneration,null);
    listeners.get('start')('normal',{},false);await scope.intercept([],0,()=>{},'normal');
    assert(injections.includes('Fact'));assert(scope.pendingGeneration);
});
