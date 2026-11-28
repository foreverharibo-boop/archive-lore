// Archive Lore — AGPL-3.0-only
// Lexical evidence only narrows a retrieved chunk; vector retrieval still decides
// which candidates are eligible. No extra model calls or embedding-key changes.
const STOP = new Set(('a an the and or of to in on at for from with by as is was were are be been being do did does have has had what which who when where how why that this these those it its they their them he his him she her we our us you your about would could should can will then there during into through ' +
    'past previous current latest recent history historical record records recorded remember recall find missing known unknown useful relevant related context information fact facts event events scene scenes situation happened happen happening before after now already specific explicitly established experience experiences reason reasons response reply roleplay set up give given use used say said tell told ask asked person people character characters').split(' '));
const normalizeTerm = word => {
    const singular=word.length>4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0,-1) : word;
    return singular==='bodyguard' ? 'guard' : singular;
};
const terms = text => new Set((String(text || '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || [])
    .map(normalizeTerm)
    .filter(word => word.length > 2 && !STOP.has(word) && !/^\d+$/.test(word)));
// These are review hints, never factual status decisions. Negated, uncertain and
// hypothetical outcomes stay verbatim for the selector to interpret in context.
const STATUS = /\b(return\w*|retreat\w*|withdraw\w*|cancel\w*|fulfill\w*|complet\w*|resolv\w*|repay\w*|repaid|refund\w*|receiv\w*|handover|handed|replac\w*|revok\w*|rescind\w*|recover\w*|refus\w*|declin\w*|releas\w*|end(?:ed|s)?|finish\w*|repair\w*|remov\w*|deactivat\w*|disabl\w*|retract\w*)\b|철수|취소|반납|반환|완료|이행|해결|철회|거절|해제|회복|返却|取消/iu;

export function createReviewWindows(chunks, queries = []) {
    const queryTerms = new Set(queries.flatMap(q=>[...terms(q)]));
    if (!queryTerms.size) return (_candidate,_nearby,fallback)=>({units:fallback,focused:false});
    const byEntry = new Map();
    for (const chunk of chunks) {
        if (!byEntry.has(chunk.id)) byEntry.set(chunk.id,new Map());
        for (const unit of chunk.reviewUnits || chunk.units || []) byEntry.get(chunk.id).set(unit.index,unit);
    }
    const entries = new Map([...byEntry].map(([id,units])=>[id,[...units.values()].sort((a,b)=>a.index-b.index)]));
    const frequencies = new Map(), entryTerms = new Map();
    for (const [id,units] of entries) {
        const words=units.map(unit=>terms(unit.text)),frequency=new Map();
        for (const set of words) for (const word of set) frequency.set(word,(frequency.get(word)||0)+1);
        for (const word of frequency.keys()) frequencies.set(word,(frequencies.get(word)||0)+1);
        entryTerms.set(id,{words,frequency});
    }
    return function focusedWindow(candidate, nearbyUnits, fallback) {
        if (!queryTerms.size || !fallback?.length) return {units:fallback,focused:false};
        const entry = entries.get(candidate.id) || [];
        const core = new Set((candidate.reviewUnits || candidate.units || []).map(u=>u.index));
        const {words,frequency}=entryTerms.get(candidate.id) || {words:[],frequency:new Map()};
        // Names and generic vocabulary appearing throughout the archive must not
        // narrow a chunk. In a tiny archive, use within-entry frequency instead.
        const distinctive = word => queryTerms.has(word) &&
            (entries.size < 3 || (frequencies.get(word)||0) <= Math.max(1,entries.size*.5)) &&
            (frequency.get(word)||0) <= Math.max(2,entry.length*.25);
        const anchors = entry.flatMap((unit,index)=> {
            if (!core.has(unit.index)) return [];
            const hits = [...words[index]].filter(distinctive);
            return hits.length >= 2 || hits.some(word=>(frequency.get(word)||0)<=Math.max(1,entry.length*.1))
                ? [{index,hits}] : [];
        });
        // Semantic-only / cross-language hits retain their original source window.
        if (!anchors.length) return {units:fallback,focused:false};
        const wanted = new Set();
        const include = index => {
            for (let i=Math.max(0,index-2);i<=Math.min(entry.length-1,index+2);i++) {
                if (Math.abs(entry[i].index-entry[index].index)<=2) wanted.add(entry[i].index);
            }
        };
        for (const anchor of anchors) include(anchor.index);
        // Offer same-entry follow-ups sharing a distinctive subject with a hit,
        // even across chunk boundaries. Never infer completion from these hints.
        // Include all matching windows atomically; a tight budget cannot retain
        // the setup while silently dropping a known matching outcome window.
        entry.forEach((unit,index)=> {
            if (!STATUS.test(unit.text)) return;
            if (anchors.some(anchor=>index>anchor.index && anchor.hits.some(word=>words[index].has(word)))) include(index);
        });
        const source = new Map(nearbyUnits.map(unit=>[unit.index,unit]));
        const template = nearbyUnits.find(unit=>unit.entryId===candidate.id);
        if (!template) return {units:fallback,focused:false};
        const units = entry.filter(unit=>wanted.has(unit.index)).map(unit=>source.get(unit.index) || {...template,index:unit.index,text:unit.text});
        return {units,focused:true};
    };
}
