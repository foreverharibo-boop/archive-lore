// Archive Lore — AGPL-3.0-only
import {serverVectorStore} from './lore-server.js';

// Storage availability is independent of where AI work runs. Once shared
// storage is selected, failures must never silently switch back to an empty DB.
export function sharedVectorStore({local,call,required=()=>false,onShared=()=>{}}) {
    const remote=serverVectorStore({local,call,enabled:()=>true});
    let opening,localOnly=false;
    async function initialize(){
        let status;
        try{status=await call('/status');}
        catch(error){if(error.status===404&&!required()){localOnly=true;return false;}throw error;}
        if(!status.capabilities?.includes('sharedEmbeddings'))throw Error('공통 임베딩 저장소를 쓰려면 아카이브 로어 서버 플러그인을 업데이트하고 실리 서버를 재시작해 줘.');
        localOnly=false;await onShared();
        // Scan keys, not all vectors, and upload only records missing remotely.
        // Browser originals remain intact; failed/partial imports retry safely.
        let after;
        do{
            const page=await local.keys(after);
            if(page.keys.length){
                const {present}=await call('/vectors/has',{keys:page.keys});
                if(!Array.isArray(present)||present.length!==page.keys.length||!present.every(v=>typeof v==='boolean'))throw Error('임베딩 이전 상태 응답이 올바르지 않아.');
                const missing=page.keys.filter((_,i)=>!present[i]);
                for(let i=0;i<missing.length;i+=8){
                    const entries=[];
                    for(const key of missing.slice(i,i+8)){
                        const vector=await local.get(key);if(vector)entries.push({key,vector});
                    }
                    if(entries.length){const result=await call('/vectors/import',{entries});if(result.confirmed!==entries.length)throw Error('임베딩 이전 완료를 확인하지 못했어. 기존 임베딩은 유지했어.');}
                }
            }
            after=page.after;
        }while(after!==undefined);
        return true;
    }
    function ready(){
        // A previous missing-plugin result can be retried after enabling server
        // execution in the same tab. No fallback follows a shared-store failure.
        if(opening&&localOnly&&required()){opening=null;localOnly=false;}
        return opening ||= initialize().catch(error=>{opening=null;throw error;});
    }
    const choose=async()=>await ready()?remote:local;
    return {
        ready,
        clear:()=>remote.clear(),
        async get(key){return (await choose()).get(key);},
        async getMany(keys,options){return (await choose()).getMany(keys,options);},
        async put(key,vector,options){return (await choose()).put(key,vector,options);},
        async hasMany(keys,options){return (await choose()).hasMany(keys,options);},
        async peekMany(keys,options){const store=await choose();return store.peekMany?store.peekMany(keys,options):store.hasMany(keys,options);},
    };
}
