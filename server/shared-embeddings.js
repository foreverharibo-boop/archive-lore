// Archive Lore — AGPL-3.0-only
import fs from 'node:fs';
import {atomic,inside,json} from './storage.js';
import {legacyEmbeddingBooks,reusableVectorStore} from './vector-store.js';

export const EMBEDDING_FOLDER='archive-lore-embeddings';
// Copy, never move: an interrupted migration can be retried and old installs
// retain their original data. Existing destination files always win.
export function sharedEmbeddings(owner,legacyRoot,worlds) {
    const root=inside(owner,EMBEDDING_FOLDER);
    fs.mkdirSync(root,{recursive:true,mode:0o700});
    const marker=inside(root,'migration-v1.json');
    if(!fs.existsSync(marker)){
        const books=legacyEmbeddingBooks(legacyRoot,worlds);
        for(const folder of ['vectors','vector-aliases']){
            const target=inside(root,folder);fs.mkdirSync(target,{recursive:true,mode:0o700});
            const source=inside(legacyRoot,folder);
            if(!fs.existsSync(source))continue;
            for(const entry of fs.readdirSync(source,{withFileTypes:true})){
                if(!entry.isFile()||! /^[a-f0-9]{64}\.json$/.test(entry.name))continue;
                const dest=inside(target,entry.name);
                if(fs.existsSync(dest))continue;
                const value=json(inside(source,entry.name));
                atomic(dest,value);
                if(JSON.stringify(json(dest))!==JSON.stringify(value))throw Error('임베딩 이전 파일 확인에 실패했어. 기존 파일은 유지했어.');
            }
        }
        atomic(marker,{version:1,books});
    }
    return reusableVectorStore(root,{legacyBooks:()=>[...new Set([
        ...(json(marker).books || []),...legacyEmbeddingBooks(legacyRoot,worlds),
    ])]});
}
