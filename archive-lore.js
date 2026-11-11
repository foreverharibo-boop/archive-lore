// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// Forked from Memory Books, Copyright (C) 2024–2026 Aiko Hanasaki.
// SPDX-License-Identifier: AGPL-3.0-only
import { getContext, extension_settings } from '../../../extensions.js';
import { getRequestHeaders, eventSource, event_types, saveSettingsDebounced, extension_prompt_types } from '../../../../script.js';
import { world_names, worldInfoCache, updateWorldInfoList, createWorldInfoEntry, METADATA_KEY } from '../../../world-info.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../slash-commands/SlashCommandArgument.js';
import { generateLorebookName } from './autocreate.js';
import { NS, normalizeSettings, applyNativePolicy, materializeEntry, isCore, entryAvailable, SIDE_PROMPT } from './lore-core.js';
import { ask, embed, createVectorStore, makeId } from './lore-api.js';
import { createLoreController } from './lore-controller.js';
import { createLoreUI } from './lore-ui.js';

const PROMPT = 'archive-lore-recalled', CORE_PROMPT = 'archive-lore-core';
let ui, recalled = new Set(), activeBooks = [], writing = false;
const settings = () => extension_settings[NS];
function saveSettings(patch = {}) {
    extension_settings[NS] = normalizeSettings({ ...extension_settings[NS], ...patch });
    extension_settings[NS].cacheNamespace ||= makeId();
    saveSettingsDebounced(); clearPrompts();
}
function chatContext() {
    const c = getContext(), char = c.characters?.[c.characterId];
    const id = c.getCurrentChatId?.() || c.chatId;
    return { key: id ? JSON.stringify([c.groupId || char?.avatar || '', id]) : '',
        name: c.groupId ? c.name2 || '그룹 대화' : `${c.name2 || ''} × ${c.name1 || ''}`, messages: c.chat || [] };
}
function chatSettings() { return getContext().chatMetadata?.[NS] || {}; }
function primaryBook() {
    const c = getContext();
    return c.characters?.[c.characterId]?.data?.extensions?.world || c.chatMetadata?.[METADATA_KEY] || '';
}
function target() { const s=chatSettings(); return Object.hasOwn(s,'target') ? s.target : primaryBook(); }
function books() {
    const selected = chatSettings().books;
    return [...new Set(Array.isArray(selected) ? selected : [target()].filter(Boolean))].filter(n => world_names.includes(n));
}
async function saveChatSettings(patch) {
    const c = getContext(); if (!chatContext().key) throw new Error('채팅방에서 설정해 줘.');
    if (controller.state().busy) throw new Error('작업이 끝난 뒤 설정을 바꿔 줘.');
    c.chatMetadata[NS] = { ...chatSettings(), ...patch }; await c.saveMetadata(); clearPrompts();
}
async function loadBook(name) {
    const response = await fetch('/api/worldinfo/get', { method:'POST', headers:getRequestHeaders(), body:JSON.stringify({name}), cache:'no-cache' });
    if (!response.ok) throw new Error(`로어북을 읽을 수 없어 (${response.status}): ${name}`);
    const data = await response.json(); if (!data?.entries || typeof data.entries !== 'object') throw new Error('로어북 형식을 확인해 줘.');
    return data;
}
async function saveBook(name, data) {
    const response = await fetch('/api/worldinfo/edit', { method:'POST', headers:getRequestHeaders(), body:JSON.stringify({name,data}) });
    if (!response.ok) throw new Error(`로어북 저장 실패 (${response.status}). 수집 위치는 이동하지 않았어.`);
    worldInfoCache.set(name, structuredClone(data));
    await eventSource.emit(event_types.WORLDINFO_UPDATED, name, data);
}
async function ensureBook() {
    const c = getContext(), key = chatContext().key;
    if (!key) throw new Error('채팅방을 먼저 열어 줘.');
    let name = target();
    if (name && !world_names.includes(name)) throw new Error('저장할 로어북이 없어졌어. 다른 책을 선택해 줘.');
    if (!name) {
        name = generateLorebookName('Archive Lore - {{char}} - {{chat}}');
        await saveBook(name,{entries:{},[NS]:{receipts:[]}});
        await updateWorldInfoList();
        if (chatContext().key !== key) throw new Error('채팅방이 바뀌었어. 생성한 로어북은 목록에서 선택할 수 있어.');
        if (c.groupId) c.chatMetadata[METADATA_KEY] = name;
        else {
            const character = c.characters?.[c.characterId];
            if (!character) throw new Error('캐릭터 정보를 찾을 수 없어.');
            const response = await fetch('/api/characters/merge-attributes', {method:'POST',headers:getRequestHeaders(),
                body:JSON.stringify({avatar:character.avatar,data:{extensions:{world:name}}})});
            if (!response.ok) throw new Error('로어북은 만들었지만 캐릭터 연결에 실패했어. 목록에서 책을 선택해 줘.');
            character.data ||= {}; character.data.extensions ||= {}; character.data.extensions.world=name;
            if(character.json_data){const json=JSON.parse(character.json_data);json.data ||= {};json.data.extensions ||= {};json.data.extensions.world=name;character.json_data=JSON.stringify(json);}
            if (chatContext().key === key) {
                document.querySelector('#character_world') && (document.querySelector('#character_world').value=name);
                if(document.querySelector('#character_json_data') && character.json_data) document.querySelector('#character_json_data').value=character.json_data;
            }
        }
    }
    if (chatContext().key !== key) throw new Error('채팅방이 바뀌어서 작업을 멈췄어.');
    c.chatMetadata[NS] = { ...chatSettings(), target:name, books:[...new Set([...books(),name])] };
    await c.saveMetadata(); return name;
}
function clearPrompts() {
    getContext().setExtensionPrompt(PROMPT,'',extension_prompt_types.IN_CHAT,1,false);
    getContext().setExtensionPrompt(CORE_PROMPT,'',extension_prompt_types.IN_CHAT,1,false);
    recalled=new Set(); activeBooks=[];
}
function error(error) {
    if(error?.name === 'AbortError') return;
    toastr.error(error?.message || '작업을 완료하지 못했어.','Archive Lore');
}
const controller = createLoreController({
    settings, context:chatContext, books, target, initialStart:()=>chatSettings().initialStart || 0,
    ensureBook, loadBook, saveBook,
    newEntry:data=>{const entry=createWorldInfoEntry('',data);if(!entry)throw new Error('새 기억 항목을 만들 수 없어.');return entry;},
    store:createVectorStore(), embed,
    ask:(profile,system,data,signal,tokens)=>ask(getContext(),profile,system,data,signal,tokens),
    countTokens:text=>getContext().getTokenCountAsync(text,0),
    changed:()=>{void ui?.refresh().catch(error);},
});
async function saveRecord(id, changes) {
    if(controller.state().busy || writing)throw new Error('진행 중인 작업이 끝난 뒤 수정해 줘.');
    const [book,uid]=JSON.parse(id); if(!books().includes(book))throw new Error('현재 검색 대상이 아닌 로어북이야.');
    const key=chatContext().key; writing=true;
    try {
        const data=await loadBook(book), entry=data.entries[uid]; if(!entry)throw new Error('기억 항목이 없어졌어.');
        const visible=materializeEntry(entry,chatContext().messages);
        if(visible[NS]?.sideCategory){
            const prior=structuredClone(entry[NS]);
            const facts=structuredClone(visible[NS].facts);
            for(const change of changes.facts){const fact=facts.find(f=>f.id===change.id);if(!fact || !change.text.trim())throw new Error('사이드 항목을 빈칸으로 저장할 수 없어.');fact.text=change.text.trim();}
            const content=facts.map(f=>`• ${f.text}`).join('\n');
            if(content!==entry.content){
                entry[NS]={...visible[NS],facts,history:[...(prior.history||[]),{content:entry.content,facts:prior.facts,source:prior.source}]};
                entry.content=content;
            }
        } else { if(!changes.content?.trim())throw new Error('빈 기억은 저장할 수 없어.');entry.content=changes.content.trim(); }
        entry.constant=changes.core;
        if(chatContext().key!==key)throw new Error('채팅방이 바뀌어서 저장하지 않았어.');
        await saveBook(book,data);clearPrompts();
    } finally {writing=false;}
}
async function intercept(_chat,_contextSize,abort,type) {
    clearPrompts();
    if(!settings().enabled || !chatContext().key || !books().length || ['quiet','impersonate'].includes(type))return;
    try {
        if(writing)throw new Error('기억 저장이 끝난 뒤 다시 전송해 줘.');
        const result=await controller.recall();
        activeBooks=result.books;recalled=result.selected;
        getContext().setExtensionPrompt(PROMPT,result.text,extension_prompt_types.IN_CHAT,1,false);
        getContext().setExtensionPrompt(CORE_PROMPT,result.core,extension_prompt_types.IN_CHAT,1,false);
    } catch(e){clearPrompts();abort(true);error(e);}
}
function nativePolicy(lists) {
    if(!settings().enabled)return;
    const selectedBooks=books(), messages=chatContext().messages;
    // Modify transient WI scan copies only. Stored keys and entry enabled state are untouched.
    for(const list of Object.values(lists))if(Array.isArray(list))for(let i=0;i<list.length;i++){
        if(!selectedBooks.includes(list[i].world))continue;
        list[i]=materializeEntry(list[i],messages);
        if(activeBooks.includes(list[i].world) && isCore(list[i]))list[i].disable=true;
    }
    applyNativePolicy(lists,{enabled:true,keywordActivation:settings().keywordActivation,books:selectedBooks,messages,selected:recalled});
}
function init() {
    saveSettings();
    ui=createLoreUI({settings,saveSettings,controller,context:chatContext,error,
        profiles:()=>getContext().extensionSettings?.connectionManager?.profiles || [],
        bookNames:()=>[...world_names],books,target,
        setTarget:async name=>saveChatSettings({target:name,books:[...new Set([...books(),name].filter(Boolean))]}),
        setBooks:async names=>saveChatSettings({books:names}),
        setInitialStart:async n=>{if(!Number.isInteger(n)||n<0||n>chatContext().messages.length)throw new Error('시작 번호를 확인해 줘.');await saveChatSettings({initialStart:n});},
        saveRecord,
    });
    const settingsNode=document.createElement('div'); settingsNode.id='archive-lore-settings';settingsNode.className='extension_container';
    settingsNode.innerHTML='<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Archive Lore</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content" data-al-settings></div></div>';
    document.querySelector('#extensions_settings2')?.append(settingsNode);
    ui.mountSettings(settingsNode.querySelector('[data-al-settings]'));
    const menu=document.createElement('div');menu.id='archive-lore-menu';menu.className='list-group-item flex-container flexGap5 interactable';menu.tabIndex=0;menu.setAttribute('role','button');
    menu.innerHTML='<i class="fa-solid fa-book-bookmark fa-fw"></i><span>아카이브 로어</span>';
    menu.addEventListener('click',()=>void ui.open().catch(error));menu.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();void ui.open().catch(error);}});
    document.querySelector('#extensionsMenu')?.append(menu);
    globalThis.archiveLoreInterceptor=intercept;
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED,nativePolicy);
    eventSource.on(event_types.CHAT_CHANGED,()=>{controller.cancel();controller.clearRecall();clearPrompts();void ui.refresh().catch(error);});
    for(const event of [event_types.MESSAGE_EDITED,event_types.MESSAGE_DELETED,event_types.MESSAGE_SWIPED])if(event)eventSource.on(event,()=>{controller.cancel();clearPrompts();});
    for(const [name,callback,help] of [
        ['al','open','아카이브 로어 열기'],['al-collect','collect','마지막 수집 다음부터 수집. 선택 범위: /al-collect 0-19'],
        ['al-embed','index','남은 기억 임베딩'],['al-recall','recall','기억 검색 미리보기'],['al-stop','cancel','아카이브 로어 작업 중지'],
    ])SlashCommandParser.addCommandObject(SlashCommand.fromProps({name,helpString:help,
        unnamedArgumentList:name==='al-collect'?[SlashCommandArgument.fromProps({description:'시작-끝 메시지 번호',typeList:[ARGUMENT_TYPE.STRING],isRequired:false})]:[],
        callback:async(_args,value)=>{try{
            if(callback==='open')await ui.open();
            else if(callback==='collect' && value?.trim()){
                const match=String(value).trim().match(/^(\d+)\s*-\s*(\d+)$/);if(!match)throw new Error('범위는 0-19처럼 입력해 줘.');await controller.collect({start:Number(match[1]),end:Number(match[2])});
            } else await controller[callback]();
            return controller.state().status;
        }catch(e){error(e);throw e;}},
    }));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
