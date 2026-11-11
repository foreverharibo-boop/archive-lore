import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { compileSideRefresh, SIDE_UPDATE_RULES } from './lore-side-story.js';
const source=fs.readFileSync(new URL('./sidePrompts.js',import.meta.url),'utf8');
const extract=(name,async=false)=>{const start=source.indexOf(`${async?'async ':''}function ${name}(`);return source.slice(start,source.indexOf('\n}\n',start)+2);};
test('manual refresh with no new dialogue keeps an empty scene without widening the range',async()=>{
 let calls=0;
 const compile=async(start,end)=>{calls++;return {start,end}};
 const result=await compileSideRefresh(20,19,{fileName:'origin'},compile);
 assert.equal(calls,0);assert.equal(result.metadata.sceneEnd,19);assert.equal(result.metadata.chatId,'origin');assert.deepEqual(result.messages,[]);
 assert.deepEqual(await compileSideRefresh(10,19,{},compile),{start:10,end:19});assert.equal(calls,1);
});
function preparationHarness(fork=true) {
 const calls=[];const memories=Array.from({length:12},(_,i)=>({title:`memory ${i}`,content:`established fact ${i}`,entry:{STMB_end:i,STMB_chatId:'origin'}}));
 const scope={archiveLoreFork:fork, SIDE_UPDATE_RULES,
  getUnifiedSidePromptTitle:()=> 'Side',getCurrentStmbChatRef:()=>({chatId:'wrong-open-chat'}),
  getSidePromptHistory:(_tpl,_macros,_kinds,ref)=>({chatId:ref.chatId}),
  resolveSidePromptHistory:(_data,h)=>(calls.push(['history',h.chatId]),{latest:{content:'prior side facts'}}),
  loadWorldInfo:async name=>(calls.push(['load',name]),{entries:{},memories}),
  resolveMemoryDefaultLorebook:async()=>{throw Error('must use origin memory book')},
  identifyMemoryEntries:data=>data.memories,
  fetchPreviousSummaries:async n=>(calls.push(['previous',n]),{summaries:[memories[0]]}),chat_metadata:{},
  resolveSidePromptAdditionalContextEntries:async()=>({entries:[]}),
  resolveSidePromptConnection:()=>({}),PLAIN_SIDE_FORMAT:'plain',
  extension_settings:{STMemoryBooks:{moduleSettings:{},profiles:[{}]}},
  applySidePromptMacros:s=>s,translate:s=>s,tr:(_k,s)=>s,
  appendSidePromptAdditionalContext(){},toReadableText:scene=>scene.messages.map(m=>m.mes).join('\n'),console,
 };
 vm.createContext(scope);vm.runInContext(extract('buildPrompt')+'\n'+extract('prepareSidePromptRun',true),scope);
 return {scope,calls};
}
test('ordinary update sends only the prior record and current dialogue, even with a legacy memory count',async()=>{
 const h=preparationHarness();const scene={metadata:{chatId:'origin',sceneStart:10,sceneEnd:19},messages:[{id:19,mes:'new promise was fulfilled'}]};
 h.scope.loadWorldInfo=async()=>{throw Error('must not load stored memories')};
 h.scope.identifyMemoryEntries=()=>{throw Error('must not scan stored memories')};
 const args={tpl:{key:'side',prompt:'Update plans',responseFormat:'plain',settings:{previousMemoriesCount:7}},loreData:{},compiledScene:scene,chatRef:{chatId:'origin'}};
 const result=await h.scope.prepareSidePromptRun(args);
 assert(result.finalPrompt.includes('prior side facts'));assert(result.finalPrompt.includes('new promise was fulfilled'));
 assert(!result.finalPrompt.includes('established fact'));assert(!result.finalPrompt.includes('SAVED STORY MEMORIES'));
 assert(result.finalPrompt.includes('Preserve existing facts and wording'));assert(result.finalPrompt.includes('return the prior record unchanged'));
 assert.deepEqual(h.calls,[['history','origin']]);
 assert.equal(scene.archiveLoreStoryMemories,undefined);
 // Older snapshots may contain the now-removed full-history attachment.
 scene.archiveLoreStoryMemories=[{title:'old memory',content:'SECRET OLD STORY'}];
 const retry=await h.scope.prepareSidePromptRun(args);
 assert(!retry.finalPrompt.includes('SECRET OLD STORY'));
 assert.equal(retry.finalPrompt,result.finalPrompt);
});
test('no-new-dialogue refresh preserves the prior record without retrieving history',async()=>{
 const h=preparationHarness();
 const scene=await compileSideRefresh(20,19,{chatId:'origin'},()=>{throw Error('must not compile')});
 const result=await h.scope.prepareSidePromptRun({tpl:{key:'side',prompt:'Update',settings:{}},loreData:{},compiledScene:scene});
 assert(result.finalPrompt.includes('prior side facts'));assert(result.finalPrompt.includes('return the prior record unchanged'));
 assert.equal(h.calls.length,1);
});
test('original Memory Books keeps its configured context count',async()=>{
 const h=preparationHarness(false);
 const result=await h.scope.prepareSidePromptRun({tpl:{key:'side',prompt:'Update',settings:{previousMemoriesCount:2}},loreData:{},compiledScene:{metadata:{sceneEnd:19},messages:[]}});
 assert(h.calls.some(c=>c[0]==='previous'&&c[1]===2));assert(result.finalPrompt.includes('DO NOT PROCESS'));assert(!result.finalPrompt.includes('=== SAVED STORY MEMORIES ==='));
});
