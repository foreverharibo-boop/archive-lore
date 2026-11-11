// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {recordCollectionResult,collectionResult,dismissCollectionResult,markDeferredCollectionHideDone,collectionResultLines,createCollectionStatusPanel,createCollectionCompletionNotifier} from './lore-collection-status.js';

test('only saved memories create queued cards; other chats and uncommitted failures do not leak',()=>{
    const memory={id:'memory',chatKey:'queue',type:'memory',createdAt:10,state:'completed',range:{sceneStart:0,sceneEnd:19},result:{memorySaved:true,memoryCount:2,autoHide:{status:'failed'}}};
    assert.equal(collectionResult('other',[memory]),null);
    assert.equal(collectionResult('queue',[{...memory,result:null,state:'failed'}]),null);
    const view=collectionResult('queue',[memory]);
    assert.equal(view.memoryCount,2);assert.equal(view.complete,true);
    assert(collectionResultLines(view).some(line=>line.includes('숨김 실패')));
});
test('queued sides count saved items, not queued jobs, and keep partial failures visible',()=>{
    const memory={id:'m',chatKey:'sides',type:'memory',createdAt:10,state:'completed',result:{memorySaved:true,sideSummary:{failed:1}}};
    const side={id:'s',parentJobId:'m',chatKey:'sides',type:'sidePromptBatch',state:'running'};
    assert.equal(collectionResult('sides',[memory,side]).side.pending,true);
    const done={...side,state:'completed',result:{successes:['one','two'],failures:[{name:'three'}]}};
    assert.deepEqual(collectionResult('sides',[memory,done]).side,{updated:2,failed:2,pending:false,interrupted:false});
    assert.equal(collectionResult('sides',[memory,{...side,state:'blocked'}]).side.interrupted,true);
});
test('successful deferred hiding replaces the old failure without inventing a per-job count',()=>{
    const memory={id:'m',chatKey:'deferred',type:'memory',createdAt:10,state:'completed',result:{memorySaved:true,autoHide:{status:'failed',recordedAt:10,keep:8}}};
    markDeferredCollectionHideDone('deferred');
    assert(collectionResultLines(collectionResult('deferred',[memory])).includes('보류했던 메시지 숨김 완료'));
});
test('latest direct receipt survives reopening, is isolated by chat and disappears after undo',()=>{
    const first=recordCollectionResult('direct',{id:'one',complete:true,hide:{status:'off'}});
    const next=recordCollectionResult('direct',{id:'two',complete:true,hide:{status:'done',changed:12,keep:8}});
    next.side={updated:2,failed:0};
    assert.equal(collectionResult('direct').id,'two');assert.equal(collectionResult('missing'),null);
    assert(collectionResultLines(collectionResult('direct')).includes('메시지 12개 숨김 · 최근 8개 유지 설정'));
    dismissCollectionResult('direct');assert.equal(collectionResult('direct'),null);
    assert.equal(collectionResult('direct',[{id:first.id,type:'memory',chatKey:'direct',createdAt:first.at-1,state:'completed',result:{memorySaved:true}}]),null);
});

function fixture() {
    const el=()=>({children:[],hidden:false,textContent:'',append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(){}});
    const listeners=new Set(),jobs=new Set();let key='a',reads=0,nativeBusy=false,resolve;
    const state={busy:false,status:''},config={enabled:true,autoEmbed:true};
    const receipt={complete:true,memoryCount:1,hide:{status:'done',changed:10,keep:8},side:{updated:2}};
    const search={context:()=>({key}),settings:()=>config,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},controller:{state:()=>state,cachedEmbeddingCounts:()=>({embedded:2,pending:3}),embeddingCounts:()=>{reads++;return new Promise(r=>resolve=r);}}};
    const panel=createCollectionStatusPanel({search,readResult:()=>receipt,busy:()=>nativeBusy,subscribeJobs:fn=>{jobs.add(fn);return()=>jobs.delete(fn);},openRecords:async()=>{},undo:async()=>{},document:{createElement:el}});
    return {panel,search,state,config,receipt,emit:()=>listeners.forEach(fn=>fn()),emitJobs:()=>jobs.forEach(fn=>fn()),resolve:v=>resolve(v),set key(v){key=v;},set nativeBusy(v){nativeBusy=v;},get reads(){return reads;},get listeners(){return listeners.size+jobs.size;}};
}
test('home reads counts without embedding and avoids rescanning on every progress event',async()=>{
    const f=fixture();assert.equal(f.reads,1);assert.equal(f.panel.status.children[1].textContent,'임베딩 대기 3개');
    f.state.busy=true;f.state.status='임베딩 진행 중';for(let i=0;i<50;i++)f.emit();assert.equal(f.reads,1);
    f.resolve({embedded:5,pending:0});await new Promise(r=>setImmediate(r));
    assert.equal(f.panel.card.children[2].textContent,'임베딩 진행 중');
    f.state.busy=false;f.emit();assert.equal(f.reads,2);
    f.resolve({embedded:5,pending:0});await new Promise(r=>setImmediate(r));
    assert.equal(f.panel.card.children[2].textContent,'연결된 로어북 임베딩 완료');
    f.search.autoEmbeddingState={key:'a',status:'failed'};f.panel.paint();assert.match(f.panel.card.children[2].textContent,/완료/);
    const refresh=f.panel.refresh();f.resolve({embedded:2,pending:3});await refresh;assert.match(f.panel.card.children[2].textContent,/실패/);
    f.config.enabled=false;f.panel.paint();assert.match(f.panel.card.children[2].textContent,/미실행/);
    f.panel.dispose();assert.equal(f.listeners,0);
});
test('slow count responses cannot paint another chat or a disposed home',async()=>{
    const f=fixture();f.key='b';f.resolve({embedded:9,pending:0});await new Promise(r=>setImmediate(r));
    f.panel.paint();assert.equal(f.panel.card.hidden,true);assert.equal(f.panel.status.hidden,true);f.panel.dispose();
});
test('completion opens once without a home, waits for side jobs and stays until explicitly resolved',async()=>{
    let result={id:'first',complete:false,side:{pending:true}},busy=true,key='a',close;
    const shown=[];
    const notifier=createCollectionCompletionNotifier({readResult:()=>result,currentKey:()=>key,busy:()=>busy,open:async(r,k)=>{shown.push([r.id,k]);await new Promise(resolve=>close=resolve);}});
    const tick=()=>new Promise(r=>setImmediate(r));
    notifier.check();await tick();assert.equal(shown.length,0);
    result.complete=true;busy=false;notifier.check();await tick();assert.equal(shown.length,0);
    result.side.pending=false;notifier.check();await tick();assert.deepEqual(shown,[['first','a']]);
    for(let i=0;i<50;i++)notifier.check();await tick();assert.equal(shown.length,1);
    result={id:'next',complete:true,side:{}};notifier.check();await tick();assert.equal(shown.length,1);
    close();await tick();assert.deepEqual(shown,[['first','a'],['next','a']]);
    close();await tick();notifier.check();await tick();assert.equal(shown.length,2);
});
