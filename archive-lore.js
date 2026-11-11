// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// Forked from Memory Books, Copyright (C) 2024–2026 Aiko Hanasaki.
// SPDX-License-Identifier: AGPL-3.0-only
import { loreIcon } from './lore-icons.js';
import { getContext, extension_settings } from '../../../extensions.js';
import { getRequestHeaders, eventSource, event_types, saveSettingsDebounced, extension_prompt_types } from '../../../../script.js';
import { world_names, worldInfoCache, updateWorldInfoList, createWorldInfoEntry, METADATA_KEY } from '../../../world-info.js';
import { executeSlashCommands } from '../../../slash-commands.js';
import { consolidationView } from './lore-maintenance.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../slash-commands/SlashCommandArgument.js';
import { generateLorebookName } from './autocreate.js';
import { NS, normalizeSettings, applyNativePolicy, materializeEntry, isCore, entryAvailable, SIDE_PROMPT, sideSnapshot, sourceRange } from './lore-core.js';
import { dateDay, relationshipPhase, relationshipLabel, formatRelationship } from './lore-relationship.js';
import { ask, embed, createVectorStore, makeId } from './lore-api.js';
import { createLoreController } from './lore-controller.js';
import { createDiagnostics, createDiagnosticStore } from './lore-diagnostics.js';
import { linkedTranslation } from './lore-translations.js';
import { proxies } from '../../../openai.js';
import { createServerClient,serverVectorStore,createServerController,profileTemplate,serverChatSnapshot } from './lore-server.js';
import { matchesRange } from './lore-core.js';
import { createLoreUI } from './lore-ui.js';
import { syncServerBooks } from './lore-automation.js';
import { createBackgroundRecall } from './lore-background.js';
import { translate } from '../../../i18n.js';

const PROMPT = 'archive-lore-recalled', CORE_PROMPT = 'archive-lore-core', GUIDANCE_PROMPT = 'archive-lore-guidance';
let ui, recalled = new Set(), activeBooks = [], writing = false, generationInFlight=false, autoTimer=null, autoAttempt='', autoPending=false;
const settings = () => extension_settings[NS];
function saveSettings(patch = {}) {
    if(Object.hasOwn(patch,'serverEnabled') && controller.state().busy)throw Error('진행 중인 작업이 끝난 뒤 실행 위치를 바꿔 줘.');
    if(Object.hasOwn(patch,'selectionFocus') || Object.hasOwn(patch,'mode'))controller.clearRecall();
    extension_settings[NS] = normalizeSettings({ ...extension_settings[NS], ...patch });
    extension_settings[NS].cacheNamespace ||= makeId();
    saveSettingsDebounced(); clearPrompts();controller.invalidateEmbeddingCounts();
}
function chatContext() {
    const c = getContext(), char = c.characters?.[c.characterId];
    const id = c.getCurrentChatId?.() || c.chatId;
    return { key: id && (c.groupId || char?.avatar) ? JSON.stringify([c.groupId || char.avatar, id]) : '',
        name: c.groupId ? c.name2 || '그룹 대화' : `${c.name2 || ''} × ${c.name1 || ''}`, messages: c.chat || [] };
}
function chatSettings() { return getContext().chatMetadata?.[NS] || {}; }
function primaryBook() {
    const c = getContext();
    return (globalThis.archiveLoreFork ? c.chatMetadata?.[METADATA_KEY] : '') || c.characters?.[c.characterId]?.data?.extensions?.world || c.chatMetadata?.[METADATA_KEY] || '';
}
function target() { const route=globalThis.archiveLoreMemoryBooks?.route?.(); if(route)return route.name; const s=chatSettings(); return Object.hasOwn(s,'target') ? s.target : primaryBook(); }
function books() {
    const route=globalThis.archiveLoreMemoryBooks?.route?.();
    if(route)return [...(globalThis.archiveLoreMemoryBooks.books() || [])].filter(n=>world_names.includes(n));
    let selected = chatSettings().books;
    if (globalThis.archiveLoreFork && (chatSettings().nativeFormat || !chatSettings().target)) {
        const nativeBooks = [...(globalThis.archiveLoreMemoryBooks?.books() || [])];
        // Once using native books, follow the current Memory Books binding.
        // The migration's old snapshot must not keep a replaced book in search.
        if (nativeBooks.length) selected = nativeBooks;
    }
    if(globalThis.archiveLoreFork && !selected?.length)selected=[target()].filter(Boolean);
    return [...new Set(Array.isArray(selected) ? selected : [target()].filter(Boolean))].filter(n => world_names.includes(n));
}
async function saveChatSettings(patch) {
    const c = getContext(); if (!chatContext().key) throw new Error('채팅방에서 설정해 줘.');
    if (controller.state().busy) throw new Error('작업이 끝난 뒤 설정을 바꿔 줘.');
    c.chatMetadata[NS] = { ...chatSettings(), ...patch }; await c.saveMetadata(); clearPrompts();controller.invalidateEmbeddingCounts();
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
    getContext().setExtensionPrompt(GUIDANCE_PROMPT,'',extension_prompt_types.IN_CHAT,1,false);
    recalled=new Set(); activeBooks=[];
}
function error(error) {
    if(error?.name === 'AbortError') return;
    toastr.error(error?.message || '작업을 완료하지 못했어.','Archive Lore');
}
const diagnosticStore=createDiagnosticStore();
const diagnostics = createDiagnostics({store:diagnosticStore,
    detailed:()=>settings()?.diagnosticsDetailed===true,
    secrets:()=>[settings()?.embeddingKey,...Object.values(settings()?.embeddingKeys || {})],
    warning:message=>toastr.warning(message,'Archive Lore'),
});
let pendingGeneration = null, generationEpoch = 0, generationStopped = false;
const serverCall=createServerClient({headers:getRequestHeaders});
const vectorStore=serverVectorStore({local:createVectorStore(),call:serverCall,enabled:()=>!!settings()?.serverEnabled});
const searchViewListeners=new Set();
function notifySearchViews(){for(const listener of searchViewListeners){try{listener();}catch(e){console.warn('[Archive Lore] View refresh failed',e);}}}
const localController = createLoreController({
    diagnostics,profileInfo:()=>{const profiles=getContext().extensionSettings?.connectionManager?.profiles || [];return profiles.filter(p=>[settings().profile,settings().searchProfile,getContext().extensionSettings?.connectionManager?.selectedProfile].includes(p.id)).map(p=>({id:p.id,name:p.name,model:p.model}));},
    settings, context:chatContext, books, target, initialStart:()=>chatSettings().initialStart || 0,
    ensureBook, loadBook, saveBook,
    generating:()=>generationInFlight || writing,
    hideRange:async(range,key)=>{
        if(chatContext().key!==key)throw Error('채팅방이 바뀌어서 숨기기를 멈췄어.');
        if(!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<range.start||range.end>=chatContext().messages.length)throw Error('숨길 메시지 범위를 확인해 줘.');
        await executeSlashCommands(`/hide ${range.start}-${range.end}`);
        if(chatContext().key!==key)throw Error('채팅방이 바뀌어서 숨기기를 멈췄어.');
        if(chatContext().messages.slice(range.start,range.end+1).some(m=>!m.is_system))throw Error('기억은 저장했지만 자동 숨기기에 실패했어. 수집 버튼으로 재시도해 줘.');
    },
    newEntry:data=>{const entry=createWorldInfoEntry('',data);if(!entry)throw new Error('새 기억 항목을 만들 수 없어.');return entry;},
    store:vectorStore, embed:(config,text,query,signal)=>config.serverEnabled?serverCall('/embedding',{settings:config,text,query},{signal}).then(r=>r.vector):embed(config,text,query,signal),
    ask:(profile,system,data,signal,tokens)=>ask(getContext(),profile,system,data,signal,tokens),
    countTokens:text=>getContext().getTokenCountAsync(text,0),
    changed:()=>{notifySearchViews();void ui?.refresh().catch(error);if(autoPending&&!controller.state().busy&&!generationInFlight&&!writing)scheduleAutomatic();},
});
const serverInput=async(kind,options,report=async()=>{})=>{
        const step=async(name,work)=>{const start=Date.now();try{return await work();}finally{await report(name,Date.now()-start);}};
        if(globalThis.archiveLoreUndoing)throw Error('직전 수집 되돌리기가 끝난 뒤 실행해 줘.');
        const key=chatContext().key;if(!key)throw Error('채팅방에서 실행해 줘.');
        if(kind==='collect')await ensureBook();
        const c=getContext();if(typeof c.saveChat!=='function')throw Error('실리태번 대화 저장 기능을 찾을 수 없어.');await step('save-chat',()=>c.saveChat());
        if(chatContext().key!==key)throw Error('채팅방이 바뀌어서 접수하지 않았어.');
        const config=normalizeSettings(settings()),templates={};
        if(kind!=='index' && !(kind==='recall' && config.mode==='embedding')){
            templates.collection=await step('collection-profile',()=>profileTemplate(c,config.profile,proxies));
            templates.search=config.searchProfile?await step('search-profile',()=>profileTemplate(c,config.searchProfile,proxies)):templates.collection;
        }
        if(chatContext().key!==key)throw Error('채팅방이 바뀌어서 접수하지 않았어.');
        const data={entries:{}},entryTemplate=createWorldInfoEntry('',data);
        const context=await step('snapshot',()=>serverChatSnapshot(chatContext()));
        return {context,chat:{group:!!c.groupId,id:c.getCurrentChatId?.()||c.chatId,avatar:c.characters?.[c.characterId]?.avatar},settings:config,templates,books:books(),target:target(),initialStart:chatSettings().initialStart||0,options,entryTemplate};
};
const controller=createServerController({local:localController,enabled:()=>!!settings()?.serverEnabled,settings,context:chatContext,call:serverCall,
    cancelBackground:()=>backgroundRecall.cancel(),
    changed:()=>{notifySearchViews();void ui?.refresh().catch(error);if(autoPending&&!controller.state().busy&&!generationInFlight&&!writing)scheduleAutomatic();},
    generating:()=>generationInFlight||writing,countTokens:text=>getContext().getTokenCountAsync(text,0),
    input:serverInput,
    sync:async job=>{
        vectorStore.clear();
        if(job.chatKey!==chatContext().key)return;
        for(const source of job.hidden || [])if(matchesRange(source,chatContext().messages)){
            const indices=(source.indices || []).filter(i=>!chatContext().messages[i]?.is_system);let start=null,end=null;
            const hide=async()=>{if(start!==null){if(job.chatKey!==chatContext().key)throw new DOMException('채팅방 변경','AbortError');await executeSlashCommands(`/hide ${start}-${end}`);}};
            for(const index of indices){if(start===null){start=index;end=index;}else if(index===end+1)end=index;else {await hide();start=end=index;}}await hide();
        }
        await syncServerBooks(job,{loadBook,cache:worldInfoCache,emit:(...args)=>eventSource.emit(event_types.WORLDINFO_UPDATED,...args)});
        if(!generationInFlight)clearPrompts();
    },
});
const backgroundRecall=createBackgroundRecall({
    settings:()=>normalizeSettings(settings()),context:chatContext,input:serverInput,call:serverCall,
    countTokens:text=>getContext().getTokenCountAsync(text,0),
    relay:()=>globalThis.sillyRelayPreparation,
    supported:type=>!!event_types.GENERATE_AFTER_DATA && !!event_types.CHAT_COMPLETION_SETTINGS_READY
        && !getContext().groupId && getContext().mainApi==='openai' && [undefined,'normal','regenerate','swipe'].includes(type),
    tokenizer:async()=>{const module=await import('../../../tokenizers.js');return module.getTokenizerModel();},
    accept:job=>controller.acceptBackgroundRecall(job),
});
const diagnosticView={
    async list(key){const local=await diagnostics.list(key);return settings()?.serverEnabled?[...local,...await serverCall('/logs/list',{chatKey:key})].sort((a,b)=>a.started.localeCompare(b.started)):local;},
    async export(key,mode){const original=await diagnostics.export(key,mode);if(!settings()?.serverEnabled)return original;const server=await serverCall('/logs/export',{chatKey:key,mode},{blob:true});return new Blob([original,'\n\n===== SERVER JOB DIAGNOSTICS =====\n',server],{type:'text/plain;charset=utf-8'});},
};
function scheduleAutomatic() {
    if(globalThis.archiveLoreFork || generationStopped)return;
    autoPending=true;
    clearTimeout(autoTimer);
    autoTimer=setTimeout(async()=>{
        if(!settings().autoCollect){autoPending=false;return;}
        if(generationInFlight||writing||controller.state().busy)return;
        autoPending=false;
        const context=chatContext(),stamp=JSON.stringify([context.key,context.messages.map(m=>[m.mes,m.is_user,m.swipe_id])]);
        if(stamp===autoAttempt)return;
        autoAttempt=stamp;
        try{await controller.maybeAutoCollect();}catch(e){error(e);}
    },250);
}
async function saveRecord(id, changes) {
    if(controller.state().busy || writing)throw new Error('진행 중인 작업이 끝난 뒤 수정해 줘.');
    const [book,uid]=JSON.parse(id); if(!books().includes(book))throw new Error('현재 검색 대상이 아닌 로어북이야.');
    const key=chatContext().key; writing=true;
    try {
        const data=await loadBook(book), entry=data.entries[uid]; if(!entry)throw new Error('기억 항목이 없어졌어.');
        const visible=materializeEntry(entry,chatContext().messages);
        if(visible[NS]?.sideCategory){
            const prior=structuredClone(entry[NS]);
            let facts=structuredClone(visible[NS].facts || []), content, storyDate=visible[NS].storyDate;
            if(visible[NS].sideCategory === 'relationship') {
                const r=changes.relationship;
                if(!r)throw new Error('관계 날짜 입력을 확인해 줘.');
                const label=relationshipLabel(r.label), phase=relationshipPhase(label,{kind:r.kind,since:r.since});
                if(r.today!==null && dateDay(r.today)===null)throw new Error('현재 RP 날짜를 확인해 줘.');
                if(phase.since && r.today && dateDay(phase.since)>dateDay(r.today))throw new Error('시작일이 현재 RP 날짜보다 늦어. 날짜를 확인해 줘.');
                storyDate=r.today;
                facts=[{id:facts[0]?.id || makeId(),text:label,relationship:phase,manual:true}];
                content=formatRelationship(facts[0],storyDate);
                const messages=chatContext().messages;
                const source=sourceRange(messages,messages.length-1,messages.length-1);
                data[NS]={...data[NS],storyDates:[...(data[NS]?.storyDates || []),{date:storyDate,source,manual:true}]};
            } else {
                for(const change of changes.facts){const fact=facts.find(f=>f.id===change.id);if(!fact || !change.text.trim())throw new Error('사이드 항목을 빈칸으로 저장할 수 없어.');fact.text=change.text.trim();}
                content=facts.map(f=>`• ${f.text}`).join('\n');
            }
            if(content!==entry.content || storyDate!==visible[NS].storyDate || JSON.stringify(facts)!==JSON.stringify(visible[NS].facts)){
                const messages=chatContext().messages;
                entry[NS]={...visible[NS],facts,storyDate,source:sourceRange(messages,messages.length-1,messages.length-1),
                    history:[...(prior.history||[]),sideSnapshot(entry)]};
                entry.content=content;
            }
        } else { if(!changes.content?.trim())throw new Error('빈 기억은 저장할 수 없어.');entry.content=changes.content.trim(); }
        entry.constant=changes.core;
        if(chatContext().key!==key)throw new Error('채팅방이 바뀌어서 저장하지 않았어.');
        await saveBook(book,data);clearPrompts();
    } finally {writing=false;if(autoPending)scheduleAutomatic();}
}
async function intercept(_chat,_contextSize,abort,type) {
    const started=Date.now();
    const epoch=++generationEpoch;
    clearPrompts();
    generationInFlight=true;
    const context=chatContext(),searchChoice=JSON.stringify([settings().mode,settings().selectionFocus]);
    const trace=diagnostics.begin({kind:'generation',chatKey:context.key,chatName:context.name,mode:settings().mode,generationType:type,messageCount:context.messages.length});
    if(!settings().enabled || !context.key || !books().length || ['quiet','impersonate'].includes(type)) {
        await trace.finish('skipped',{enabled:settings().enabled,chat:!!context.key,books:books(),type});return;
    }
    if(pendingGeneration)await pendingGeneration.trace.finish('superseded',{nextAttempt:trace.id});
    pendingGeneration=null;
    try {
        if(writing)throw new Error('기억 저장이 끝난 뒤 다시 전송해 줘.');
        const result=await backgroundRecall.prepare(type,trace) || await controller.recall({kind:'generation',generationType:type,trace});
        if(epoch!==generationEpoch || generationStopped || chatContext().key!==context.key)throw new DOMException('생성이 중지되어 검색 결과를 주입하지 않았어.','AbortError');
        if(searchChoice!==JSON.stringify([settings().mode,settings().selectionFocus]))throw Error('검색 중 기억 선별 설정이 바뀌어서 주입하지 않았어. 다시 시도해 줘.');
        activeBooks=result.books;recalled=result.selected;
        getContext().setExtensionPrompt(PROMPT,result.text,extension_prompt_types.IN_CHAT,1,false);
        getContext().setExtensionPrompt(CORE_PROMPT,result.core,extension_prompt_types.IN_CHAT,1,false);
        getContext().setExtensionPrompt(GUIDANCE_PROMPT,result.guidance||'',extension_prompt_types.IN_CHAT,1,false);
        if(!result.deferred)controller.markInjected(Date.now()-started);
        await trace.event(result.deferred?'injection.reserved':'injection.installed',{timings:controller.state().lastRecall?.timings,slots:[{name:PROMPT,text:result.text,position:'IN_CHAT',depth:1},{name:CORE_PROMPT,text:result.core,position:'IN_CHAT',depth:1},{name:GUIDANCE_PROMPT,text:result.guidance||'',position:'IN_CHAT',depth:1}],selected:[...result.selected]});
        if(epoch===generationEpoch && !generationStopped)pendingGeneration={trace,key:context.key,messageCount:context.messages.length};
    } catch(e){if(epoch===generationEpoch)backgroundRecall.cancel();await trace.finish(e.name==='AbortError'?'stopped':'error',{message:e.message});if(epoch===generationEpoch && chatContext().key===context.key){generationInFlight=false;clearPrompts();abort(true);error(e);}}
}
function nativePolicy(lists) {
    // Per-chat source exclusions prevent copied books and retained originals firing together.
    const excluded=new Set(chatSettings().nativeExcludedBooks || []);
    if(excluded.size)for(const list of Object.values(lists))if(Array.isArray(list))for(let i=0;i<list.length;i++){
        if(excluded.has(list[i].world))list[i]={...list[i],disable:true};
    }
    if(!settings().enabled)return;
    const selectedBooks=books(), messages=chatContext().messages;
    // Modify transient WI scan copies only. Stored keys and entry enabled state are untouched.
    for(const list of Object.values(lists))if(Array.isArray(list))for(let i=0;i<list.length;i++){
        if(!selectedBooks.includes(list[i].world))continue;
        list[i]=materializeEntry(list[i],messages);
    }
    for(const list of Object.values(lists))if(Array.isArray(list))for(const book of selectedBooks){
        const mapped=new Map(consolidationView(list.filter(e=>e.world===book),messages).map(e=>[String(e.uid),e]));
        for(let i=0;i<list.length;i++)if(list[i].world===book)list[i]=mapped.get(String(list[i].uid)) || list[i];
    }
    for(const list of Object.values(lists))if(Array.isArray(list))for(const entry of list)if(activeBooks.includes(entry.world)&&isCore(entry))entry.disable=true;
    applyNativePolicy(lists,{enabled:true,keywordActivation:settings().keywordActivation,books:selectedBooks,messages,selected:recalled});
    if(pendingGeneration?.key===chatContext().key)void pendingGeneration.trace.event('native-world-info.policy',{keywordActivation:settings().keywordActivation,entries:Object.values(lists).filter(Array.isArray).flat().filter(e=>selectedBooks.includes(e.world)).map(e=>({book:e.world,uid:e.uid,disabled:e.disable,core:isCore(e)}))});
}
function init() {
    saveSettings();
    void diagnosticStore.ready().catch(error);
    ui=createLoreUI({settings,saveSettings,controller,context:chatContext,error,diagnostics:diagnosticView,translate,
        retrievalOnly:!!globalThis.archiveLoreFork,openHome:globalThis.archiveLoreFork?()=>globalThis.archiveLoreMemoryBooks.open():null,
        serverCheck:()=>serverCall('/status'),serverJobs:()=>controller.jobs(),
        embeddingTest:async()=>{const config=normalizeSettings(settings());return config.serverEnabled?serverCall('/embedding-test',{settings:config}):{dimensions:(await embed(config,'Archive Lore connection test.',false)).length,model:config.embeddingModel};},
        translation:(book,entry)=>linkedTranslation(extension_settings,book,entry),
        profiles:()=>getContext().extensionSettings?.connectionManager?.profiles || [],
        bookNames:()=>[...world_names],books,target,
        setTarget:async name=>saveChatSettings({target:name,books:[...new Set([...books(),name].filter(Boolean))]}),
        setBooks:async names=>saveChatSettings({books:names}),
        setInitialStart:async n=>{if(!Number.isInteger(n)||n<0||n>chatContext().messages.length)throw new Error('시작 번호를 확인해 줘.');await saveChatSettings({initialStart:n});},
        saveRecord,
    });
    if(settings().serverEnabled){void serverCall('/status').catch(error);void controller.restore(true).catch(error);}
    if(!globalThis.archiveLoreFork){
    const settingsNode=document.createElement('div'); settingsNode.id='archive-lore-settings';settingsNode.className='extension_container';
    settingsNode.innerHTML='<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b class="al-brand">'+loreIcon('book')+'Archive Lore</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content" data-al-settings></div></div>';
    document.querySelector('#extensions_settings2')?.append(settingsNode);
    ui.mountSettings(settingsNode.querySelector('[data-al-settings]'));
    const menu=document.createElement('div');menu.id='archive-lore-menu';menu.className='list-group-item flex-container flexGap5 interactable';menu.tabIndex=0;menu.setAttribute('role','button');
    menu.innerHTML=`${loreIcon('book')}<span>아카이브 로어</span>`;
    menu.addEventListener('click',()=>void ui.open().catch(error));menu.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();void ui.open().catch(error);}});
    document.querySelector('#extensionsMenu')?.append(menu);
    }
    globalThis.archiveLoreSearch={subscribe:listener=>{searchViewListeners.add(listener);return ()=>searchViewListeners.delete(listener);},openSettings:()=>ui.openSettings(),controller,settings,saveSettings,books,target,loadBook,saveBook,store:vectorStore,diagnostics:diagnosticView,context:chatContext,clearPrompts};
    globalThis.archiveLoreInterceptor=intercept;
    if(event_types.GENERATE_AFTER_DATA)eventSource.on(event_types.GENERATE_AFTER_DATA,(data,dryRun)=>backgroundRecall.capture(data,dryRun));
    if(event_types.CHAT_COMPLETION_SETTINGS_READY)eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY,data=>backgroundRecall.attach(data));
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED,nativePolicy);
    eventSource.on(event_types.WORLDINFO_UPDATED,()=>controller.invalidateEmbeddingCounts());
    for(const event of [event_types.CHAT_CHANGED,event_types.MESSAGE_EDITED,event_types.MESSAGE_DELETED,event_types.MESSAGE_SWIPED,event_types.MESSAGE_RECEIVED])if(event)eventSource.on(event,()=>controller.invalidateEmbeddingCounts());
    eventSource.on(event_types.CHAT_CHANGED,()=>{backgroundRecall.detach();clearTimeout(autoTimer);autoPending=false;autoAttempt='';generationInFlight=false;controller.detach();controller.discardDraft();if(pendingGeneration)void pendingGeneration.trace.event('generation.chat-changed');pendingGeneration=null;controller.clearRecall();clearPrompts();void ui.refresh().catch(error);});
    for(const event of [event_types.MESSAGE_EDITED,event_types.MESSAGE_DELETED,event_types.MESSAGE_SWIPED])if(event)eventSource.on(event,()=>{backgroundRecall.cancel();controller.cancel();clearPrompts();});
    if(event_types.GENERATION_STARTED)eventSource.on(event_types.GENERATION_STARTED,(_type,_options,dryRun)=>{if(dryRun)return;generationStopped=false;generationInFlight=true;clearTimeout(autoTimer);});
    if(event_types.MESSAGE_RECEIVED)eventSource.on(event_types.MESSAGE_RECEIVED,async index=>{
        scheduleAutomatic();
        const run=pendingGeneration,context=chatContext();if(!run || context.key!==run.key)return;
        const message=context.messages[Number(index)];
        if(message && !message.is_user)await run.trace.event('rp.response',{index:Number(index),name:message.name,text:message.mes,swipeId:message.swipe_id});
    });
    for(const name of ['GENERATION_ENDED','GENERATION_STOPPED'])if(event_types[name])eventSource.on(event_types[name],async()=>{
        generationInFlight=false;
        if(name==='GENERATION_STOPPED'){
            backgroundRecall.cancel();generationStopped=true;generationEpoch++;clearTimeout(autoTimer);autoPending=false;
            controller.cancel();controller.clearRecall();clearPrompts();
        }else if(!generationStopped){void backgroundRecall.completed().catch(error);scheduleAutomatic();}
        const run=pendingGeneration;if(!run)return;pendingGeneration=null;
        const context=chatContext();
        await run.trace.event(name==='GENERATION_STOPPED'?'rp.stopped':'rp.ended',{sameChat:context.key===run.key,messageCount:context.messages.length,latestAssistant:context.key===run.key?context.messages.map((m,index)=>({index,name:m.name,text:m.mes,is_user:m.is_user,is_system:m.is_system})).filter(m=>!m.is_user&&!m.is_system).slice(-1):[]});
        await run.trace.finish(name==='GENERATION_STOPPED'?'stopped':'completed');void ui.refresh().catch(error);
    });
    if(!globalThis.archiveLoreFork)for(const [name,callback,help] of [
        ['al','open','아카이브 로어 열기'],['al-collect','collect','마지막 수집 다음부터 수집. 선택 범위: /al-collect 0-19'],
        ['al-catchup','catchup','지난 대화를 나눠 수집: /al-catchup 0-245 40'],
        ['al-embed','index','남은 기억 임베딩'],['al-recall','recall','기억 검색 미리보기'],['al-stop','cancel','아카이브 로어 작업 중지'],
    ])SlashCommandParser.addCommandObject(SlashCommand.fromProps({name,helpString:help,
        unnamedArgumentList:['al-collect','al-catchup'].includes(name)?[SlashCommandArgument.fromProps({description:'시작-끝 메시지 번호',typeList:[ARGUMENT_TYPE.STRING],isRequired:false})]:[],
        callback:async(_args,value)=>{try{
            if(callback==='open')await ui.open();
            else if(callback==='catchup'){
                const match=String(value||'').trim().match(/^(\d+)\s*-\s*(\d+)\s+(\d+)$/);if(!match)throw Error('/al-catchup 0-245 40처럼 입력해 줘.');
                await controller.collect({start:Number(match[1]),end:Number(match[2]),batchSize:Number(match[3])});
            }
            else if(callback==='collect' && value?.trim()){
                const match=String(value).trim().match(/^(\d+)\s*-\s*(\d+)$/);if(!match)throw new Error('범위는 0-19처럼 입력해 줘.');await controller.collect({start:Number(match[1]),end:Number(match[2])});
            } else await controller[callback]();
            return controller.state().status;
        }catch(e){error(e);throw e;}},
    }));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
