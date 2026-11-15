// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import dirtyJson from 'dirty-json';
import {withCollectionDate,DATE_COLLECTION_JSON_SCHEMA,validateDateCollectionResponse,splitDateMemoryResult} from './lore-date-collection.js';
import {withArchiveLoreTitle,ARCHIVE_LORE_TITLE_FORMAT} from './lore-native-title.js';
const source=fs.readFileSync(new URL('./stmemory.js',import.meta.url),'utf8');
const extract=name=>{const a=source.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));assert(a>=0,name);return source.slice(a,source.indexOf('\n}',a)+2).replace(/^export /,'');};
const ranges=[{start:0,end:1,date:'2028-11-12'},{start:2,end:3,date:'2028-11-13'}];
const response={memories:[{id:0,content:'Detailed events A.',keywords:['A']},{id:1,content:'Detailed events B.',keywords:['B']}]};
function harness() {
 const calls=[];
 const scope={archiveLoreFork:true,console:{debug(){},warn(){}},dirtyJson,
   withCollectionDate,withArchiveLoreTitle,DATE_COLLECTION_JSON_SCHEMA,validateDateCollectionResponse,splitDateMemoryResult,
   AIResponseError:class extends Error{},TokenWarningError:class extends Error{},InvalidProfileError:class extends Error{},
   extension_settings:{STMemoryBooks:{moduleSettings:{maxTokens:30000}}},oai_settings:{},MODULE_NAME:'test',
   applyGroupMemoryPolicy(){},getGroupMemoryProfile:p=>p,validateInputs(){},getEffectivePrompt:async()=> 'CUSTOM PROMPT: preserve all detailed events.',
   substituteParams:s=>s,resolveAdditionalContextEntries:async()=>({entries:[]}),appendAdditionalContextSection(){},translate:s=>s,
   estimateTokenUsage:async()=>({total:20}),waitForCharacterData:async()=>true,normalizeCompletionSource:s=>s,getCurrentApiInfo:()=>({api:'openai'}),isStmbStopError:()=>false,
   sendRawCompletionRequest:async(request)=>{calls.push(request);return {text:JSON.stringify(response),full:{choices:[{finish_reason:'stop'}]}};},
 };
 vm.createContext(scope);
 vm.runInContext(source.slice(source.indexOf('const MEMORY_RESPONSE_JSON_SCHEMA'),source.indexOf('// --- ST Regex')),scope);
 for(const name of ['normalizeText','extractFencedBlocks','extractBalancedJson','uniqStrings','hasAnyJsonDelimiter','likelyUnbalanced','endsNicely','makeAIError','extractFromClaudeStructuredFormat','parseAIJsonResponse','assertProviderDidNotTruncate','shouldUseStructuredOutput','shouldFallbackFromStructuredOutput','formatSceneForAI','buildPrompt','generateMemoryWithAI','processJsonResult','createMemory'])vm.runInContext(extract(name),scope);
 const scene={metadata:{sceneStart:0,sceneEnd:3,messageCount:4,chatId:'chat',archiveLoreDateRanges:ranges},messages:[0,1,2,3].map(id=>({id,name:'Character',mes:`Message ${id}`}))};
 const profile={name:'Custom',titleFormat:ARCHIVE_LORE_TITLE_FORMAT,connection:{api:'openai'}};
 return {scope,calls,scene,profile,run:()=>scope.createMemory(scene,profile)};
}
test('actual generation sends full transcript once with batch schema and returns dated standard entries',async()=>{
 const h=harness(),result=await h.run();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].jsonSchema,DATE_COLLECTION_JSON_SCHEMA);assert.equal(h.calls[0].extra.max_tokens,30000);
 assert.match(h.calls[0].prompt,/CUSTOM PROMPT/);for(let i=0;i<4;i++)assert(h.calls[0].prompt.includes(`[Message #${i}] Character: Message ${i}`));
 assert.deepEqual(Array.from(result.dateMemories,m=>m.extractedTitle),['2028-11-12','2028-11-13']);
 assert.deepEqual(Array.from(result.dateMemories,m=>m.metadata.sceneRange),['0-1','2-3']);assert.equal(result.metadata.sceneRange,'0-3');
});
test('actual parser accepts complete fenced output, rejects truncated/missing/duplicate date groups',()=>{
 const h=harness();assert.equal(h.scope.parseAIJsonResponse('```json\n'+JSON.stringify(response)+'\n```',{dateRanges:ranges}).memories.length,2);
 for(const text of [JSON.stringify(response).slice(0,-2),JSON.stringify({memories:[response.memories[0]]}),JSON.stringify({memories:[response.memories[0],response.memories[0]]})])
  assert.throws(()=>h.scope.parseAIJsonResponse(text,{dateRanges:ranges}));
});
test('provider truncation is rejected even if the returned batch happens to be valid JSON',async()=>{
 const h=harness();h.scope.sendRawCompletionRequest=async()=>({text:JSON.stringify(response),full:{choices:[{finish_reason:'length'}]}});
 await assert.rejects(h.run(),e=>e.code==='PROVIDER_TRUNCATION');
});
test('ordinary single-memory generation retains original JSON schema and result',async()=>{
 const h=harness();delete h.scene.metadata.archiveLoreDateRanges;
 h.scope.sendRawCompletionRequest=async(request)=>{h.calls.push(request);return{text:JSON.stringify({content:'Normal memory',title:'Normal title',keywords:['normal']}),full:{}};};
 const result=await h.run();assert.equal(h.calls[0].jsonSchema.name,'stmb_memory');assert.equal(result.content,'Normal memory');assert.equal(result.dateMemories,undefined);
});
