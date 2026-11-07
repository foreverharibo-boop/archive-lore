import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {nextCollectionRange,advanceCollectionCheckpoint} from './lore-native-progress.js';
import {englishPrompt,migrateUneditedDefaults,migrateUneditedSideDefaults} from './lore-native-defaults.js';

test('next collection starts after highest saved range, including message zero and manual ranges',()=>{
    const markers={};assert.deepEqual(nextCollectionRange(markers,21),{highest:-1,start:0,end:20,count:21});
    advanceCollectionCheckpoint(markers,0);assert.equal(nextCollectionRange(markers,21).start,1);
    advanceCollectionCheckpoint(markers,10);assert.equal(nextCollectionRange(markers,21).start,11);
    advanceCollectionCheckpoint(markers,5);assert.equal(nextCollectionRange(markers,21).start,11);
    const reloaded=JSON.parse(JSON.stringify(markers));assert.equal(nextCollectionRange(reloaded,21).count,10);
    advanceCollectionCheckpoint(reloaded,20);assert.equal(nextCollectionRange(reloaded,21).count,0);
    assert.equal(nextCollectionRange({},0).count,0);
    assert.throws(()=>advanceCollectionCheckpoint(markers,NaN));
});
test('now collect uses saved cursor, not stale selected markers; no new messages makes no request',async()=>{
    const source=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8');
    const start=source.indexOf('async function collectNextArchiveLore('),end=source.indexOf('\nasync function runSceneMemoryRange',start);
    const markers={highestMemoryProcessed:19,sceneStart:0,sceneEnd:3},calls=[];
    const scope={nextCollectionRange,chat:Array(25).fill({mes:'text'}),getSceneMarkers:()=>markers,isMemoryProcessing:()=>false,toastr:{info(){}},runSceneMemoryRange:async(a,b)=>{calls.push([a,b]);return true;}};
    vm.runInNewContext(source.slice(start,end),scope);
    assert.equal(await scope.collectNextArchiveLore(),true);assert.deepEqual(calls,[[20,24]]);
    markers.highestMemoryProcessed=24;assert.equal(await scope.collectNextArchiveLore(),false);assert.equal(calls.length,1);
    scope.isMemoryProcessing=()=>true;await assert.rejects(scope.collectNextArchiveLore(),/진행 중/);
});
test('native saved-range checkpoint keeps max instead of moving backwards',()=>{
    const source=fs.readFileSync(new URL('./addlore.js',import.meta.url),'utf8');const start=source.indexOf('function updateHighestMemoryProcessed(');const end=source.indexOf('\n/**',start);
    const markers={highestMemoryProcessed:99};let saves=0;
    const scope={archiveLoreFork:true,advanceCollectionCheckpoint,console:{log(){},warn(){},error(){}},MODULE_NAME:'test',i18n:(_key,fallback)=>fallback,getSceneMarkers:()=>markers,saveMetadataForCurrentContext:()=>saves++};
    vm.runInNewContext(source.slice(start,end),scope);
    scope.updateHighestMemoryProcessed({metadata:{sceneRange:'0-19'}});assert.equal(markers.highestMemoryProcessed,99);
    scope.updateHighestMemoryProcessed({metadata:{sceneRange:'100-119'}});assert.equal(markers.highestMemoryProcessed,119);assert.equal(saves,2);
    scope.updateHighestMemoryProcessed({metadata:{}});assert.equal(markers.highestMemoryProcessed,119);
});
test('stock prompt conversion changes exact defaults only, leaving edits/imported prompts intact',()=>{
    const data={overrides:{summary:{prompt:'원래 기본'},edited:{prompt:'내가 수정'},imported:{prompt:'가져온 프롬프트'}}};
    const updated=migrateUneditedDefaults(data,{summary:'원래 기본',edited:'원래 기본'},{summary:'English stock',edited:'English stock'});
    assert.equal(updated.overrides.summary.prompt,'English stock');assert.equal(updated.overrides.edited.prompt,'내가 수정');assert.equal(updated.overrides.imported.prompt,'가져온 프롬프트');
    assert.equal(data.overrides.summary.prompt,'원래 기본');assert.equal(migrateUneditedDefaults(updated,{summary:'원래 기본'},{summary:'English stock'}),null);
    const sides={prompts:{stock:{prompt:'원본',responseFormat:'양식'},imported:{prompt:'원본'}}};
    const next=migrateUneditedSideDefaults(sides,{stock:{prompt:'원본',responseFormat:'양식'}},{stock:{prompt:'English',responseFormat:'Format'}});
    assert.equal(next.prompts.stock.prompt,'English');assert.equal(next.prompts.imported.prompt,'원본');
});
test('real summary/arc default factories produce English while localized UI fallback is available',()=>{
    const source=fs.readFileSync(new URL('./utils.js',import.meta.url),'utf8');const start=source.indexOf('export function getBuiltInPresetPrompts(');const end=source.indexOf('/* DEFAULT_PROMPT',start);
    const scope={archiveLoreFork:true,englishPrompt,translate:()=> '한글 기본'};
    vm.runInNewContext(source.slice(start,end).replace(/^export /gm,''),scope);
    const english=scope.getBuiltInPresetPrompts();assert.match(english.summary,/You are/);assert.match(english.summary,/in English/);assert.equal(scope.getBuiltInPresetPrompts(true).summary,'한글 기본');
    assert.match(scope.getDefaultPrompt(),/in English/);
    const arc=fs.readFileSync(new URL('./templatesArcPrompts.js',import.meta.url),'utf8');
    Object.assign(scope,{CONSOLIDATION_REGENERATION_PRESET_KEY:'regen',GROUP_CHAT_CONSOLIDATION_PRESET_KEY:'group'});
    vm.runInNewContext(arc.slice(arc.indexOf('function getDefinitions(')).replace(/^export /gm,''),scope);
    assert.match(scope.getBuiltInArcPrompts().arc_default,/in English/);assert.equal(scope.getBuiltInArcPrompts(true).arc_default,'한글 기본');
});
test('changing destination book binds current chat without moving memories; chat switch is rejected',async()=>{
    const source=fs.readFileSync(new URL('./utils.js',import.meta.url),'utf8');const start=source.indexOf('export async function showLorebookSelectionPopup('),end=source.indexOf('\n}\n',start)+2;
    let metadata={},switchChat=false,saves=0;const markers={};
    const scope={archiveLoreFork:true,getContext:()=>({chatMetadata:metadata}),chat_metadata:metadata,getSceneMarkers:()=>markers,isCharacterAwarenessDisabled:()=>false,getCurrentMemoryBooksContext:()=>({}),getCurrentGroupLorebookMembers:()=>[],extension_settings:{},world_names:['new book'],escapeHtml:x=>x,translate:x=>x,METADATA_KEY:'world_info',POPUP_TYPE:{TEXT:1},POPUP_RESULT:{AFFIRMATIVE:1},MEMORY_TIER_CACHE_REFRESH_EVENT:'refresh',eventSource:{emit:async()=>{}},saveMetadataForCurrentContext:()=>saves++,toastr:{success(){},error(){}},Popup:class{dlg={querySelector:()=>({value:'new book'})};async show(){if(switchChat)metadata={};return 1;}}};
    vm.runInNewContext(source.slice(start,end).replace('export ',''),scope);
    assert.equal(await scope.showLorebookSelectionPopup(null,{binding:'chat'}),'new book');
    assert.equal(metadata.world_info,'new book');assert.equal(markers.manualLorebook,undefined);assert.equal(saves,1);
    switchChat=true;await assert.rejects(scope.showLorebookSelectionPopup(null,{binding:'chat'}),/채팅이 변경/);assert.equal(saves,1);
});
