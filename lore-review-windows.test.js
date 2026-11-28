// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareReview,reviewSourceTokens} from './lore-review-budget.js';
import {createReviewWindows} from './lore-review-windows.js';
import {reviewUnits,normalizeSettings,estimateTokens,DEFAULT_PROMPTS} from './lore-core.js';
import {selectorMemories} from './lore-retrieval.js';
import {PREVIOUS_FOCUSED_QUESTIONS,PREVIOUS_CONTEXT_SELECT} from './lore-prompts.js';

const make=(id,texts,start=0,index=0)=>({id,index,title:id,book:'book',source:{hashes:[id]},score:.9,
    units:texts.map((text,i)=>({index:start+i,text}))});
const filler=Array.from({length:16},(_,i)=>`They discussed recipe ${i} at breakfast. `+'The soup tasted mild. '.repeat(12));

test('focused windows admit more distinct candidates under the same shared budget without rewriting source',()=>{
    const chunks=Array.from({length:8},(_,i)=>make('event-'+i,[...filler,`The emergency beacon${i} was installed beside the window.`,...filler]));
    const questions=chunks.map((_,i)=>`Where was emergency beacon${i} installed?`);
    const before=structuredClone(chunks),old=prepareReview(chunks,chunks,5000),next=prepareReview(chunks,chunks,5000,questions);
    assert(next.reviewedCandidates>old.reviewedCandidates);
    assert.equal(next.reviewedCandidates,8);
    assert.equal(next.reviewSourceTokens,reviewSourceTokens(next.batches));assert(next.reviewSourceTokens<=5000);
    assert.equal(next.reviewScope,'query-focused-outcomes-v2');
    for(const unit of next.offered)assert.deepEqual({...unit,id:undefined},{...reviewUnits(chunks).find(u=>u.entryId===unit.entryId&&u.index===unit.index),id:undefined});
    assert.deepEqual(chunks,before);
});

test('guard withdrawal across distant chunks accompanies the original deployment with its neighboring context',()=>{
    const chunks=[make('home',[...filler,'He stationed bodyguards outside the apartment door.',...filler]),
        make('home',['She objected to the restrictions.','He ordered all guards to retreat to the basement.','They agreed to discuss it later.'],33,4)];
    const plan=prepareReview([chunks[0]],chunks,3000,['What bodyguards were stationed at the apartment?']);
    assert(plan.offered.some(u=>u.text.includes('stationed bodyguards')));
    assert(plan.offered.some(u=>u.text.includes('guards to retreat')));
    assert(plan.offered.some(u=>u.text.includes('objected')));
    assert(plan.offered.some(u=>u.text.includes('discuss it later')));
    assert.equal(new Set(plan.offered.map(u=>u.id)).size,plan.offered.length);
});

test('linked resolution cannot be silently discarded to fit its setup into a small budget',()=>{
    const chunks=[make('loan',['Morgan borrowed a telescope.']),
        make('loan',['Morgan returned the telescope. '+'The signed receipt remained legible. '.repeat(100)],1,4)];
    const plan=prepareReview([chunks[0]],chunks,1000,['What telescope did Morgan borrow?']);
    assert.equal(plan.reviewedCandidates,0);assert.equal(plan.skippedCandidates,1);assert.equal(plan.offered.length,0);
});

test('negated outcomes remain exact and unrelated status words cannot manufacture a connection',()=>{
    const chunks=[make('loan',[...filler,'Morgan borrowed a telescope.',...filler]),
        make('loan',['Morgan had not returned the telescope.'],33,4),
        make('loan',['Morgan canceled a bakery order.'],60,8)];
    const nearby=reviewUnits([chunks[0]]),result=createReviewWindows(chunks,['What happened to the telescope?'])(chunks[0],nearby,nearby);
    assert(result.units.some(u=>u.text==='Morgan had not returned the telescope.'));
    assert(!result.units.some(u=>u.text.includes('bakery')));
    assert(!result.units.some(u=>u.text==='Morgan returned the telescope.'));
});

test('semantic-only queries retain the complete original review window',()=>{
    const chunks=[make('home',['그는 비상 연락처를 알려 주었다.','그녀는 번호를 저장했다.'])];
    assert.deepEqual(prepareReview(chunks,chunks,1000,['Which emergency contact is available?']).offered,
        prepareReview(chunks,chunks,1000).offered);
});

test('global overlap and batch limits still apply when focused windows overlap',()=>{
    const chunks=Array.from({length:20},(_,i)=>make('entry-'+i,[...filler,`The signal${i} was disabled after testing.`,...filler]));
    const questions=chunks.map((_,i)=>`What happened to signal${i}?`);
    for(const limit of [1000,5000,16000]){
        const p=prepareReview([...chunks,chunks[0]],chunks,limit,questions);
        assert(p.reviewSourceTokens<=limit);assert.equal(p.reviewSourceTokens,reviewSourceTokens(p.batches));
        assert(p.batches.every(b=>estimateTokens(JSON.stringify(selectorMemories(b)))<=10000));
        assert.equal(new Set(p.offered.map(u=>u.entryId+':'+u.index)).size,p.offered.length);
    }
});

test('revision ten migrates only exact old defaults and preserves user prompts, collection and limits',()=>{
    const saved={promptRevision:9,prompts:{questions:PREVIOUS_FOCUSED_QUESTIONS,select:PREVIOUS_CONTEXT_SELECT,collect:'My collector'},reviewTokens:5000,injectionTokens:3000};
    const before=structuredClone(saved),next=normalizeSettings(saved);
    assert.equal(next.promptRevision,12);assert.equal(next.prompts.questions,DEFAULT_PROMPTS.questions);assert.equal(next.prompts.select,DEFAULT_PROMPTS.select);
    assert.equal(next.prompts.collect,'My collector');assert.equal(next.reviewTokens,5000);assert.equal(next.injectionTokens,3000);assert.deepEqual(saved,before);
    const custom=normalizeSettings({...saved,prompts:{questions:PREVIOUS_FOCUSED_QUESTIONS+'\nMy rule',select:'Custom selection'}});
    assert.equal(custom.prompts.questions,PREVIOUS_FOCUSED_QUESTIONS+'\nMy rule');assert.equal(custom.prompts.select,'Custom selection');
    const exported=JSON.parse(fs.readFileSync(new URL('./prompts/archive-lore-defaults.json',import.meta.url)));
    assert.equal(exported.prompts.questions,DEFAULT_PROMPTS.questions);assert.equal(exported.prompts.select,DEFAULT_PROMPTS.select);
    assert.deepEqual(normalizeSettings(next),next);
});
