// Archive Lore — AGPL-3.0-only
import { linkedSelectionUnits } from './lore-selection-repair.js';
// Appended at runtime so existing custom prompts receive continuity constraints
// without overwriting their saved text or adding another model request.
export const OUTCOME_QUESTION_PROMPT = `\n\nEVENT STATUS SEARCH
When a past event or obligation's status matters now, include its recorded outcome and later changes in the same question. Match the same subject; unknown does not mean pending. Do not search for an already-recorded resolution of a newly occurring event or invent one.`;

export const OUTCOME_SELECTION_PROMPT = `\n\nEVENT OUTCOME CONTINUITY
Check EACH selected event or side fact for the SAME object/obligation's recorded outcome and later changes, including incidental borrowing, costs, repayment, promises, errands, injuries, disputes and plans even in emotional-history searches. The newest date alone does not establish this connection.
Preserve handover, receipt, fulfillment, refusal, cancellation, recovery or resolution. Actions count: placing a borrowed item in its owner's locker may establish receipt. Cleaning-fee reimbursement and clothing return are DIFFERENT obligations. Origin/cost does not prove an outstanding obligation, intention is not completion, and old completion does not rule out later changes.
Add optional outcomeIds to the existing selections JSON for supported outcomes and necessary attribution, following REFERENCE VALIDATION. Keep original wording, dates, uncertainty and hypothetical/negated status. Prefer a final-status fact as priority 3 when it prevents a continuity error; retain its context. Never sacrifice a known outcome to keep its setup. If none is supplied, use an empty outcomeIds array: status is unknown, not pending, and another batch cannot be assumed to supply it.`;

export function outcomeContext(row, allowed) {
    return linkedSelectionUnits(row, allowed, {field:'outcomeIds',limit:8});
}
