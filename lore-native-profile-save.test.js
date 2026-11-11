// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ARCHIVE_LORE_TITLE_FORMAT } from './lore-native-title.js';
function load(file,name,scope) {
 const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');
 const start=source.indexOf('function '+name+'('),end=start+source.slice(start).search(/\n}\r?(?:\n|$)/)+2;
 assert(start>=0);vm.runInNewContext(source.slice(start,end),scope);
}
test('native profile form keeps selected title, preset, saved connection and entry settings through serialization',()=>{
 const scope={archiveLoreFork:true};
 for(const name of ['parseTemperature','parseBooleanFlag','clampInt','generateProfileKey','normalizeAdditionalContextEntries','createProfileObject'])load('./utils.js',name,scope);
 load('./profileManager.js','buildProfileFromForm',scope);
 const form={
  '#stmb-profile-name':{value:'Collection'},'#stmb-profile-api':{value:'current_st'},
  '#stmb-profile-preset':{value:'my-prompt'},'#al-native-connection':{value:'saved-ai'},
  '#stmb-profile-title-format-select':{value:ARCHIVE_LORE_TITLE_FORMAT},
  '#stmb-profile-temperature':{value:'0.35'},'#stmb-profile-const-vect':{value:'link'},
  '#stmb-profile-position':{value:'7'},'#stmb-profile-outlet-name':{value:'memory-slot'},
  'input[name="order-mode"]:checked':{value:'manual'},'#stmb-profile-order-value':{value:'123'},
  '#stmb-profile-prevent-recursion':{checked:false},'#stmb-profile-delay-recursion':{checked:true},
  '#stmb-profile-skip-structured-output':{checked:true},
  '#stmb-profile-use-chat-completion-service':{checked:true},'#stmb-profile-chat-completion-preset':{value:'collection-preset'},
 };
 const result=scope.buildProfileFromForm({querySelector:s=>form[s]},'fallback',{profileKey:'same-profile',archiveLoreConnectionProfileId:'saved-ai'});
 const saved=JSON.parse(JSON.stringify(result));
 const reloaded=JSON.parse(JSON.stringify(scope.createProfileObject(saved)));
 assert.equal(reloaded.titleFormat,ARCHIVE_LORE_TITLE_FORMAT);
 assert.equal(reloaded.archiveLoreConnectionProfileId,'saved-ai');
 assert.equal(reloaded.preset,'my-prompt');assert.equal(reloaded.profileKey,'same-profile');
 assert.equal(reloaded.connection.temperature,.35);assert.equal(reloaded.connection.api,'current_st');
 assert.equal(reloaded.constVectMode,'link');assert.equal(reloaded.position,7);assert.equal(reloaded.outletName,'memory-slot');
 assert.equal(reloaded.orderMode,'manual');assert.equal(reloaded.orderValue,123);
 assert.equal(reloaded.preventRecursion,false);assert.equal(reloaded.delayUntilRecursion,true);
 assert.equal(reloaded.skipStructuredOutput,true);assert.equal(reloaded.useChatCompletionService,true);assert.equal(reloaded.chatCompletionPreset,'collection-preset');
});
