import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SIDE_COMMON, DEFAULT_SIDES } from './lore-side-config.js';
import { adaptArchiveSideTemplate, migrateArchiveSideTemplates, PLAIN_SIDE_FORMAT, validatePlainSideRecord } from './lore-native-side.js';

test('all six migrated records use readable record formats without old JSON operation instructions',()=>{
 const rows=DEFAULT_SIDES.map(side=>adaptArchiveSideTemplate({key:side.id,prompt:SIDE_COMMON+'\n'+side.prompt,responseFormat:'',settings:{archiveLoreSetOnly:true}}));
 assert.equal(rows.length,6);
 for(const tpl of rows){
  assert.equal(tpl.responseFormat,PLAIN_SIDE_FORMAT);
  assert.doesNotMatch(tpl.prompt,/Return only change operations|sideChanges|relationship\.kind|dateEvidence for/);
 }
 assert.match(rows[0].prompt,/one short current label/);
 assert.match(rows[0].prompt,/Preserve a known phase start date/);
});
test('existing imported templates upgrade idempotently without changing custom/native templates or record contents',()=>{
 const old={key:'old',prompt:SIDE_COMMON+'\n'+DEFAULT_SIDES[0].prompt,responseFormat:'',settings:{archiveLoreSetOnly:true}};
 const custom={...old,key:'custom',prompt:'My instruction about names',responseFormat:'My own format'};
 const native={key:'native',prompt:'native JSON format',settings:{}};
 const doc={prompts:{old,custom,native},sets:{set:{items:['old','custom']}},version:2};
 const next=migrateArchiveSideTemplates(doc);
 assert.equal(doc.prompts.old.responseFormat,'');
 assert.equal(next.prompts.old.responseFormat,PLAIN_SIDE_FORMAT);
 assert.deepEqual(next.prompts.custom,custom);assert.deepEqual(next.prompts.native,native);assert.deepEqual(next.sets,doc.sets);
 assert.equal(migrateArchiveSideTemplates(next),null);
 const edited=adaptArchiveSideTemplate({...old,prompt:'Use aliases Dana and Shin.'});assert.match(edited.prompt,/Use aliases Dana and Shin/);
});
test('JSON and no-change commentary fail closed, while factual plain records remain usable',()=>{
 for(const text of ['```json\n{"relationship":"Married","since":null}\n```','No permanent turning point or fundamental shift in trust occurred in this scene.','Some explanation\n{"turningPoints":[]}','No changes.'])assert.throws(()=>validatePlainSideRecord(text),/저장하지 않았습니다/);
 for(const text of ['Married','Married\nSince: 2027-06-18','Not established.','- Dana declined the invitation.\n- Shin has no plans to move.'])assert.equal(validatePlainSideRecord(text),text);
});
test('actual side LLM path validates after response/regex and leaves unrelated templates unchanged',async()=>{
 const src=fs.readFileSync(new URL('./sidePrompts.js',import.meta.url),'utf8');const a=src.indexOf('async function runLLM('),b=src.indexOf('\n}\n',a)+2;
 let result='```json\n{"relationship":"Married"}\n```',calls=0;
 const scope={validatePlainSideRecord,normalizeCompletionSource:s=>s,extension_settings:{},oai_settings:{},MODULE_NAME:'test',console:{debug(){},warn(){}},assertProviderDidNotTruncate(){},requestCompletion:async()=>{calls++;return{text:result,full:{}};}};
 vm.runInNewContext(src.slice(a,b),scope);
 await assert.rejects(scope.runLLM('prompt',{api:'openai',archiveLorePlainRecord:true}),/저장하지 않았습니다/);
 assert.equal(calls,1);
 assert.equal(await scope.runLLM('prompt',{api:'openai'}),result);
 result='Married';assert.equal(await scope.runLLM('prompt',{api:'openai',archiveLorePlainRecord:true}),'Married');
});
