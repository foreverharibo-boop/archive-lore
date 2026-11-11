import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {boundConnectionDisplay} from './lore-native-connection.js';

test('bound model label uses the same saved model even on a legacy current-ST collection profile',()=>{
 const profile={archiveLoreConnectionProfileId:'flash',connection:{api:'current_st',model:'rp-model'},useDynamicSTSettings:true};
 assert.deepEqual(boundConnectionDisplay(profile,{getProfile:id=>({name:'수집용 플래시',model:'saved-flash-model'})}),{profileModel:'수집용 플래시 · saved-flash-model'});
 assert.deepEqual(boundConnectionDisplay({connection:{model:'legacy'}},{}),{});
 for(const service of [{},{getProfile:()=>null},{getProfile:()=>{throw Error('missing');}}]) {
  assert.match(boundConnectionDisplay(profile,service).profileModel,/확인해 주세요/);
  assert.doesNotMatch(boundConnectionDisplay(profile,service).profileModel,/rp-model/);
 }
});
test('real confirmation renders saved model and retains the binding on confirmation',async()=>{
 const src=fs.readFileSync(new URL('./confirmationPopup.js',import.meta.url),'utf8');
 const a=src.indexOf('export async function showConfirmationPopup('),b=src.indexOf('\n}\n',a)+2;
 let displayed;
 const profile={name:'Archive Lore · 이관',archiveLoreConnectionProfileId:'flash',connection:{api:'current_st'},useDynamicSTSettings:true};
 const scope={archiveLoreFork:true,boundConnectionDisplay,getContext:()=>({ConnectionManagerRequestService:{getProfile:()=>({name:'수집 플래시',model:'flash-test'})}}),getEffectivePrompt:async()=> 'prompt',translate:s=>s,DOMPurify:{sanitize:s=>s},simpleConfirmationTemplate:data=>{displayed=data;return 'html';},safePlayMessageSound(){},markStmbPopup(){},activeMemoryPreviewPopups:new Set(),POPUP_TYPE:{TEXT:1},POPUP_RESULT:{AFFIRMATIVE:1},STMB_POPUP_RESULTS:{ADVANCED:2},Popup:class{async show(){return 1;}}};
 vm.runInNewContext(src.slice(a,b).replace('export ',''),scope);
 const result=await scope.showConfirmationPopup({estimatedTokens:10},{defaultProfile:0,profiles:[profile],moduleSettings:{}},{model:'rp-test'}, {}, {});
 assert.equal(displayed.profileModel,'수집 플래시 · flash-test');
 assert.equal(result.profileSettings.archiveLoreConnectionProfileId,'flash');
 assert.equal(result.confirmed,true);
});
