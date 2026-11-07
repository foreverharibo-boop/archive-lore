// Archive Lore © 2026 foreverharibo-boop — AGPL-3.0-only
import { boundedText, recentDialogue, rankChunks } from './lore-core.js';

export function retrievalFocus(messages, count) {
    const visible = messages.filter(m=>m && !m.is_system && String(m.mes ?? '').trim()).slice(-count);
    const user = visible.findLast(m=>m.is_user) || visible.at(-1);
    return {
        latestUser: boundedText(user?.mes || '', 1800),
        context: recentDialogue(visible, Math.min(count, 4), 1800).text,
    };
}

const chunkKey = c => JSON.stringify([c.id,c.index]);

// Reciprocal ranks combine separate searches without letting any one long older message win by max similarity.
export function rankFocusedChunks(chunks, { focus = [], context = [], questions = [] }) {
    const lanes = [['focus',focus,.65],['questions',questions,.25],['context',context,.1]].filter(([,q])=>q.length);
    const rows = new Map();
    for (const [lane, vectors, weight] of lanes) {
        const ranked = rankChunks(chunks, vectors, chunks.length);
        ranked.forEach((chunk,index)=>{
            const key = chunkKey(chunk);
            const row = rows.get(key) || {...chunk,score:0};
            row.score += weight * 60 / (60 + index + 1);
            row[`${lane}Rank`] = index+1;
            row[`${lane}Score`] = chunk.score;
            rows.set(key,row);
        });
    }
    return [...rows.values()].sort((a,b)=>b.score-a.score);
}

export function chooseCandidates(ranked, limit) {
    const selected = [], seen = new Set(), counts = new Map();
    const add = (row, diverse) => {
        const key = chunkKey(row);
        if (seen.has(key) || (diverse && (counts.get(row.id)||0)>=2)) return;
        seen.add(key); counts.set(row.id,(counts.get(row.id)||0)+1); selected.push(row);
    };
    // Reserve half the review for the user's immediate request, while allowing context/questions to contribute.
    const focused = ranked.filter(r=>r.focusRank).sort((a,b)=>a.focusRank-b.focusRank);
    for (const row of focused) { if (selected.length>=Math.ceil(limit/2)) break; add(row,true); }
    const questioned = ranked.filter(r=>r.questionsRank).sort((a,b)=>a.questionsRank-b.questionsRank);
    const questionTarget = Math.min(limit,selected.length+Math.floor(limit/4));
    for (const row of questioned) { if (selected.length>=questionTarget) break; add(row,true); }
    for (const row of ranked) { if (selected.length>=limit) break; add(row,true); }
    // A small book or a single long event may legitimately need more than two chunks.
    for (const row of ranked) { if (selected.length>=limit) break; add(row,false); }
    return selected;
}
