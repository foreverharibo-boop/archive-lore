// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings,estimateTokens,embeddingChunks} from './lore-core.js';
import {prepareReview,reviewSourceTokens,DEFAULT_REVIEW_TOKENS} from './lore-review-budget.js';
import {selectorMemories} from './lore-retrieval.js';
import {createDiagnostics} from './lore-diagnostics.js';
const chunk=(id,index,n=10)=>({id,index,title:'Original title',book:'book',source:{hashes:['original']},units:Array.from({length:n},(_,i)=>({index:index*n+i,text:`Original ${id} sentence ${index*n+i}. `+'원문 '.repeat(12)}))});
test('default and saved review budgets normalize independently of final injection limits',()=>{
 assert.equal(normalizeSettings().reviewTokens,DEFAULT_REVIEW_TOKENS);
 for(const [input,want] of [[1000,1000],[12000,12000],['16000',16000],[0,1000],[-1,1000],[1e9,64000],['bad',8000],[null,8000]]){
  const config=normalizeSettings({reviewTokens:input,injectionTokens:5000});assert.equal(config.reviewTokens,want);assert.equal(config.injectionTokens,5000);
 }
});
test('a hit never expands to a whole long entry and admitted text and identity stay exact',()=>{
 const chunks=Array.from({length:100},(_,i)=>chunk('a',i)),before=structuredClone(chunks);
 const plan=prepareReview([chunks[50]],chunks,64000);
 assert.equal(plan.offered.length,30);assert(plan.offered.every(u=>u.index>=490&&u.index<520));
 assert(plan.offered.some(u=>u.index===499));assert(plan.offered.some(u=>u.index===510));
 for(const unit of plan.offered){assert.equal(unit.text,chunks.flatMap(c=>c.units).find(u=>u.index===unit.index).text);assert.equal(unit.entryId,'a');assert.deepEqual(unit.source,{hashes:['original']});}
 assert.deepEqual(chunks,before);
});
test('ranked hits get space before extra neighboring chunks and overlaps are deduplicated',()=>{
 const chunks=[chunk('a',0),chunk('a',1),chunk('a',2),chunk('b',0)];
 const plan=prepareReview([chunks[1],chunks[3],chunks[1]],chunks,2000);
 assert(plan.offered.some(u=>u.entryId==='a'));assert(plan.offered.some(u=>u.entryId==='b'));
 assert.equal(new Set(plan.offered.map(u=>JSON.stringify([u.entryId,u.index]))).size,plan.offered.length);
 assert.equal(new Set(plan.offered.map(u=>u.id)).size,plan.offered.length);
 assert(plan.reviewSourceTokens<=2000);
});
test('global budget includes repeated originals at batch boundaries and applies at each configured limit',()=>{
 const chunks=Array.from({length:80},(_,i)=>chunk('a',i)),candidates=chunks.filter((_,i)=>i%3===1);
 for(const limit of [1000,4000,8000,16000,64000]){
  const plan=prepareReview(candidates,chunks,limit);
  assert(plan.batches.length>0);assert.equal(plan.reviewSourceTokens,reviewSourceTokens(plan.batches));assert(plan.reviewSourceTokens<=limit);
  assert(plan.batches.every(b=>estimateTokens(JSON.stringify(selectorMemories(b)))<=10000));
  assert.equal(new Set(plan.batches.flat().map(u=>u.id)).size,plan.offered.length);
 }
 const small=prepareReview(candidates,chunks,4000),large=prepareReview(candidates,chunks,16000);
 assert(large.offered.length>small.offered.length);assert(large.batches.length>1);
 assert(large.reviewSourceTokens>reviewSourceTokens([large.offered]),'boundary duplicates must count against the total');
});
test('over-budget windows are skipped whole while later smaller candidates can still fit',()=>{
 const large=chunk('large',0,1);large.units[0].text='원'.repeat(2000);
 const small=chunk('small',0,1),plan=prepareReview([large,small],[large,small],1000);
 assert.equal(plan.skippedCandidates,1);assert.equal(plan.offered.length,1);assert.equal(plan.offered[0].text,small.units[0].text);
 assert.equal(prepareReview([large],[large],1000).batches.length,0);
});
test('neighboring unindexed source can be included without rewriting abbreviations or source boundaries',()=>{
 const entry={comment:'Visit',content:'Dr. Lee arrived at 8:30 p.m. '+('The coat remained with Morgan that day. '.repeat(100))+'Lee accepted the hanger and put the coat in his locker.'};
 const chunks=embeddingChunks(entry).map(c=>({...c,id:'visit',title:'Visit'}));
 assert(chunks.length>1);
 const plan=prepareReview([chunks.at(-2)],chunks,8000);
 assert(plan.offered.some(u=>u.text.includes('accepted the hanger')));assert(plan.offered.every(u=>entry.content.includes(u.text)));
});
test('diagnostic preview retains budget, skipped candidates and actual bounded scope',async()=>{
 const chunks=Array.from({length:20},(_,i)=>chunk('entry'+i,0));const plan=prepareReview(chunks,chunks,1000),{offered,batches,...stats}=plan;
 const d=createDiagnostics(),trace=d.begin();await trace.event('selection.plan',{...stats,policy:'test',units:offered.length,batches:batches.length,concurrency:2});
 const text=await d.preview();assert(text.includes(`${plan.reviewSourceTokens} / 1000`));assert(text.includes(`${plan.skippedCandidates}개 제외`));assert(text.includes('retrieved-nearby-v1'));
});
