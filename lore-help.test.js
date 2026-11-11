// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HELP,helpFor} from './lore-help-catalog.js';
const control=(id='',name='',dataset={},classes=[])=>({id,name,dataset,classList:{contains:k=>classes.includes(k)}});
test('every static native setting control has guidance, including reminder data keys',()=>{
 const files=['templates.js','profileManager.js','sidePromptsPopup.js','contextSettingsPopup.js','clipManager.js','index.js','autosummary.js','utils.js','stmbJobs.js','confirmationPopup.js','clipReview.js'];
 const missing=[];let count=0;
 for(const file of files){for(const [tag]of fs.readFileSync(new URL(file,import.meta.url),'utf8').matchAll(/<(?:input|select|textarea)\b[^>]*>/g)){
  if(/\stype="(?:file|hidden)"/.test(tag))continue;
  const id=tag.match(/\sid="([^"]*)"/)?.[1]||'',name=tag.match(/\sname="([^"]*)"/)?.[1]||'',memoryReminder=tag.match(/data-memory-reminder="([^"]*)"/)?.[1];
  if(!(id||name||memoryReminder) || /\$\{/.test(id||name))continue;
  count++;if(!helpFor(control(id,name,{memoryReminder})))missing.push(file+': '+(id||name||memoryReminder));
 }}
 assert(count>190);assert.deepEqual(missing,[]);
});
test('dynamic side editors and library operation settings resolve to the correct guidance',()=>{
 for(const id of ['stmb-sp-edit-prompt','stmb-sp-new-response-format','stmb-pm-edit-prompt','stmb-apm-new-prompt','stmb-compaction-request-profile-select','stmb-clip-entry-position','stmb-clip-entry-order-mode','stmb-consolidation-preview-content-5'])assert(helpFor(control(id)),id);
 for(const key of ['stmb-sp-set-item-prompt','stmb-sp-set-item-label','stmb-sp-set-item-macro','stmb-sp-special-mode'])assert(helpFor(control('','',{},[key])),key);
 assert.match(helpFor(control('','',{alHelpKey:'range-end'})),/끝 번호도 포함/);
 assert.match(helpFor(control('','',{memoryReminder:'automaticMemoryReminderInterval'})),/메시지 개수/);
 assert.equal(helpFor(control('unknown-host-setting')),'');
});
test('guidance distinguishes hidden-message inclusion, budgets, profile roles and optional server scope',()=>{
 assert.match(HELP['stmb-unhide-before-memory'],/실제로 해제/);
 assert.match(HELP['stmb-topical-clip-include-hidden-messages'],/숨김 상태는 유지/);
 assert.match(HELP['stmb-max-tokens'],/출력 토큰/);
 assert.match(HELP.injectionTokens,/최종 토큰 예산/);
 assert.match(HELP.autoEmbed,/API 비용/);
 assert.match(HELP.profile,/기본 검색 AI/);
 assert.match(HELP.serverEnabled,/선택 기능/);
});
