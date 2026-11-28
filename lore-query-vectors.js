// Archive Lore — AGPL-3.0-only
import {embeddingChunks} from './lore-core.js';
import {mapOrdered} from './lore-parallel.js';

// Preserve every lane, chunk and duplicate occurrence used by ranking, while
// requesting each distinct text once with bounded concurrency across ALL lanes.
export async function queryVectors(inputs,embed,concurrency,signal){
    const texts=Object.fromEntries(Object.entries(inputs).map(([lane,values])=>
        [lane,values.flatMap(text=>embeddingChunks({content:text},1000).map(chunk=>chunk.text))]));
    const unique=[...new Set(Object.values(texts).flat())];
    const values=await mapOrdered(unique,concurrency,(text,_index,workerSignal)=>embed(text,workerSignal),signal);
    const cache=new Map(unique.map((text,i)=>[text,values[i]]));
    return {lanes:Object.fromEntries(Object.entries(texts).map(([lane,list])=>[lane,list.map(text=>cache.get(text))])),
        dimensions:values.map(vector=>vector.length)};
}
