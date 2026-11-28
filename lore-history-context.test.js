// Archive Lore — AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeSettings, DEFAULT_PROMPTS} from './lore-core.js';
import {PREVIOUS_ESTABLISHED_QUESTIONS, PREVIOUS_DIRECT_SELECT} from './lore-prompts.js';
import {createLoreController} from './lore-controller.js';

test('revision 12 migrates both shipped prompts independently and preserves custom rules and limits',()=>{
    const old={questions:PREVIOUS_ESTABLISHED_QUESTIONS,select:PREVIOUS_DIRECT_SELECT};
    for(const customized of [null,'questions','select']){
        const saved={promptRevision:11,mode:'questions',reviewTokens:5000,injectionTokens:3000,
            candidateCount:24,selectionConcurrency:2,prompts:{...old,collect:'Personal collection'}};
        if(customized)saved.prompts[customized]+='\nPersonal rule';
        const before=structuredClone(saved),next=normalizeSettings(saved);
        assert.deepEqual(saved,before);
        for(const key of ['questions','select'])
            assert.equal(next.prompts[key],key===customized?saved.prompts[key]:DEFAULT_PROMPTS[key]);
        assert.equal(next.prompts.collect,saved.prompts.collect);
        for(const key of ['mode','reviewTokens','injectionTokens','candidateCount','selectionConcurrency'])
            assert.equal(next[key],saved[key]);
        assert.equal(next.promptRevision,12);
        assert.deepEqual(normalizeSettings(next),next);
    }
    const exported=JSON.parse(fs.readFileSync(new URL('./prompts/archive-lore-defaults.json',import.meta.url)));
    assert.deepEqual(exported.prompts,DEFAULT_PROMPTS);
});

// Controlled model replies verify prompt delivery and preservation through the
// actual pipeline, not the semantic quality of a live provider's selections.
for(const generousRecall of [false,true])for(const empty of [false,true])
test(`historical reaction can survive alone; genuine empty stays empty: generous=${generousRecall}, empty=${empty}`,async()=>{
    const sentences=['During an earlier illness at the coastal clinic, Morgan feared losing Lee.',
        'Morgan stayed beside Lee all night and held their hand.',
        'Lee recovered and they returned home the next morning.'];
    const book={entries:{0:{uid:0,comment:'Earlier illness',content:sentences.join('\n')}}};
    const before=structuredClone(book),cache=new Map();let planners=0,selectors=0;
    const config=normalizeSettings({promptRevision:11,mode:'questions',generousRecall,
        reviewTokens:5000,injectionTokens:3000,
        prompts:{questions:PREVIOUS_ESTABLISHED_QUESTIONS,select:PREVIOUS_DIRECT_SELECT}});
    const host={settings:()=>config,context:()=>({key:'history-context',messages:[
        {name:'Lee',is_user:true,mes:'At the city hospital, I wake after surgery and reach for Morgan.'}]}),
        books:()=>['book'],target:()=>'',loadBook:async()=>structuredClone(book),
        store:{get:async key=>cache.get(key),put:async(key,value)=>cache.set(key,value)},
        embed:async()=>[1,0],countTokens:text=>Math.ceil(text.length/4),changed:()=>{},
        ask:async(_profile,system,data)=>{
            if(!data.memories){
                planners++;assert(system.startsWith(DEFAULT_PROMPTS.questions));
                return JSON.stringify({questions:['How did Morgan react during earlier times when Lee was ill?']});
            }
            selectors++;assert(system.startsWith(DEFAULT_PROMPTS.select));
            assert.equal(data.injectionBudgetTokens,3000);
            const anchor=data.memories.find(u=>u.text===sentences[0]);assert(anchor);
            const context=data.memories.filter(u=>sentences.slice(1).includes(u.text));
            assert.equal(context.length,2);
            return JSON.stringify({selections:empty?[]:[{id:anchor.id,priority:2,
                reason:'Earlier fear and caregiving provide context for the present illness.',
                contextIds:context.map(u=>u.id)}]});
        }};
    const controller=createLoreController(host);await controller.index();
    const result=await controller.recall();
    assert.equal(planners,1);assert.equal(selectors,1);
    assert.deepEqual(book,before);assert(result.tokens<=3000);
    if(empty){assert.equal(result.text,'');assert.equal(result.units.length,0);}
    else{
        for(const sentence of sentences)assert(result.text.includes(sentence));
        assert(!result.text.includes('city hospital'));assert(!result.text.includes('surgery'));
        assert(result.units.length>=3);
    }
});
