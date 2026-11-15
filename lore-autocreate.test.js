// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const creationSource=fs.readFileSync(new URL('./autocreate.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
const validationSource=fs.readFileSync(new URL('./lorebookValidation.js',import.meta.url),'utf8').split('export async function validateLorebookRequirement')[1];
function harness({mode='chat',name='',enabled=true,manual=false,group=false}={}) {
 const character={avatar:'char.png',data:{extensions:{}},json_data:'{"data":{"extensions":{"other":"keep"}}}'};
 const ctx={chat:[],chatMetadata:{},characters:[character],characterId:0,groupId:group?'group':null};
 const calls=[],worlds=[],route=mode==='legacy'?null:{mode,name};
 if(name){worlds.push(name);if(mode==='character')character.data.extensions.world=name;else ctx.chatMetadata.world_info=name;}
 let active=ctx;
 const settings={moduleSettings:{autoCreateLorebook:enabled,manualModeEnabled:manual}};
 const scope={getContext:()=>active,getCurrentChatId:()=>active===ctx?'chat':'new-chat',name1:'User',name2:'Char',
  chat_metadata:ctx.chatMetadata,METADATA_KEY:'world_info',world_names:worlds,
  translate:s=>s,console:{log(){},warn(){},error(){}},toastr:{success(){}},document:{querySelector:()=>null},$:()=>({addClass(){}}),
  createNewWorldInfo:async name=>{calls.push(['create',name]);worlds.push(name);return true;},
  saveMetadata:async()=>calls.push(['metadata']),getRequestHeaders:()=>({}),fetch:async(url,options)=>{calls.push(['request',url,JSON.parse(options.body)]);return{ok:true};},
  extension_settings:{STMemoryBooks:settings},getArchiveLoreBookRoute:()=>route && {...route,name:route.mode==='character'?character.data.extensions.world||route.name:route.mode==='chat'?ctx.chatMetadata.world_info||route.name:route.name},
  loadWorldInfo:async name=>{calls.push(['load',name]);return{entries:{}};},getDefaultRetryText:()=>'',getSceneMarkers:()=>({}),
  getCurrentManualLorebookResolution:()=>({lorebookName:'',source:'none'}),showLorebookRecoveryPopup:async()=>({type:'handled',error:'select'}),tr:(_k,f)=>f,
 };
 vm.createContext(scope);vm.runInContext(creationSource,scope);vm.runInContext('async function validateLorebookRequirement'+validationSource,scope);
 return{scope,calls,worlds,ctx,character,settings,route,switchChat:()=>{active={...ctx,chat:[],chatMetadata:{}};return active;}};
}
for(const mode of ['chat','character','legacy'])test(`enabled creation resolves ${mode} and reuses the resulting book for the next memory/side`,async()=>{
 const h=harness({mode});
 const result=await h.scope.validateLorebookRequirement({createContext:'side-prompt'});
 assert.equal(result.valid,true);assert.equal(h.calls.filter(c=>c[0]==='create').length,1);
 if(mode==='character'){
  assert.equal(h.character.data.extensions.world,result.name);assert.equal(h.ctx.chatMetadata.world_info,undefined);
  assert.equal(h.calls.find(c=>c[0]==='request')[2].avatar,'char.png');
  assert.equal(JSON.parse(h.character.json_data).data.extensions.other,'keep');
 }else assert.equal(h.ctx.chatMetadata.world_info,result.name);
 assert.equal((await h.scope.validateLorebookRequirement()).name,result.name);
 assert.equal(h.calls.filter(c=>c[0]==='create').length,1);
});
test('creation stays off for read-only checks, disabled settings, fixed destinations and existing/missing named books',async()=>{
 for(const options of [{mode:'chat',enabled:false},{mode:'fixed'},{mode:'fixed',name:'Existing'},{mode:'character',name:'Existing'}]){
  const h=harness(options);await h.scope.validateLorebookRequirement();assert.equal(h.calls.filter(c=>c[0]==='create').length,0);
 }
 const h=harness();assert.equal((await h.scope.validateLorebookRequirement({skipAutoCreate:true})).valid,false);assert.equal(h.calls.length,0);
 const missing=harness({name:'Deleted'});missing.worlds.length=0;assert.equal((await missing.scope.validateLorebookRequirement()).valid,false);assert.equal(missing.calls.length,0);
});
test('manual legacy mode and explicit side destinations never silently create a replacement',async()=>{
 for(const [options,request] of [[{mode:'legacy',manual:true},{}],[{mode:'legacy'},{lorebookName:null}]]){
  const h=harness(options);await h.scope.validateLorebookRequirement(request);assert.equal(h.calls.filter(c=>c[0]==='create').length,0);
 }
});
test('group character-follow cannot bind an arbitrary group member',async()=>{
 const h=harness({mode:'character',group:true});assert.equal((await h.scope.validateLorebookRequirement()).valid,false);assert.equal(h.calls.length,0);
 const chat=harness({mode:'chat',group:true});assert.equal((await chat.scope.validateLorebookRequirement()).valid,true);
});
test('simultaneous memory and side requests share one create/bind operation',async()=>{
 const h=harness();let release;h.scope.createNewWorldInfo=async name=>{h.calls.push(['create',name]);await new Promise(r=>release=r);h.worlds.push(name);return true;};
 const first=h.scope.validateLorebookRequirement(),second=h.scope.validateLorebookRequirement();release();
 const results=await Promise.all([first,second]);assert(results.every(r=>r.valid));assert.equal(results[0].name,results[1].name);
 assert.equal(h.calls.filter(c=>c[0]==='create').length,1);assert.equal(h.calls.filter(c=>c[0]==='metadata').length,1);
});
test('chat or route changes during creation never bind the newly opened chat',async()=>{
 for(const change of ['chat','mode','binding']){
  const h=harness();let next;h.scope.createNewWorldInfo=async name=>{h.worlds.push(name);if(change==='chat')next=h.switchChat();else if(change==='mode')h.route.mode='fixed';else h.ctx.chatMetadata.world_info='Other';return true;};
  assert.equal((await h.scope.validateLorebookRequirement()).valid,false);
  assert.equal(h.calls.filter(c=>c[0]==='metadata'||c[0]==='request').length,0);assert.equal(next?.chatMetadata.world_info,undefined);
 }
});
test('failed create or character binding reports failure and never proceeds to memory load',async()=>{
 const failed=harness();failed.scope.createNewWorldInfo=async()=>false;assert.equal((await failed.scope.validateLorebookRequirement()).valid,false);
 const h=harness({mode:'character'});h.scope.fetch=async()=>({ok:false});assert.equal((await h.scope.validateLorebookRequirement()).valid,false);
 assert.equal(h.character.data.extensions.world,undefined);assert.equal(h.calls.filter(c=>c[0]==='load').length,0);
});
