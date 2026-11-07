// SPDX-License-Identifier: AGPL-3.0-only
import { SIDE_PROMPT } from './lore-prompts.js';
const categories = [
    ['relationship','관계','Relationship'],['agreements','약속·합의·거절','Promises & Agreements'],
    ['preferences','취향·습관','Preferences & Habits'],['emotions','감정·이유','Feelings & Reasons'],
    ['turningPoints','관계 전환점','Relationship Turning Points'],['plans','미해결 문제·계획','Unresolved Issues & Plans'],
];
export const SIDE_COMMON = SIDE_PROMPT.slice(0,SIDE_PROMPT.indexOf('\n\n1.')).replace('six separate side records','the enabled side records')+'\n\n'+SIDE_PROMPT.slice(SIDE_PROMPT.indexOf('CHANGE RULES'));
export const DEFAULT_SIDES = categories.map(([id,label,title],i)=>{
    const start=SIDE_PROMPT.indexOf(`\n\n${i+1}.`), end=i===5?SIDE_PROMPT.indexOf('\n\nCHANGE RULES'):SIDE_PROMPT.indexOf(`\n\n${i+2}.`);
    return {id,label,title,enabled:true,prompt:SIDE_PROMPT.slice(start,end).trim()};
});
export function normalizeSides(value) {
    if (!Array.isArray(value)) return structuredClone(DEFAULT_SIDES);
    if(value.length>24)throw Error('사이드는 최대 24개까지 설정할 수 있어.');
    const seen=new Set();
    return value.map(row=>{
        if(!row || !/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(row.id) || seen.has(row.id))throw Error('사이드 ID가 잘못됐거나 중복됐어.');
        seen.add(row.id);
        if(!String(row.title||'').trim() || !String(row.prompt||'').trim())throw Error('사이드 이름과 프롬프트를 입력해 줘.');
        return {id:row.id,label:String(row.label||row.title),title:String(row.title).trim(),enabled:row.enabled!==false,prompt:String(row.prompt)};
    });
}
export function enabledSides(config) { return config.sideEnabled===false?[]:normalizeSides(config.sideTemplates).filter(row=>row.enabled); }
export function sideInstructions(config) {
    const rows=enabledSides(config);
    const common=config.sidePrompt && config.sidePrompt!==SIDE_PROMPT?config.sidePrompt:SIDE_COMMON;
    return `${common}\n\nENABLED SIDE CATEGORIES ONLY:\n${rows.map(r=>`ID: ${r.id}\nTitle: ${r.title}\n${r.prompt}`).join('\n\n')}\nReturn changes ONLY for these IDs: ${rows.map(r=>r.id).join(', ') || '(none: return an empty sideChanges array)'}. Disabled categories must not be updated. Generate memories and sideChanges together in this single response.`;
}
