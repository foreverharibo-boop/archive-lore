// Archive Lore — AGPL-3.0-only
import { linkedSelectionUnits } from './lore-selection-repair.js';
// Appended at runtime so existing custom prompts receive continuity constraints
// without overwriting their saved text or adding another model request.
export const OUTCOME_QUESTION_PROMPT = `\n\nEVENT STATUS SEARCH
When the ongoing scene mentions a borrowed object, repayment, promise, errand, injury, dispute or plan, include its recorded outcome and later changes in the relevant retrieval question: returned/received, paid/refused, fulfilled/canceled, recovered/resolved, or still unresolved. Seek the latest supported status of that SAME object or obligation, not only its origin or emotional background. Combine this with the event question within the existing question limit. Do not assume it remains pending or invent a resolution; absence of a record is unknown.`;

export const OUTCOME_SELECTION_PROMPT = `\n\nEVENT OUTCOME CONTINUITY
Before finalizing EACH selected event or side-record fact, inspect the supplied memories for its recorded outcome and later status. This includes incidental references to borrowing, cleaning costs, repayment, promises, errands, injuries, disputes and plans, even when the retrieval questions ask about feelings instead. A reference to the origin or cost does not mean the object or obligation is still outstanding.
Preserve the actual handover, receipt, fulfillment, refusal, cancellation, recovery or resolution that prevents replaying a completed event. Look for actions as well as explicit status words: taking a hanger or putting a borrowed item in its owner's locker can establish receipt. A cleaning-fee reimbursement and return of the clothing are DIFFERENT obligations; retain each one's supported outcome without conflating them.
For each selected fact, add outcomeIds: up to 8 supplied unit IDs establishing that SAME event/object/obligation's outcome or later change, plus attribution needed to understand it. Unlike contextIds, outcomeIds may refer to another entry IN THIS BATCH when the source explicitly establishes the connection. Never link merely by shared names, theme, chronology alone, or a guessed object identity. Preserve original wording, dates, uncertainty and hypothetical/negated status; do not turn an intention into completion or old completion into proof that no later change occurred.
The selected fact and its outcomeIds are retained together or omitted together under the shared token budget. Prefer a supported final-status fact as a priority-3 selection itself when it prevents a continuity error; include its necessary source context. Do not sacrifice a known outcome to keep an earlier setup. If no outcome is supplied, use an empty outcomeIds array; never invent one, claim the task is pending, or assume another batch will supply it. Output only the existing selections JSON with the additional optional outcomeIds field; all other format rules remain in force.`;

export function outcomeContext(row, allowed) {
    return linkedSelectionUnits(row, allowed, {field:'outcomeIds',limit:8});
}
