// Archive Lore — AGPL-3.0-only
import { estimateTokens, integer, reviewUnits } from './lore-core.js';
import { reviewCandidates, reviewBatches, selectorMemories, questionCandidateLists, roundRobinCandidates } from './lore-retrieval.js';
import { createReviewWindows } from './lore-review-windows.js';

export const DEFAULT_REVIEW_TOKENS = 8000;
export const normalizeReviewTokens = value => integer(value ?? DEFAULT_REVIEW_TOKENS, DEFAULT_REVIEW_TOKENS, 1000, 64000);
export const BOUNDED_REVIEW_PROMPT = `\n\nBOUNDED SOURCE REVIEW
The supplied memories are retrieved excerpts with nearby original context, NOT complete entries or the entire history. Source indices can contain gaps. Never infer that an omitted outcome did not happen, that an old obligation is still pending, or that another batch will provide missing evidence. Select only facts that can be faithfully understood from this batch. Preserve required attribution, conditions, negation and supported outcomes together; omit an event if essential context is missing. Keep original wording. Do not request or fabricate missing IDs.`;
const key = unit => JSON.stringify([unit.entryId, unit.index]);

// Count original text across ALL planned batches, including boundary overlap.
// Instructions, recent dialogue and JSON labels are not original-memory tokens.
export function reviewSourceTokens(batches) {
    return batches.reduce((total,batch)=>total+batch.reduce((sum,u)=>sum+estimateTokens(u.text),0),0);
}

export function prepareReview(candidates, chunks, tokenLimit, queries = []) {
    const limit=normalizeReviewTokens(tokenLimit),selected=new Map(),identities=new Map(),accepted=[];
    // Candidate reservations preserve recall coverage, not review priority. Anchor
    // matches are inserted first by chooseCandidates even with weak vector ranks.
    // Fused-score order is the dialogue/default priority and a stable tie order
    // for question lists. Question mode gets the balanced admission pass below.
    const ranked=[...candidates].sort((a,b)=>(Number.isFinite(b.score)?b.score:0)-(Number.isFinite(a.score)?a.score:0));
    const questionLists=questionCandidateLists(ranked),balanced=questionLists.some(list=>list.length);
    const reviewOrder=[];
    let batches=[],sourceTokens=0,skippedCandidates=0,expandedContexts=0,focusedCandidates=0;
    const focusWindow=createReviewWindows(chunks,queries);
    const identify=units=>units.map(unit=>{
        const id=key(unit);
        if(!identities.has(id))identities.set(id,{...unit,id:`u${identities.size}`});
        return identities.get(id);
    });
    function admit(units,allowance=limit) {
        const additions=identify(units).filter(unit=>!selected.has(key(unit)));
        if(!additions.length)return true;
        // Cheap lower bound before constructing batches; never split a source window to fit.
        if(reviewSourceTokens([[...selected.values(),...additions]])>limit)return false;
        const next=reviewBatches([...selected.values(),...additions]);
        const tokens=reviewSourceTokens(next);
        if(tokens>limit || tokens-sourceTokens>allowance || next.some(batch=>estimateTokens(JSON.stringify(selectorMemories(batch)))>10000))return false;
        for(const unit of additions)selected.set(key(unit),unit);
        batches=next;sourceTokens=tokens;return true;
    }
    // Prioritize retrieved chunks, each with up to two source units either side.
    // Only the immediately adjacent chunks are eligible for context expansion.
    const windows=new Map(),included=new Set();
    const candidateKey=c=>JSON.stringify([c.id,c.index]);
    function sourceWindow(candidate){
        const id=candidateKey(candidate);if(windows.has(id))return windows.get(id);
        const neighborhood=reviewCandidates([candidate],chunks);
        const units=reviewUnits(neighborhood);
        const core=new Set((candidate.reviewUnits||candidate.units||[]).map(u=>u.index));
        const first=units.findIndex(u=>u.entryId===candidate.id&&core.has(u.index));
        const last=units.findLastIndex(u=>u.entryId===candidate.id&&core.has(u.index));
        const fallback=first<0?null:units.slice(Math.max(0,first-2),last+3);
        const focused=focusWindow(candidate,units,fallback);
        const value={neighborhood,window:focused.units,focused:focused.focused};
        windows.set(id,value);return value;
    }
    function attempt(candidate,allowance,question,final){
        const id=candidateKey(candidate);if(included.has(id))return true;
        const {neighborhood,window,focused}=sourceWindow(candidate),ok=window&&admit(window,allowance);
        if(ok){included.add(id);accepted.push({candidate,neighborhood});if(focused)focusedCandidates++;}
        if(ok||final){
            reviewOrder.push({entryId:candidate.id,index:candidate.index,title:candidate.title,score:candidate.score,
                questionRanks:candidate.questionRanks,questionScores:candidate.questionScores,question,
                status:ok?'reviewed':window?'budget':'missing-source',focused:!!focused});
            if(!ok)skippedCandidates++;
        }
        return !!ok;
    }
    if(balanced){
        // First offer each question one intact source window within an equal
        // share. Shared hits cost nothing twice. Unused shares are released;
        // oversized windows are reconsidered below, never chopped to fit.
        const share=Math.floor(limit/questionLists.filter(list=>list.length).length);
        questionLists.forEach((list,q)=>{
            for(const candidate of list)if(attempt(candidate,share,q+1,false))break;
        });
    }
    const queue=balanced?[...new Map([...roundRobinCandidates(questionLists),...ranked].map(c=>[candidateKey(c),c])).values()]:ranked;
    for(const candidate of queue)attempt(candidate,limit,null,true);
    // Spend remaining space on nearby context only after ranked hits have had a chance.
    for(const {candidate,neighborhood} of accepted){
        for(const chunk of neighborhood.filter(c=>c.index!==candidate.index)){
            const units=reviewUnits([chunk]);
            if(units.every(u=>selected.has(key(u))))continue;
            if(admit(units))expandedContexts++;
        }
    }
    return {offered:[...selected.values()],batches,reviewTokenLimit:limit,reviewSourceTokens:sourceTokens,
        skippedCandidates,reviewedCandidates:accepted.length,expandedContexts,focusedCandidates,
        reviewScope:focusedCandidates?'query-focused-outcomes-v2':'retrieved-nearby-v1',
        reviewOrderPolicy:balanced?'question-balanced-v1':'fused-score-first-v1',reviewOrder};
}
