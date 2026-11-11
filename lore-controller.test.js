// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoreController } from './lore-controller.js';
import { DEFAULTS, NS, sourceRange } from './lore-core.js';
function fixture() {
    let book={entries:{}}, key='chat-a', failSave=false, failEmbed=false;
    let config={...DEFAULTS,cacheNamespace:'test'}, replies=[], calls=[], cache=new Map();
    const messages=[{name:'A',mes:'같이 병원에 가자.',is_user:true},{name:'B',mes:'좋아, 같이 가자.'}];
    const host={
        settings:()=>config,context:()=>({key,messages}),books:()=>['book'],target:()=> 'book',initialStart:()=>0,
        ensureBook:async()=> 'book',loadBook:async()=>structuredClone(book),
        saveBook:async(_name,data)=>{calls.push('save');if(failSave)throw Error('save failed');book=structuredClone(data);},
        newEntry:data=>{const uid=Math.max(-1,...Object.keys(data.entries).map(Number))+1;return data.entries[uid]={uid,constant:false,disable:false,key:[],content:''};},
        store:{get:async k=>cache.get(k),put:async(k,v)=>cache.set(k,v)},
        embed:async(_s,text,query)=>{calls.push(query?'query':'document');if(failEmbed)throw Error('embed failed');return [1,0];},
        ask:async(_p,system,data)=>{calls.push({system,data});const reply=replies.shift();if(reply instanceof Function)return reply(data);return reply;},
        countTokens:async t=>Math.ceil(t.length/3),changed:()=>{},
    };
    const controller=createLoreController(host);
    return {controller,host,messages,replies,calls,cache,get book(){return book;},set book(value){book=value;},
        set key(v){key=v;},set failSave(v){failSave=v;},set failEmbed(v){failEmbed=v;},set config(v){config={...config,...v};}};
}
const memory=()=>JSON.stringify({entries:[{title:'병원 약속',content:'두 사람은 병원에 함께 가기로 약속했다.',keywords:['병원']}],sideChanges:[]});
test('collect saves receipts and memories before embeddings; next click never recollects',async()=>{
    const f=fixture();f.replies.push(memory());await f.controller.collect();
    assert.equal(Object.keys(f.book.entries).length,1);assert.equal(f.book[NS].receipts.length,1);
    assert(f.calls.indexOf('save')<f.calls.indexOf('document'));
    await f.controller.collect();assert.equal(f.calls.filter(x=>typeof x==='object').length,1);
    assert.equal((await f.controller.dashboard()).next,2);
});
test('failed save neither embeds nor advances and retry saves once',async()=>{
    const f=fixture();f.failSave=true;f.replies.push(memory());await assert.rejects(f.controller.collect(),/save failed/);
    assert.equal(Object.keys(f.book.entries).length,0);assert(!f.calls.includes('document'));
    f.failSave=false;f.replies.push(memory());await f.controller.collect();assert.equal(f.book[NS].receipts.length,1);
});
test('embedding failure retains saved data and retry only embeds pending chunks',async()=>{
    const f=fixture();f.failEmbed=true;f.replies.push(memory());await assert.rejects(f.controller.collect(),/embed failed/);
    assert.equal(Object.keys(f.book.entries).length,1);assert.equal((await f.controller.dashboard()).pending,1);
    f.failEmbed=false;await f.controller.collect();assert.equal(f.calls.filter(x=>typeof x==='object').length,1);
    assert.equal((await f.controller.dashboard()).pending,0);
});
test('switching chats during generation cannot write to either chat',async()=>{
    const f=fixture();f.replies.push(()=>{f.key='chat-b';return memory();});
    await assert.rejects(f.controller.collect(),/채팅방/);assert(!f.calls.includes('save'));
});
test('editing source or lorebook during generation aborts before commit',async()=>{
    const f=fixture();f.replies.push(()=>{f.messages[0].mes='different';return memory();});
    await assert.rejects(f.controller.collect(),/대화가 수정/);assert(!f.calls.includes('save'));
    const g=fixture();g.replies.push(()=>{g.book={entries:{5:{uid:5,content:'manual'}}};return memory();});
    await assert.rejects(g.controller.collect(),/로어북이 변경/);assert(!g.calls.includes('save'));
});
test('invalid side evidence atomically rejects memory and side changes',async()=>{
    const f=fixture();f.replies.push(JSON.stringify({entries:JSON.parse(memory()).entries,sideChanges:[{op:'add',category:'agreements',text:'married',evidence:{message:0,quote:'not in chat'}}]}));
    await assert.rejects(f.controller.collect(),/근거/);assert(!f.calls.includes('save'));
});
test('dialogue search has one selector call; question search plans before embedding/retrieval',async()=>{
    const f=fixture();f.replies.push(memory());await f.controller.collect();f.calls.length=0;
    f.replies.push('{"ids":["u0"]}');const r=await f.controller.recall();
    assert(r.text.includes('병원에 함께'));assert.equal(f.calls.filter(x=>typeof x==='object').length,1);
    f.config={mode:'questions'};f.calls.length=0;f.replies.push('{"questions":["병원에 누구와 가기로 했는가?"]}','{"ids":["u0"]}');await f.controller.recall();
    assert.equal(f.calls.filter(x=>typeof x==='object').length,2);assert.equal(typeof f.calls[0],'object');assert.equal(f.calls[1],'query');
});
test('core is returned intact but never embedded, and empty selection is allowed',async()=>{
    const f=fixture();f.book={entries:{0:{uid:0,content:'Always remember',constant:true},1:{uid:1,content:'Maybe useful'}}};
    await f.controller.index();assert.equal(f.calls.filter(x=>x==='document').length,1);
    f.replies.push('{"ids":[]}');const result=await f.controller.recall();assert.equal(result.core,'Always remember');assert.equal(result.text,'');
});
test('side updates modify only selected fact and retain history; irrelevant collection leaves it unchanged',async()=>{
    const f=fixture();f.replies.push(JSON.stringify({entries:[],sideChanges:[{op:'add',category:'agreements',text:'함께 병원에 가기로 약속함.',evidence:{message:0,quote:'같이 병원에 가자.'}}]}));await f.controller.collect();
    const first=JSON.stringify(f.book.entries[0]);
    f.messages.push({name:'A',mes:'오늘 날씨가 좋네.'});f.replies.push('{"entries":[],"sideChanges":[]}');await f.controller.collect();assert.equal(JSON.stringify(f.book.entries[0]),first);
    f.messages.push({name:'B',mes:'병원에 함께 다녀왔어.'});const id=f.book.entries[0][NS].facts[0].id;
    f.replies.push(JSON.stringify({entries:[],sideChanges:[{op:'update',category:'agreements',id,text:'함께 병원에 가겠다는 약속을 이행함.',evidence:{message:3,quote:'병원에 함께 다녀왔어.'}}]}));await f.controller.collect();
    assert.equal(f.book.entries[0][NS].history.length,1);assert(f.book.entries[0].content.includes('이행'));
});
test('branch collection without changes never overwrites later side version',async()=>{
    const f=fixture(), source=sourceRange(f.messages,0,1), later=[...f.messages,{mes:'future'}];
    f.book={entries:{0:{uid:0,content:'future side',[NS]:{sideCategory:'plans',source:sourceRange(later,2,2),facts:[{id:'f',text:'future'}],history:[{content:'old side',facts:[{id:'f',text:'old'}],source}]}}}};
    const before=JSON.stringify(f.book.entries[0]);f.replies.push('{"entries":[],"sideChanges":[]}');await f.controller.collect();assert.equal(JSON.stringify(f.book.entries[0]),before);
});
