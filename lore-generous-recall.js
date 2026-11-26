// Archive Lore — AGPL-3.0-only
import { parseJson } from './lore-core.js';
import { selectorMemories } from './lore-retrieval.js';
import { prepareReview, BOUNDED_REVIEW_PROMPT } from './lore-review-budget.js';
import { fitFocusedInjection } from './lore-focus-injection.js';
import { normalizeSelectionFocus, orderFocusedUnits, selectionFocusPrompt, EVENT_CONTEXT_SELECTION_PROMPT, MAX_EVENT_CONTEXT } from './lore-selection-focus.js';
import { mapOrdered } from './lore-parallel.js';
import { OUTCOME_SELECTION_PROMPT, outcomeContext } from './lore-outcome-context.js';
import { linkedSelectionUnits, SELECTION_REFERENCE_RULES, SELECTION_REFERENCE_LIMITS, SELECTION_REPAIR_PROMPT, selectionRepairFeedback, validateSelectionAttempt } from './lore-selection-repair.js';

const unitKey = u => JSON.stringify([u.entryId, u.index]);

export const GENEROUS_SELECTION_PROMPT = `
GENEROUS RELATED MEMORY MODE
For this mode, the following relevance and output rules replace earlier restrictions to indispensable facts, a small selection count, or a terse answer. Preserve all other source-fidelity and user exclusions.
Select related source units generously from the FIRST review. Priority 3: directly addresses the present request. Priority 2: related background that can enrich this scene or keep character reactions consistent, including connected experiences, preferences, promises, feelings with their recorded reasons, and distinctive event details. Priority 2 does NOT require a priority-3 fact and does NOT need to be indispensable. Do not reject related material merely because the current reply is possible without it, it is old, or enough other facts have already been selected. Do not stop after 24 units. The program fills the token budget from the selected related pool.
Omit unrelated, redundant or uninterpretable units without listing them. A shared character name alone does not establish relevance; a different date or location alone does not disprove a concrete connection. Never invent connections to fill space.
For each selected unit include contextIds (up to 32 source IDs in this batch, including connected records in other entries) for the event's circumstances, meaningful dialogue, reasons, reactions, conditions and outcome, including owner, speaker, chronology and negation. These sentences are retained together or omitted together with their original entry titles and dates. Do not include unrelated sentences as context. Never rewrite or summarize the original text. Preserve uncertainty and distinguish past events from current status.
Return ONLY JSON: {"selections":[{"id":"u0","priority":2,"contextIds":[]}]}.
Return only selected IDs, priorities and contextIds, plus focusMatches when selectionFocus is supplied (only checked categories supported by the source). Do NOT output inclusion/exclusion reasons, explanations, rejected IDs or a review of every unit. For no related material return {"selections":[]}. There is no minimum fill quota and no second review to fill unused space.`;

export function parseGenerousSelections(response, offered, selectionFocus = []) {
    const rows = parseJson(response)?.selections;
    const allowed = new Map(offered.map(u => [u.id, u])), seen = new Set();
    if (!Array.isArray(rows)) throw Error('넉넉한 주입 선별 형식이 올바르지 않아.');
    for (const row of rows) {
        if (!row || !allowed.has(row.id) || seen.has(row.id) || ![2,3].includes(row.priority))
            throw Error('넉넉한 주입 선별 형식이 올바르지 않아.');
        seen.add(row.id);
        outcomeContext(row, allowed);
        linkedSelectionUnits(row, allowed, {field:'contextIds',limit:MAX_EVENT_CONTEXT});
    }
    return rows.map(row => ({
        ...allowed.get(row.id), priority:row.priority, selectionFormat:'generous',
        focusMatches:normalizeSelectionFocus(row.focusMatches).filter(id => selectionFocus.includes(id)),
        requiredContext:[...new Map([
            ...[...new Set(row.contextIds || [])].filter(id => id !== row.id).map(id => allowed.get(id)),
            ...outcomeContext(row, allowed),
        ].map(unit=>[unit.id,unit])).values()],
    }));
}

export async function generousRecall({candidates, chunks, config, latestUser, dialogue, questions,
    ask, countTokens, signal, log=async()=>{}, notify=()=>{}}) {
    // Use the same candidates and input batching as normal selection. A smaller
    // final injection never triggers more candidates, reviews or explanations.
    const plan=prepareReview(candidates,chunks,config.reviewTokens),{offered,batches,...reviewStats}=plan;
    await log('selection.plan',{...reviewStats,policy:'generous-related-v2',selectionFocus:config.selectionFocus,
        units:offered.length,batches:batches.length,concurrency:config.selectionConcurrency});
    const results=await mapOrdered(batches,config.selectionConcurrency,async(batch,index,signal)=>{
        notify('관련 기억을 넉넉하게 고르는 중');
        let repair;
        for(let attempt=0;attempt<2;attempt++){
            signal.throwIfAborted();
            const response=await ask(config.prompts.select+selectionFocusPrompt(config.selectionFocus)+GENEROUS_SELECTION_PROMPT+OUTCOME_SELECTION_PROMPT+EVENT_CONTEXT_SELECTION_PROMPT+SELECTION_REFERENCE_RULES+BOUNDED_REVIEW_PROMPT
                +(repair?SELECTION_REPAIR_PROMPT:''),
                {latestUser,dialogue,questions,selectionFormat:'generous',selectionLimits:SELECTION_REFERENCE_LIMITS,memories:selectorMemories(batch),batch:index+1,batchCount:batches.length,
                    ...(repair?{selectionRepair:repair}:{}),
                    injectionBudgetTokens:config.injectionTokens,...(config.selectionFocus.length?{selectionFocus:config.selectionFocus}:{})},signal,6000);
            try {
                const {accepted,contextOverflowRecovered}=validateSelectionAttempt(parseGenerousSelections,response,batch,config.selectionFocus);
                await log('selection.validated',{policy:'generous-related-v2',batch:index+1,batchCount:batches.length,attempt:attempt+1,contextOverflowRecovered,offered:batch,accepted});
                return accepted;
            } catch(error) {
                signal.throwIfAborted();
                await log('selection.invalid',{policy:'generous-related-v2',batch:index+1,batchCount:batches.length,attempt:attempt+1,message:error.message,details:error.details,response,offered:batch});
                if(attempt===1){error.category='response-format';error.stage='selection.validate';throw error;}
                repair=selectionRepairFeedback(error,response);
            }
        }
    },signal);
    const selected=new Map();
    for(const units of results)for(const unit of units){
        // Preserve accepted units and required context across overlapping batches.
        const prior=selected.get(unit.id);
        if(!prior){selected.set(unit.id,unit);continue;}
        const context=new Map([...prior.requiredContext,...unit.requiredContext].map(u=>[unitKey(u),u]));
        selected.set(unit.id,{...(prior.priority>=unit.priority?prior:unit),requiredContext:[...context.values()]});
    }
    const ordered=orderFocusedUnits([...selected.values()].sort((a,b)=>b.priority-a.priority),config.selectionFocus);
    const fitted=await fitFocusedInjection(ordered,config,countTokens);
    signal.throwIfAborted();
    await log('injection.budget',{policy:'generous-related-v2',limit:config.injectionTokens,tokens:fitted.tokens,
        kept:fitted.units,dropped:ordered.filter(u=>!fitted.units.some(k=>k.id===u.id))});
    return {...fitted,candidateTotal:candidates.length};
}
