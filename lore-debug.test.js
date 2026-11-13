// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ask, embed } from './lore-api.js';
import { createDiagnostics } from './lore-diagnostics.js';
import { redact, errorInfo } from './lore-telemetry.js';
import { testSearchConnection } from './lore-connection-test.js';
import { normalizeSettings } from './lore-core.js';
import { captureTransport, probePayload } from './server/connection-test.js';
import { invokeBackend } from './server/backend.js';
import { registerRoutes } from './server/index.js';

function fixture({detailed=true,reply={choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]}}={}) {
    const rows=new Map(),calls=[];
    const diagnostics=createDiagnostics({detailed:()=>detailed,secrets:()=>['proxy-fixture-secret'],store:{put:async r=>rows.set(r.id,r),list:async()=>[...rows.values()]}});
    const context={extensionSettings:{connectionManager:{selectedProfile:'current'}},ConnectionManagerRequestService:{
        getProfile:id=>{if(id==='missing')throw Error('Profile missing');return {id,name:id+' name',model:'model-'+id,preset:'test preset',password:'proxy-fixture-secret'};},
        validateProfile:()=>({selected:'openai',source:'vertexai'}),
        sendRequest:async(...args)=>{calls.push(args);if(reply instanceof Error)throw reply;return reply;},
    }};
    const run=overrides=>testSearchConnection({settings:normalizeSettings(overrides),context:{key:'chat',name:'Chat'},diagnostics,
        request:(...args)=>ask(context,...args)});
    return {rows,calls,context,diagnostics,run};
}
for(const [settings,expected] of [[{profile:'base',searchProfile:'search'},'search'],[{profile:'base'},'base'],[{},'current']]) {
    test('connection probe resolves '+expected+' without switching profiles or retrying',async()=>{
        const f=fixture(),before=JSON.stringify(f.context.extensionSettings),result=await f.run(settings);
        assert.equal(result.profile.id,expected);assert.equal(result.formatValid,true);assert.equal(result.connected,true);
        assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],expected);assert.equal(f.calls[0][3].includePreset,true);
        assert.equal(JSON.stringify(f.context.extensionSettings),before);
        const exported=await f.diagnostics.export('chat');assert(exported.includes('ai.transport.prepared'));assert(exported.includes('finish_reason'));
        assert(!exported.includes('proxy-fixture-secret'));assert(exported.includes('profile.resolved'));
    });
}
test('a readable non-JSON reply is a format warning, not a connection failure',async()=>{
    const f=fixture({reply:'Hello'}),result=await f.run({});
    assert.equal(result.connected,true);assert.equal(result.formatValid,false);assert.equal((await f.diagnostics.list('chat'))[0].status,'warning');assert.equal(f.calls.length,1);
});
test('profile failure is recorded before transport, without sending a request',async()=>{
    const f=fixture();await assert.rejects(f.run({searchProfile:'missing'}),e=>e.category==='profile');
    assert.equal(f.calls.length,0);const log=await f.diagnostics.export('chat');assert(log.includes('profile.resolve'));assert(log.includes('Profile missing'));
});
test('raw blocked/truncated replies survive text extraction failure in full debug',async()=>{
    const f=fixture({reply:{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}],usageMetadata:{totalTokenCount:42}}});
    await assert.rejects(f.run({}),e=>e.category==='response-format');
    const log=await f.diagnostics.export('chat');assert(log.includes('MAX_TOKENS'));assert(log.includes('totalTokenCount'));assert(log.includes('ai.extract'));assert.equal(f.calls.length,1);
});
test('debug-off does not accumulate diagnostic stages',async()=>{
    const f=fixture({detailed:false,reply:'private-response-sentinel'});await f.run({});
    const log=await f.diagnostics.export('chat');assert(!log.includes('private-response-sentinel'));assert(!log.includes('ai.transport.response'));
});
test('diagnostic observer failures do not prevent or retry a real request',async()=>{
    const f=fixture();assert.equal(await ask(f.context,'','system',{},undefined,500,()=>{throw Error('quota');}),' {"ok":true}'.trim());assert.equal(f.calls.length,1);
});
test('redacts nested JSON, headers, URL credentials, causes and circular errors',()=>{
    const error=Object.assign(Error('Bearer exposed-token'),{cause:Error('password="plain-password"'),details:JSON.stringify({access_token:'private-access',nested:{'x-goog-api-key':'private-key'}})});
    error.self=error;
    const text=JSON.stringify(redact({error,authorization:'Basic private-basic',url:'https://user:url-password@site.test/?key=url-key',token:'private-token',reasoning_content:'hidden-reasoning',parts:[{thought:true,text:'hidden-thought'},{text:'visible-answer'}]}));
    for(const secret of ['exposed-token','plain-password','private-access','private-key','private-basic','url-password','url-key','private-token','hidden-reasoning','hidden-thought'])assert(!text.includes(secret),secret);
    assert(text.includes('visible-answer'));assert(text.includes('Circular'));
});
test('embedding captures exact route, HTTP failure and response with isolated credential redaction',async()=>{
    const events=[],config=normalizeSettings({embeddingProvider:'vertex',embeddingVertexProjectId:'example-project',embeddingKeys:{vertex:'private-vertex-key'}});
    await assert.rejects(embed(config,'input memory',true,undefined,async()=>({ok:false,status:403,headers:new Headers({'x-request-id':'req-123'}),text:async()=>JSON.stringify({error:{message:'private-vertex-key denied'}})}),(stage,data)=>events.push({stage,data})),e=>e.status===403);
    const serialized=JSON.stringify(events);assert(serialized.includes('/projects/example-project/locations/global/'));assert(serialized.includes('req-123'));assert(serialized.includes('authentication'));assert(events.some(e=>e.data.query===true));assert(!serialized.includes('private-vertex-key'));
});
test('embedding abort reason is recorded and aborted work makes no provider call',async()=>{
    const controller=new AbortController(),events=[];controller.abort(new DOMException('user stopped','AbortError'));let calls=0;
    await assert.rejects(embed(normalizeSettings({embeddingKey:'fixture-key'}),'test',false,controller.signal,async()=>{calls++;},(stage,data)=>events.push({stage,data})),/user stopped/);
    assert.equal(calls,0);assert(JSON.stringify(events).includes('user stopped'));assert.equal(events.at(-1).data.category,'canceled');
    assert.equal(errorInfo(Error('timeout'),AbortSignal.abort(new DOMException('deadline','TimeoutError'))).category,'timeout');
});
test('malformed HTTP 200 response type is recorded without retaining its body',async()=>{
    const events=[];
    await assert.rejects(embed(normalizeSettings({embeddingKey:'fixture-key'}),'test',false,undefined,async()=>new Response('<html>proxy login page</html>',{status:200}),(stage,data)=>events.push({stage,data})),e=>e.category==='response-format');
    assert(events.some(e=>e.stage==='embedding.transport.response'&&e.data.responseType==='html'));
    assert.equal(events.at(-1).data.stage,'embedding.decode');
});
test('server backend preserves error HTTP status and response body through the debug probe',async()=>{
    const payload=probePayload({chat_completion_source:'custom',model:'test',proxy_password:'private-proxy',max_tokens:99999,messages:[{role:'user',content:'must replace'}]});
    assert.equal(payload.max_tokens,1024);assert(!JSON.stringify(payload.messages).includes('must replace'));
    const captured=await captureTransport(log=>invokeBackend({handle:(_req,res)=>res.status(429).json({error:{message:'quota private-proxy',code:'RESOURCE_EXHAUSTED'}})}, {},payload,undefined,1000,log),{detailed:true,secrets:['private-proxy']});
    assert.equal(captured.error.category,'rate-limit');assert.equal(captured.error.status,429);assert(JSON.stringify(captured.events).includes('RESOURCE_EXHAUSTED'));assert(!JSON.stringify(captured).includes('private-proxy'));
});
test('new server probe route authenticates and returns one real backend result without creating a job',async()=>{
    const routes=new Map();let calls=0;
    registerRoutes({post:(url,callback)=>routes.set(url,callback)},{},undefined,null,async(_user,payload,_signal,log)=>{calls++;await log('ai.backend.request',{payload});return {content:'{"ok":true}'};});
    const callback=routes.get('/connection-test');let code=200,body;
    const res={status:n=>{code=n;return res;},json:data=>{body=data;},on(){},removeListener(){}};
    await callback({body:{template:{chat_completion_source:'custom',model:'m'}}},res);assert.equal(code,401);assert.equal(calls,0);
    await callback({user:{profile:{handle:'fixture'},directories:{root:'/fixture'}},body:{template:{chat_completion_source:'custom',model:'m'},detailed:true}},res);
    assert.equal(calls,1);assert.equal(body.result.content,'{"ok":true}');assert(body.events.some(e=>e.stage==='ai.backend.request'));
});
test('server transport capture applies the same body cap and preserves metadata when detail is omitted',async()=>{
    const captured=await captureTransport(async log=>{await log('response',{response:'x'.repeat(5*1024*1024),status:200});return 'ok';},{detailed:true});
    assert.equal(captured.events.length,1);assert.equal(captured.events[0].data.status,200);assert.equal(captured.events[0].data.response,undefined);
});
