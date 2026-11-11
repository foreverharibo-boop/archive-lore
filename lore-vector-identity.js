// Archive Lore — AGPL-3.0-only. Embedding compatibility depends on the exact
// provider/model/input, not on which lorebook happens to contain that input.
export function embeddingIdentity(key) {
    if(typeof key!=='string')return null;
    const prefix=key.startsWith('embedding-v2:')?'embedding-v2:':key.startsWith('exact-v1:')?'exact-v1:':null;
    if(!prefix)return null;
    try{
        const parts=JSON.parse(key.slice(prefix.length));
        if(!Array.isArray(parts)||parts.length!==6||!parts.slice(1).every(p=>typeof p==='string'))return null;
        return JSON.stringify([parts[0],parts[1],parts[2],parts[3],parts[5]]);
    }catch{return null;}
}
export function renamedEmbeddingKeys(key,names) {
    if(!embeddingIdentity(key))return [];
    try{
        const parts=JSON.parse(key.slice(key.indexOf(':')+1)),id=JSON.parse(parts[4]);
        if(!Array.isArray(id)||id.length!==2||typeof id[1]!=='string')return [];
        return [...new Set(names)].filter(name=>typeof name==='string'&&name!==id[0]).map(name=>{
            const copy=[...parts];copy[4]=JSON.stringify([name,id[1]]);return 'embedding-v2:'+JSON.stringify(copy);
        });
    }catch{return [];}
}
