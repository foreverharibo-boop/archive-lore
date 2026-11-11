// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeSides } from './lore-side-config.js';
import { normalizeSelectionFocus } from './lore-selection-focus.js';
import { fingerprintChatMessage } from './chatSelection.js';
import { COLLECT_PROMPT, SIDE_PROMPT, QUESTIONS_PROMPT, SELECT_PROMPT, LEGACY_QUESTIONS, LEGACY_SELECT, PREVIOUS_QUESTIONS, PREVIOUS_SELECT } from './lore-prompts.js';
import { LEGACY_COLLECT, LEGACY_SIDE } from './lore-prompts-v1.js';
export { SIDE_PROMPT } from './lore-prompts.js';
import { dateDay, relationshipLabel, relationshipPhase, formatRelationship } from './lore-relationship.js';

export const NS = 'archiveLore';
export const DEFAULT_PROMPTS = Object.freeze({
    collect: COLLECT_PROMPT,
    questions: QUESTIONS_PROMPT,
    select: SELECT_PROMPT,
});
export const DEFAULTS = Object.freeze({
    enabled: true, profile: '', searchProfile: '', embeddingProvider: 'gemini',
    embeddingUrl: 'https://api.openai.com/v1', embeddingModel: 'gemini-embedding-001', embeddingKey: '',
    mode: 'dialogue', recentCount: 10, injectionTokens: 3000, batchSize: 20,
    keywordActivation: false, candidateCount: 16, selectionFocus: Object.freeze([]), autoEmbed: true, prompts: DEFAULT_PROMPTS,
});
export function integer(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}
export function normalizeSettings(value = {}) {
    value = { ...value, prompts: { ...value.prompts } };
    if ((value.promptRevision || 0) < 2) {
        if (value.prompts.collect === LEGACY_COLLECT) value.prompts.collect = COLLECT_PROMPT;
        if (value.sidePrompt === LEGACY_SIDE) value.sidePrompt = SIDE_PROMPT;
    }
    if ((value.promptRevision || 0) < 3) {
        if (value.prompts.questions === LEGACY_QUESTIONS) value.prompts.questions = QUESTIONS_PROMPT;
        if (value.prompts.select === LEGACY_SELECT) value.prompts.select = SELECT_PROMPT;
    }
    if ((value.promptRevision || 0) < 4) {
        if (value.prompts.questions === PREVIOUS_QUESTIONS) value.prompts.questions = QUESTIONS_PROMPT;
        if (value.prompts.select === PREVIOUS_SELECT) value.prompts.select = SELECT_PROMPT;
    }
    return { ...DEFAULTS, ...value, promptRevision: 4,
        enabled: value.enabled !== false,
        autoEmbed: value.autoEmbed !== false,
        serverEnabled: value.serverEnabled === true,
        relayEnabled: value.relayEnabled === true,
        selectionConcurrency: integer(value.selectionConcurrency ?? 1,1,1,2),
        diagnosticsDetailed: value.diagnosticsDetailed === true,
        sideTemplates: normalizeSides(value.sideTemplates),
        autoCollect:value.autoCollect===true,autoMode:value.autoMode==='tokens'?'tokens':'messages',
        autoMessages:integer(value.autoMessages ?? 20,20,1,1000),autoTokens:integer(value.autoTokens ?? 6000,6000,100,100000),
        keepMessages:integer(value.keepMessages ?? 10,10,0,1000),
        mode: ['questions','embedding'].includes(value.mode) ? value.mode : 'dialogue',
        embeddingProvider: ['openai','vertex'].includes(value.embeddingProvider) ? value.embeddingProvider : 'gemini',
        embeddingVertexProjectId: String(value.embeddingVertexProjectId || '').trim(),
        embeddingVertexRegion: String(value.embeddingVertexRegion || 'global').trim() || 'global',
        embeddingModel: value.embeddingProvider === 'openai' ? value.embeddingModel || 'text-embedding-3-small' : 'gemini-embedding-001',
        embeddingKeys: { ...(value.embeddingKey ? { [value.embeddingProvider || 'gemini']: value.embeddingKey } : {}), ...value.embeddingKeys },
        recentCount: integer(value.recentCount ?? 10, 10, 1, 200),
        injectionTokens: integer(value.injectionTokens ?? 3000, 3000, 256, 32000),
        batchSize: integer(value.batchSize ?? 20, 20, 1, 100),
        candidateCount: integer(value.candidateCount ?? 16, 16, 1, 40),
        selectionFocus: normalizeSelectionFocus(value.selectionFocus),
        prompts: Object.fromEntries(Object.entries(DEFAULT_PROMPTS).map(([key, fallback]) =>
            [key, typeof value.prompts?.[key] === 'string' && value.prompts[key].trim() ? value.prompts[key] : fallback])),
    };
}
export function estimateTokens(text) {
    let count = 0;
    for (const char of String(text)) count += char.codePointAt(0) < 128 ? 0.35 : 1.2;
    return Math.ceil(count);
}
export function boundedText(text, budget) {
    text = String(text ?? '');
    if (estimateTokens(text) <= budget) return text;
    const chars = [...text];
    let size = Math.floor(chars.length * budget / estimateTokens(text) * .9);
    const make = n => chars.slice(0, Math.ceil(n * .6)).join('') + '\n[…]\n' + chars.slice(-Math.floor(n * .4)).join('');
    while (size > 0 && estimateTokens(make(size)) > budget) size--;
    return size > 0 ? make(size) : '';
}
export function recentDialogue(messages, count, budget = 9000) {
    const recent = messages.filter(x => x && !x.is_system && String(x.mes ?? '').trim()).slice(-count);
    const selected = [];
    let remaining = budget;
    for (let i = recent.length - 1; i >= 0 && remaining > 50; i--) {
        const message = recent[i];
        const text = boundedText(`${message.name || (message.is_user ? 'User' : 'Character')}: ${message.mes}`, Math.min(3000, remaining));
        selected.unshift(text); remaining -= estimateTokens(text) + 2;
    }
    return { text: selected.join('\n\n'), requested: recent.length, included: selected.length,
        shortened: selected.length !== recent.length || recent.some((m, i) => !selected[i]?.includes(m.mes)) };
}
export function parseJson(text) {
    if (typeof text !== 'string') throw new Error('AI 응답이 비어 있어.');
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try { return JSON.parse(cleaned); } catch { throw new Error('AI 응답 형식이 맞지 않아. 저장하지 않았어. 다시 시도해 줘.'); }
}
export function parseCollection(text, existing = []) {
    const parsed = parseJson(text);
    if (!Array.isArray(parsed.entries) || parsed.entries.length > 40) throw new Error('기억 목록 형식이 올바르지 않아.');
    const known = new Set(existing.map(e => String(e.uid)));
    return parsed.entries.map(e => {
        if (!e || typeof e.title !== 'string' || typeof e.content !== 'string' || !e.content.trim() || e.content.length > 20000)
            throw new Error('기억 제목·내용을 확인할 수 없어.');
        const title = e.title.trim().slice(0, 150);
        const metadata = ['date', 'time', 'location'].map(key => typeof e[key] === 'string' ? e[key].trim().slice(0, 200) : '');
        const line = [[metadata[0], metadata[1]].filter(Boolean).join(' '), metadata[2]].filter(Boolean).join(' | ');
        return { title, content: `[${title}]\n${line ? line + '\n' : ''}\n${e.content.trim()}`, date: metadata[0], time: metadata[1], location: metadata[2],
            keywords: Array.isArray(e.keywords) ? e.keywords.filter(x => typeof x === 'string').slice(0, 12).map(x => x.slice(0, 100)) : [],
            supersedes: known.has(String(e.supersedes)) ? String(e.supersedes) : null };
    });
}
export function sourceRange(messages, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= messages.length)
        throw new Error('수집할 메시지 범위를 확인해 줘.');
    return { start, end, hashes: messages.slice(start, end + 1).map(message => fingerprintChatMessage({ ...message, is_system: false })) };
}
export function matchesRange(source, messages) {
    return !!source && Number.isInteger(source.start) && source.start >= 0 && source.end < messages.length
        && Array.isArray(source.hashes) && source.hashes.length === source.end - source.start + 1
        && source.hashes.every((hash, i) => hash === fingerprintChatMessage({ ...messages[source.start + i], is_system: false }));
}
export function validReceipts(data, messages) {
    return (data?.[NS]?.receipts || []).filter(r => matchesRange(r.source, messages));
}
export function nextStart(receipts, initial = 0) {
    let cursor = initial;
    for (const receipt of [...receipts].sort((a, b) => a.source.start - b.source.start)) {
        if (receipt.source.start <= cursor) cursor = Math.max(cursor, receipt.source.end + 1);
    }
    return cursor;
}
export function entryAvailable(entry, messages) {
    return !!entry && !entry.disable && typeof entry.content === 'string' && !!entry.content.trim()
        && (!entry[NS]?.source || matchesRange(entry[NS].source, messages));
}
export function isCore(entry) { return entry.constant === true; }
export function entryId(book, uid) { return JSON.stringify([book, String(uid)]); }
// Frozen embedding segmentation: changing this would invalidate existing vector keys.
function embeddingTextUnits(text, maxTokens = 900) {
    // Exact substrings only. Long sentences are split without paraphrasing or losing characters.
    const sentences = String(text).match(/[^.!?。！？\n]+(?:[.!?。！？]+["'”’)]*|\n+|$)|[.!?。！？\n]+/gu) || [];
    const units = [];
    for (const sentence of sentences) {
        let part = '', cost = 0;
        for (const char of sentence) {
            const next = char.codePointAt(0) < 128 ? .35 : 1.2;
            if (cost + next > maxTokens && part) { if (part.trim()) units.push(part.trim()); part = ''; cost = 0; }
            part += char; cost += next;
        }
        if (part.trim()) units.push(part.trim());
    }
    return units;
}
export function textUnits(text, maxTokens = 900) {
    text = String(text);
    const sentences = [];
    let start = 0;
    for (const match of text.matchAll(/[.!?。！？]+["'”’)]*|\n+/gu)) {
        const end = match.index + match[0].length;
        if (match[0] === '.') {
            const before = text.slice(start, end), after = text.slice(end);
            // Decimal numbers, initialisms, titles and common abbreviations are not sentence ends.
            if (/\d\.$/.test(before) && /^\d/.test(after)) continue;
            if (/[A-Za-z]\.$/.test(before) && /^[A-Za-z]\./.test(after)) continue;
            if (/(?:\b(?:[A-Za-z]\.){2,}|\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|No|vs|etc|approx)\.)$/i.test(before)) continue;
            if (/\b[A-Z]\.$/.test(before) && /^\s+[A-Z][a-z]/.test(after)) continue;
        }
        sentences.push(text.slice(start, end)); start = end;
    }
    if (start < text.length) sentences.push(text.slice(start));
    const units = [];
    for (const sentence of sentences) {
        let part = '', cost = 0;
        for (const char of sentence) {
            const next = char.codePointAt(0) < 128 ? .35 : 1.2;
            if (cost + next > maxTokens && part) { if (part.trim()) units.push(part.trim()); part = ''; cost = 0; }
            part += char; cost += next;
        }
        if (part.trim()) units.push(part.trim());
    }
    return units;
}
export function embeddingChunks(entry, budget = 1000) {
    const boundary = entry.content.indexOf('\n\n');
    const formatted = entry.content.startsWith(`[${entry.comment}]\n`) && boundary >= 0;
    const header = formatted ? entry.content.slice(0, boundary) : String(entry.comment || '').slice(0, 150);
    const body = formatted ? entry.content.slice(boundary + 2) : entry.content;
    const units = embeddingTextUnits(body, Math.max(100, budget - 120));
    // Review complete source sentences even when a cached chunk ends inside an abbreviation.
    let cursor = 0;
    const review = textUnits(body).map((text, index) => {
        const start = body.indexOf(text, cursor); cursor = start + text.length;
        return { index, text, start, end: cursor };
    });
    const result = []; let current = [], cost = 0;
    cursor = 0;
    units.forEach((text, index) => {
        const size = estimateTokens(text) + 5;
        if (current.length && cost + size > budget) { result.push(current); current = []; cost = 0; }
        const start = body.indexOf(text, cursor); cursor = start + text.length;
        current.push({ index, text, start, end:cursor }); cost += size;
    });
    if (current.length) result.push(current);
    return result.map((parts, index) => ({ index, units: parts.map(({index,text})=>({index,text})),
        reviewUnits: review.filter(u=>u.end>parts[0].start && u.start<parts.at(-1).end).map(({index,text})=>({index,text})),
        text: `${header}\n${parts.map(x => x.text).join('\n')}` }));
}
export function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
    let dot = 0, x = 0, y = 0;
    for (let i = 0; i < a.length; i++) {
        if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return -1;
        dot += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2;
    }
    return x && y ? dot / Math.sqrt(x * y) : -1;
}
export function rankChunks(chunks, queries, limit) {
    return chunks.map(c => ({ ...c, score: Math.max(...queries.map(q => cosine(q, c.vector))) }))
        .filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
export function reviewUnits(candidates) {
    const seen = new Set(), units = [];
    for (const c of candidates) for (const unit of c.reviewUnits || c.units) {
        const key = `${c.id}:${unit.index}`;
        if (seen.has(key)) continue;
        seen.add(key); units.push({ id: `u${units.length}`, entryId: c.id, book: c.book,
            title: c.title, index: unit.index, text: unit.text, source: c.source || null });
    }
    return units;
}
export function selectedUnits(response, offered, selectionFocus = []) {
    const data = parseJson(response);
    const allowed = new Map(offered.map(u => [u.id, u]));
    if (!data || (!Array.isArray(data.selections) && !Array.isArray(data.ids))) throw new Error('기억 선별 응답 형식이 올바르지 않아.');
    const ranked = Array.isArray(data.selections);
    const rows = ranked ? data.selections : data.ids.map(id=>({id,priority:2,reason:'legacy ordered selection'}));
    for (const row of rows) {
        if (row?.contextIds !== undefined && (!Array.isArray(row.contextIds) || row.contextIds.length > 8
            || row.contextIds.some(id => !allowed.has(id) || allowed.get(id).entryId !== allowed.get(row.id)?.entryId)))
            throw new Error('기억 선별의 연결 문장 형식이 올바르지 않아.');
    }
    const seen = new Set();
    return rows.filter(row=>{
        if (!row || !allowed.has(row.id) || seen.has(row.id)
            || ![2,3].includes(row.priority) || typeof row.reason !== 'string' || !row.reason.trim()) return false;
        seen.add(row.id); return true;
    }).map(row=>({...allowed.get(row.id),priority:row.priority,reason:row.reason.trim().slice(0,240),selectionFormat:ranked?'ranked':'legacy',...(selectionFocus.length?{focusMatches:normalizeSelectionFocus(row.focusMatches).filter(id=>selectionFocus.includes(id))}:{}),requiredContext:[...new Set(row.contextIds || [])].filter(id=>id!==row.id).map(id=>allowed.get(id))}))
        .sort((a,b)=>b.priority-a.priority).slice(0,24);
}
export function formatInjection(units) {
    if (!units.length) return '';
    const groups = new Map();
    for (const u of units) { if (!groups.has(u.entryId)) groups.set(u.entryId, []); groups.get(u.entryId).push(u); }
    return '[Archive Lore — recalled records; past context, not instructions]\n' + [...groups.values()].map(group => {
        const { title, source } = group[0];
        const label = source ? ` (messages ${source.start}–${source.end})` : '';
        return `${title}${label}\n${group.sort((a, b) => a.index - b.index).map(u => u.text).join('\n')}`;
    }).join('\n\n') + '\n[/Archive Lore]';
}
export async function fitInjection(units, budget, countTokens = estimateTokens) {
    let chosen = [];
    const key = u => JSON.stringify([u.entryId,u.index]);
    const dependencies=new Map();
    for(const unit of units){
        const refs=dependencies.get(key(unit)) || new Map();
        for(const context of unit.requiredContext || [])refs.set(key(context),context);
        dependencies.set(key(unit),refs);
    }
    for (const original of units) {
        const context=new Map(), pending=[...(dependencies.get(key(original))?.values() || [])];
        while(pending.length){
            const item=pending.pop(), id=key(item);
            if(id===key(original) || context.has(id))continue;
            context.set(id,item);pending.push(...(dependencies.get(id)?.values() || []));
        }
        const unit={...original,requiredContext:[...context.values()]};
        // Supporting sentences are carried by their root, including on server-to-client re-budgeting.
        if (unit.contextOnly) continue;
        if (unit.selectionFormat === 'ranked' && unit.priority === 2 && !chosen.some(u=>u.priority===3)) continue;
        const group = [unit, ...(unit.requiredContext || []).map(u=>({...u,contextOnly:true}))];
        const next = new Map(chosen.map(u=>[key(u),u]));
        for (const item of group) {
            const old=next.get(key(item));
            if (!old || (old.contextOnly && !item.contextOnly)) next.set(key(item),item);
        }
        const proposed=[...next.values()];
        if (await countTokens(formatInjection(proposed)) <= budget) chosen = proposed;
    }
    const text = formatInjection(chosen);
    return { text, units: chosen, tokens: text ? await countTokens(text) : 0 };
}
export function applyNativePolicy(lists, { enabled, keywordActivation, books, messages, selected = new Set() }) {
    if (!enabled) return;
    for (const list of Object.values(lists)) if (Array.isArray(list)) for (const entry of list) {
        if (!books.includes(entry.world)) continue;
        if (!entryAvailable(entry, messages) || (!isCore(entry) && (!keywordActivation || selected.has(entryId(entry.world, entry.uid))))) entry.disable = true;
    }
}

export const SIDE_CATEGORIES = Object.freeze({
    relationship: 'Relationship', agreements: 'Promises & Agreements', preferences: 'Preferences & Habits',
    emotions: 'Feelings & Reasons', turningPoints: 'Relationship Turning Points', plans: 'Unresolved Issues & Plans',
});


export function materializeEntry(entry, messages) {
    if (!entry?.[NS]?.sideCategory || matchesRange(entry[NS].source, messages)) return entry;
    const history = [...(entry[NS].history || [])].reverse().find(v => matchesRange(v.source, messages));
    return history ? { ...entry, content: history.content, [NS]: { ...entry[NS], source: history.source, facts: history.facts, storyDate: history.storyDate } } : entry;
}
export function sideRecords(entries) {
    return entries.filter(e => e?.[NS]?.sideCategory).flatMap(e => (e[NS].facts || []).map(f => ({
        ...f, category: e[NS].sideCategory, uid: String(e.uid),
    })));
}
export function parseSideChanges(response, facts, messages, source, categories = SIDE_CATEGORIES) {
    const parsed = parseJson(response);
    if (!Array.isArray(parsed.sideChanges)) throw new Error('사이드 기록 변경 목록이 빠졌어. 저장하지 않았어.');
    if (parsed.sideChanges.length > 60) throw new Error('사이드 변경 항목이 너무 많아. 범위를 줄여 줘.');
    const seen = new Set();
    if (parsed.sideChanges.filter(c => c?.category === 'relationship').length > 1) throw new Error('관계 변경은 한 번에 하나만 저장할 수 있어.');
    return parsed.sideChanges.map(change => {
        if (!Object.hasOwn(categories, change.category) || !['add', 'update'].includes(change.op)
            || typeof change.text !== 'string' || !change.text.trim() || change.text.length > 3000)
            throw new Error('사이드 기록 변경 형식이 올바르지 않아.');
        if (change.op === 'update') {
            const fact = facts.find(f => f.id === change.id && f.category === change.category);
            if (!fact || seen.has(change.id)) throw new Error('변경할 기존 사이드 항목을 확인할 수 없어.');
            seen.add(change.id);
        }
        const evidence = change.evidence;
        if (!evidence || !Number.isInteger(evidence.message) || evidence.message < source.start || evidence.message > source.end
            || typeof evidence.quote !== 'string' || !evidence.quote.trim() || messages[evidence.message]?.is_system
            || !String(messages[evidence.message]?.mes || '').includes(evidence.quote))
            throw new Error('사이드 변경의 대화 원문 근거를 확인할 수 없어. 저장하지 않았어.');
        if (change.category === 'relationship') {
            relationshipLabel(change.text);
            const prior = facts.find(f => f.category === 'relationship' && f.id === change.id)
                || facts.find(f => f.category === 'relationship');
            const phase = relationshipPhase(change.text.trim(), change.relationship, prior);
            if (change.relationship?.since != null && change.relationship.since !== prior?.relationship?.since)
                validateEvidence(change.dateEvidence, messages, source);
            return { ...change, text: change.text.trim(), relationship: phase };
        }
        return { ...change, text: change.text.trim() };
    });
}
export function sideSnapshot(entry) {
    const meta = entry[NS];
    return { content: entry.content, facts: structuredClone(meta.facts || []), source: meta.source, storyDate: meta.storyDate };
}
export function validateEvidence(evidence, messages, source) {
    if (!evidence || !Number.isInteger(evidence.message) || evidence.message < source.start || evidence.message > source.end
        || typeof evidence.quote !== 'string' || !evidence.quote.trim() || messages[evidence.message]?.is_system
        || !String(messages[evidence.message]?.mes || '').includes(evidence.quote))
        throw new Error('날짜 변경의 대화 원문 근거를 확인할 수 없어.');
}
export function parseStoryDate(response, messages, source) {
    const clock = parseJson(response).storyDate;
    if (clock == null) return null;
    if (dateDay(clock.date) === null) throw new Error('이야기 날짜가 올바른 YYYY-MM-DD 형식이 아니야.');
    validateEvidence(clock.evidence, messages, source);
    return { date: clock.date, evidence: clock.evidence, source };
}
export function currentStoryDate(data, messages) {
    return [...(data?.[NS]?.storyDates || [])].reverse()
        .find(clock => (clock.date === null || dateDay(clock.date) !== null) && matchesRange(clock.source, messages))?.date || null;
}
export function applySideChanges(existing, changes, source, makeEntry, makeId, storyDate = undefined, categories = SIDE_CATEGORIES) {
    const changed = [];
    for (const category of Object.keys(categories)) {
        const ops = changes.filter(c => c.category === category);
        let entry = existing.find(e => e[NS]?.sideCategory === category);
        if (!ops.length && !(category === 'relationship' && entry && storyDate !== undefined)) continue;
        const previous = entry ? structuredClone(entry[NS]) : null;
        const oldContent = entry?.content || '';
        let facts = structuredClone(previous?.facts || []);
        for (const op of ops) {
            if (category === 'relationship') {
                const prior = facts.find(f => f.id === op.id) || facts[0];
                facts = [{ id: prior?.id || makeId(), text: relationshipLabel(op.text), evidence: op.evidence,
                    relationship: relationshipPhase(op.text, op.relationship, prior) }];
            } else if (op.op === 'add') {
                if (!facts.some(f => f.text === op.text)) facts.push({ id: makeId(), text: op.text, evidence: op.evidence });
            } else {
                const fact = facts.find(f => f.id === op.id);
                if (!fact) throw new Error('사이드 항목이 갱신 중 바뀌었어. 다시 시도해 줘.');
                if (fact.text !== op.text) Object.assign(fact, { text: op.text, evidence: op.evidence });
            }
        }
        const date = storyDate === undefined ? previous?.storyDate : storyDate;
        const content = category === 'relationship' && facts[0]?.relationship
            ? formatRelationship(facts[0], date) : facts.map(f => `• ${f.text}`).join('\n');
        if (content === oldContent && JSON.stringify(facts) === JSON.stringify(previous?.facts || [])
            && (category !== 'relationship' || (date || null) === (previous?.storyDate || null))) continue;
        if (!entry) entry = makeEntry();
        const history = previous?.history || [];
        if (previous) history.push(sideSnapshot({ content: oldContent, [NS]: previous }));
        entry.comment = categories[category]; entry.content = content;
        entry[NS] = { ...previous, sideCategory: category, facts, source, history,
            ...(category === 'relationship' ? { storyDate: date || null } : {}) };
        changed.push(entry);
    }
    return changed;
}
