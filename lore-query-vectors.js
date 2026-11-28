// Archive Lore — AGPL-3.0-only
import {embeddingChunks} from './lore-core.js';
import {mapOrdered} from './lore-parallel.js';

// Preserve every lane, chunk and duplicate occurrence used by ranking, while
// requesting each distinct text once with bounded concurrency across ALL lanes.
export async function queryVectors(inputs,embed,concurrency,signal){
    const grouped=Object.fromEntries(Object.entries(inputs).map(([lane,values])=>
        [lane,values.map(text=>embeddingChunks({content:text},1000).map(chunk=>chunk.text))]));
    const texts=Object.fromEntries(Object.entries(grouped).map(([lane,groups])=>[lane,groups.flat()]));
    const unique=[...new Set(Object.values(texts).flat())];
    const values=await mapOrdered(unique,concurrency,(text,_index,workerSignal)=>embed(text,workerSignal),signal);
    const cache=new Map(unique.map((text,i)=>[text,values[i]]));
    return {lanes:Object.fromEntries(Object.entries(texts).map(([lane,list])=>[lane,list.map(text=>cache.get(text))])),
        groups:Object.fromEntries(Object.entries(grouped).map(([lane,groups])=>[lane,groups.map(list=>list.map(text=>cache.get(text)))])),
        dimensions:values.map(vector=>vector.length)};
}
