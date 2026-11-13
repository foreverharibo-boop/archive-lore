// Archive Lore — AGPL-3.0-only
import { parseJson, reviewUnits } from './lore-core.js';
import { reviewCandidates, reviewBatches, selectorMemories } from './lore-retrieval.js';
import { fitFocusedInjection } from './lore-focus-injection.js';
import { normalizeSelectionFocus, orderFocusedUnits, selectionFocusPrompt } from './lore-selection-focus.js';
import { mapOrdered } from './lore-parallel.js';

export const GENEROUS_TARGET = .9;
export const GENEROUS_CANDIDATE_LIMIT = 40;
const unitKey = u => JSON.stringify([u.entryId, u.index]);
const chunkKey = c => JSON.stringify([c.id, c.index]);

export const GENEROUS_SELECTION_PROMPT = `
GENEROUS RELATED MEMORY MODE
For this mode, the following relevance and output rules replace earlier restrictions to indispensable facts, a small selection count, or a terse answer. Preserve all other source-fidelity and user exclusions.
Classify EVERY supplied memory unit exactly once. Priority 3: directly addresses the present request. Priority 2: related background that can enrich this scene or keep character reactions consistent, including connected experiences, preferences, promises, feelings with their recorded reasons, and distinctive event details. Priority 2 does NOT require a priority-3 fact and does NOT need to be indispensable. Do not reject related material merely because the current reply is possible without it, it is old, or enough other facts have already been selected. Do not stop after 24 units. The program, not you, fills the token budget from the complete related pool.
Priority 0 is allowed ONLY for unrelated material, unresolved attribution/meaning (ambiguous), or a genuine duplicate of a retained unit (duplicate). For duplicate, name duplicateOf from this batch with priority 2 or 3. A shared character name alone does not establish relevance; a different date or location alone does not disprove a concrete connection. Never invent connections to fill space. Explain a concrete connection or exclusion in a brief reason, not hidden reasoning.
For each retained unit include contextIds (up to 8 IDs from the SAME entry in this batch) needed for owner, speaker, chronology, pronoun, condition, negation or a contrasting counterpart. These sentences are retained together or omitted together. Do not include unrelated sentences as context. Never rewrite or summarize the original text. Preserve uncertainty and distinguish past events from current status.
Return ONLY JSON: {"reviews":[{"id":"u0","priority":2,"reason":"Recorded preference relates to the current outing","contextIds":[]},{"id":"u1","priority":0,"exclusion":"unrelated","reason":"Different event with no connection to this scene"}]}.
Each supplied ID must occur exactly once, even when everything is unrelated. Include focusMatches for retained units when selectionFocus is supplied, using only checked categories supported by the source. Never omit an ID or substitute a selections list. No token quota or minimum number of retained units is imposed on the reviewer.`;

export function parseGenerousReviews(response, offered, selectionFocus = []) {
    const rows = parseJson(response)?.reviews;
    const allowed = new Map(offered.map(u => [u.id, u])), seen = new Set();
    if (!Array.isArray(rows) || rows.length !== allowed.size) throw Error('넉넉한 주입 검토에서 일부 문장의 판정이 빠졌어.');
    for (const row of rows) {
        if (!row || !allowed.has(row.id) || seen.has(row.id) || ![0,2,3].includes(row.priority)
            || typeof row.reason !== 'string' || !row.reason.trim()) throw Error('넉넉한 주입 검토 형식이 올바르지 않아.');
        seen.add(row.id);
        if (row.priority === 0 && !['unrelated','ambiguous','duplicate'].includes(row.exclusion)) throw Error('기억 제외 이유를 확인할 수 없어.');
        if (row.contextIds !== undefined && (!Array.isArray(row.contextIds) || row.contextIds.length > 8
            || row.contextIds.some(id => !allowed.has(id) || allowed.get(id).entryId !== allowed.get(row.id).entryId))) throw Error('기억 선별의 연결 문장 형식이 올바르지 않아.');
    }
    for (const row of rows) if (row.priority === 0 && row.exclusion === 'duplicate'
        && !rows.some(other => other.id === row.duplicateOf && other.priority >= 2 && other.id !== row.id)) throw Error('중복으로 제외한 기억의 원본을 확인할 수 없어.');
    const reviews = rows.map(row => ({...row,reason:row.reason.trim().slice(0,240)}));
    const selected = reviews.filter(row => row.priority >= 2).map(row => ({
        ...allowed.get(row.id), priority:row.priority, reason:row.reason, selectionFormat:'generous',
        focusMatches:normalizeSelectionFocus(row.focusMatches).filter(id => selectionFocus.includes(id)),
        requiredContext:[...new Set(row.contextIds || [])].filter(id => id !== row.id).map(id => allowed.get(id)),
    }));
    return {reviews, selected};
}

// Bound output size too: short source sentences can otherwise yield hundreds of IDs.
function generousBatches(units) {
    return reviewBatches(units,4000).flatMap(batch => {
        const result=[];let start=0;
        while(start<batch.length){
            const end=Math.min(start+48,batch.length);result.push(batch.slice(start,end));
            if(end===batch.length)break;
            let overlap=0;
            while(overlap<8 && end-overlap>start && batch[end-overlap-1].entryId===batch[end].entryId)overlap++;
            start=end-overlap;
        }
        return result;
    });
}

export async function generousRecall({candidates, expandedCandidates, chunks, config, latestUser, dialogue, questions,
    ask, countTokens, signal, log=async()=>{}, notify=()=>{}}) {
    const combined=[...candidates], seenChunks=new Set(candidates.map(chunkKey));
    for(const candidate of expandedCandidates){
        if(combined.length>=GENEROUS_CANDIDATE_LIMIT)break;
        if(!seenChunks.has(chunkKey(candidate))){combined.push(candidate);seenChunks.add(chunkKey(candidate));}
    }
    const all=reviewUnits(reviewCandidates(combined,chunks));
    const initialKeys=new Set(reviewUnits(reviewCandidates(candidates,chunks)).map(unitKey));
    const decisions=new Map(), selected=new Map();let expanded=false;
    const review=async(units,pass)=>{
        const batches=generousBatches(units);
        await log('selection.plan',{policy:'generous-related-v1',pass,selectionFocus:config.selectionFocus,units:units.length,batches:batches.length,concurrency:config.selectionConcurrency});
        const results=await mapOrdered(batches,config.selectionConcurrency,async(batch,index,signal)=>{
            notify(pass===1?'관련 기억을 넉넉하게 검토하는 중':'주입량이 90% 미만 · 추가 기억 검토 중');
            for(let attempt=0;attempt<2;attempt++){
                signal.throwIfAborted();
                const response=await ask(config.prompts.select+selectionFocusPrompt(config.selectionFocus)+GENEROUS_SELECTION_PROMPT
                    +(attempt?'\nThe previous reply was incomplete or invalid. Include exactly one valid review for EVERY supplied ID.':''),
                    {latestUser,dialogue,questions,memories:selectorMemories(batch),batch:index+1,batchCount:batches.length,
                        pass,injectionBudgetTokens:config.injectionTokens,...(config.selectionFocus.length?{selectionFocus:config.selectionFocus}:{})},signal,6000);
                try {
                    const result=parseGenerousReviews(response,batch,config.selectionFocus);
                    await log('selection.validated',{policy:'generous-related-v1',pass,batch:index+1,offered:batch,rawResponse:response,...result});
                    return result;
                } catch(error) {
                    signal.throwIfAborted();
                    await log('selection.invalid',{policy:'generous-related-v1',pass,batch:index+1,attempt:attempt+1,message:error.message,response});
                    if(attempt===1)throw error;
                }
            }
        },signal);
        for(const result of results){
            // Overlap is context for the next batch, not a second veto on a
            // previously accepted unit. Preserve the strongest supported review.
            for(const row of result.reviews)if(!decisions.has(row.id) || decisions.get(row.id).priority<row.priority)decisions.set(row.id,row);
            for(const unit of result.selected){
                const prior=selected.get(unit.id);
                if(!prior){selected.set(unit.id,unit);continue;}
                const context=new Map([...prior.requiredContext,...unit.requiredContext].map(u=>[unitKey(u),u]));
                selected.set(unit.id,{...(prior.priority>=unit.priority?prior:unit),requiredContext:[...context.values()]});
            }
        }
    };
    const fit=()=>fitFocusedInjection(orderFocusedUnits([...selected.values()].sort((a,b)=>b.priority-a.priority),config.selectionFocus),config,countTokens);
    await review(all.filter(u=>initialKeys.has(unitKey(u))),1);
    let fitted=await fit();const initialTokens=fitted.tokens,targetTokens=Math.ceil(config.injectionTokens*GENEROUS_TARGET);
    // Review only newly reached entries/regions; carry their same-entry context with them.
    const extraEntries=new Set(all.filter(u=>!initialKeys.has(unitKey(u))).map(u=>u.entryId));
    if(fitted.tokens<targetTokens && extraEntries.size){
        expanded=true;
        await review(all.filter(u=>extraEntries.has(u.entryId)),2);
        fitted=await fit();
    }
    signal.throwIfAborted();
    const fill={targetTokens,initialTokens,expanded,reviewed:decisions.size,related:selected.size,
        excluded:[...decisions.values()].filter(row=>row.priority===0).length,
        candidateLimit:GENEROUS_CANDIDATE_LIMIT,
        status:fitted.tokens>=targetTokens?'target-reached':selected.size?'related-pool-or-fit-limit':'no-related-units'};
    await log('injection.budget',{policy:'generous-related-v1',limit:config.injectionTokens,tokens:fitted.tokens,...fill,
        kept:fitted.units,dropped:[...selected.values()].filter(u=>!fitted.units.some(k=>k.id===u.id))});
    return {...fitted,fill,candidateTotal:expanded?combined.length:candidates.length};
}
