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
test('review-budget audit exposes actual priority and deterministic skips separately from AI selection',async()=>{
    const d=createDiagnostics(),t=d.begin();
    await t.event('selection.plan',{policy:'compact-source-units-v1',units:1,batches:1,concurrency:2,
        reviewTokenLimit:1000,reviewSourceTokens:600,reviewedCandidates:1,skippedCandidates:2,
        reviewScope:'retrieved-nearby-v1',reviewOrderPolicy:'fused-score-first-v1',
        reviewOrder:[{entryId:'strong',index:0,score:.9,status:'reviewed'},
            {entryId:'weak',index:0,score:.1,status:'budget'},{entryId:'missing',index:0,status:'missing-source'}]});
    await t.finish('success');const text=await d.preview();
    assert.match(text,/fused-score-first-v1/);assert.match(text,/AI 선택 결과 아님/);
    assert.match(text,/1\. strong #0.*검토 포함/);assert.match(text,/2\. weak #0.*검토 예산 부족/);
    assert.match(text,/3\. missing #0.*검토 원문 없음/);
    const rows=JSON.parse(JSON.stringify(await d.list()));
    for(const row of rows)for(const event of row.events)event.data=diagnosticSummary(event.data);
    assert.equal(formatDiagnosticPreview(rows),text);
});
test('audit separates selection dependencies, unselected units and budget losses without inventing reasons',()=>{
    const a=createRecallAudit(),before=JSON.stringify(units);
    a.capture('selection.validated',{batch:1,offered:units,accepted:[{...units[0],reason:'Location continuity',requiredContext:[units[1]]}]});
    a.capture('injection.budget',{limit:30,tokens:0,kept:[],dropped:[units[0]]});
    const text=a.text();assert.match(text,/검토 3 · 선택 중심 문장 1 · 연결 문장 1 · 미선택 1/);
    const rejected=text.split('[AI 미선택]')[1].split('[주입 한도 적용]')[0];
    assert.match(rejected,/Unrelated dinner/);assert(!rejected.includes('Repairs complete'));
    assert.doesNotMatch(text+a.details(),/미선택 사유|개별 탈락 이유|알 수 없음/);
    assert.match(a.details(),/\[미선택\] u2.*\nThey had dinner\./);
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
    assert(!text.includes('등록 완료'));assert(!text.includes('private-fixture-secret'));assert(!text.includes('raw body must'));assert(text.includes('core body must'));assert.match(text,/REDACTED/);
    await t.event('injection.installed',{slots:[{name:'archive-lore-recalled',text:'body must stay absent',position:'IN_CHAT',depth:1}],selected:['book:1','book:2']});
    await t.event('rp.response',{text:'RP must stay absent'});await t.finish('success');
    const rows=await d.list(),events=rows.flatMap(r=>r.events);assert.equal(events.length,10);assert.equal(events.filter(e=>e.stage==='recall.review').length,1);
    text=await d.preview();assert.match(text,/주입 슬롯 등록 완료/);assert(text.includes('body must stay absent'));assert(!text.includes('RP must stay absent'));
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
test('overview stays bounded while full recall originals survive beyond the old display limit and secrets remain masked',async()=>{
    const secret='a'.repeat(190)+'PRIVATE-SECRET-END',d=createDiagnostics({secrets:()=>[secret]}),t=d.begin();
    const offered=Array.from({length:200},(_,i)=>({...units[0],id:'u'+i,index:i,text:secret+' BODY-TAIL'.repeat(30)}));
    await t.event('search.ranking',{ranked:offered.map(u=>({...u,offered:true}))});
    for(let i=0;i<3;i++)await t.event('selection.validated',{batch:i+1,offered,accepted:offered.map(u=>({...u,requiredContext:[]}))});
    await t.finish('success');const events=(await d.list()).flatMap(r=>r.events),audit=events.find(e=>e.stage==='recall.review').data.recallReview;
    assert(audit.length<=RECALL_REVIEW_CHARS);assert.match(audit,/표시 .*200개/);assert.match(audit,/진단 표시 한도/);assert(!audit.includes('a'.repeat(140)));assert.match(audit,/REDACTED/);
    const full=(await d.preview());assert(full.length>30000);assert(full.includes('u199'));assert(full.includes(' BODY-TAIL'.repeat(30)));assert(!full.includes(secret));
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
test('full selected and rejected source units and exact final slots survive preview, copy/export and server round trips',async()=>{
    const secret='private-completion-key',d=createDiagnostics({secrets:()=>[secret]}),t=d.begin({chatKey:'full',kind:'generation'});
    const offered=Array.from({length:60},(_,i)=>({id:'unit-'+i,entryId:'book:'+i,index:0,title:'Source '+i,text:`START ${i}\n`+'full source words '.repeat(80)+`\nEND ${i}`}));
    const selected={...offered[58],priority:3,reason:'Complete reason '+secret,requiredContext:[offered[59]]};
    await t.event('selection.validated',{batch:2,offered,accepted:[selected]});
    const prepared='PREPARED-ONLY\n'+'original memory '.repeat(3000)+'\nPREPARED END';
    await t.event('injection.prepared',{recalled:prepared,core:'Original core',guidance:'Original guidance',selected:[selected,offered[59]],tokens:5000});
    let text=await d.preview();assert(text.includes(prepared));assert(text.includes(offered[0].text));assert(text.includes(offered[58].text));assert(text.includes(offered[59].text));
    const installed='REGISTERED\n'+offered[58].text+'\n'+offered[59].text+'\nREGISTERED END';
    await t.event('injection.installed',{slots:[{name:'archive-lore-recalled',text:installed},{name:'archive-lore-core',text:'Core '+secret},{name:'archive-lore-guidance',text:'Guidance\nEND'}],selected:['book:58','book:59']});
    offered[58].text='MUTATED AFTER CAPTURE';await t.finish('success');
    text=await d.preview();assert(text.includes(installed));assert(!text.includes('PREPARED-ONLY'));assert(!text.includes('MUTATED AFTER CAPTURE'));assert(!text.includes(secret));assert(!text.includes('diagnostic.summary-error'));assert.match(text,/Core \[REDACTED\]/);
    assert.equal(await d.export(),text);
    const transported=JSON.parse(JSON.stringify(await d.list()));
    for(const run of transported)for(const event of run.events)event.data=diagnosticSummary(diagnosticSummary(event.data));
    assert.equal(formatDiagnosticPreview(transported),text);
    assert(text.length>24000);assert(text.includes('END 59'));
});
test('selection failure evidence survives the ten-event ring and server summary round trips with secrets redacted',async()=>{
    const secret='private-selector-key',d=createDiagnostics({secrets:()=>[secret]}),t=d.begin();
    await t.event('selection.invalid',{batch:2,batchCount:2,attempt:2,message:'Invalid reference',
        details:{field:'contextIds',anchorId:'u84',problems:[{code:'id-not-in-batch',id:'u0'}]},
        offered:[{id:'u84',entryId:'day'}],response:JSON.stringify({selections:[{id:'u84',reason:secret,contextIds:['u0']}]})});
    for(let i=0;i<20;i++)await t.event('request',{model:'test'});
    await t.finish('error');const text=await d.preview();
    assert.match(text,/묶음 2\/2 · 시도 2/);assert.match(text,/id-not-in-batch/);assert.match(text,/u84 · day/);
    assert.match(text,/REDACTED/);assert(!text.includes(secret));assert(!text.includes('[주입 준비 완료]'));
    const transported=JSON.parse(JSON.stringify(await d.list()));
    for(const run of transported)for(const event of run.events)event.data=diagnosticSummary(diagnosticSummary(event.data));
    assert.equal(formatDiagnosticPreview(transported),text);
});

test('reserved reply placeholders are never presented as installed memory originals',async()=>{
    const d=createDiagnostics(),t=d.begin();await t.event('injection.reserved',{slots:[{name:'memory',text:'SECRET RESERVATION MARKER'}]});
    const text=await d.preview();assert(!text.includes('SECRET RESERVATION MARKER'));assert(!text.includes('실제 주입 슬롯에 등록한 원문 전체'));assert.match(text,/설치 완료 아님/);
});
