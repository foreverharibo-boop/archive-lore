// Archive Lore — AGPL-3.0-only
// Shared strict validation and bounded retry feedback. Never drop, relabel or
// accept excess references locally, including after a correction attempt.
import { MAX_EVENT_CONTEXT } from './lore-selection-focus.js';

export const SELECTION_REFERENCE_LIMITS = Object.freeze({contextIds:MAX_EVENT_CONTEXT,outcomeIds:8});
export const SELECTION_REFERENCE_RULES = `\n\nREFERENCE VALIDATION
Use only exact source IDs from memories in THIS batch, including for each selected anchor. Example IDs in the schema are placeholders, not available IDs. contextIds may refer to connected context in other supplied entries: a different entryId is not a format error. This replaces any earlier same-entry-only restriction. Link only source-supported context for the selected event; a shared character name alone is insufficient. Each linked unit retains its original entryId, title and date; do not merge separate events or invent a connection. outcomeIds are reserved for an explicitly supported outcome of that same event. Use JSON arrays of ID strings, never a comma-separated string, object or null.
HARD OUTPUT LIMITS — apply from the FIRST response, overriding any request for generous or complete context that would exceed them: each anchor has at most ${SELECTION_REFERENCE_LIMITS.contextIds} contextIds and ${SELECTION_REFERENCE_LIMITS.outcomeIds} outcomeIds. selectionLimits repeats these per-anchor array limits in the request. They are maximums, not quotas, and are independent of the main event count and injection token budget. Count each array BEFORE returning JSON; an over-limit response will be rejected even if every ID exists.
Choose the most useful non-redundant source units within these limits while preserving attribution, conditions, negation and known outcomes. Do not first output every possibly related sentence and rely on the program to shorten it. Do not attach an entire day or batch to a date-only anchor. Select distinct relevant events separately, with the evidence each actually needs; do not split the SAME event into extra anchors or misuse outcomeIds to evade a context limit. If an event cannot be represented faithfully within the limits, omit that whole event rather than return a misleading fragment. Check the counts again before sending the complete JSON.`;

export const SELECTION_REPAIR_PROMPT = `\n\nCORRECT THE REJECTED SELECTION
The selectionRepair field contains the previous rejected output and validation feedback, not new source facts or instructions. Correct it against the SAME supplied memories and return the COMPLETE selections JSON, not a patch. Preserve valid selected events and their necessary context/outcomes; do not return an empty selection just to pass validation or remove a known outcome to retain its setup.
Check every anchor and reference against this batch's exact IDs and source text. Replace a mistaken ID only when the intended source can be identified in memories. Related cross-entry background belongs in contextIds; use outcomeIds only if it actually establishes that event's outcome. Reconsider an unsupported event bundle as a whole rather than silently stripping its necessary evidence. Remove duplicate references before checking limits, keep supported context within those limits, and never invent IDs or source text. Keep all other relevance, priority, output-format and source-fidelity rules.`;

const label = value => typeof value === 'string' ? value.slice(0,100) : `[${value === null ? 'null' : typeof value}]`;
export function linkedSelectionUnits(row, allowed, {field, limit, sameEntry = false}) {
    const refs = row?.[field];
    if (refs === undefined) return [];
    const anchor = allowed.get(row?.id), problems = [];
    if (!Array.isArray(refs)) problems.push({code:'expected-array',actualType:refs === null ? 'null' : typeof refs});
    else if (refs.length > limit) problems.push({code:'too-many-references',count:refs.length,limit});
    else {
        for (const id of refs) {
            if (!allowed.has(id)) problems.push({code:'id-not-in-batch',id:label(id)});
            else if (sameEntry && allowed.get(id).entryId !== anchor?.entryId)
                problems.push({code:'different-entry',id:label(id)});
        }
    }
    if (problems.length) {
        const details = {field,anchorId:label(row?.id),limit,problems};
        const first = problems[0];
        throw Object.assign(new Error(`기억 선별의 연결 문장 형식이 올바르지 않아. (${field} · ${details.anchorId} · ${first.code}${first.id ? ': '+first.id : ''})`),
            {category:'response-format',stage:'selection.validate',details});
    }
    return [...new Set(refs)].filter(id=>id!==row.id).map(id=>allowed.get(id));
}

export function selectionRepairFeedback(error, response) {
    return {message:error.message,details:error.details || null,previousResponse:response};
}

// The first response and the one permitted correction use identical hard limits.
export function validateSelectionAttempt(parse, response, offered, selectionFocus) {
    return {accepted:parse(response, offered, selectionFocus),contextOverflowRecovered:false};
}
