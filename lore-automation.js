// SPDX-License-Identifier: AGPL-3.0-only
import { estimateTokens, matchesRange } from './lore-core.js';
export function automaticReady(config,messages,start) {
    if(!config.autoCollect || start>=messages.length)return false;
    const pending=messages.slice(start).filter(m=>!m.is_system && String(m.mes||'').trim());
    return config.autoMode==='tokens'?estimateTokens(pending.map(m=>m.mes).join('\n'))>=config.autoTokens:pending.length>=config.autoMessages;
}
export function collectedHideRanges(receipts,messages,keep) {
    const covered=new Set();
    for(const receipt of receipts)if(matchesRange(receipt.source,messages))for(let i=receipt.source.start;i<=receipt.source.end;i++)covered.add(i);
    const sorted=[...covered].sort((a,b)=>a-b), retained=new Set(sorted.slice(Math.max(0,sorted.length-keep)));
    const indices=sorted.filter(i=>!retained.has(i)&&!messages[i].is_system),ranges=[];
    for(const i of indices){const last=ranges.at(-1);if(last&&last.end+1===i)last.end=i;else ranges.push({start:i,end:i});}
    return ranges;
}
