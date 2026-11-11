import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ARCHIVE_LORE_TITLE_FORMAT, LEGACY_ARCHIVE_LORE_TITLE_FORMAT, isArchiveLoreDateFormat, archiveLoreDateTitle, migrateArchiveLoreTitleFormat, titleFormatLabel, withArchiveLoreTitle } from './lore-native-title.js';
import { applyFixedSequenceNumber, hasSequenceNumberPlaceholder, withoutTitleDates, extractEntrySequenceNumber } from './memoryRegeneration.js';
function load(file,name,scope) {
 const s=fs.readFileSync(new URL(file,import.meta.url),'utf8');
 const a=s.search(new RegExp(`(?:async )?function ${name}\\(`));
 const b=a+s.slice(a).search(/\n}\r?(?:\n|$)/)+2;
 vm.runInNewContext(s.slice(a,b),scope);return scope[name];
}
test('native collection applies fictional-date title instructions only for the selected format',async()=>{
 const scope={archiveLoreFork:true,withArchiveLoreTitle,getGroupMemoryProfile:p=>p,getEffectivePrompt:async()=> 'Custom memory instructions',substituteParams:s=>s,resolveAdditionalContextEntries:async()=>({entries:[]}),formatSceneForAI:()=> 'Scene with a story date',extension_settings:{}};
 const build=load('./stmemory.js','buildPrompt',scope);
 const normal=await build({metadata:{},messages:[]},{titleFormat:'[000] - {{title}}'});
 assert.equal(normal,'Custom memory instructions\n\nScene with a story date');
 const dated=await build({metadata:{},messages:[]},{titleFormat:ARCHIVE_LORE_TITLE_FORMAT});
 assert.match(dated,/Custom memory instructions/);assert.match(dated,/never the real-world date/);assert.match(dated,/write ONLY "YYYY-MM-DD"/);assert.match(dated,/Keep the requested JSON schema unchanged/);
 scope.archiveLoreFork=false;assert.equal(await build({metadata:{},messages:[]},{titleFormat:ARCHIVE_LORE_TITLE_FORMAT}),normal);
});
test('native title rendering keeps only story dates, including legacy preset and regeneration',()=>{
 const scope={isArchiveLoreDateFormat,archiveLoreDateTitle,applyFixedSequenceNumber,hasSequenceNumberPlaceholder,i18n:(_key,f)=>f,moment:()=>({format:()=> '2099-01-01'}),sanitizeTitle:s=>s};
 const render=load('./addlore.js','generateEntryTitleAtNumber',scope);
 const cases = [
   ['2029-10-23 · Returning home','2029-10-23'],
   ['2029-10-23–2029-10-24 · A hospital stay','2029-10-23–2029-10-24'],
   ['2029-10-23','2029-10-23'],
   ['Returning home','날짜 미상'],
   ['2029-02-30','날짜 미상'],
 ];
 for(const format of [ARCHIVE_LORE_TITLE_FORMAT, LEGACY_ARCHIVE_LORE_TITLE_FORMAT]) {
   for(const [title, expected] of cases) {
     assert.equal(render(format,{extractedTitle:title},7),expected);
     assert.equal(render(format,{extractedTitle:title},7,{forceNumber:true}),expected);
   }
 }
 assert.equal(render('{{date}} - {{title}}',{extractedTitle:'Old format'},7),'2099-01-01 - Old format');
 assert.match(titleFormatLabel(ARCHIVE_LORE_TITLE_FORMAT),/작중 날짜/);
});

function numbering() {
 const scope={withoutTitleDates,isMemoryEntry:e=>e.stmemorybooks===true};
 for(const name of ['escapeRegex','extractNumberFromTitle','extractNumberUsingFormat','getNextEntryNumber'])load('./addlore.js',name,scope);
 return scope;
}
test('story dates never become memory 2030, including imported and regenerated entries',()=>{
 const n=numbering();
 const imported=['2029-10-23 작중 요약','2029.10.23 · Returning home','[2029-10-23] Returning home','2029/10/23 12:50 · Returning home'];
 for(const comment of imported){
   assert.equal(n.extractNumberFromTitle(comment),null,comment);
   assert.equal(extractEntrySequenceNumber({comment}),null,comment);
   for(const format of ['[000]-{{title}}','[000] - {{title}}',ARCHIVE_LORE_TITLE_FORMAT]){
     assert.equal(n.getNextEntryNumber({entries:{0:{stmemorybooks:true,comment}}},format),1);
   }
 }
 assert.equal(extractEntrySequenceNumber({comment:imported[0],STMB_memoryNumber:7}),7);
 assert.equal(n.getNextEntryNumber({entries:{0:{stmemorybooks:true,comment:imported[0]},1:{stmemorybooks:true,comment:'[105] 2029-10-22 · Hospital'}}},ARCHIVE_LORE_TITLE_FORMAT),106);
});
test('format-aware sequence extraction matches every native rendered numbering form',()=>{
 const n=numbering();
 for(const format of ['[0] - {{title}}','[[00]] {{title}}','([000]) {{title}}','{[000]} {{title}}','#[000] {{title}}','(000) {{title}}','{000} {{title}}','#000 {{title}}','Memory [000] / {{title}}']){
   const title=applyFixedSequenceNumber(format,7).replace('{{title}}','2029-10-23 · Hospital');
   assert.equal(n.extractNumberUsingFormat(title,format),7,format);
   assert.equal(n.getNextEntryNumber({entries:{0:{stmemorybooks:true,comment:title}}},format),8);
 }
 assert.equal(n.extractNumberFromTitle('#7-8 Arc'),8);
});

test('existing preset migrates once while custom and unrelated profiles stay unchanged',()=>{
 const settings={titleFormat:LEGACY_ARCHIVE_LORE_TITLE_FORMAT,profiles:[{titleFormat:LEGACY_ARCHIVE_LORE_TITLE_FORMAT},{titleFormat:'[000] {{title}}'},{titleFormat:'Custom {{archiveLoreTitle}}'}]};
 assert.equal(migrateArchiveLoreTitleFormat(settings),true);
 assert.equal(settings.titleFormat,ARCHIVE_LORE_TITLE_FORMAT);
 assert.equal(settings.profiles[0].titleFormat,ARCHIVE_LORE_TITLE_FORMAT);
 assert.equal(settings.profiles[1].titleFormat,'[000] {{title}}');
 assert.equal(settings.profiles[2].titleFormat,'Custom {{archiveLoreTitle}}');
 assert.equal(migrateArchiveLoreTitleFormat(settings),false);
});
test('date-only memories keep internal sequence for the next collection and regeneration',()=>{
 const n=numbering();
 const entry={stmemorybooks:true,comment:'2029-10-23',STMB_memoryNumber:24};
 assert.equal(n.getNextEntryNumber({entries:{0:entry}},ARCHIVE_LORE_TITLE_FORMAT),25);
 assert.equal(extractEntrySequenceNumber(entry),24);
});
