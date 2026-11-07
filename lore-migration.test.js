// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {convertLegacyBook,migrateLegacyChat,migrationSideTemplates} from './lore-migration.js';
import {sourceRange,normalizeSettings} from './lore-core.js';
const messages=Array.from({length:8},(_,i)=>({mes:'message '+i,is_user:i%2===0}));
const config=normalizeSettings({sideEnabled:true});
function fixture(){const source=sourceRange(messages,0,3);return {entries:{0:{uid:0,comment:'Memory',content:'Original facts.',archiveLore:{source}},1:{uid:1,comment:'Relationship',content:'Partners since 2026-10-01.',archiveLore:{sideCategory:'relationship',source}}},archiveLore:{receipts:[{source}]}};}

test('migration produces native entries and cursor without changing source or retaining a legacy reader dependency',()=>{
    const book=fixture(),before=structuredClone(book),result=convertLegacyBook(book,messages,'chat',config);
    assert.deepEqual(book,before);assert.equal(result.next,4);
    assert.equal(result.data.entries[0].STMB_chatId,'chat');assert.equal(result.data.entries[0].STMB_end,3);
    assert.equal(result.data.entries[0].content,'Original facts.');assert.equal(result.data.entries[0].stmemorybooks,true);
    assert.equal(result.data.entries[1].comment,'Relationship (STMB SidePrompt)');assert.equal(result.data.entries[1].stmemorybooks,false);
    assert(!JSON.stringify(result.data).includes('archiveLore'));
});
test('other branch memories remain disabled and cannot advance the collection checkpoint',()=>{
    const book=fixture(),branch=structuredClone(messages);branch[1].mes='different branch';
    const converted=convertLegacyBook(book,branch,'branch',config);
    assert.equal(converted.next,0);assert.equal(converted.data.entries[0].disable,true);
    assert.equal(converted.data.entries[0].STMB_start,undefined);
});
test('side templates use native complete-record responses and stay scoped to an explicit set',()=>{
    const rows=migrationSideTemplates(config,'imported');assert.equal(rows.length,6);
    assert(rows.every(t=>t.settings.archiveLoreSetOnly && t.triggers.onAfterMemory.enabled));
    assert(rows.every(t=>t.responseFormat.includes('complete, readable English record') && t.settings.archiveLorePlainRecord));
    assert.equal(migrationSideTemplates({...config,sideEnabled:false},'x').filter(t=>t.enabled).length,0);
});
test('failed verification never switches bindings; retry reuses a destination and completed imports do nothing',async()=>{
    const storage=new Map([['old',fixture()]]);let fail=true,committed=0,backups=0,completed=false;
    const host={snapshot:()=>({key:'chat',chatId:'chat',books:['old'],target:'old',messages,config,completed}),assertCurrent:()=>{},
        load:async name=>{const data=structuredClone(storage.get(name));if(fail&&name==='new')data.entries[0].content='failed write';return data;},
        save:async(name,data)=>storage.set(name,structuredClone(data)),backup:async()=>backups++,destination:async()=> 'new',copyVectors:async()=>{},savePrompts:async()=>{},
        commit:async(s,c,next)=>{assert.equal(next,4);committed++;completed=true;}};
    await assert.rejects(migrateLegacyChat(host),/검증/);assert.equal(committed,0);
    fail=false;await migrateLegacyChat(host);assert.equal(committed,1);assert.equal(storage.size,2);
    await migrateLegacyChat(host);assert.equal(committed,1);assert.equal(backups,2);
    assert.equal(storage.get('old').entries[0].archiveLore.source.end,3);
});

test('converted arcs retain native source links while consolidated originals remain disabled',()=>{
    const book=fixture();
    book.entries[2]={uid:2,comment:'Arc',content:'Combined facts.',archiveLore:{tier:1,source:sourceRange(messages,0,3),members:[{uid:'0',content:book.entries[0].content}]}};
    const result=convertLegacyBook(book,messages,'chat',config).data;
    assert.deepEqual(result.entries[2].stmbSourceEntryUids,['0']);
    assert.equal(result.entries[2].stmbSummaryTier,1);
    assert.equal(result.entries[0].disable,true);
    assert.equal(result.entries[2].disable,undefined);
});


test('vector copy failure reports its stage, preserves originals and does not switch the chat',async()=>{
    const original=fixture(),before=structuredClone(original),reports=[];let saved,committed=false;
    const host={snapshot:()=>({key:'chat',chatId:'chat',books:['old'],messages,config}),assertCurrent(){},
        report:message=>reports.push(message),load:async name=>name==='old'?original:saved,
        backup:async()=>{},destination:async()=> 'new',save:async(_name,data)=>{saved=data;},
        copyVectors:async()=>{throw Error('서버 응답 대기 시간(30초)을 초과했습니다. [/vectors/put]');},
        savePrompts:async()=>{throw Error('must not reach prompts');},commit:async()=>{committed=true;}};
    await assert.rejects(migrateLegacyChat(host),/이관 중단 — 기존 임베딩 복사 · new:.*vectors\/put/);
    assert.equal(committed,false);assert.deepEqual(original,before);
    assert.equal(reports.at(-1),'기존 임베딩 복사 · new');
});
