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

// Retrieval anchors are a supplementary lane, never a reason to inject a memory.
// Document frequency is measured per entry so long records do not dominate it.
const stopWords = new Set('a an the and or of to in on at for from with by as is was were are be been being do did does have has had what which who when where how why that this these those it its they their them he his him she her we our us you your about happened remember recall would could should can will then there during into through'.split(' '));
function anchorTerms(text) {
    return String(text).toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.filter(t=>t.length>1&&!stopWords.has(t)) || [];
}
export function rankAnchors(chunks, queries) {
    const entries=new Map(), terms=new Map();
    for(const chunk of chunks){
        const words=new Set(anchorTerms(chunk.text));terms.set(chunkKey(chunk),words);
        if(!entries.has(chunk.id))entries.set(chunk.id,new Set());
        for(const word of words)entries.get(chunk.id).add(word);
    }
    const frequency=new Map();
    for(const words of entries.values())for(const word of words)frequency.set(word,(frequency.get(word)||0)+1);
    const requests=queries.map(q=>[...new Set(anchorTerms(q))]);
    return chunks.map(chunk=>{
        const words=terms.get(chunkKey(chunk));let anchorScore=0;
        for(const query of requests){
            // Names shared by most entries are not enough to reserve a candidate.
            const hits=query.filter(t=>words.has(t)&&(frequency.get(t)||0)<=Math.max(1,entries.size*.5));
            if(hits.length<2)continue;
            const score=hits.reduce((sum,t)=>sum+Math.log(1+entries.size/(frequency.get(t)||1)),0);
            anchorScore=Math.max(anchorScore,score);
        }
        return {...chunk,anchorScore};
    }).filter(c=>c.anchorScore>0).sort((a,b)=>b.anchorScore-a.anchorScore);
}

// Reciprocal ranks combine separate searches without letting any one long older message win by max similarity.
export function rankFocusedChunks(chunks, { focus = [], context = [], questions = [], emphasis = [] }, queryTexts = []) {
    const lanes = (emphasis.length ? [['focus',focus,.5],['questions',questions,.2],['context',context,.1],['emphasis',emphasis,.2]] : [['focus',focus,.65],['questions',questions,.25],['context',context,.1]]).filter(([,q])=>q.length);
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
    rankAnchors(chunks,queryTexts).forEach((chunk,index)=>{
        const key=chunkKey(chunk),row=rows.get(key)||{...chunk,score:0};
        row.anchorRank=index+1;row.anchorScore=chunk.anchorScore;rows.set(key,row);
    });
    return [...rows.values()].sort((a,b)=>b.score-a.score);
}

export function chooseCandidates(ranked, limit, mode = 'dialogue') {
    const selected = [], seen = new Set(), counts = new Map();
    const add = (row, diverse) => {
        const key = chunkKey(row);
        if (seen.has(key) || (diverse && (counts.get(row.id)||0)>=2)) return;
        seen.add(key); counts.set(row.id,(counts.get(row.id)||0)+1); selected.push(row);
    };
    const focused = ranked.filter(r=>r.focusRank).sort((a,b)=>a.focusRank-b.focusRank);
    const questioned = ranked.filter(r=>r.questionsRank).sort((a,b)=>a.questionsRank-b.questionsRank);
    const anchored = ranked.filter(r=>r.anchorRank).sort((a,b)=>a.anchorRank-b.anchorRank);
    // Reserve distinct event records, not multiple chunks of the same event.
    const anchorEntries=new Set();
    for(const row of anchored){
        if(selected.length>=Math.ceil(limit/4))break;
        if(anchorEntries.has(row.id))continue;
        add(row,true);anchorEntries.add(row.id);
    }
    if (mode === 'questions' && questioned.length) {
        // Preserve the question's top hits before fused ranks or per-entry diversity can displace them.
        for (const row of questioned) { if (selected.length>=Math.ceil(limit/2)) break; add(row,false); }
        const focusTarget = Math.min(limit,selected.length+Math.floor(limit/4));
        for (const row of focused) { if (selected.length>=focusTarget) break; add(row,true); }
    } else {
        // Dialogue search retains its existing latest-user reservation.
        for (const row of focused) { if (selected.length>=Math.ceil(limit/2)) break; add(row,true); }
        const questionTarget = Math.min(limit,selected.length+Math.floor(limit/4));
        for (const row of questioned) { if (selected.length>=questionTarget) break; add(row,true); }
    }
    for (const row of ranked) { if (selected.length>=limit) break; add(row,true); }
    // A small book or a single long event may legitimately need more than two chunks.
    for (const row of ranked) { if (selected.length>=limit) break; add(row,false); }
    const emphasized=ranked.filter(r=>r.emphasisRank).sort((a,b)=>a.emphasisRank-b.emphasisRank);
    if(!emphasized.length || limit<2)return selected;
    // Retain most direct-request candidates; reserve at most a third for the
    // selected aspects, so they cannot disappear under the original query lane.
    const quota=Math.max(1,Math.floor(limit/3)),result=selected.slice(0,limit-quota);
    const used=new Set(result.map(chunkKey)),entries=new Set();let added=0;
    for(const row of emphasized){
        if(added>=quota || result.length>=limit)break;
        if(used.has(chunkKey(row))||entries.has(row.id))continue;
        result.push(row);used.add(chunkKey(row));entries.add(row.id);added++;
    }
    for(const row of selected){if(result.length>=limit)break;if(!used.has(chunkKey(row))){result.push(row);used.add(chunkKey(row));}}
    return result;
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
    // Measure exactly what the selector sees; source hashes/book paths stay local.
    const size=u=>estimateTokens(JSON.stringify(selectorUnit(u,`e${units.length}`)));
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

function selectorUnit(unit,entryId) {
    return {id:unit.id,entryId,title:unit.title,index:unit.index,text:unit.text};
}
export function selectorMemories(units) {
    const entries=new Map();
    return units.map(unit=>{
        if(!entries.has(unit.entryId))entries.set(unit.entryId,`e${entries.size}`);
        return selectorUnit(unit,entries.get(unit.entryId));
    });
}
