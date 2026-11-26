// Archive Lore — AGPL-3.0-only
import { estimateTokens, integer, reviewUnits } from './lore-core.js';
import { reviewCandidates, reviewBatches, selectorMemories } from './lore-retrieval.js';

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

export function prepareReview(candidates, chunks, tokenLimit) {
    const limit=normalizeReviewTokens(tokenLimit),selected=new Map(),identities=new Map(),accepted=[];
    let batches=[],sourceTokens=0,skippedCandidates=0,expandedContexts=0;
    const identify=units=>units.map(unit=>{
        const id=key(unit);
        if(!identities.has(id))identities.set(id,{...unit,id:`u${identities.size}`});
        return identities.get(id);
    });
    function admit(units) {
        const additions=identify(units).filter(unit=>!selected.has(key(unit)));
        if(!additions.length)return true;
        // Cheap lower bound before constructing batches; never split a source window to fit.
        if(reviewSourceTokens([[...selected.values(),...additions]])>limit)return false;
        const next=reviewBatches([...selected.values(),...additions]);
        const tokens=reviewSourceTokens(next);
        if(tokens>limit || next.some(batch=>estimateTokens(JSON.stringify(selectorMemories(batch)))>10000))return false;
        for(const unit of additions)selected.set(key(unit),unit);
        batches=next;sourceTokens=tokens;return true;
    }
    // Prioritize retrieved chunks, each with up to two source units either side.
    // Only the immediately adjacent chunks are eligible for context expansion.
    for(const candidate of candidates){
        const neighborhood=reviewCandidates([candidate],chunks);
        const units=reviewUnits(neighborhood);
        const core=new Set((candidate.reviewUnits||candidate.units||[]).map(u=>u.index));
        const first=units.findIndex(u=>u.entryId===candidate.id&&core.has(u.index));
        const last=units.findLastIndex(u=>u.entryId===candidate.id&&core.has(u.index));
        if(first<0){skippedCandidates++;continue;}
        const window=units.slice(Math.max(0,first-2),last+3);
        if(admit(window))accepted.push({candidate,neighborhood});else skippedCandidates++;
    }
    // Spend remaining space on nearby context only after ranked hits have had a chance.
    for(const {candidate,neighborhood} of accepted){
        for(const chunk of neighborhood.filter(c=>c.index!==candidate.index)){
            const units=reviewUnits([chunk]);
            if(units.every(u=>selected.has(key(u))))continue;
            if(admit(units))expandedContexts++;
        }
    }
    return {offered:[...selected.values()],batches,reviewTokenLimit:limit,reviewSourceTokens:sourceTokens,
        skippedCandidates,reviewedCandidates:accepted.length,expandedContexts,reviewScope:'retrieved-nearby-v1'};
}
