// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { dateDay, formatRelationship, relationshipPhase } from './lore-relationship.js';
import { NS, DEFAULT_PROMPTS, SIDE_PROMPT, normalizeSettings, parseCollection, embeddingChunks,
    parseSideChanges, parseStoryDate, currentStoryDate, applySideChanges, materializeEntry, sourceRange, SIDE_CATEGORIES } from './lore-core.js';
import { LEGACY_COLLECT, LEGACY_SIDE } from './lore-prompts-v1.js';
const messages=[{mes:'2025-03-11. We agreed to be lovers.'},{mes:'2025-03-22. We had breakfast.'}];
const source=sourceRange(messages,0,1);
const evidence={message:0,quote:messages[0].mes};
const op={op:'add',category:'relationship',text:'Lovers',relationship:{kind:'start',since:'2025-03-11'},evidence,dateEvidence:evidence};
function fixture(){let serial=0;const entries=[];return {entries,apply:(ops,range=source,date='2025-03-22')=>applySideChanges(entries,ops,range,()=>{const e={uid:serial++};entries.push(e);return e;},()=>`f${serial++}`,date)};}
test('date arithmetic includes start day and handles leap years/year boundaries without local time',()=>{
    assert.equal(formatRelationship({text:'Lovers',relationship:{kind:'start',since:'2025-03-11'}},'2025-03-11'),'Lovers · D+1');
    assert.equal(formatRelationship({text:'Lovers',relationship:{kind:'start',since:'2025-03-11'}},'2025-03-22'),'Lovers · D+12');
    assert.equal(dateDay('2024-03-01')-dateDay('2024-02-28'),2);
    assert.equal(dateDay('2026-01-01')-dateDay('2025-12-31'),1);
    for(const s of ['2025-02-29','2025-04-31','2025-13-01','2025-1-1','0000-01-01','tomorrow'])assert.equal(dateDay(s),null);
});
test('missing or backwards dates never become invented or negative counters',()=>{
    assert.equal(formatRelationship({text:'Lovers',relationship:{kind:'start',since:null}},'2025-03-22'),'Lovers · Start date unknown');
    const fact={text:'Lovers',relationship:{kind:'start',since:'2025-03-22'}};
    assert(formatRelationship(fact,null).includes('Current story date unknown'));
    assert(!formatRelationship(fact,'2025-03-01').includes('D+'));
});
test('six independent entries, no-op stable, date-only progression updates only relationship',()=>{
    const f=fixture();f.apply(Object.keys(SIDE_CATEGORIES).map(category=>category==='relationship'?op:{op:'add',category,text:`Fact for ${category}`,evidence}));
    assert.equal(f.entries.length,6);assert.equal(new Set(f.entries.map(e=>e.comment)).size,6);
    assert.equal(f.entries[0].content,'Lovers · D+12');
    const others=JSON.stringify(f.entries.slice(1)), same=JSON.stringify(f.entries);
    f.apply([]);assert.equal(JSON.stringify(f.entries),same);
    f.apply([],source,'2025-03-23');assert.equal(f.entries[0].content,'Lovers · D+13');assert.equal(JSON.stringify(f.entries.slice(1)),others);
});
test('breakup and reunion reuse the same entry, retain earlier dates, and do not reset on repetition',()=>{
    const f=fixture();f.apply([op]);const entry=f.entries[0], id=entry[NS].facts[0].id;
    f.apply([{...op,op:'update',id,text:'Ex-partners',relationship:{kind:'breakup',since:'2025-03-24'}}],source,'2025-03-24');
    assert.equal(entry.content,'Ex-partners · D+1 since breakup');
    f.apply([],source,'2025-03-28');assert.equal(entry.content,'Ex-partners · D+5 since breakup');
    f.apply([{...op,op:'update',id,relationship:{kind:'reunion',since:'2025-03-29'}}],source,'2025-03-29');
    assert.equal(entry.content,'Lovers · D+1 since reunion');assert.equal(f.entries.length,1);
    f.apply([{...op,op:'update',id,relationship:{kind:'reunion',since:null}}],source,'2025-03-30');
    assert.equal(entry.content,'Lovers · D+2 since reunion');
    assert(entry[NS].history.some(h=>h.facts[0].relationship.since==='2025-03-11'));
    assert(entry[NS].history.some(h=>h.facts[0].relationship.since==='2025-03-24'));
});
test('relationship labels stay short and date changes need exact source evidence',()=>{
    assert.throws(()=>relationshipPhase('Deeply loving soulmates forever',{}));
    const parse=change=>parseSideChanges(JSON.stringify({sideChanges:[change]}),[],messages,source);
    assert.equal(parse(op)[0].relationship.since,'2025-03-11');
    assert.throws(()=>parse({...op,dateEvidence:{message:0,quote:'invented'}}));
    assert.throws(()=>parse({...op,relationship:{kind:'start',since:'2025-02-30'}}));
    assert.throws(()=>parseSideChanges(JSON.stringify({sideChanges:[op,op]}),[],messages,source));
});
test('story clock is branch-scoped, validates evidence and supports explicit unknown manual correction',()=>{
    const clock=parseStoryDate(JSON.stringify({storyDate:{date:'2025-03-22',evidence:{message:1,quote:messages[1].mes}}}),messages,source);
    const book={[NS]:{storyDates:[clock]}};
    assert.equal(currentStoryDate(book,messages),'2025-03-22');assert.equal(currentStoryDate(book,[messages[0]]),null);
    assert.throws(()=>parseStoryDate('{"storyDate":{"date":"2025-02-30"}}',messages,source));
    book[NS].storyDates.push({date:null,source,manual:true});assert.equal(currentStoryDate(book,messages),null);
});
test('history materialization retains the previous relation phase and story date on a branch',()=>{
    const f=fixture();f.apply([op]);const more=[...messages,{mes:'2025-03-24. We broke up.'}], range=sourceRange(more,2,2);
    const entry=f.entries[0];f.apply([{...op,op:'update',id:entry[NS].facts[0].id,text:'Ex-partners',relationship:{kind:'breakup',since:'2025-03-24'}}],range,'2025-03-24');
    const old=materializeEntry(entry,messages);assert.equal(old.content,'Lovers · D+12');assert.equal(old[NS].storyDate,'2025-03-22');
    assert.equal(old[NS].facts[0].relationship.kind,'start');
});
test('default migration upgrades only untouched prompts and preserves custom edits',()=>{
    const migrated=normalizeSettings({prompts:{collect:LEGACY_COLLECT},sidePrompt:LEGACY_SIDE});
    assert.equal(migrated.prompts.collect,DEFAULT_PROMPTS.collect);assert.equal(migrated.sidePrompt,SIDE_PROMPT);
    const custom=normalizeSettings({prompts:{collect:'My custom prompt'},sidePrompt:'My side prompt'});
    assert.equal(custom.prompts.collect,'My custom prompt');assert.equal(custom.sidePrompt,'My side prompt');
    assert.equal(normalizeSettings({promptRevision:2,prompts:{collect:LEGACY_COLLECT}}).prompts.collect,LEGACY_COLLECT);
    assert(!/[가-힣]/.test(DEFAULT_PROMPTS.collect+SIDE_PROMPT));
});
test('compact memory assembly omits unknown metadata and preserves only narrative units for selection',()=>{
    const [entry]=parseCollection(JSON.stringify({entries:[{title:'Clinic visit',date:'2025-03-11',time:'morning',location:'Clinic',content:'They returned home together.'}]}));
    assert.equal(entry.content,'[Clinic visit]\n2025-03-11 morning | Clinic\n\nThey returned home together.');
    const chunks=embeddingChunks({...entry,comment:entry.title});assert.deepEqual(chunks[0].units.map(u=>u.text),['They returned home together.']);
    assert(chunks[0].text.includes('2025-03-11'));
    const [unknown]=parseCollection('{"entries":[{"title":"A talk","content":"They talked."}]}');
    assert.equal(unknown.content,'[A talk]\n\nThey talked.');
});
