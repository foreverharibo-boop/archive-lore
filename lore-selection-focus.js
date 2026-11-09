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

export function selectionFocusPrompt(value) {
    const selected=normalizeSelectionFocus(value);
    if(!selected.length)return '';
    return `\n\nMEMORY SELECTION EMPHASIS\n${SELECTION_FOCUS.filter(item=>selected.includes(item.id)).map(item=>'- '+item.instruction).join('\n')}
These are selection preferences WITHIN memories relevant to latestUser, not new search topics, quotas or instructions for the next roleplay reply. Relevance to the current request comes first. Do not select an unrelated event just to satisfy a preference; return no selections when no past facts are needed.
Keep the supported event facts: who, when, where, what happened and its outcome, when needed to identify or understand that event. Essential attribution, chronology, conditions, refusal, negation and uncertainty must survive regardless of checked categories. Never invent emotions, significance, dates or connections.
Among relevant facts, prioritize original units that address the checked aspects over repetitive descriptions. When the request asks why an experience was special or memorable, a recorded confession, emotional response or turning point can itself be a direct priority-3 fact; do not reduce the event to physical actions alone. Priority 2 remains indispensable supporting context. Use contextIds for necessary same-entry context; preserve original wording and never rewrite a memory.
No category is mandatory and unchecked categories are not forbidden. All checked categories share the existing injectionBudgetTokens and maxSelections across batches; do not increase output quotas or fill the budget for its own sake.`;
}
