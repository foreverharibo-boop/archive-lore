// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionOutputSchema, requestSelectionOutput } from './lore-selection-output.js';
import { ask } from './lore-api.js';
import { selectedUnits } from './lore-core.js';
import { createRecallAudit } from './lore-recall-diagnostics.js';

const data = (selectionFormat='ranked') => ({selectionFormat,batch:3,memories:[{id:'u158',text:'A recorded event.'}],selectionFocus:['meaning','unknown']});
const error = (message,status=400) => Object.assign(Error(message),{status});
for (const mode of ['ranked','generous']) test(`first ${mode} request carries strict limits with the correct response fields`,async()=>{
    const input=data(mode),before=structuredClone(input),calls=[];
    const reply=await requestSelectionOutput({data:input,request:async schema=>{calls.push(schema);return '{"selections":[]}';}});
    assert.equal(reply,'{"selections":[]}');assert.equal(calls.length,1);assert.deepEqual(input,before);
    const schema=calls[0];assert.equal(schema.strict,true);assert.equal(schema.value.additionalProperties,false);
    const selections=schema.value.properties.selections,row=selections.items;
    assert.equal(selections.maxItems,48);assert.equal(row.properties.contextIds.maxItems,32);assert.equal(row.properties.outcomeIds.maxItems,8);
    assert.deepEqual(row.properties.priority,{type:'integer',minimum:2,maximum:3});assert.equal(row.additionalProperties,false);
    assert.deepEqual(new Set(row.required),new Set(Object.keys(row.properties)));
    assert.equal(Object.hasOwn(row.properties,'reason'),mode==='ranked');assert.deepEqual(row.properties.focusMatches.items.enum,['meaning']);
});
for (const mode of ['ranked','generous']) test(`${mode} schema uses Google-compatible enums and accepts only numeric priorities 2/3`,()=>{
    const schema=selectionOutputSchema(data(mode));
    const checkEnums=value=>{
        if(!value||typeof value!=='object')return;
        if(Array.isArray(value.enum))assert(value.enum.every(item=>typeof item==='string'),'response_schema enum values must be strings');
        for(const child of Object.values(value))checkEnums(child);
    };
    checkEnums(schema.value);
    const priority=schema.value.properties.selections.items.properties.priority;
    const accepts=value=>Number.isInteger(value)&&value>=priority.minimum&&value<=priority.maximum;
    for(const value of [2,3])assert(accepts(value));
    for(const value of [1,4,2.5,'2','3',null,true])assert(!accepts(value));
    for(const value of [2,3]){
        const selected=selectedUnits(JSON.stringify({selections:[{id:'u158',priority:value,reason:'Recorded event',contextIds:[],outcomeIds:[]}]}),data(mode).memories);
        assert.equal(selected.length,1);assert.equal(selected[0].priority,value);
    }
});
test('planner, collection and probe requests have no selection schema',async()=>{
    for(const input of [{questions:['Where?']},{entries:[]},{memories:[]},{selectionFormat:'ranked'},{ok:true}]){
        assert.equal(selectionOutputSchema(input),undefined);
        let calls=0;await requestSelectionOutput({data:input,request:async schema=>{calls++;assert.equal(schema,undefined);return 'unchanged';}});assert.equal(calls,1);
    }
});
test('explicit schema incompatibility retries once, caches only that route, and records the loss of enforcement',async()=>{
    const unsupported=new Set(),calls=[],events=[];
    const options={data:data(),unsupported,route:'profile-a',log:async(stage,event)=>events.push({stage,...event}),request:async schema=>{
        calls.push(schema);if(schema)throw error('response_format json_schema is not supported');return 'legacy';
    }};
    assert.equal(await requestSelectionOutput(options),'legacy');assert.equal(calls.length,2);assert.equal(calls[1],undefined);
    await requestSelectionOutput(options);assert.equal(calls.length,3);assert.equal(calls[2],undefined);
    assert(events.some(e=>e.status==='unsupported'&&e.message.includes('보장되지')));
    let other;await requestSelectionOutput({...options,route:'profile-b',request:async schema=>{other=schema;return 'ok';}});assert.equal(other.strict,true);
});
for (const failure of [error('quota json_schema unsupported',429),error('response_format unauthorized',401),error('provider timeout',504),error('bad request',400),error('invalid json_schema definition',400),Object.assign(error('json_schema unsupported'),{code:'OUTPUT_TRUNCATED'}),Object.assign(error('json_schema unsupported'),{category:'timeout'})]) {
    test(`does not retry unrelated errors: ${failure.message} ${failure.status} ${failure.code||failure.category||''}`,async()=>{
        let calls=0;await assert.rejects(requestSelectionOutput({data:data(),request:async()=>{calls++;throw failure;}}),e=>e===failure);assert.equal(calls,1);
    });
}
test('abort and a failing fallback do not trigger more requests',async()=>{
    const stop=new AbortController();let calls=0;
    await assert.rejects(requestSelectionOutput({data:data(),signal:stop.signal,request:async()=>{calls++;stop.abort(Error('stopped'));throw error('maxItems not supported');}}),/stopped/);assert.equal(calls,1);
    calls=0;await assert.rejects(requestSelectionOutput({data:data(),request:async()=>{calls++;throw error('maxItems not supported');}}),/maxItems/);assert.equal(calls,2);
});
test('browser connection overrides a saved schema on the first request and preserves source/model/preset',async()=>{
    const calls=[],profile={id:'p',model:'chosen-model',preset:'chosen-preset'};
    const context={extensionSettings:{connectionManager:{selectedProfile:'p'}},ConnectionManagerRequestService:{
        getProfile:()=>profile,validateProfile:()=>({selected:'openai',source:'custom'}),sendRequest:async(...args)=>{calls.push(args);return {choices:[{message:{content:'{"selections":[]}'},finish_reason:'stop'}]};},
    }};
    assert.equal(await ask(context,'p','select',data(),undefined,6000),'{"selections":[]}');
    assert.equal(calls.length,1);assert.equal(calls[0][0],'p');assert.equal(calls[0][2],6000);assert.equal(calls[0][3].includePreset,true);
    assert.equal(calls[0][4].model,'chosen-model');assert.equal(calls[0][4].json_schema.value.properties.selections.items.properties.contextIds.maxItems,32);
    assert.deepEqual(profile,{id:'p',model:'chosen-model',preset:'chosen-preset'});
    await ask(context,'p','questions',{questions:[]},undefined,1200);assert.equal(calls[1][4].json_schema,undefined);
});
test('a provider ignoring the schema still cannot inject 33 references or silently truncate them',async()=>{
    const offered=Array.from({length:34},(_,i)=>({id:`u${i}`,entryId:'event',index:i,text:`Fact ${i}.`}));
    const response=JSON.stringify({selections:[{id:'u0',priority:2,reason:'event',contextIds:offered.slice(1).map(u=>u.id)}]});
    const returned=await requestSelectionOutput({data:data(),request:async()=>response});
    assert.equal(returned,response);assert.throws(()=>selectedUnits(returned,offered),/too-many-references/);
});
test('schema support status survives the ten-stage diagnostic ring in recall evidence',()=>{
    const audit=createRecallAudit();audit.capture('selection.output-schema',{batch:3,status:'requested',message:'Limits requested.'});
    audit.capture('selection.output-schema',{batch:3,status:'unsupported',message:'API unsupported; enforcement not guaranteed.'});
    assert.match(audit.text(),/unsupported/);assert.match(audit.details(),/unsupported/);assert.doesNotMatch(audit.details(),/Limits requested/);
});
