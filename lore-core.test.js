// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { NS, normalizeSettings, estimateTokens, boundedText, recentDialogue, parseCollection, sourceRange,
    matchesRange, nextStart, entryAvailable, textUnits, embeddingChunks, cosine, rankChunks,
    reviewUnits, selectedUnits, fitInjection, applyNativePolicy, parseSideChanges, applySideChanges,
    materializeEntry, SIDE_PROMPT } from './lore-core.js';
import { embeddingRequest, embed, completionText } from './lore-api.js';
const messages=[{name:'A',mes:'다음 진료에 같이 가자.',is_user:true},{name:'B',mes:'그래. 같이 가자.'}];
const source=sourceRange(messages,0,1);
test('settings preserve user prompts and enforce numeric bounds',()=>{
    const s=normalizeSettings({recentCount:0,injectionTokens:1e6,prompts:{collect:'custom'},sidePrompt:'mine'});
    assert.equal(s.recentCount,1);assert.equal(s.injectionTokens,32000);assert.equal(s.prompts.collect,'custom');assert.equal(s.sidePrompt,'mine');
    assert.equal(normalizeSettings().recentCount,10);assert.equal(normalizeSettings().injectionTokens,3000);
});
test('fresh settings leave native lore activation intact and saved search choices survive updates',()=>{
    const fresh=normalizeSettings();
    assert.equal(fresh.enabled,false);
    const lists={chat:[{world:'book',uid:0,key:['meeting'],content:'The meeting is on Friday.',disable:false}]};
    const before=structuredClone(lists);
    applyNativePolicy(lists,{...fresh,books:['book'],messages,selected:new Set()});
    assert.deepEqual(lists,before);
    for(const enabled of [true,false]) {
        const saved=normalizeSettings({enabled});
        const reopened=normalizeSettings(JSON.parse(JSON.stringify(saved)));
        const edited=normalizeSettings({...reopened,recentCount:15});
        assert.equal(edited.enabled,enabled);
    }
});
test('source fingerprints reject edited/swiped/deleted and divergent branch messages',()=>{
    assert(matchesRange(source,messages));assert(!matchesRange(source,[messages[0]]));
    assert(!matchesRange(source,[messages[0],{...messages[1],mes:'싫어.'}]));
    assert(!entryAvailable({content:'x',[NS]:{source}},[messages[0]]));
});
test('cursor advances contiguous saved ranges only',()=>{
    const rec=(start,end)=>({source:{start,end}});
    assert.equal(nextStart([rec(0,9),rec(20,29)]),10);
    assert.equal(nextStart([rec(10,19),rec(20,29)],10),30);
    assert.equal(nextStart([rec(0,9)],30),30);
});
test('recent dialogue skips hidden messages and caps length with explicit marker',()=>{
    const value=recentDialogue([...messages,{mes:'secret',is_system:true},{name:'B',mes:'가'.repeat(20000)}],2,900);
    assert(estimateTokens(value.text)<=900);assert(!value.text.includes('secret'));assert(value.text.includes('[…]'));assert(value.shortened);
    assert(estimateTokens(boundedText('가'.repeat(3000),300))<=300);
});
test('all long and punctuation-only source content remains represented as exact units',()=>{
    for(const text of ['Hello. Next!\n끝.','가'.repeat(3000),'...!?','단어\n\n다음','"You said no." But now?']){
        const units=textUnits(text,100);assert(units.every(u=>text.includes(u)));
        assert.equal(units.join('').replace(/\s/g,''),text.replace(/\s/g,''));
        assert(units.every(u=>estimateTokens(u)<=101));
    }
    assert(embeddingChunks({content:'가'.repeat(9000)}).length>5);
});
test('cosine rejects dimension mismatches and invalid values',()=>{
    assert.equal(cosine([1,0],[1,0]),1);assert.equal(cosine([1],[1,2]),-1);assert.equal(cosine([0],[0]),-1);assert.equal(cosine([NaN],[1]),-1);
    assert.equal(rankChunks([{vector:[1,0],id:'a'},{vector:[0,1],id:'b'}],[[1,0]],1)[0].id,'a');
});
test('AI can select only offered original text, never invent replacement text',async()=>{
    const offered=reviewUnits([{id:'a',book:'b',title:'t',units:[{index:0,text:'original'},{index:1,text:'second'}]}]);
    const picked=selectedUnits('{"ids":["u0","invented","u0"],"text":"fake"}',offered);
    assert.deepEqual(picked.map(x=>x.text),['original']);
    const fitted=await fitInjection(offered,110,t=>t.length);assert(fitted.tokens<=110);assert(!fitted.text.includes('fake'));
});
test('keyword policy touches scan copies, leaves unselected books and core available',()=>{
    const lists={globalLore:[{world:'a',uid:1,content:'m'},{world:'a',uid:2,content:'core',constant:true},{world:'b',uid:3,content:'other'}]};
    applyNativePolicy(lists,{enabled:true,keywordActivation:false,books:['a'],messages,selected:new Set()});
    assert(lists.globalLore[0].disable);assert(!lists.globalLore[1].disable);assert(!lists.globalLore[2].disable);
});
test('malformed or truncated responses are never treated as successful empty collection',()=>{
    assert.throws(()=>parseCollection('oops'));assert.throws(()=>parseCollection('{"bad":[]}'));
    assert.deepEqual(parseCollection('{"entries":[]}'),[]);
    assert.throws(()=>completionText({choices:[{finish_reason:'length',message:{content:'{"entries":[]}'}}]}));
});
const fact={id:'f1',text:'진료에 함께 가기로 약속함.',category:'agreements'};
const change={op:'update',category:'agreements',id:'f1',text:'함께 진료에 가기로 약속했고 날짜는 아직 미정이다.',evidence:{message:0,quote:'다음 진료에 같이 가자.'}};
test('side delta requires real existing ID, same category and exact evidence within current range',()=>{
    const parse=c=>parseSideChanges(JSON.stringify({sideChanges:[c]}),[fact],messages,source);
    assert.equal(parse(change).length,1);
    assert.throws(()=>parse({...change,id:'unknown'}));assert.throws(()=>parse({...change,category:'emotions'}));
    assert.throws(()=>parse({...change,evidence:{message:0,quote:'병원에 다녀왔다'}}));
    assert.throws(()=>parse({...change,evidence:{message:99,quote:change.evidence.quote}}));
});
test('side updates preserve unrelated facts, category history, and no-op byte identity',()=>{
    const entry={uid:1,content:'• 진료에 함께 가기로 약속함.\n• 금요일에는 전화하기.',[NS]:{sideCategory:'agreements',source,facts:[fact,{id:'f2',text:'금요일에는 전화하기.'}]}};
    const old=JSON.stringify(entry);
    applySideChanges([entry],[],source,()=>{throw Error('no create');},()=> 'new');assert.equal(JSON.stringify(entry),old);
    applySideChanges([entry],[change],source,()=>{throw Error('no create');},()=> 'new');
    assert.equal(entry[NS].facts[1].text,'금요일에는 전화하기.');assert.equal(entry[NS].history[0].content,JSON.parse(old).content);
    assert(SIDE_PROMPT.includes('Unmentioned facts remain unchanged.'));
});
test('a forked chat sees the previous side version when later branch evidence differs',()=>{
    const different=[...messages,{mes:'cancel'}], newer=sourceRange(different,2,2);
    const entry={content:'new',[NS]:{sideCategory:'plans',source:newer,facts:[],history:[{content:'old',facts:[fact],source}]}};
    assert.equal(materializeEntry(entry,messages).content,'old');assert.equal(materializeEntry(entry,different).content,'new');
});
test('embedding requests use independent credentials, task types and safe endpoints',async()=>{
    const s={embeddingProvider:'gemini',embeddingModel:'gemini-embedding-001',embeddingKey:'private'};
    const req=embeddingRequest(s,'text',true);assert.equal(req.body.taskType,'RETRIEVAL_QUERY');assert(!req.url.includes('private'));assert.equal(req.headers['x-goog-api-key'],'private');
    assert.throws(()=>embeddingRequest({...s,embeddingProvider:'openai',embeddingUrl:'http://public.example/v1'},'x'));
    const value=await embed(s,'x',false,null,async()=>({ok:true,json:async()=>({embedding:{values:[1,2]}})}));assert.deepEqual(value,[1,2]);
    await assert.rejects(embed(s,'x',false,null,async()=>({ok:true,json:async()=>({embedding:{values:[0,0]}})})));
});
test('hiding previously collected messages does not invalidate evidence or resume cursor',()=>{
    assert(matchesRange(source,messages.map(m=>({...m,is_system:true}))));
});
