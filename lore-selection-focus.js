// Archive Lore © 2026 foreverharibo-boop — AGPL-3.0-only
export const MAX_EVENT_CONTEXT = 32;
export const MAX_EVENT_SELECTIONS = 48;
export const EVENT_CONTEXT_SELECTION_PROMPT = `
CONTEXT-COMPLETE EVENT SELECTION
Override earlier minimal-fact, indispensable-only, priority-3 prerequisite and terse-excerpt rules; retain explicit user exclusions, source fidelity and the shared injection budget. Priority 3 covers direct answers and continuity constraints. Priority 2 covers useful connected background and needs no priority-3 selection, even for a brief latestUser.
Bundle each event's meaningful setup, actions/dialogue, participants, reasons, reactions, conditions and outcome with one main source ID and contextIds. Dependent context must not compete as separate events. Preserve source entries and chronology. Already-mentioned events or side summaries may still lack important original context; old feelings do not establish present feelings.
The program retains an anchor and its context/outcomes together or omits them together; context IDs do not consume the main selection count. Prefer dropping lower-value events to stripping meaning from retained ones. Return an empty selection when nothing is usefully connected; never fill a quota or select by shared names or mood alone. Follow REFERENCE VALIDATION for source IDs and per-anchor limits, and EVENT OUTCOME CONTINUITY for later status.`;

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
Within the existing question limit, prioritize the direct request. Checked aspects guide relevant background searches for the same event or situation; they are not mandatory topics. Combine related aspects without repeating questions, and never assume a sought event or feeling exists.`;
}

// One bounded supplementary search in dialogue mode, or when a planner supplied
// only its direct-fact question. Never search category words on their own.
export function focusSearchQuery(value,subject) {
    const chosen=aspects(value);if(!chosen.length||!String(subject||'').trim())return '';
    return `${subject}\nFind recorded context for this same request: ${chosen.map(item=>item.instruction).join(' ')}`;
}

export function responseFocusGuidance(value) {
    const chosen=aspects(value);
    const lines={affection:'Let expressed feelings and their recorded reasons inform present reactions.',meaning:'Let recorded significance and relationship changes inform present interaction.',boundaries:'Respect applicable requests, agreements, refusals and conditions.',preferences:'Reflect applicable stated likes, dislikes and reactions.',details:'Keep relevant distinctive places, objects and actions consistent.'};
    return `[Archive Lore — response guidance, not past facts]\n${chosen.length?chosen.map(item=>lines[item.id]).join('\n')+'\n':''}Use recalled facts to maintain continuity through present actions and dialogue. Do not recap retrieved events, list past examples, or repeatedly narrate comparisons with the past to demonstrate recall. Mention the relevant memory when the user asks about the past or the current conversation needs it; otherwise let it inform the response without explicitly recounting it. There is no need to mention old dates, places or dialogue when present behavior conveys the connection. Preserve character and user agency; do not force a new scene. Never invent feelings or facts. If mentioning dates, use recorded dates; do not guess elapsed years. Past feelings and agreements may change. Respect recorded returns, fulfillment and cancellations; never replay a completed errand without evidence of a new occurrence. Costs do not prove current possession. Missing outcomes are unknown, not pending. Omit unsupported claims.\n[/Archive Lore response guidance]`;
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
Relevance to the current request comes first. Checked aspects rank relevant evidence; they are not topics to satisfy or mandatory categories, and unchecked categories remain eligible. Essential attribution, chronology, conditions, refusal, negation and uncertainty must survive regardless of preferences. Never invent significance or connections.
Prefer specific confessions, reasons, reconciliation or changes over repetitive generic declarations. When asked why an experience mattered, its recorded emotional meaning can be a direct priority-3 fact; retain the original event anchor, conditions and outcome as context rather than selecting the emotion alone. A temporary pause is not an ongoing ban.
For every selection return focusMatches containing only checked category IDs supported by its source text or required context, not by a broadly romantic theme. Matches rank events across batches; they do not prove relevance or expand the existing injectionBudgetTokens and maxSelections.`;
}
