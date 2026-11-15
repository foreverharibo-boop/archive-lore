// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostics} from './lore-diagnostics.js';
import {diagnosticSummary} from './lore-retention.js';
import {formatDiagnosticPreview} from './lore-diagnostic-preview.js';
import {createRecallAudit,RECALL_REVIEW_CHARS} from './lore-recall-diagnostics.js';
const units=[
    {id:'u0',entryId:'book:1',index:0,title:'Temporary gym',text:'The team used the basement.'},
    {id:'u1',entryId:'book:2',index:0,title:'Repairs complete',text:'The team returned to the stadium facility.'},
    {id:'u2',entryId:'book:3',index:0,title:'Unrelated dinner',text:'They had dinner.'},
];
test('audit separates selection dependencies, unselected units and budget losses without inventing reasons',()=>{
    const a=createRecallAudit(),before=JSON.stringify(units);
    a.capture('selection.validated',{batch:1,offered:units,accepted:[{...units[0],reason:'Location continuity',requiredContext:[units[1]]}]});
    a.capture('injection.budget',{limit:30,tokens:0,kept:[],dropped:[units[0]]});
    const text=a.text();assert.match(text,/검토 3 · 선택 중심 문장 1 · 연결 문장 1 · 미선택 1/);
    const rejected=text.split('[AI 미선택]')[1].split('[주입 한도 적용]')[0];
    assert.match(rejected,/Unrelated dinner/);assert(!rejected.includes('Repairs complete'));assert.match(rejected,/알 수 없음/);
    assert.match(text,/빠진 중심 문장 1개/);assert.match(text,/Location continuity/);assert.equal(JSON.stringify(units),before);
});
test('a completed long recall retains early candidates and selection in one stage, and distinguishes prepared from installed',async()=>{
    const d=createDiagnostics({secrets:()=>['private-fixture-secret']}),t=d.begin({chatKey:'test',kind:'generation'});
    await t.event('search.queries',{mode:'questions',queries:['Where does the team train?'],policy:'test'});
    await t.event('search.ranking',{ranked:units.map(u=>({...u,offered:true,score:.8}))});
    for(let i=0;i<40;i++)await t.event('ai.response',{response:'raw body must stay absent',model:'test'});
    await t.event('selection.validated',{batch:1,offered:units,accepted:[{...units[0],reason:'private-fixture-secret',requiredContext:[units[1]]}]});
    await t.event('injection.prepared',{candidateTotal:3,selected:units.slice(0,2),tokens:40,core:'core body must stay absent'});
    await t.finish('success');
    let text=await d.preview();assert.match(text,/Where does the team train/);assert.match(text,/Repairs complete/);assert.match(text,/등록 확인 전/);
    assert(!text.includes('등록 완료'));assert(!text.includes('private-fixture-secret'));assert(!text.includes('raw body must'));assert(!text.includes('core body must'));assert.match(text,/REDACTED/);
    await t.event('injection.installed',{slots:[{name:'archive-lore-recalled',text:'body must stay absent',position:'IN_CHAT',depth:1}],selected:['book:1','book:2']});
    await t.event('rp.response',{text:'RP must stay absent'});await t.finish('success');
    const rows=await d.list(),events=rows.flatMap(r=>r.events);assert.equal(events.length,10);assert.equal(events.filter(e=>e.stage==='recall.review').length,1);
    text=await d.preview();assert.match(text,/주입 슬롯 등록 완료/);assert(!text.includes('body must stay absent'));assert(!text.includes('RP must stay absent'));
    const roundTrip=JSON.parse(JSON.stringify(rows));for(const r of roundTrip)for(const e of r.events)e.data=diagnosticSummary(e.data);
    assert.equal(formatDiagnosticPreview(roundTrip),text);
});
test('empty candidates, zero selection and deferred installation are explicit',async()=>{
    const d=createDiagnostics(),t=d.begin();
    await t.event('retrieval.cache',{chunks:[{hit:false}]});await t.event('retrieval.empty',{reason:'no indexed memories',pending:1});
    await t.event('injection.prepared',{selected:[],tokens:0,candidateTotal:0});
    await t.event('injection.reserved',{slots:[],selected:[]});await t.finish('success');
    const text=await d.preview();assert.match(text,/미임베딩 1/);assert.match(text,/no indexed memories/);assert.match(text,/선별 원문 0/);assert.match(text,/설치 완료 아님/);assert(!text.includes('주입 슬롯 등록 완료'));
});
test('bounded excerpts survive batch volume without retaining full source or leaking a secret crossing the clipping boundary',async()=>{
    const secret='a'.repeat(190)+'PRIVATE-SECRET-END',d=createDiagnostics({secrets:()=>[secret]}),t=d.begin();
    const offered=Array.from({length:200},(_,i)=>({...units[0],id:'u'+i,index:i,text:secret+' BODY-TAIL'.repeat(1000)}));
    await t.event('search.ranking',{ranked:offered.map(u=>({...u,offered:true}))});
    for(let i=0;i<50;i++)await t.event('selection.validated',{batch:i+1,offered,accepted:offered.map(u=>({...u,requiredContext:[]}))});
    await t.finish('success');const events=(await d.list()).flatMap(r=>r.events),audit=events.find(e=>e.stage==='recall.review').data.recallReview;
    assert(audit.length<=RECALL_REVIEW_CHARS);assert.match(audit,/표시 .*200개/);assert.match(audit,/진단 표시 한도/);assert(!audit.includes('a'.repeat(140)));assert.match(audit,/REDACTED/);
    assert((await d.preview()).length<30000);
});
test('disabled diagnostics do not inspect recall arrays, clear and disable do not revive previous summaries',async()=>{
    let enabled=false;const d=createDiagnostics({detailed:()=>enabled}),t=d.begin();
    const forbidden=new Proxy([],{get(){throw Error('do not inspect');}});
    await t.event('search.ranking',{ranked:forbidden});assert.deepEqual(await d.list(),[]);
    enabled=true;await t.event('search.queries',{queries:['old query']});d.clear();await t.finish('success');assert(!(await d.preview()).includes('old query'));
    await t.event('search.queries',{queries:['second old query']});enabled=false;await t.event('ai.response',{});enabled=true;await t.finish('success');
    const reviews=(await d.list()).flatMap(r=>r.events).filter(e=>e.stage==='recall.review');assert.equal(reviews.length,1);
});
test('errors keep the partial search audit and original diagnostic error, without marking injection successful',async()=>{
    const d=createDiagnostics(),t=d.begin();await t.event('search.queries',{queries:['original query']});
    for(let i=0;i<20;i++)await t.event('request',{model:'test'});
    await t.finish('error',{message:'selector failed',status:429});
    const text=await d.preview();assert.match(text,/original query/);assert.match(text,/selector failed/);assert.match(text,/429/);assert(!text.includes('주입 슬롯 등록 완료'));
});
