// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {nativePreferences,resolveBookPreference} from './lore-native-preferences.js';
import {scenePreview} from './lore-native-lazy.js';
const config=(mode,book='Shared')=>({moduleSettings:{archiveLoreBookMode:mode,archiveLoreBook:book}});
test('existing installations keep native manual/chat behavior until explicitly changed',()=>{
    assert.equal(resolveBookPreference({moduleSettings:{manualModeEnabled:true}},{}),null);
    assert.deepEqual(nativePreferences(),{mode:'legacy',book:'',layout:'archive',palette:'default'});
    assert.equal(nativePreferences({moduleSettings:{archiveLorePalette:'invalid'}}).palette,'default');
});
test('fixed world destination survives new chats and character changes without touching metadata',()=>{
    const settings=config('fixed');
    const contexts=[{chatBook:'Chat A',characterBook:'Character A'},{chatBook:'',characterBook:'Character A'},{chatBook:'Chat B',characterBook:'Character B',isGroup:true}];
    for(const context of contexts){const before=structuredClone(context);assert.deepEqual(resolveBookPreference(settings,context),{mode:'fixed',name:'Shared'});assert.deepEqual(context,before);}
});
test('character world follows character, while absent bindings never fall back to chat or another character in a group',()=>{
    assert.equal(resolveBookPreference(config('character'),{chatBook:'Chat',characterBook:'World'}).name,'World');
    assert.equal(resolveBookPreference(config('character'),{chatBook:'Chat',characterBook:'Next'}).name,'Next');
    assert.equal(resolveBookPreference(config('character'),{chatBook:'Chat'}).name,'');
    assert.equal(resolveBookPreference(config('character'),{chatBook:'Chat',characterBook:'World',isGroup:true}).name,'');
    assert.equal(resolveBookPreference(config('chat'),{chatBook:'Chat',characterBook:'World'}).name,'Chat');
    assert.equal(resolveBookPreference(config('chat'),{characterBook:'World'}).name,'');
});
const validationSource=(await fs.readFile(new URL('./lorebookValidation.js',import.meta.url),'utf8')).split('export async function validateLorebookRequirement')[1];
function validation(route,load,worlds=['Shared']) {
    const deps={getArchiveLoreBookRoute:()=>route,loadWorldInfo:load,world_names:worlds,
        extension_settings:{STMemoryBooks:{moduleSettings:{autoCreateLorebook:true}}},chat_metadata:{world_info:'Chat'},METADATA_KEY:'world_info',getDefaultRetryText:()=>'',
        showLorebookRecoveryPopup:()=>assert.fail('explicit source must not create a replacement or ask for a chat binding')};
    return new Function(...Object.keys(deps),'return async function validateLorebookRequirement'+validationSource)(...Object.values(deps));
}
test('generation validation loads precisely the chosen world book',async()=>{
    const data={entries:{0:{content:'Fact'}}};let requested;
    const result=await validation({mode:'fixed',name:'Shared'},async name=>{requested=name;return data;})();
    assert.equal(requested,'Shared');assert.equal(result.valid,true);assert.equal(result.name,'Shared');assert.equal(result.data,data);
});
test('missing or unreadable selected books cannot redirect collection or auto-create a new chat book',async()=>{
    for(const name of ['', 'Deleted'])assert.equal((await validation({mode:'fixed',name},()=>assert.fail('must not load absent books'))()).valid,false);
    assert.equal((await validation({mode:'fixed',name:'Shared'},async()=>{throw Error('offline');})()).valid,false);
});
test('explicit group member destinations retain native validation behavior',async()=>{
    const result=await validation({mode:'fixed',name:'Shared'},async name=>({entries:{},name}),['Shared','Member'])({lorebookName:'Member'});
    assert.equal(result.valid,true);assert.equal(result.name,'Member');
});
test('fast scene preview reads only the two endpoints, never scans or tokenizes the conversation',()=>{
    const chat=new Proxy({0:{name:'User',mes:'a'.repeat(120)},9999:{name:'Char',mes:'last'}},{get(target,key){assert(['0','9999'].includes(key));return target[key];}});
    const preview=scenePreview({sceneStart:0,sceneEnd:9999},chat);
    assert.equal(preview.messageCount,10000);assert.equal(preview.startExcerpt.length,103);assert.equal(preview.estimatedTokens,'…');
    assert.equal(scenePreview({sceneStart:null,sceneEnd:null},[]),null);
    assert.equal(scenePreview({sceneStart:5,sceneEnd:2},[]),null);
});
const nativeSource=await fs.readFile(new URL('./index.js',import.meta.url),'utf8');
const templateSource=nativeSource.split('async function buildSettingsTemplateData')[1].split('/**\n * Show main settings popup')[0];
test('actual main template builder returns without tokenizer, preset I/O or side-template reads',async()=>{
    const fail=()=>assert.fail('main-menu rendering must not start expensive preparation');
    const settings={defaultProfile:0,moduleSettings:{},profiles:[{name:'Profile',preset:'custom',connection:{api:'openai'}}]};
    const deps={initializeSettings:()=>settings,SummaryPromptManager:{firstRunInitIfMissing:fail,getPrompt:fail},getSceneData:fail,listSets:fail,
        getSceneMarkers:()=>({sceneStart:0,sceneEnd:1}),chat:[{mes:'Start'},{mes:'End'}],scenePreview,getRegexScripts:()=>[],
        getDefaultProfileTitleFormat:()=>'',getDefaultTitleFormats:()=>[],getCurrentManualLorebookResolution:()=>({lorebookName:'Old'}),
        getCurrentMemoryBooksContext:()=>({isGroupChat:false}),getCurrentNarratorConfig:()=>null,normalizeAutoConsolidationTargetTiers:()=>[],normalizeSidePromptSetKey:v=>v||'',
        getAIReferenceManualData:()=>({}),getArchiveLoreBookRoute:()=>null,getCurrentCanonicalLorebookName:()=> 'World',chat_metadata:{},METADATA_KEY:'world_info',world_names:['World'],
        normalizeMemoryBoundaryMode:()=>'',getMemoryBoundaryModeOptions:()=>[],DEFAULT_MAX_TOKENS:500,getAutoHideMode:()=>'',MEMORY_REMINDER_DEFAULTS:{},getAutoConsolidationTierOptions:()=>[],titleFormatLabel:v=>v,translate:v=>v};
    const build=new Function(...Object.keys(deps),'return async function buildSettingsTemplateData'+templateSource)(...Object.values(deps));
    const before=globalThis.archiveLoreFork;globalThis.archiveLoreFork=true;
    try{const data=await build();assert.equal(data.sceneData.messageCount,2);assert.equal(data.sceneData.estimatedTokens,'…');assert.equal(data.selectedProfile.effectivePrompt,'');assert.equal(data.currentLorebookName,'World');}
    finally{globalThis.archiveLoreFork=before;}
});
