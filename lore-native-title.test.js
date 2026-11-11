import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ARCHIVE_LORE_TITLE_FORMAT, titleFormatLabel, withArchiveLoreTitle } from './lore-native-title.js';
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
 assert.match(dated,/Custom memory instructions/);assert.match(dated,/never the real-world date/);assert.match(dated,/omit the date and separator/);assert.match(dated,/Keep the requested JSON schema unchanged/);
 scope.archiveLoreFork=false;assert.equal(await build({metadata:{},messages:[]},{titleFormat:ARCHIVE_LORE_TITLE_FORMAT}),normal);
});
test('native title rendering retains story dates/ranges or undated title and assigns sequence number',()=>{
 const scope={applyFixedSequenceNumber,hasSequenceNumberPlaceholder,i18n:(_key,f)=>f,moment:()=>({format:()=> '2099-01-01'}),sanitizeTitle:s=>s};
 const render=load('./addlore.js','generateEntryTitleAtNumber',scope);
 for(const title of ['2029-10-23 · Returning home','2029-10-23–2029-10-24 · A hospital stay','Returning home']) {
   assert.equal(render(ARCHIVE_LORE_TITLE_FORMAT,{extractedTitle:title},7),'[007] '+title);
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
