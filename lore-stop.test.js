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
        extension_prompt_types:{IN_CHAT:1},PROMPT:'recalled',GUIDANCE_PROMPT:'guidance',CORE_PROMPT:'core',
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

test('real prompt hook separates guidance, clears it on the next empty recall and blocks midflight setting changes',async()=>{
    const slots=new Map(),events=[],errors=[];let current={enabled:true,mode:'questions',selectionFocus:['affection']},result={books:['book'],selected:new Set(['e']),text:'Past fact',core:'Core',guidance:'Response direction'};
    const scope={Date,DOMException,Set,Error,pendingGeneration:null,generationEpoch:0,generationStopped:false,writing:false,
        settings:()=>current,books:()=>['book'],chatContext:()=>({key:'chat',messages:[]}),
        diagnostics:{begin:()=>({finish:async()=>{},event:async(stage,data)=>events.push({stage,data})})},
        getContext:()=>({setExtensionPrompt:(key,text)=>slots.set(key,text)}),extension_prompt_types:{IN_CHAT:1},
        PROMPT:'recalled',GUIDANCE_PROMPT:'guidance',CORE_PROMPT:'core',error:e=>errors.push(e),
        controller:{recall:async()=>result,markInjected(){},state:()=>({})}};
    vm.createContext(scope);
    vm.runInContext(source.slice(source.indexOf('function clearPrompts('),source.indexOf('\nfunction error(')),scope);
    vm.runInContext(source.slice(source.indexOf('async function intercept('),source.indexOf('\nfunction nativePolicy(')),scope);
    await scope.intercept([],0,()=>assert.fail(),'normal');
    assert.equal(slots.get('guidance'),'Response direction');assert.equal(slots.get('recalled'),'Past fact');
    assert(events.find(e=>e.stage==='injection.installed').data.slots.some(s=>s.name==='guidance'&&s.text==='Response direction'));
    current={...current,selectionFocus:[]};result={books:['book'],selected:new Set(),text:'',core:'Core'};
    await scope.intercept([],0,()=>assert.fail(),'normal');assert.equal(slots.get('guidance'),'');assert.equal(slots.get('recalled'),'');
    scope.controller.recall=async()=>{current={...current,selectionFocus:['details']};return {...result,text:'Stale',guidance:'Stale'};};
    let aborted=false;await scope.intercept([],0,()=>aborted=true,'normal');
    assert(aborted);assert.equal(slots.get('guidance'),'');assert.equal(slots.get('recalled'),'');assert.match(errors.at(-1).message,/설정이 바뀌/);
});
