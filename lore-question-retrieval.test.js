// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {rankFocusedChunks,chooseCandidates,questionCandidateLists,roundRobinCandidates} from './lore-retrieval.js';
import {queryVectors} from './lore-query-vectors.js';
import {prepareReview,reviewSourceTokens} from './lore-review-budget.js';
import {embeddingChunks} from './lore-core.js';
const source=(id,score,ranks,chars=1400)=>({id,index:0,title:id,score,questionRanks:ranks,
    units:[{index:0,text:id+' '+('x'.repeat(chars))}]});

test('question mode ranks a specific answer over many latest-dialogue lookalikes without changing dialogue mode',()=>{
    const chunks=Array.from({length:80},(_,i)=>({id:'sofa-'+i,index:0,text:'Relaxing on the sofa.',vector:[1,.02]}));
    const camera={id:'camera',index:0,text:'Home camera settings.',vector:[.02,1]};chunks.push(camera);
    const lanes={focus:[[1,0]],context:[[1,0]],questions:[[0,1]]};
    const before=structuredClone(chunks);
    assert.notEqual(rankFocusedChunks(chunks,lanes)[0].id,'camera');
    const ranked=rankFocusedChunks(chunks,lanes,[],{questionGroups:[[[0,1]]]});
    assert.equal(ranked[0].id,'camera');assert.deepEqual(ranked[0].questionRanks,[1]);
    assert.equal(ranked[0].questionScores[0]>0,true);
    assert.deepEqual(chunks,before);assert.deepEqual(rankFocusedChunks(chunks,lanes),rankFocusedChunks(chunks,lanes,[],{questionGroups:[]}));
});

test('all question lanes retain candidates even when a dense first topic dominates fused scores',()=>{
    const rows=Array.from({length:20},(_,i)=>source('camera-'+i,1-i*.01,[i+1,50+i,50+i]));
    rows.push(source('audio',.3,[30,1,40]),source('filming',.2,[31,40,1]));
    const chosen=chooseCandidates(rows,6,'questions');
    assert.deepEqual(chosen.slice(0,3).map(c=>c.id),['camera-0','audio','filming']);
    assert.equal(chosen.length,6);assert.equal(new Set(chosen.map(c=>c.id)).size,6);
    assert.deepEqual(chooseCandidates(rows,0,'questions'),[]);
    assert.equal(chooseCandidates(rows,1,'questions').length,1);
});

test('balanced review reserves intact sources for each question before spending remaining shared budget',()=>{
    const rows=[source('large-camera',.99,[1,8,8],4000),source('camera',.98,[2,9,9]),
        source('audio',.4,[8,1,8]),source('filming',.3,[9,8,1])];
    const before=structuredClone(rows),plan=prepareReview(rows,rows,3000);
    assert.deepEqual(plan.reviewOrder.slice(0,3).map(c=>c.entryId),['camera','audio','filming']);
    assert.deepEqual(plan.reviewOrder.slice(0,3).map(c=>c.question),[1,2,3]);
    assert(plan.offered.some(u=>u.entryId==='large-camera'),'unused shares must be reusable by an oversized intact window');
    assert.equal(plan.reviewOrderPolicy,'question-balanced-v1');
    assert.equal(plan.reviewSourceTokens,reviewSourceTokens(plan.batches));assert(plan.reviewSourceTokens<=3000);
    assert.equal(new Set(plan.offered.map(u=>u.entryId+':'+u.index)).size,plan.offered.length);
    for(const u of plan.offered)assert.equal(u.text,rows.find(c=>c.id===u.entryId).units[0].text);
    assert.deepEqual(rows,before);
});

test('shared top hit costs once and sparse or incompatible questions create no fake source',()=>{
    const rows=[source('shared',.9,[1,1,null]),source('next',.8,[2,2,null]),source('anchor',0,undefined)];
    const lists=questionCandidateLists(rows);assert.equal(lists[2].length,0);
    assert.deepEqual(roundRobinCandidates(lists).map(c=>c.id),['shared','next']);
    const plan=prepareReview(rows,rows,1000);
    assert(plan.reviewSourceTokens<=1000);assert.equal(plan.reviewOrder.filter(c=>c.entryId==='shared').length,1);
    assert.equal(plan.offered.filter(u=>u.entryId==='shared').length,1);
    assert.equal(plan.reviewedCandidates+plan.skippedCandidates,rows.length);
});

test('insufficient budgets skip whole windows rather than fabricate per-question coverage',()=>{
    const rows=[source('large',.9,[1,null],7000),source('fits',.8,[null,1],1000)];
    const plan=prepareReview(rows,rows,1000);
    assert.deepEqual(plan.offered.map(u=>u.entryId),['fits']);
    assert.equal(plan.reviewOrder.find(c=>c.entryId==='large').status,'budget');
    assert.equal(plan.skippedCandidates,1);
});

test('query grouping preserves long-question boundaries and cross-lane cache reuse without extra calls',async()=>{
    const long='camera setting. '.repeat(400),inputs={questions:['camera',long,'camera'],emphasis:[long],focus:['scene']};
    const calls=[];const result=await queryVectors(inputs,async text=>{calls.push(text);return [text.length,1];},2);
    assert.equal(result.groups.questions.length,3);
    assert.equal(result.groups.questions[1].length,embeddingChunks({content:long},1000).length);
    assert(result.groups.questions[1].length>1);
    assert.deepEqual(result.groups.questions.flat(),result.lanes.questions);
    assert.deepEqual(result.groups.questions[0],result.groups.questions[2]);
    assert.equal(calls.length,new Set(calls).size);
});
