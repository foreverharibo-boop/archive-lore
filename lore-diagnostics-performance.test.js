// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostics} from './lore-diagnostics.js';
import {compactDiagnosticRun,formatDiagnosticPreview,PREVIEW_CHARS} from './lore-diagnostic-preview.js';

test('1000 stages batch into one snapshot, keep ordered events and isolate later writes',async()=>{
    const saved=[],d=createDiagnostics({detailed:()=>true,store:{put:async r=>saved.push(r),list:async()=>saved}});
    const t=d.begin({chatKey:'chat'});const data={text:'x'.repeat(500000)};
    await t.event('request',data);data.text='changed after capture';
    for(let i=0;i<1000;i++)await t.event('cache',{index:i});
    assert.equal(saved.length,0);
    await t.finish('success');assert.equal(saved.length,1);
    const first=saved[0];assert.equal(first.events.length,1002);assert.equal(first.events[0].data.text.length,500000);
    assert(first.diagnosticBytes>=JSON.stringify(first).length*2);
    await t.event('injection.installed',{text:'done'});
    assert.equal(saved.length,2);assert.equal(first.events.length,1002);assert.equal(saved[1].events.length,1003);
});
test('turning detailed mode off stops future bodies in an already active trace',async()=>{
    let detailed=true,run;const d=createDiagnostics({detailed:()=>detailed,store:{put:async r=>run=r,list:async()=>[]}});
    const t=d.begin({chatKey:'chat'});await t.event('before',{text:'old detail'});detailed=false;
    await t.event('after',{text:'new private body'});await t.finish('success');
    assert.equal(run.events[0].data.text,'old detail');assert(!JSON.stringify(run).includes('new private body'));
});
test('preview uses bounded store path and does not flush or export complete logs',async()=>{
    let writes=0,previews=0;
    const d=createDiagnostics({detailed:()=>true,store:{put:async()=>writes++,preview:async()=>{previews++;return [];},list:async()=>assert.fail('must not load whole history')}});
    const t=d.begin({chatKey:'chat'});await t.event('profile.resolved',{model:'fixture'});
    const text=await d.preview('chat');assert(text.includes('fixture'));assert.equal(writes,0);assert.equal(previews,1);
    await t.finish('success');
});
test('large histories give bounded previews with errors, profile routes and no expanded arrays',()=>{
    const runs=[],payload={text:'x'.repeat(10000),vectors:Array(10000).fill(1)};
    for(let i=0;i<20;i++)runs.push(compactDiagnosticRun({id:String(i),started:new Date(1000+i).toISOString(),kind:'generation',status:'error',events:[
        {stage:'profile.resolved',data:{requestedProfile:'current',resolvedProfile:'profile-A',source:'vertexai'}},
        ...Array.from({length:1997},()=>({stage:'response',data:payload})),
        {stage:'ai.transport.error',data:{message:'permission denied',status:403,authorization:'Bearer hidden-key'}},
    ]}));
    const text=formatDiagnosticPreview(runs);assert(text.length<=PREVIEW_CHARS);assert(text.includes('permission denied'));assert(text.includes('profile-A'));
    assert(!text.includes('hidden-key'));assert(text.includes('생략'));assert.equal((text.match(/===== generation/g)||[]).length,3);
});
test('batches arriving during slow persistence are not lost or overwritten',async()=>{
    const rows=new Map();let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let calls=0;
    const d=createDiagnostics({store:{put:async r=>{if(++calls===1){entered();await gate;}rows.set(r.id,r);},list:async()=>[...rows.values()]}});
    const t=d.begin({chatKey:'chat'});await t.event('first');const finishing=t.finish('success');await started;
    const late=t.event('late');release();await Promise.all([finishing,late]);
    assert.equal(rows.get(t.id).events.at(-1).stage,'late');assert.equal(calls,2);
});
test('active traces persist on the batching timer before completion',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});let saved;
    const d=createDiagnostics({store:{put:async r=>saved=r,list:async()=>[]}});
    const trace=d.begin({chatKey:'chat'});await trace.event('pending');t.mock.timers.tick(1000);
    await Promise.resolve();await Promise.resolve();assert.equal(saved.events[0].stage,'pending');await trace.finish('success');
});
