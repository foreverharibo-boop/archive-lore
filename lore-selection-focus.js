// Archive Lore © 2026 foreverharibo-boop — AGPL-3.0-only
export const SELECTION_FOCUS = Object.freeze([
    {id:'affection',label:'애정·감정',help:'사랑 표현, 고마움, 서운함, 안도감과 그 이유를 더 챙깁니다.',instruction:'Affection and emotions: explicit expressions of love, gratitude, hurt or relief, and their recorded reasons.'},
    {id:'meaning',label:'의미·관계 변화',help:'그날이 특별했던 이유, 화해와 신뢰 등 관계가 달라진 계기를 더 챙깁니다.',instruction:'Meaning and relationship changes: recorded reasons an event mattered, reconciliation, changes in trust or how participants understood one another.'},
    {id:'boundaries',label:'약속·경계',help:'합의한 조건, 부탁, 거절, 하지 않기로 한 행동을 더 챙깁니다. 사실 이해에 필수인 조건·거절은 선택하지 않아도 유지합니다.',instruction:'Promises and boundaries: agreements, conditions, requests, refusals and actions participants agreed not to take.'},
    {id:'preferences',label:'취향·반응',help:'당시 직접 드러낸 좋아함·싫어함과 구체적인 반응을 더 챙깁니다.',instruction:'Preferences and reactions: explicitly expressed likes, dislikes and observable responses at the time; do not infer a lasting preference from one reaction.'},
    {id:'details',label:'구체적 장면',help:'장소, 물건, 옷, 행동 등 그날을 구별하는 세부사항을 더 챙깁니다.',instruction:'Concrete scene details: distinctive places, objects, clothing and actions that identify the relevant event.'},
].map(Object.freeze));

export function normalizeSelectionFocus(value) {
    return SELECTION_FOCUS.filter(item=>Array.isArray(value)&&value.includes(item.id)).map(item=>item.id);
}

const aspects=value=>SELECTION_FOCUS.filter(item=>normalizeSelectionFocus(value).includes(item.id));
export function focusQuestionPrompt(value) {
    const chosen=aspects(value);if(!chosen.length)return '';
    return `\n\nFOCUSED MEMORY SEARCH\n${chosen.map(item=>'- '+item.instruction).join('\n')}
First decide whether the latest request needs past information at all; an empty questions list remains valid. If needed, the first question must identify the relevant event or answer the direct factual request. Use the remaining questions (at most six questions TOTAL) to seek the checked aspects of that same subject, including recorded reasons, dialogue and consequences rather than only actions. Combine related aspects instead of repeating a generic question. Keep each question tied to the people/event/time named or unambiguously implied by the dialogue. Do not invent an event, feeling or answer. Write in English, preserve proper names and explicit exclusions. A past temporary agreement is not evidence of its present status; seek later changes if the request concerns whether it still holds.`;
}

// One bounded supplementary search in dialogue mode, or when a planner supplied
// only its direct-fact question. Never search category words on their own.
export function focusSearchQuery(value,subject) {
    const chosen=aspects(value);if(!chosen.length||!String(subject||'').trim())return '';
    return `${subject}\nFind recorded context for this same request: ${chosen.map(item=>item.instruction).join(' ')}`;
}

export function responseFocusGuidance(value) {
    const chosen=aspects(value);if(!chosen.length)return '';
    const lines={affection:'Emphasize expressed feelings and their recorded reasons.',meaning:'Explain recorded significance and relationship changes.',boundaries:'Emphasize requests, agreements, refusals and conditions.',preferences:'Emphasize stated likes, dislikes and reactions.',details:'Emphasize distinctive places, objects and actions.'};
    return `[Archive Lore — response guidance, not past facts]\n${chosen.map(item=>lines[item.id]).join('\n')}
Apply only when relevant to the current request and supported by the recalled records. Develop a few meaningful events instead of listing many. Preserve the character and the user's agency; do not force a new scene. Never invent feelings or facts. Use recorded dates; do not guess elapsed years. A past pause or promise is not automatically still in force; do not infer that nothing happened afterward. When evidence is insufficient, omit the claim.\n[/Archive Lore response guidance]`;
}

export function orderFocusedUnits(units,value) {
    const chosen=normalizeSelectionFocus(value);if(!chosen.length)return units;
    const groups=new Map();
    for(const unit of units){if(!groups.has(unit.entryId))groups.set(unit.entryId,[]);groups.get(unit.entryId).push(unit);}
    const matches=unit=>(unit.focusMatches||[]).filter(id=>chosen.includes(id)).length;
    const groupsInOrder=[...groups.values()].sort((a,b)=>
        Math.max(...b.map(u=>u.priority||0))-Math.max(...a.map(u=>u.priority||0)) ||
        Math.max(...b.map(matches))-Math.max(...a.map(matches)));
    // Keep direct facts ahead of support; within each priority, develop the
    // strongest matching events together rather than mixing every batch equally.
    return [3,2].flatMap(priority=>groupsInOrder.flatMap(group=>group.filter(u=>u.priority===priority).sort((a,b)=>matches(b)-matches(a))));
}

export function selectionFocusPrompt(value) {
    const selected=normalizeSelectionFocus(value);
    if(!selected.length)return '';
    return `\n\nMEMORY SELECTION EMPHASIS\n${SELECTION_FOCUS.filter(item=>selected.includes(item.id)).map(item=>'- '+item.instruction).join('\n')}
These are selection preferences WITHIN memories relevant to latestUser, not unrelated search topics or quotas. Relevance to the current request comes first. Do not select an unrelated event just to satisfy a preference; return no selections when no past facts are needed.
Keep the supported event facts: who, when, where, what happened and its outcome, when needed to identify or understand that event. Essential attribution, chronology, conditions, refusal, negation and uncertainty must survive regardless of checked categories. Never invent emotions, significance, dates or connections.
Among relevant facts, prioritize original units that address the checked aspects over repetitive descriptions. When the request asks why an experience was special or memorable, a recorded confession, emotional response or turning point can itself be a direct priority-3 fact; do not reduce the event to physical actions alone. Priority 2 remains indispensable supporting context. Use contextIds for necessary same-entry context; preserve original wording and never rewrite a memory.
Prefer a few well-supported events with their essential context over many interchangeable examples. A generic declaration during repetitive action is weaker evidence of significance than a specific confession, reason, reconciliation or change. Include the original event anchor and essential outcome/conditions in contextIds when selecting its emotional meaning. Compare chronology within the supplied records; never turn a temporary pause into an ongoing ban or claim no later event occurred.
For every selection also return focusMatches: an array containing only checked category IDs that its actual original text or required context supports. Do not mark a match merely because the event is broadly romantic. These matches rank relevant events across batches; they are not proof of relevance.
No category is mandatory and unchecked categories are not forbidden. All checked categories share the existing injectionBudgetTokens and maxSelections across batches; do not increase output quotas or fill the budget for its own sake.`;
}
