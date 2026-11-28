// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoreController } from './lore-controller.js';
import { DEFAULTS, NS, sourceRange } from './lore-core.js';
import { createDiagnostics } from './lore-diagnostics.js';
import { completionText } from './lore-api.js';
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
test('bulk cache reads and parallel queries retain the same reviewed sources and selected original text',async()=>{
    const runs=[];
    for(const parallel of [false,true]){
        const f=fixture();f.config={mode:'questions',selectionConcurrency:parallel?2:1,cacheNamespace:'speed-test'};
        f.book={entries:{0:{uid:0,comment:'Visit',content:'They visited the hospital. The treatment ended.'},1:{uid:1,comment:'Trip',content:'They visited the beach. They returned home.'}}};
        let bulk=0;const review=[],queryTexts=[];
        if(parallel)f.host.store.getMany=async keys=>{bulk++;return keys.map(key=>f.cache.get(key));};
        f.host.embed=async(_config,text,query)=>{if(query)queryTexts.push(text);await new Promise(r=>setImmediate(r));return [1,0];};
        f.host.ask=async(_profile,_system,data)=>{
            if(!data.memories)return JSON.stringify({questions:['Did the treatment end?','Did the treatment end?','What happened at the hospital?']});
            review.push(data.memories);
            return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Prior context',contextIds:data.memories.slice(1).map(m=>m.id)}]});
        };
        await f.controller.index();const result=await f.controller.recall();
        assert.equal(bulk,parallel?1:0);assert.equal(new Set(queryTexts).size,queryTexts.length);
        assert(f.controller.state().lastRecall.timings.cacheMs>=0);
        runs.push({text:result.text,review,queryTexts});
    }
    assert.deepEqual(runs[0],runs[1]);
});
for(const mode of ['dialogue','questions','embedding'])for(const generousRecall of [false,true])test(`recall diagnostics inspect the real pipeline without extra model calls: ${mode}, generous=${generousRecall}`,async()=>{
    const f=fixture(),diagnostics=createDiagnostics();f.host.diagnostics=diagnostics;
    f.config={mode,generousRecall,injectionTokens:3000};
    f.book={entries:{0:{uid:0,comment:'Hospital followup',content:'They visited the hospital together. The treatment is finished.'}}};
    let requests=0;
    f.host.ask=async(_p,system,data)=>{
        requests++;
        if(!data.memories)return '{"questions":["Did the treatment finish?"]}';
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Prior visit',contextIds:data.memories.slice(1).map(u=>u.id)}]});
    };
    await f.controller.index();diagnostics.clear();
    const result=await f.controller.recall();assert.match(result.text,/treatment is finished/);
    const text=await diagnostics.preview();assert.match(text,/Hospital followup/);assert.match(text,/주입 준비 완료/);assert.match(text,/주입 한도 적용/);assert(!text.includes('주입 슬롯 등록 완료'));
    if(mode!=='embedding'){assert.match(text,/미선택 0/);assert.match(text,/연결 문장 1/);}
    else assert(!text.includes('[AI 미선택]'));
    if(mode==='questions')assert.match(text,/Did the treatment finish/);
    assert.equal(requests,mode==='questions'?2:mode==='embedding'?0:1);
});
for(const generousRecall of [false,true])test(`completed return is atomic with a selected side fact, generous=${generousRecall}`,async()=>{
    const f=fixture();
    f.config={mode:'questions',generousRecall,injectionTokens:3000,prompts:{questions:'Custom planner',select:'Custom selector'}};
    f.book={entries:{
        0:{uid:0,comment:'Expenses',content:'Morgan paid to clean the borrowed raincoat.'},
        1:{uid:1,comment:'Monday',content:'Morgan brought the coat back to Lee. Lee took the hanger and put the coat in his locker.'},
        2:{uid:2,comment:'Excluded',content:'PRIVATE unrelated outcome.',STMB_sidePromptHistory:{templateKey:'private'}},
    }};
    f.config={excludedSidePromptKeys:['private']};
    let planners=0,selectors=0;
    f.host.ask=async(_profile,system,data)=>{
        assert(!JSON.stringify(data).includes('PRIVATE'));
        if(system.startsWith('Custom planner')){
            planners++;assert.match(system,/EVENT STATUS SEARCH/);
            return '{"questions":["What happened to the borrowed raincoat, including its return?"]}';
        }
        selectors++;assert(system.startsWith('Custom selector'));
        assert.match(system,/EVENT OUTCOME CONTINUITY/);
        const cost=data.memories.find(u=>u.text.includes('paid'));
        const outcomes=data.memories.filter(u=>u.text.includes('brought')||u.text.includes('hanger'));
        return JSON.stringify({selections:[{id:cost.id,priority:3,reason:'Expense context',outcomeIds:outcomes.map(u=>u.id)}]});
    };
    await f.controller.index();
    const saved=structuredClone(f.book),documentCalls=f.calls.filter(c=>c==='document').length;
    const result=await f.controller.recall();
    assert.equal(planners,1);assert.equal(selectors,1);
    assert(result.text.includes('paid'));assert(result.text.includes('brought'));assert(result.text.includes('locker'));
    assert(result.guidance.includes('never replay a completed errand'));
    assert(result.tokens<=3000);assert.deepEqual(f.book,saved);
    assert.equal(f.calls.filter(c=>c==='document').length,documentCalls);
});
for(const mode of ['dialogue','questions','embedding'])test(`generous recall includes related background, respects side exclusions and bypasses plain embedding in ${mode}`,async()=>{
    const f=fixture();f.config={mode,generousRecall:true,candidateCount:2,excludedSidePromptKeys:['private'],selectionFocus:['meaning'],injectionTokens:3000};
    f.book={entries:{0:{uid:0,content:'They had a reassuring hospital visit.'},1:{uid:1,content:'She liked having him beside her at the hospital.'},2:{uid:2,content:'PRIVATE record.',STMB_sidePromptHistory:{templateKey:'private'}}}};
    let selectors=0;
    f.host.ask=async(_p,system,data)=>{
        assert(!JSON.stringify(data).includes('PRIVATE'));
        if(system.includes('"questions":'))return '{"questions":["What helped at the hospital?"]}';
        selectors++;assert.match(system,/GENEROUS RELATED MEMORY MODE/);
        return JSON.stringify({selections:data.memories.map(m=>({id:m.id,priority:2,contextIds:[],focusMatches:['meaning']}))});
    };
    await f.controller.index();const before=structuredClone(f.book),result=await f.controller.recall();
    assert(result.tokens<=3000);assert.deepEqual(f.book,before);assert(!result.text.includes('PRIVATE'));
    if(mode==='embedding'){assert.equal(selectors,0);assert.equal(result.fill,undefined);}
    else {assert.equal(selectors,1);assert(result.text.includes('reassuring'));assert(result.text.includes('liked'));assert.equal(result.fill,undefined);assert(result.guidance);}
});
test('changing generous mode during a search rejects its obsolete result',async()=>{
    const f=fixture();f.book={entries:{0:{uid:0,content:'Hospital fact.'}}};await f.controller.index();
    f.replies.push(()=>{f.config={generousRecall:true};return '{"selections":[]}';});
    await assert.rejects(f.controller.recall(),/설정이 바뀌/);assert.equal(f.controller.state().lastRecall,null);
});
test('generous mode keeps normal candidate batches and clearing it restores normal requests',async()=>{
    const f=fixture();f.config={candidateCount:4,injectionTokens:256};
    f.book={entries:Object.fromEntries(Array.from({length:8},(_,i)=>[i,{uid:i,content:('They visited hospital room '+i+' for a checkup. ').repeat(160)}]))};
    await f.controller.index();let requests=[];
    f.host.ask=async(_p,system,data)=>{requests.push({system,data});return '{"selections":[]}';};
    await f.controller.recall();const normal=requests;assert(normal.length>0);
    requests=[];f.config={generousRecall:true};const generous=await f.controller.recall();
    assert.equal(generous.text,'');assert.equal(requests.length,normal.length);
    assert.deepEqual(requests.map(r=>r.data.memories),normal.map(r=>r.data.memories));
    requests=[];f.config={generousRecall:false};await f.controller.recall();
    assert.deepEqual(requests,normal);
});
for(const mode of ['dialogue','questions','embedding'])test(`selection focus reaches search, selection and response in ${mode} mode without extra completions`,async()=>{
    const f=fixture();f.config={mode,selectionFocus:['affection','meaning'],prompts:{select:'My custom selector'},injectionTokens:500};
    f.book={entries:{0:{uid:0,comment:'Hospital visit',content:'They went to the hospital together. She thanked him for staying.'}}};
    f.messages.splice(0,f.messages.length,{name:'A',is_user:true,mes:'Why was that hospital visit special?'});
    let planners=0,selectors=0;
    f.host.ask=async(_p,system,data)=>{
        if(system.includes('"questions":')){
            planners++;assert(!system.includes('MEMORY SELECTION EMPHASIS'));assert.deepEqual(data.selectionFocus,['affection','meaning']);assert.match(system,/FOCUSED MEMORY SEARCH/);
            return '{"questions":["What happened at the hospital?"]}';
        }
        selectors++;assert(system.startsWith('My custom selector'));assert.match(system,/Affection and emotions/);assert.match(system,/Meaning and relationship changes/);
        assert.deepEqual(data.selectionFocus,['affection','meaning']);assert.equal(data.injectionBudgetTokens,500);
        const fact=data.memories.find(x=>x.text.includes('thanked'));
        return JSON.stringify({selections:[{id:fact.id,priority:3,reason:'Recorded gratitude explains why this visit mattered.'}]});
    };
    await f.controller.index();const indexed=f.calls.filter(x=>x==='document').length;
    const result=await f.controller.recall();assert(result.text.includes('thanked him'));assert(result.tokens<=500);
    assert(result.guidance);
    assert.equal(selectors,mode==='embedding'?0:1);assert.equal(planners,mode==='questions'?1:0);
    assert.equal(f.calls.filter(x=>x==='document').length,indexed);
});
test('clearing selection emphasis restores the original selector request',async()=>{
    const f=fixture();f.book={entries:{0:{uid:0,content:'They visited the hospital.'}}};await f.controller.index();
    const systems=[];f.host.ask=async(_p,system,data)=>{systems.push(system);assert.equal('selectionFocus' in data,systems.length===2);return '{"selections":[]}';};
    await f.controller.recall();f.config={selectionFocus:['boundaries']};await f.controller.recall();f.config={selectionFocus:[]};await f.controller.recall();
    assert.equal(systems[0],systems[2]);assert.notEqual(systems[0],systems[1]);
});
test('count-only reads one book, never migrates vectors or reads receipts, and scopes its immediate cache',async()=>{
    const f=fixture();f.book={entries:{0:{uid:0,content:'First'},1:{uid:1,content:'Second'},2:{uid:2,content:'Core',constant:true},3:{uid:3,content:'Disabled',disable:true}}};
    let reads=0,checks=0;const load=f.host.loadBook;
    f.host.loadBook=async(...args)=>{reads++;return load(...args);};
    f.host.target=()=>assert.fail('counts must not read collection progress');
    f.host.store.hasMany=()=>assert.fail('counts must not migrate');
    f.host.store.peekMany=async keys=>{checks++;assert.equal(keys.length,2);return [true,false];};
    assert.equal(f.controller.cachedEmbeddingCounts(),null);
    const [a,b]=await Promise.all([f.controller.embeddingCounts(),f.controller.embeddingCounts()]);
    assert.deepEqual(a,{embedded:1,pending:1});assert.deepEqual(a,b);assert.equal(reads,1);assert.equal(checks,1);
    assert.deepEqual(f.controller.cachedEmbeddingCounts(),a);
    f.config={embeddingProvider:'openai',embeddingModel:'different'};assert.equal(f.controller.cachedEmbeddingCounts(),null);
    await f.controller.embeddingCounts();f.controller.invalidateEmbeddingCounts();assert.equal(f.controller.cachedEmbeddingCounts(),null);
    f.key='other';assert.equal(f.controller.cachedEmbeddingCounts(),null);
});
test('an entry edit during count lookup cannot repopulate the cache with stale numbers',async()=>{
    const f=fixture();f.book={entries:{0:{uid:0,content:'Fact'}}};let release,entered;
    const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
    f.host.store.peekMany=async()=>{entered();await gate;return [true];};
    const pending=f.controller.embeddingCounts();await started;f.controller.invalidateEmbeddingCounts();release();
    await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(f.controller.cachedEmbeddingCounts(),null);
});
for(const phase of ['questions','embedding','selection'])test(`stop aborts ${phase}, discards noncooperative late results and allows a new recall`,async()=>{
    const f=fixture();f.book={entries:{0:{uid:0,content:'The hospital visit happened.'}}};await f.controller.index();
    f.config={mode:'questions'};let entered,release,seen;
    const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
    const hold=async signal=>{seen=signal;entered();await gate;return phase==='embedding'?[1,0]:'{"selections":[]}';};
    const originalEmbed=f.host.embed;
    f.host.embed=async(...args)=>phase==='embedding'?hold(args[3]):originalEmbed(...args);
    f.host.ask=async(_p,system,_data,signal)=>{
        const question=system.includes('"questions":');
        if((phase==='questions'&&question)||(phase==='selection'&&!question))return hold(signal);
        return question?'{"questions":["Which hospital?"]}':'{"selections":[]}';
    };
    const result=f.controller.recall();await started;f.controller.cancel();
    await assert.rejects(result,e=>e.name==='AbortError');assert(seen.aborted);assert.equal(f.controller.state().busy,false);
    assert.equal(f.controller.state().lastRecall,null);release();await new Promise(r=>setImmediate(r));
    f.host.embed=originalEmbed;f.host.ask=async(_p,system)=>system.includes('"questions":')?'{"questions":["Which hospital?"]}':'{"selections":[]}';
    await f.controller.recall();assert.equal(f.controller.state().busy,false);
});
test('both recall modes focus the new request, select original facts, and reuse cached document embeddings',async()=>{
    for (const mode of ['dialogue','questions']) {
        const f=fixture();f.config={mode,candidateCount:4};
        f.messages.splice(0,f.messages.length,{name:'B',mes:'An unrelated restaurant scene. '.repeat(500)},
            {name:'A',is_user:true,mes:'Remember the ski resort?'});
        f.book={entries:{0:{uid:0,comment:'Snow outing',content:'They exchanged rings at the ski resort at 9 a.m. He proposed.'},
            ...Object.fromEntries(Array.from({length:20},(_,i)=>[i+1,{uid:i+1,comment:'Dinner '+i,content:'An unrelated restaurant scene.'}]))}};
        let documents=0,queries=0,questionCalls=0,reviews=0;
        f.host.embed=async(_s,text,query)=>{if(query)queries++;else documents++;return text.length<300&&/ski|Snow/.test(text)?[1,.01]:[.01,1];};
        f.host.ask=async(_p,system,data)=>{
            assert.equal(data.latestUser,'Remember the ski resort?');
            if(system.includes('"questions":')){questionCalls++;return '{"questions":["What happened at the ski resort?"]}';}
            reviews++;assert.equal(data.maxSelections,48);assert.equal(data.injectionBudgetTokens,3000);
            const found=data.memories.find(u=>u.text.includes('exchanged rings'));
            assert(found,'focused event must reach the selection AI');
            assert(!data.memories.some(u=>u.text==='m.'));
            return JSON.stringify({selections:[{id:found.id,priority:3,reason:'answers the requested ski event'}]});
        };
        await f.controller.index();const indexed=documents;
        const result=await f.controller.recall();
        assert(result.text.includes('exchanged rings'));assert(result.text.includes('9 a.m.'));
        assert(!result.text.includes('unrelated restaurant'));assert.equal(documents,indexed);
        assert.equal(questionCalls,mode==='questions'?1:0);assert.equal(reviews,1);assert(queries>0);
        assert.equal(result.units[0].priority,3);assert.equal(result.units[0].reason,'answers the requested ski event');
    }
});
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
test('collection persists six side entries and advances story dates without duplicating them',async()=>{
    const f=fixture();f.messages[0].mes='2026-03-01. We are lovers. The other facts are confirmed.';
    const evidence={message:0,quote:'2026-03-01'};
    const categories=['relationship','agreements','preferences','emotions','turningPoints','plans'];
    f.replies.push(JSON.stringify({entries:[],sideChanges:categories.map(category=>({op:'add',category,text:category==='relationship'?'Lovers':'Confirmed '+category,evidence,...(category==='relationship'?{relationship:{kind:'start',since:'2026-03-01'},dateEvidence:evidence}:{})})),storyDate:{date:'2026-03-01',evidence}}));
    await f.controller.collect();
    const relation=()=>Object.values(f.book.entries).find(e=>e[NS]?.sideCategory==='relationship');
    const other=()=>JSON.stringify(Object.values(f.book.entries).filter(e=>e[NS]?.sideCategory!=='relationship'));
    assert.equal(Object.keys(f.book.entries).length,6);assert.equal(relation().content,'Lovers · D+1');
    const uid=relation().uid, unchanged=other();
    f.messages.push({mes:'2026-03-12. We went for a walk.',name:'A'});
    f.replies.push(data=>{assert.equal(data.currentStoryDate,'2026-03-01');return JSON.stringify({entries:[],sideChanges:[],storyDate:{date:'2026-03-12',evidence:{message:2,quote:'2026-03-12'}}});});
    await f.controller.collect();
    assert.equal(relation().uid,uid);assert.equal(relation().content,'Lovers · D+12');assert.equal(other(),unchanged);
    assert.equal(relation()[NS].history[0].content,'Lovers · D+1');
    f.messages.push({mes:'2026-03-13. We broke up.',name:'A'});
    const breakupEvidence={message:3,quote:'2026-03-13. We broke up.'};
    f.replies.push(JSON.stringify({entries:[],sideChanges:[{op:'update',category:'relationship',id:relation()[NS].facts[0].id,text:'Ex-partners',relationship:{kind:'breakup',since:'2026-03-13'},evidence:breakupEvidence,dateEvidence:breakupEvidence}],storyDate:{date:'2026-03-13',evidence:breakupEvidence}}));
    await f.controller.collect();
    assert.equal(relation().uid,uid);assert.equal(relation().content,'Ex-partners · D+1 since breakup');
    assert.equal(Object.keys(f.book.entries).length,6);assert.equal(f.book[NS].receipts.length,3);
});
test('automatic collection uses one request for memory and enabled custom sides; disabled categories remain unchanged',async()=>{
    const f=fixture();f.config={enabled:true,autoCollect:true,autoMessages:2,sideTemplates:[{id:'inventory',title:'Inventory',prompt:'Track acquired objects',enabled:true}]};
    f.replies.push(JSON.stringify({entries:JSON.parse(memory()).entries,sideChanges:[{op:'add',category:'inventory',text:'A hospital invitation',evidence:{message:0,quote:'병원'}}]}));
    assert.equal(await f.controller.maybeAutoCollect(),true);
    assert.equal(f.calls.filter(c=>typeof c==='object').length,1);
    assert.equal(Object.values(f.book.entries).filter(e=>e[NS]?.sideCategory==='inventory').length,1);
    assert.equal(await f.controller.maybeAutoCollect(),false);
    f.messages.push({mes:'새 대화'});assert.equal(await f.controller.maybeAutoCollect(),false);
});
test('disabled side output rejects entire collection instead of updating a disabled record',async()=>{
    const f=fixture();f.config={sideTemplates:[]};
    f.replies.push(JSON.stringify({entries:[],sideChanges:[{op:'add',category:'plans',text:'Plan',evidence:{message:0,quote:'병원'}}]}));
    await assert.rejects(f.controller.collect(),/변경 형식/);assert.equal(Object.keys(f.book.entries).length,0);
});
test('catch-up batches every message including newest without buffer; hiding occurs only after successful indexing',async()=>{
    const f=fixture();f.messages.push({mes:'third'},{mes:'fourth'},{mes:'fifth'});f.config={keepMessages:1};
    const hidden=[];f.host.hideRange=async range=>{hidden.push(range);for(let i=range.start;i<=range.end;i++)f.messages[i].is_system=true;};
    for(let i=0;i<3;i++)f.replies.push(data=>JSON.stringify({entries:[{title:'Batch',content:data.dialogue.map(m=>m.text).join(' ')}],sideChanges:[]}));
    await f.controller.collect({start:0,end:4,batchSize:2});
    assert.deepEqual(f.book[NS].receipts.map(r=>[r.source.start,r.source.end]),[[0,1],[2,3],[4,4]]);
    assert.deepEqual(hidden,[{start:0,end:3}]);assert(!f.messages[4].is_system);
    const g=fixture();g.config={keepMessages:0};g.host.hideRange=async()=>{throw Error('must not hide');};g.failEmbed=true;g.replies.push(memory());
    await assert.rejects(g.controller.collect(),/embed failed/);
    g.failEmbed=false;let didHide=false;g.host.hideRange=async()=>{didHide=true;};await g.controller.collect();assert(didHide);
});
test('catch-up rejects invalid batch size; automatic collection waits for RP and current chat',async()=>{
    const f=fixture();await assert.rejects(f.controller.collect({batchSize:0}),/분할 개수/);
    f.config={autoCollect:true,autoMessages:1};f.host.generating=()=>true;assert.equal(await f.controller.maybeAutoCollect(),false);
    f.host.generating=()=>false;const load=f.host.loadBook;f.host.loadBook=async()=>{f.key='other';return load();};assert.equal(await f.controller.maybeAutoCollect(),false);
});
const draftReply=JSON.stringify({title:'Hospital arc',content:'They planned and completed a hospital visit.'});
function twoMemories(f){f.book={entries:{0:{uid:0,comment:'Plan',content:'They planned a visit.',[NS]:{source:sourceRange(f.messages,0,0)}},1:{uid:1,comment:'Visit',content:'They visited.',[NS]:{source:sourceRange(f.messages,1,1)}}}};}
test('merge draft is read-only; apply keeps originals and replaces retrieval with arc',async()=>{
    const f=fixture();twoMemories(f);const original=JSON.stringify(f.book);f.replies.push(draftReply);
    const draft=await f.controller.prepareMaintenance({kind:'merge',ids:['["book","0"]','["book","1"]']});
    assert.equal(JSON.stringify(f.book),original);assert(!f.calls.includes('save'));
    await f.controller.applyMaintenance(draft);
    assert.equal(Object.keys(f.book.entries).length,3);assert.equal(f.book.entries[0].content,'They planned a visit.');
    assert.equal(f.book.entries[2][NS].tier,1);assert.equal((await f.controller.dashboard()).records.length,1);
    await assert.rejects(f.controller.applyMaintenance(draft),/만료/);
});
test('maintenance rejects cross-book, single-item merge and mixed-tier selection',async()=>{
    const f=fixture();twoMemories(f);
    await assert.rejects(f.controller.prepareMaintenance({kind:'merge',ids:['["book","0"]']}),/2개 이상/);
    f.book.entries[1][NS].tier=1;
    await assert.rejects(f.controller.prepareMaintenance({kind:'merge',ids:['["book","0"]','["book","1"]']}),/기억끼리/);
    await assert.rejects(f.controller.prepareMaintenance({kind:'compact',ids:['["else","0"]']}),/같은 로어북/);
});
test('maintenance stale draft, changed chat and changed source cannot commit',async()=>{
    for(const change of [f=>{f.book.entries[0].content='manual change';},f=>{f.key='new';},f=>{f.messages[0].mes='edited';}]){
        const f=fixture();twoMemories(f);f.replies.push(draftReply);const draft=await f.controller.prepareMaintenance({kind:'compact',ids:['["book","0"]']});
        change(f);await assert.rejects(f.controller.applyMaintenance(draft));assert(!f.calls.includes('save'));
    }
});
test('regeneration reads original hidden dialogue, compaction retains previous content',async()=>{
    const f=fixture();twoMemories(f);f.messages[0].is_system=true;
    f.replies.push(data=>{assert.equal(data.dialogue[0].text,'같이 병원에 가자.');assert(!data.memories);return draftReply;});
    const draft=await f.controller.prepareMaintenance({kind:'regenerate',ids:['["book","0"]']});await f.controller.applyMaintenance(draft);
    assert.equal(f.book.entries[0][NS].history[0].content,'They planned a visit.');
    assert.equal(f.book.entries[0].content,JSON.parse(draftReply).content);
});
test('two arcs become a combined arc; no further tier; regeneration uses original member records',async()=>{
    const f=fixture();twoMemories(f);f.book.entries[0][NS].tier=1;f.book.entries[1][NS].tier=1;f.replies.push(draftReply);
    const draft=await f.controller.prepareMaintenance({kind:'merge',ids:['["book","0"]','["book","1"]']});await f.controller.applyMaintenance(draft);
    assert.equal(f.book.entries[2][NS].tier,2);
    await assert.rejects(f.controller.prepareMaintenance({kind:'merge',ids:['["book","2"]']}),/더 묶지 않아/);
    f.replies.push(data=>{assert.equal(data.sourceMemories.length,2);assert.equal(data.sourceMemories[0].content,'They planned a visit.');return draftReply;});
    await f.controller.prepareMaintenance({kind:'regenerate',ids:['["book","2"]']});
});
test('maintenance embedding failure retains committed version and invalidates draft to prevent duplicate apply',async()=>{
    const f=fixture();twoMemories(f);f.replies.push(draftReply);const draft=await f.controller.prepareMaintenance({kind:'compact',ids:['["book","0"]']});
    f.failEmbed=true;await assert.rejects(f.controller.applyMaintenance(draft),/embed failed/);
    assert.equal(f.book.entries[0].content,JSON.parse(draftReply).content);await assert.rejects(f.controller.applyMaintenance(draft),/만료/);
    f.failEmbed=false;await f.controller.index();assert.equal(f.book.entries[0][NS].history.length,1);
});
test('failed maintenance save keeps draft retryable; chat switch during last read prevents saving',async()=>{
    const f=fixture();twoMemories(f);f.replies.push(draftReply);const draft=await f.controller.prepareMaintenance({kind:'compact',ids:['["book","0"]']});
    f.failSave=true;await assert.rejects(f.controller.applyMaintenance(draft),/save failed/);assert.equal(f.book.entries[0].content,'They planned a visit.');
    f.failSave=false;await f.controller.applyMaintenance(draft);assert.equal(f.book.entries[0][NS].history.length,1);
    const g=fixture();twoMemories(g);g.replies.push(draftReply);const second=await g.controller.prepareMaintenance({kind:'compact',ids:['["book","0"]']});
    const load=g.host.loadBook;g.host.loadBook=async()=>{g.key='other';return load();};
    await assert.rejects(g.controller.applyMaintenance(second),/채팅방/);assert(!g.calls.includes('save'));
});

test('105 imported entries changed from core to recallable are visible as pending without generating or rewriting memories',async()=>{
    const f=fixture();f.book={entries:Object.fromEntries(Array.from({length:105},(_,i)=>[i,{uid:i,content:'Imported memory '+i,constant:true}]))};
    let batches=0;f.host.store.hasMany=async keys=>{batches++;return keys.map(()=>false);};
    let view=await f.controller.dashboard();assert.equal(view.records.length,105);assert.equal(view.pending,0);
    for(const entry of Object.values(f.book.entries))entry.constant=false;
    const before=JSON.stringify(f.book);view=await f.controller.dashboard();assert.equal(view.pending,105);assert.equal(view.embedded,0);assert.equal(view.records.length,105);assert.equal(batches,2);assert.equal(JSON.stringify(f.book),before);assert.deepEqual(f.calls,[]);
});

test('plain embedding recall needs no AI profile/calls and injects cached source chunks within budget',async()=>{
    const f=fixture();f.config={mode:'embedding',profile:'',searchProfile:'',injectionTokens:256};
    f.book={entries:{0:{uid:0,comment:'Visit',content:'They visited the hospital. Her ring reads A B. His ring reads B A.'},1:{uid:1,constant:true,content:'Core stays intact.'}}};
    await f.controller.index();f.calls.length=0;
    f.host.ask=async()=>{throw Error('plain embedding must not call AI');};
    const result=await f.controller.recall();
    assert(result.text.includes('hospital'));assert(result.text.includes('Her ring'));assert(result.text.includes('His ring'));
    assert.equal(result.core,'Core stays intact.');assert(result.tokens<=256);
    assert(f.calls.includes('query'));assert(!f.calls.includes('document'));
    assert.equal(f.controller.state().lastRecall.mode,'embedding');
    assert.equal(f.controller.state().lastRecall.timings.selectionMs,0);
    assert.equal(f.controller.state().lastRecall.timings.questionMs,0);
});

test('plain embedding with missing vectors does not generate memories or fall back to AI',async()=>{
    const f=fixture();f.config={mode:'embedding'};f.book={entries:{0:{uid:0,content:'Not embedded.'}}};
    const r=await f.controller.recall();assert.equal(r.text,'');assert.equal(f.controller.state().lastRecall.pending,1);assert.equal(f.calls.length,0);
});

test('recall excludes replaced answer in every mode while maintaining the full stale snapshot',async()=>{
    for(const mode of ['dialogue','questions','embedding']){
        const f=fixture();f.config={mode};f.messages[1].mes='OLD_ANSWER_MUST_NOT_LEAK';
        f.book={entries:{0:{uid:0,content:'A hospital visit.'}}};await f.controller.index();
        const embed=f.host.embed;f.host.embed=async(s,text,q,signal)=>{if(q)assert(!text.includes('OLD_ANSWER'));return embed(s,text,q,signal);};
        f.host.ask=async(_p,_s,data)=>{assert(!JSON.stringify(data).includes('OLD_ANSWER'));return 'memories' in data?'{"selections":[]}':'{"questions":["hospital"]}';};
        await f.controller.recall({generationType:'swipe'});assert.equal(f.messages.length,2);
    }
});

test('malformed selector responses get one retry; valid empty selection does not retry',async()=>{
    for(const replies of [['{}','{"selections":[]}'],['{"selections":[]}'],['{}','{}']]){
        const f=fixture();f.book={entries:{0:{uid:0,content:'Hospital visit.'}}};await f.controller.index();f.calls.length=0;
        f.replies.push(...replies);
        if(replies.at(-1)==='{}')await assert.rejects(f.controller.recall(),/형식/);
        else await f.controller.recall();
        assert.equal(f.calls.filter(x=>typeof x==='object').length,replies.length);
    }
});

for(const generousRecall of [false,true])test(`selection repair identifies the bad link and preserves the full corrected event, generous=${generousRecall}`,async()=>{
    const f=fixture(),d=createDiagnostics();f.host.diagnostics=d;
    f.config={generousRecall,injectionTokens:3000};
    f.book={entries:{0:{uid:0,content:'Lee borrowed a coat. The owner agreed to lend it.'},1:{uid:1,content:'Lee returned the coat.'}}};
    await f.controller.index();d.clear();const before=structuredClone(f.book);
    let calls=0,first,memories;
    f.host.ask=async(_p,system,data)=>{
        calls++;
        const start=data.memories.find(u=>u.text.includes('borrowed'));
        const context=data.memories.find(u=>u.text.includes('agreed'));
        const outcome=data.memories.find(u=>u.text.includes('returned'));
        if(calls===1){
            assert(!data.selectionRepair);memories=structuredClone(data.memories);
            first=JSON.stringify({selections:[{id:start.id,priority:3,reason:'Coat status',contextIds:[context.id,'unoffered-id']} ]});
            return first;
        }
        assert.equal(calls,2);assert.match(system,/CORRECT THE REJECTED SELECTION/);
        assert.deepEqual(data.memories,memories);assert.equal(data.selectionRepair.previousResponse,first);
        assert.equal(data.selectionRepair.details.anchorId,start.id);
        assert.deepEqual(data.selectionRepair.details.problems,[{code:'id-not-in-batch',id:'unoffered-id'}]);
        return JSON.stringify({selections:[{id:start.id,priority:3,reason:'Coat status',contextIds:[context.id],outcomeIds:[outcome.id]}]});
    };
    const result=await f.controller.recall();assert.equal(calls,2);assert.deepEqual(f.book,before);
    assert(result.text.includes('borrowed'));assert(result.text.includes('agreed'));assert(result.text.includes('returned'));
    const preview=await d.preview();assert.match(preview,/id-not-in-batch/);assert.match(preview,/수정 응답 재검증 성공/);
});

for(const generousRecall of [false,true])test(`cross-category context survives recall without a repair, generous=${generousRecall}`,async()=>{
    const f=fixture();f.config={generousRecall,injectionTokens:3000};
    f.book={entries:{0:{uid:0,comment:'Agreements',content:'Lee agreed to meet Morgan on Saturday.'},1:{uid:1,comment:'Plans',content:'Morgan plans to wait at the station.'}}};
    await f.controller.index();let calls=0;
    f.host.ask=async(_p,system,data)=>{
        calls++;assert.match(system,/different entryId is not a format error/);
        const a=data.memories.find(u=>u.text.includes('agreed')),b=data.memories.find(u=>u.text.includes('plans'));
        return JSON.stringify({selections:[{id:a.id,priority:2,reason:'Meeting plan',contextIds:[b.id]}]});
    };
    const result=await f.controller.recall();assert.equal(calls,1);
    assert(result.text.includes('Agreements\nLee agreed'));assert(result.text.includes('Plans\nMorgan plans'));
    assert.equal(result.selected.size,2);assert(result.tokens<=3000);
});

for(const generousRecall of [false,true])test(`recall retries truncated questions and selection with larger ceilings, generous=${generousRecall}`,async()=>{
    const f=fixture();f.config={mode:'questions',generousRecall};
    f.book={entries:{0:{uid:0,content:'Lee visited the station.'}}};await f.controller.index();
    const limits={questions:[],selection:[]};
    f.host.ask=async(_p,_system,data,_signal,tokens)=>{
        const phase=data.memories?'selection':'questions';limits[phase].push(tokens);
        if(limits[phase].length===1)return completionText({choices:[{finish_reason:'length',message:{content:'{"selections":['}}]});
        if(phase==='questions')return '{"questions":["What happened at the station?"]}';
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Prior visit',contextIds:[]}]});
    };
    const result=await f.controller.recall();
    assert.deepEqual(limits,{questions:[1200,6000],selection:[6000,12000]});
    assert(result.text.includes('Lee visited the station.'));assert(result.tokens<=3000);
});

for(const generousRecall of [false,true])test(`failed selection repair stays bounded and exposes the failing batch without injecting partial memory, generous=${generousRecall}`,async()=>{
    const f=fixture(),secret='private-test-credential',d=createDiagnostics({secrets:()=>[secret]});f.host.diagnostics=d;
    f.config={generousRecall};f.book={entries:{0:{uid:0,content:'A recorded visit.'}}};await f.controller.index();d.clear();
    let calls=0;
    f.host.ask=async(_p,_s,data)=>{calls++;return JSON.stringify({selections:[{id:data.memories[0].id,priority:2,reason:secret,contextIds:['u999']} ]});};
    await assert.rejects(f.controller.recall(),error=>error.stage==='selection.validate');
    assert.equal(calls,2);assert.equal(f.controller.state().lastRecall,null);
    const preview=await d.preview();assert.match(preview,/묶음 1\/1 · 시도 2/);assert.match(preview,/u999/);
    assert.match(preview,/id-not-in-batch/);assert.match(preview,/미검증, 주입되지 않음/);
    assert(!preview.includes(secret));assert(!preview.includes('[주입 준비 완료]'));
});

for(const generousRecall of [false,true])test(`canceling selection repair discards late model output, generous=${generousRecall}`,async()=>{
    const f=fixture();f.config={generousRecall};f.book={entries:{0:{uid:0,content:'A recorded visit.'}}};await f.controller.index();
    let calls=0;
    f.host.ask=async(_p,_s,data)=>{calls++;if(calls===1)return JSON.stringify({selections:[{id:data.memories[0].id,priority:2,reason:'Visit',contextIds:['missing']}]});
        f.controller.cancel();return JSON.stringify({selections:[{id:data.memories[0].id,priority:2,reason:'Visit'}]});};
    await assert.rejects(f.controller.recall(),error=>error.name==='AbortError');
    assert.equal(calls,2);assert.equal(f.controller.state().lastRecall,null);
});

test('cached server indexing yields to other requests and does not reread context for every chunk',async()=>{
    const f=fixture();let reads=0,yields=0;
    f.book={entries:Object.fromEntries(Array.from({length:105},(_,uid)=>[uid,{uid,content:'Fact '+uid}]))};
    const context=f.host.context;f.host.context=()=>{reads++;return context();};
    f.host.contextKey=()=>context().key;f.host.yieldControl=async()=>{yields++;};
    f.host.store.get=async()=>[1,0];
    await f.controller.index();
    assert(yields>=7);assert(reads<10,`context read ${reads} times`);
    assert(!f.calls.includes('document'));
});

test('native Memory Books entries index without legacy metadata; cache skips unchanged and constant records',async()=>{
    const f=fixture();
    f.book={entries:{
        0:{uid:0,stmemorybooks:true,comment:'[001] First',content:'An established event.',constant:false},
        1:{uid:1,stmemorybooks:true,comment:'Relationship',content:'Married.',constant:false},
        2:{uid:2,stmemorybooks:true,content:'Always included core fact.',constant:true},
        3:{uid:3,stmemorybooks:true,content:'Disabled fact.',disable:true},
    }};
    await f.controller.index();assert.equal(f.calls.filter(x=>x==='document').length,2);
    await f.controller.index();assert.equal(f.calls.filter(x=>x==='document').length,2);
    f.book.entries[1].content='Married; moved into a new home.';
    await f.controller.index();assert.equal(f.calls.filter(x=>x==='document').length,3);
});

test('dashboard counts whole entries, leaving partially embedded long entries pending',async()=>{
    const f=fixture();f.book={entries:{0:{uid:0,content:'Short fact.'},1:{uid:1,content:'A long fact with a distinct ending. '.repeat(800)},2:{uid:2,content:'Always present',constant:true},3:{uid:3,content:'Disabled',disable:true}}};
    let documents=0;f.host.embed=async()=>{if(++documents===3)throw Error('partial failure');return [1,0];};
    await assert.rejects(f.controller.index(),/partial failure/);
    let view=await f.controller.dashboard();assert.equal(view.embedded,1);assert.equal(view.pending,1);
    f.host.embed=async()=>[1,0];await f.controller.index();view=await f.controller.dashboard();assert.equal(view.embedded,2);assert.equal(view.pending,0);
    f.book.entries[0].content='Changed fact.';view=await f.controller.dashboard();assert.equal(view.embedded,1);assert.equal(view.pending,1);
});

for(const selectionFocus of [[],['affection']])test(`empty question plan retries then searches cached records with normal selection: ${selectionFocus}`,async()=>{
    const f=fixture();f.config={mode:'questions',selectionFocus,injectionTokens:500};
    f.book={entries:{0:{uid:0,content:'Current relationship',constant:true},1:{uid:1,content:'She thanked him for staying at the hospital.'}}};
    await f.controller.index();f.calls.length=0;
    f.replies.push('{"questions":[]}','{"questions":["What feelings did she express about their hospital visit?"]}',data=>JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Recorded gratitude informs their next shared visit.'}]}));
    const result=await f.controller.recall();
    assert.equal(result.core,'Current relationship');assert.match(result.text,/thanked him/);assert(result.tokens<=500);
    assert.equal(f.calls.filter(c=>typeof c==='object').length,3);assert(f.calls.includes('query'));assert(!f.calls.includes('document'));
    assert.equal(f.controller.state().lastRecall.questions.length,1);
    assert.equal(f.controller.state().lastRecall.candidateTotal,1);
});

test('English event anchors reach the selector when all vector lanes prefer unrelated scenes',async()=>{
    const f=fixture();f.config={mode:'questions',candidateCount:4};
    f.messages.splice(0,f.messages.length,{mes:'We are sitting on the sofa.'},{is_user:true,mes:'처음 안전교육 때 숙제가 뭐였지?'});
    f.book={entries:{...Object.fromEntries(Array.from({length:20},(_,i)=>[i,{uid:i,comment:'Evening',content:'They sit on the sofa.'}])),
        20:{uid:20,comment:'2031-06-20 First training',content:'First safety training. The instructor assigned a thirty-minute drill. The attempt ended after fifteen minutes.'}}};
    f.host.embed=async(_s,text,query)=>query?[1,0]:text.includes('safety')?[.1,1]:[1,0];
    await f.controller.index();
    f.host.ask=async(_p,system,data)=>{
        if(system.includes('"questions":'))return '{"questions":["What was the first safety training assignment and drill duration?"]}';
        const assignment=data.memories.find(u=>u.text.includes('thirty-minute'));
        const outcome=data.memories.find(u=>u.text.includes('fifteen minutes'));
        assert(assignment);assert(outcome);
        return JSON.stringify({selections:[{id:assignment.id,priority:3,reason:'original assignment and actual outcome',contextIds:[outcome.id]}]});
    };
    const result=await f.controller.recall();
    assert.match(result.text,/2031-06-20/);assert.match(result.text,/thirty-minute/);assert.match(result.text,/fifteen minutes/);
    assert(!result.text.includes('sofa'));
});

test('same request carries different category evidence and response direction, then clearing fully restores requests',async()=>{
    const f=fixture();f.config={mode:'questions',injectionTokens:1000};
    f.messages.splice(0,f.messages.length,{is_user:true,mes:'What do you remember about the hospital visit?'});
    f.book={entries:{0:{uid:0,comment:'Visit',content:'They visited the hospital. She thanked him for staying. They carried a blue umbrella.'}}};
    const asks=[],queries=[];
    f.host.embed=async(_c,text,query)=>{if(query)queries.push(text);return [1,0];};
    f.host.ask=async(_p,system,data)=>{
        asks.push({system,data});
        if(system.includes('"questions":'))return JSON.stringify({questions:data.selectionFocus?['What happened at the hospital?','Which recorded details explain this hospital visit?']:['What happened at the hospital?']});
        const word=data.selectionFocus?.includes('affection')?'thanked':data.selectionFocus?.includes('details')?'umbrella':'visited';
        const unit=data.memories.find(u=>u.text.includes(word));
        return JSON.stringify({selections:[{id:unit.id,priority:3,reason:'Answers the visit request',focusMatches:data.selectionFocus||[]}]});
    };
    await f.controller.index();
    const baseline=await f.controller.recall(),baselineRequests=structuredClone(asks),baselineQueries=[...queries];
    asks.length=0;queries.length=0;f.config={selectionFocus:['affection']};const feelings=await f.controller.recall();
    assert.match(feelings.text,/thanked/);assert.match(feelings.guidance,/expressed feelings/);
    assert.match(asks[0].system,/FOCUSED MEMORY SEARCH/);assert(queries.some(q=>q.includes('Which recorded details')));
    assert.equal(asks.length,2);
    f.config={selectionFocus:['details']};const details=await f.controller.recall();
    assert.match(details.text,/umbrella/);assert.match(details.guidance,/distinctive places/);assert.notEqual(feelings.text,details.text);
    f.config={selectionFocus:[]};asks.length=0;queries.length=0;const cleared=await f.controller.recall();
    assert.deepEqual(cleared,baseline);assert.deepEqual(asks,baselineRequests);assert.deepEqual(queries,baselineQueries);
});
test('mandatory question search still allows the selector to reject every candidate without guidance',async()=>{
    const f=fixture();f.config={mode:'questions',selectionFocus:['affection']};
    f.book={entries:{0:{uid:0,content:'They visited the hospital.'}}};await f.controller.index();
    f.replies.push('{"questions":["What feelings were recorded during their hospital visit?"]}','{"selections":[]}');
    const result=await f.controller.recall();
    assert.equal(result.text,'');assert(!result.guidance);assert(f.calls.filter(c=>c==='query').length>0);
    assert.equal(f.controller.state().lastRecall.candidateTotal,1);
});

test('changing categories during a noncooperative local selector rejects its stale result',async()=>{
    const f=fixture();f.config={selectionFocus:['affection']};f.book={entries:{0:{uid:0,content:'She thanked him.'}}};await f.controller.index();
    f.host.ask=async()=>{f.config={selectionFocus:['details']};return '{"selections":[{"id":"u0","priority":3,"reason":"gratitude"}]}';};
    await assert.rejects(f.controller.recall(),/설정이 바뀌/);assert.equal(f.controller.state().lastRecall,null);
});

test('parallel selector preserves every batch prompt and the final memory order',async()=>{
    async function run(concurrency){
        const f=fixture();f.config={selectionConcurrency:concurrency,candidateCount:40,injectionTokens:3000};
        f.book={entries:Object.fromEntries(Array.from({length:16},(_,i)=>[i,{uid:i,content:(`Hospital visit ${i}: they promised to return together and remembered the agreement. `).repeat(90)}]))};
        let active=0,peak=0;const prompts=[];
        f.host.ask=async(_profile,system,data)=>{
            peak=Math.max(peak,++active);prompts.push({system,data});
            await new Promise(r=>setTimeout(r,data.batch===1?15:1));active--;
            return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'The relevant hospital agreement.'}]});
        };
        await f.controller.index();const result=await f.controller.recall();
        return {result,prompts:prompts.sort((a,b)=>a.data.batch-b.data.batch),peak};
    }
    const serial=await run(1),parallel=await run(2);
    assert(serial.prompts.length>1);assert.equal(serial.peak,1);assert.equal(parallel.peak,2);
    assert.deepEqual(parallel.prompts,serial.prompts);assert.equal(parallel.result.text,serial.result.text);
    assert.deepEqual([...parallel.result.selected],[...serial.result.selected]);assert.equal(parallel.result.tokens,serial.result.tokens);
});

for(const selectionFocus of [[],['affection','meaning']])test(`six-question recall keeps one planner call, cached embeddings and the injection cap: ${selectionFocus}`,async()=>{
    const f=fixture();f.config={mode:'questions',selectionFocus,injectionTokens:500};
    f.book={entries:Object.fromEntries(Array.from({length:30},(_,i)=>[i,{uid:i,comment:`Visit ${i}`,content:`During visit ${i}, she thanked him for staying at the hospital.`}]))};
    await f.controller.index();f.calls.length=0;
    const questions=Array.from({length:6},(_,i)=>`What happened during hospital visit ${i}?`);
    let planners=0,selectors=0;
    f.host.ask=async(_profile,system,data,_signal,tokens)=>{
        if(system.includes('"questions":')){
            planners++;assert.match(system,/one to six/);assert.doesNotMatch(system,/at most four/);assert.equal(tokens,1200);
            return JSON.stringify({questions});
        }
        selectors++;assert.equal(tokens,6000);assert.deepEqual(data.questions,questions);
        assert.equal(data.injectionBudgetTokens,500);
        const fact=data.memories[0];
        return JSON.stringify({selections:[{id:fact.id,priority:3,reason:'Recorded hospital gratitude informs the current shared hospital visit.'}]});
    };
    const result=await f.controller.recall();
    assert.equal(planners,1);assert.equal(selectors,1);
    assert.equal(f.controller.state().lastRecall.candidateTotal,24);
    assert.deepEqual(f.controller.state().lastRecall.questions,questions);
    assert.equal(f.calls.filter(c=>c==='document').length,0);
    assert(result.text.includes('thanked him'));assert(result.tokens<=500);
});

for(const response of ['{"questions":[]}','{"questions":[" " ]}','{"questions":["Valid?",""]}','{}','null','[]','not JSON','{"questions":"Where?"}','{"questions":["1","2","3","4","5","6","7"]}'])test(`malformed question plan retries only the planner once: ${response}`,async()=>{
    const f=fixture();f.config={mode:'questions',searchProfile:'search-profile'};
    f.book={entries:{0:{uid:0,content:'They visited the hospital.'}}};await f.controller.index();f.calls.length=0;
    const requests=[];f.host.ask=async(profile,system,data)=>{
        requests.push({profile,system,data});
        if(requests.length===1)return response;
        if(requests.length===2)return '{"questions":["Which hospital did they visit?"]}';
        return '{"selections":[]}';
    };
    await f.controller.recall();
    assert.equal(requests.length,3);assert.equal(requests[0].profile,'search-profile');
    assert.match(requests[0].system,/Never return an empty questions array/);
    assert.match(requests[1].system,/previous response/);
    assert.deepEqual(requests[1].data,requests[0].data);
    assert.deepEqual(f.controller.state().lastRecall.questions,['Which hospital did they visit?']);
    assert.equal(f.calls.filter(c=>c==='document').length,0);
});
for(const response of ['{}','{"questions":[]}','{"questions":[" "]}'])test(`repeated invalid or empty plans fail clearly without silently injecting zero: ${response}`,async()=>{
    const f=fixture();f.config={mode:'questions'};f.replies.push(response,response);
    f.book={entries:{0:{uid:0,content:'They visited the hospital.'}}};await f.controller.index();f.calls.length=0;
    f.host.embed=()=>assert.fail('no embedding before a valid question');
    await assert.rejects(f.controller.recall(),/유효한 질문을 1~6개.*한 번 재시도했지만 실패/);
    assert.equal(f.calls.length,2);assert.equal(f.controller.state().lastRecall,null);
});

test('question provider errors are not retried and cancellation during the retry discards late output',async()=>{
    const f=fixture();f.config={mode:'questions'};let calls=0;
    f.book={entries:{0:{uid:0,content:'They visited the hospital.'}}};await f.controller.index();
    f.host.ask=async()=>{calls++;throw Error('provider timeout');};
    await assert.rejects(f.controller.recall(),/provider timeout/);assert.equal(calls,1);
    let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);calls=0;
    f.host.ask=async()=>{calls++;if(calls===1)return '{}';entered();await gate;return '{"questions":["Late question?"]}';};
    const pending=f.controller.recall();await started;f.controller.cancel();
    await assert.rejects(pending,{name:'AbortError'});release();await new Promise(r=>setImmediate(r));
    assert.equal(calls,2);assert.equal(f.controller.state().lastRecall,null);
});

for (const mode of ['dialogue','questions','embedding']) test(`side search exclusions apply before ranking and core injection in ${mode}`,async()=>{
    const f=fixture();f.config={mode,excludedSidePromptKeys:['private']};
    f.book={entries:{
        0:{uid:0,content:'PUBLIC hospital memory.'},
        1:{uid:1,content:'PRIVATE side record.',STMB_sidePromptHistory:{templateKey:'private'}},
        2:{uid:2,constant:true,content:'PRIVATE constant side.',STMB_sidePromptRegeneration:{templateKey:'private'}},
        3:{uid:3,constant:true,content:'PUBLIC core.'},
    }};
    const before=structuredClone(f.book);await f.controller.index();
    if(mode==='questions')f.replies.push(JSON.stringify({questions:['What happened at the hospital?']}));
    if(mode!=='embedding')f.replies.push(data=>{
        assert(!JSON.stringify(data).includes('PRIVATE'));
        return JSON.stringify({selections:[]});
    });
    const result=await f.controller.recall();assert.equal(result.core,'PUBLIC core.');
    assert(!result.text.includes('PRIVATE'));
    assert(f.controller.state().lastRecall.records.every(r=>[0,3].includes(r.entry.uid)));
    assert.deepEqual(f.book,before,'retrieval never rewrites native activation or saved content');
    f.config={excludedSidePromptKeys:[],mode:'embedding'};
    const included=await f.controller.recall();assert(included.core.includes('PRIVATE constant'));
    assert(included.text.includes('PRIVATE side'),'re-enabling needs neither regeneration nor re-embedding');
});
test('changing side search selection during recall rejects stale injection',async()=>{
    const f=fixture();f.config={mode:'dialogue'};
    f.book={entries:{0:{uid:0,content:'A hospital memory.'}}};await f.controller.index();
    f.replies.push(()=>{f.config={excludedSidePromptKeys:['private']};return JSON.stringify({selections:[]});});
    await assert.rejects(f.controller.recall(),/설정이 바뀌/);assert.equal(f.controller.state().lastRecall,null);
});

for(const mode of ['dialogue','questions','embedding'])for(const generousRecall of [false,true])for(const scenario of ['empty','core','excluded','unindexed'])test(`no searchable memories skip all provider calls: ${mode}, generous=${generousRecall}, ${scenario}`,async()=>{
    const f=fixture();f.config={mode,generousRecall,excludedSidePromptKeys:['private'],selectionFocus:['meaning']};
    if(scenario==='core')f.book={entries:{0:{uid:0,constant:true,content:'Always retained core.'}}};
    if(scenario==='excluded'){
        f.book={entries:{0:{uid:0,content:'Private memory.',STMB_sidePromptHistory:{templateKey:'private'}},1:{uid:1,content:'Disabled memory.',disable:true},2:{uid:2,content:'   '}}};
        await f.controller.index();f.calls.length=0;
    }
    if(scenario==='unindexed')f.book={entries:{0:{uid:0,content:'A real memory awaiting indexing.'}}};
    const before=structuredClone(f.book);
    f.host.ask=()=>assert.fail('no question or selection call without searchable memories');
    f.host.embed=()=>assert.fail('no query or document embedding without searchable memories');
    const result=await f.controller.recall(),last=f.controller.state().lastRecall;
    assert.equal(result.text,'');assert.equal(result.selected.size,0);assert.equal(result.core,scenario==='core'?'Always retained core.':'');
    assert.deepEqual(last.questions,[]);assert.equal(last.candidateTotal,0);assert.equal(last.pending,scenario==='unindexed'?1:0);
    assert.equal(last.timings.questionMs,0);assert.equal(last.timings.embeddingMs,0);assert.equal(last.timings.selectionMs,0);
    assert.deepEqual(f.book,before);assert.deepEqual(f.calls,[]);
});

for(const mode of ['dialogue','questions','embedding'])for(const generousRecall of [false,true])test(`recall attaches common guidance without focus and without extra requests: ${mode}, generous=${generousRecall}`,async()=>{
    const f=fixture();f.config={mode,generousRecall,selectionFocus:[],injectionTokens:1000};
    f.book={entries:{0:{uid:0,content:'They visited the hospital together.'}}};await f.controller.index();f.calls.length=0;
    if(mode==='questions')f.replies.push('{"questions":["What happened at the hospital?"]}');
    if(mode!=='embedding')f.replies.push(data=>JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'The shared visit.',contextIds:[]}]}));
    const result=await f.controller.recall();assert.match(result.guidance,/Do not recap retrieved events/);
    assert(!result.guidance.includes('Let expressed feelings'));assert.match(result.text,/hospital together/);assert(result.tokens<=1000);
    assert.equal(f.calls.filter(c=>typeof c==='object').length,mode==='embedding'?0:mode==='questions'?2:1);
    assert.equal(f.calls.filter(c=>c==='document').length,0);
});

for(const generousRecall of [false,true])for(const correct of [false,true])test(`context count stays strict across repair, generous=${generousRecall}, correct=${correct}`,async()=>{
    const f=fixture();f.config={generousRecall,injectionTokens:3000};
    f.book={entries:{0:{uid:0,content:Array.from({length:40},(_,i)=>`Hospital detail number ${i}.`).join(' ')}}};
    await f.controller.index();let calls=0,originalMemories;
    f.host.ask=async(_p,system,data)=>{
        calls++;
        assert.match(system,/HARD OUTPUT LIMITS/);
        assert.match(system,/Count each array BEFORE returning JSON/);
        assert.deepEqual(data.selectionLimits,{contextIds:32,outcomeIds:8});
        assert(data.memories.length>=36);
        if(calls===1){assert(!data.selectionRepair);originalMemories=structuredClone(data.memories);}
        else {
            assert.equal(calls,2);assert.deepEqual(data.memories,originalMemories);
            assert.deepEqual(data.selectionRepair.details.problems,[{code:'too-many-references',count:35,limit:32}]);
        }
        const refs=data.memories.slice(1,calls===2&&correct?33:36).map(u=>u.id);
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Visit context',contextIds:refs}]});
    };
    if(correct){
        const result=await f.controller.recall();assert.equal(result.units.length,33);assert(result.tokens<=3000);
        for(const unit of originalMemories.slice(0,33))assert(result.text.includes(unit.text));
    } else await assert.rejects(f.controller.recall(),/too-many-references/);
    assert.equal(calls,2);
});

for(const mode of ['dialogue','questions'])for(const generousRecall of [false,true])test(`review input cap reaches actual selector calls: ${mode}, generous=${generousRecall}`,async()=>{
    const {estimateTokens}=await import('./lore-core.js');
    const f=fixture(),diagnostics=createDiagnostics();f.host.diagnostics=diagnostics;
    f.config={mode,generousRecall,reviewTokens:2000,injectionTokens:5000,candidateCount:24,selectionConcurrency:2};
    f.book={entries:Object.fromEntries(Array.from({length:12},(_,i)=>[i,{uid:i,comment:`Visit ${i}`,content:(`At hospital visit ${i}, they discussed the treatment and agreed to rest together. `).repeat(90)}]))};
    let originalTokens=0,selectors=0;
    f.host.ask=async(_p,system,data)=>{
        if(!data.memories)return '{"questions":["What happened at the hospital?"]}';
        assert.match(system,/BOUNDED SOURCE REVIEW/);assert.equal(data.injectionBudgetTokens,5000);
        originalTokens+=data.memories.reduce((sum,u)=>sum+estimateTokens(u.text),0);selectors++;
        return JSON.stringify({selections:[{id:data.memories[0].id,priority:3,reason:'Relevant hospital context',contextIds:[]}]});
    };
    await f.controller.index();const before=structuredClone(f.book);diagnostics.clear();
    const result=await f.controller.recall();assert(selectors>0);assert(originalTokens<=2000);assert(result.tokens<=5000);assert.deepEqual(f.book,before);
    assert((await diagnostics.preview()).includes(`${originalTokens} / 2000`));
});
test('plain embedding bypasses review input limits and never invokes a selector',async()=>{
    const f=fixture();f.config={mode:'embedding',reviewTokens:1000,injectionTokens:5000};
    f.book={entries:{0:{uid:0,content:'They discussed their visit to the hospital. '.repeat(400)}}};
    f.host.ask=()=>assert.fail('no selector for plain embedding');await f.controller.index();
    const low=await f.controller.recall();f.config={reviewTokens:64000};const high=await f.controller.recall();
    assert(low.text);assert.equal(low.text,high.text);assert.equal(low.tokens,high.tokens);
});

for(const generousRecall of [false,true])for(const selectionFocus of [[],['affection']])test(`question-first recall sends evidence for all questions to the real selector: generous=${generousRecall}, focus=${selectionFocus.length}`,async()=>{
    const f=fixture(),diagnostics=createDiagnostics();f.host.diagnostics=diagnostics;
    f.config={mode:'questions',generousRecall,selectionFocus,reviewTokens:2000,injectionTokens:3000,candidateCount:24};
    f.messages.splice(0,f.messages.length,{is_user:true,mes:'I am resting on the sofa in the living room.'});
    const content=id=>id+'. '+('This is the original recorded agreement, with its conditions and outcome intact. '.repeat(15));
    f.book={entries:Object.fromEntries(Array.from({length:20},(_,i)=>[i,{uid:i,comment:'Evening',content:content('sofa-'+i)}]))};
    for(const [i,id] of ['camera-policy','audio-policy','filming-plan'].entries())f.book.entries[20+i]={uid:20+i,comment:id,content:content(id)};
    const questions=['What camera-policy was agreed?','What audio-policy was agreed?','What filming-plan was recorded?'];
    const queryInputs=[],seen=[];let questionCalls=0,selectionCalls=0;
    f.host.embed=async(_s,text,query)=>{
        if(query)queryInputs.push(text);
        if(text.includes('camera-policy'))return [.02,1,0,0];
        if(text.includes('audio-policy'))return [.02,0,1,0];
        if(text.includes('filming-plan'))return [.02,0,0,1];
        return [1,.01,.01,.01];
    };
    f.host.ask=async(_p,_system,data)=>{
        if(!data.memories){questionCalls++;return JSON.stringify({questions:[...questions,questions[0]]});}
        selectionCalls++;seen.push(...data.memories);
        return JSON.stringify({selections:data.memories.filter(u=>['camera-policy.','audio-policy.','filming-plan.'].includes(u.text))
            .map(u=>({id:u.id,priority:3,reason:'Direct recorded answer to a search question',contextIds:[]}))});
    };
    await f.controller.index();const before=structuredClone(f.book);const result=await f.controller.recall();
    for(const id of ['camera-policy','audio-policy','filming-plan']){
        assert(seen.some(u=>u.text===id+'.'),id+' must reach the selector');assert(result.text.includes(id));
    }
    assert.equal(questionCalls,1);assert.equal(selectionCalls,1);assert.equal(queryInputs.length,new Set(queryInputs).size);
    assert.equal(f.controller.state().lastRecall.questions.length,3);assert.deepEqual(f.book,before);
    const report=await diagnostics.preview();assert.match(report,/question-balanced-v1/);assert.match(report,/질문 3 우선 배분/);
});
