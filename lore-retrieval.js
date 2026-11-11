// Archive Lore © 2026 foreverharibo-boop — AGPL-3.0-only
import { boundedText, recentDialogue, rankChunks, estimateTokens } from './lore-core.js';

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

// Keep the saved chat intact for receipts/stale checks; exclude only the assistant being replaced.
export function recallMessages(messages, generationType) {
    if (!['swipe','regenerate'].includes(generationType)) return messages;
    const last = messages.findLastIndex(m=>m && !m.is_system && String(m.mes || '').trim());
    return last >= 0 && !messages[last].is_user ? messages.slice(0,last) : messages;
}

// Review neighboring source chunks too, so a retrieved object's owner/contrast is not silently cut away.
// This changes review context, never stored embedding text or cache keys.
export function reviewCandidates(candidates, chunks) {
    const seen=new Set(), result=[];
    for (const candidate of candidates) {
        for (const row of chunks.filter(c=>c.id===candidate.id && Math.abs(c.index-candidate.index)<=1).sort((a,b)=>a.index-b.index)) {
            const key=chunkKey(row);
            if (!seen.has(key)) { seen.add(key); result.push(row); }
        }
    }
    return result;
}

// Keep entries together when possible; overlap context at unavoidable large-entry boundaries.
export function reviewBatches(units, budget = 10000) {
    const entries=new Map(), batches=[];
    for(const unit of units){if(!entries.has(unit.entryId))entries.set(unit.entryId,[]);entries.get(unit.entryId).push(unit);}
    let batch=[], cost=0;
    const size=u=>estimateTokens(JSON.stringify(u));
    for(const entry of entries.values()) {
        entry.sort((a,b)=>a.index-b.index);
        const total=entry.reduce((sum,u)=>sum+size(u),0);
        if(batch.length && cost+total>budget){batches.push(batch);batch=[];cost=0;}
        for(const unit of entry){
            const next=size(unit);
            if(batch.length && cost+next>budget){
                batches.push(batch);
                const carry=[];let carryCost=0;
                for(const prior of batch.slice().reverse()){
                    const n=size(prior);
                    if(prior.entryId!==unit.entryId || carry.length>=8 || carryCost+n>budget/4 || carryCost+n+next>budget)break;
                    carry.unshift(prior);carryCost+=n;
                }
                batch=carry;cost=carryCost;
            }
            batch.push(unit);cost+=next;
        }
    }
    if(batch.length)batches.push(batch);
    return batches;
}
