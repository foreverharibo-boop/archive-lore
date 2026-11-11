// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { translatedExcerpt, injectionSnapshot, createInjectionRecorder } from './lore-injection-view.js';
import { managerSourceHash } from './lore-translations.js';
import { formatInjection } from './lore-core.js';
const entry={uid:1,comment:'부산',content:'He arrived. He sat down.\nShe smiled.'};
const settings={'simple-lorebook':{translations:{'Book␟1':{sourceHash:managerSourceHash(entry.content),text:'그가 도착했다. 그가 앉았다.\n그녀가 웃었다.',language:'Korean'}}}};
test('cuts matching sentence positions, without including adjacent untranslated facts',()=>{
    assert.deepEqual(translatedExcerpt(settings,'Book',entry,'He sat down.'),{text:'그가 앉았다.',aligned:true});
    assert.equal(translatedExcerpt(settings,'Book',entry,'He sat down.\nShe smiled.').text,'그가 앉았다.\n그녀가 웃었다.');
    assert.equal(translatedExcerpt(settings,'Book',entry,'sat down.'),null);
    assert.equal(translatedExcerpt(settings,'Other',entry,'He sat down.'),null);
});
test('stale source, wrong language, merged sentences and changed line layouts fall back to source',()=>{
    assert.equal(translatedExcerpt(settings,'Book',{...entry,content:entry.content+' New fact.'},'He sat down.'),null);
    const wrong=structuredClone(settings);wrong['simple-lorebook'].entryLanguagePairs={'Book␟1':{translationLanguage:'French'}};
    assert.equal(translatedExcerpt(wrong,'Book',entry,'He sat down.'),null);
    for(const text of ['그가 도착하고 앉았다.\n그녀가 웃었다.','그가 도착했다.\n그가 앉았다. 그녀가 웃었다.']){
        const changed=structuredClone(settings);changed['simple-lorebook'].translations['Book␟1'].text=text;
        assert.equal(translatedExcerpt(changed,'Book',entry,'He sat down.'),null);
    }
});
test('whole entries may use whole translations, repeated excerpts are ambiguous',()=>{
    assert.equal(translatedExcerpt(settings,'Book',entry,entry.content).aligned,false);
    const repeated={...entry,content:'Hello. Hello.'},s=structuredClone(settings);
    s['simple-lorebook'].translations['Book␟1']={sourceHash:managerSourceHash(repeated.content),text:'안녕. 안녕.'};
    assert.equal(translatedExcerpt(s,'Book',repeated,'Hello.'),null);
});
test('snapshot counts source slots including core and guidance and preserves exact raw text',async()=>{
    const units=[{entryId:'id',title:'부산',index:1,text:'He sat down.'},{entryId:'id',title:'부산',index:0,text:'He arrived.',contextOnly:true}];
    const result={text:formatInjection(units),core:'Core fact.',guidance:'Guidance.'};
    const recall={...result,units,records:[{id:'id',book:'Book',entry},{id:'core',book:'Book',entry:{uid:2,constant:true,comment:'인물',content:result.core}}]};
    const before=JSON.stringify({result,recall,settings});
    const snapshot=await injectionSnapshot({key:'chat',result,recall,settings,countTokens:s=>s.length});
    assert.equal(snapshot.tokens.total,result.text.length+result.core.length+result.guidance.length);
    assert.equal(snapshot.text,result.text);assert.deepEqual(snapshot.rows.map(r=>r.title),['인물','부산']);
    assert.equal(snapshot.rows[1].parts[0].translation.text,'그가 도착했다.');
    assert.equal(snapshot.rows[1].parts[1].translation.text,'그가 앉았다.');
    assert.equal(JSON.stringify({result,recall,settings}),before);
});
test('only latest chat capture wins; deferred slots, disabled state and other-chat metadata are never shown',async()=>{
    let key='A',enabled=true,saved=null,release;
    const recorder=createInjectionRecorder({key:()=>key,enabled:()=>enabled,read:()=>saved,write:s=>{saved=s;},settings:()=>settings,countTokens:async text=>text==='wait'?new Promise(r=>{release=r;}):text.length});
    const first=recorder.capture({text:'wait'},null);
    await recorder.capture({text:'new'},null);release(4);await first;
    assert.equal(saved.text,'new');
    await recorder.capture({text:'reserved',deferred:true},null);assert.equal(saved.text,'new');
    key='B';assert.equal(recorder.read(),null);
    const pending=recorder.capture({text:'wait'},null);key='C';release(4);await pending;assert.equal(saved.key,'A');
    enabled=false;await recorder.capture({text:'off'},null);assert.equal(saved.text,'new');
    enabled=true;const stopped=recorder.capture({text:'wait'},null);recorder.invalidate();release(4);await stopped;assert.equal(saved.text,'new');
});
test('question-mode snapshots retain exact planner questions without changing injected text or token counts',async()=>{
    const result={text:'Selected memory.'},questions=['Where did they first meet?','What did he promise?'];
    const args={key:'A',result,recall:{text:result.text,mode:'questions',questions},settings:{},countTokens:s=>s.length};
    const snapshot=await injectionSnapshot(args);
    questions.push('A later search must not change this snapshot.');
    assert.deepEqual(snapshot.questions,['Where did they first meet?','What did he promise?']);
    assert.equal(snapshot.text,result.text);assert.equal(snapshot.tokens.total,result.text.length);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).questions,snapshot.questions);
    for(const mode of ['dialogue','embedding',undefined]){
        assert.deepEqual((await injectionSnapshot({...args,recall:{...args.recall,mode}})).questions,[]);
    }
    assert.deepEqual((await injectionSnapshot({...args,recall:{...args.recall,text:'Another turn'}})).questions,[]);
    assert.deepEqual((await injectionSnapshot({...args,recall:null})).questions,[]);
    const empty=await injectionSnapshot({...args,result:{text:''},recall:{text:'',mode:'questions',questions:['No matches for this question?']}});
    assert.deepEqual(empty.questions,['No matches for this question?']);
});
test('empty actual injection replaces a prior injection; counting failure never fails generation',async()=>{
    let saved,errors=0;
    const recorder=createInjectionRecorder({key:()=> 'A',enabled:()=>true,read:()=>saved,write:s=>{saved=s;},settings:()=>settings,countTokens:async text=>{if(text==='fail')throw Error('tokenizer');return text.length;},onError:()=>errors++});
    await recorder.capture({text:'old'},null);await recorder.capture({},null);
    assert.equal(saved.text,'');assert.equal(saved.tokens.total,0);
    await recorder.capture({text:'fail'},null);assert.equal(errors,1);assert.equal(saved.text,'');
});
test('prepared search is recorded only when a real outgoing prompt is built, never a dry run',async()=>{
    let saved=null,key='A';
    const recorder=createInjectionRecorder({key:()=>key,enabled:()=>true,read:()=>saved,write:s=>{saved=s;},settings:()=>settings,countTokens:s=>s.length});
    recorder.stage({text:'prepared'},null);assert.equal(saved,null);
    await recorder.commit(true);assert.equal(saved,null);
    await recorder.commit(false);assert.equal(saved.text,'prepared');
    recorder.stage({text:'cancelled'},null);recorder.invalidate();await recorder.commit();assert.equal(saved.text,'prepared');
    recorder.stage({text:'wrong chat'},null);key='B';await recorder.commit();assert.equal(saved.text,'prepared');
});
