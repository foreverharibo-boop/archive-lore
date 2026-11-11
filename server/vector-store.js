// Archive Lore — AGPL-3.0-only. Reuse exact embedding inputs across book renames.
import fs from 'node:fs';
import {privateStore,inside,json,hash} from './storage.js';
import {embeddingIdentity,renamedEmbeddingKeys} from '../lore-vector-identity.js';

// Older files contain only vectors under hashed filenames. Reconstruct candidate
// keys from retained job book names; never guess a vector from its dimensions.
export function legacyEmbeddingBooks(root,worlds) {
    const names=new Set();
    if(worlds && fs.existsSync(worlds))for(const entry of fs.readdirSync(worlds,{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.json'))names.add(entry.name.slice(0,-5));
    const jobs=inside(root,'jobs');
    if(fs.existsSync(jobs))for(const entry of fs.readdirSync(jobs,{withFileTypes:true})){
        if(!entry.isFile()||!/^[-a-f0-9]+\.json$/.test(entry.name))continue;
        try{for(const name of json(inside(jobs,entry.name)).input?.books || [])if(typeof name==='string')names.add(name);}catch{/* An unrelated damaged job must not block saved vectors. */}
    }
    return [...names];
}
export function reusableVectorStore(root,{legacyBooks=()=>[]}={}) {
    const vectors=privateStore(root,'vectors'),aliases=privateStore(root,'vector-aliases');
    let names;const known=new Map();
    const remember=async key=>{
        const identity=embeddingIdentity(key);if(!identity || known.has(identity))return;
        const prior=await aliases.get(identity);
        if(prior?.key && embeddingIdentity(prior.key)===identity && (await vectors.hasMany([prior.key]))[0]){known.set(identity,prior.key);return;}
        await aliases.put(identity,{key});known.set(identity,key);
    };
    async function resolve(key,present=keys=>vectors.hasMany(keys)){
        const identity=embeddingIdentity(key);if(!identity)return null;
        const alias=known.has(identity)?{key:known.get(identity)}:await aliases.get(identity);
        if(alias?.key && embeddingIdentity(alias.key)===identity && (await present([alias.key]))[0]){known.set(identity,alias.key);return alias.key;}
        names ||= legacyBooks();
        const candidates=renamedEmbeddingKeys(key,names);
        if(!candidates.length)return null;
        const found=await present(candidates);return candidates.find((_,i)=>found[i]) || null;
    }
    return {
        async get(key){
            let vector=await vectors.get(key);
            if(vector){await remember(key);return vector;}
            const match=await resolve(key);if(!match)return null;
            vector=await vectors.get(match);if(vector)await remember(match);return vector;
        },
        async hasMany(keys){
            const files=new Set(fs.readdirSync(inside(root,'vectors'),{withFileTypes:true}).filter(e=>e.isFile()).map(e=>e.name));
            const present=items=>items.map(key=>files.has(hash(key)+'.json'));
            const found=present(keys);
            for(let i=0;i<keys.length;i++)if(!found[i])found[i]=!!await resolve(keys[i],present);
            return found;
        },
        async put(key,value){await vectors.put(key,value);await remember(key);},
    };
}
