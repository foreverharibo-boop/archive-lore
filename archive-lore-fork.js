// Archive Lore, based on Memory Books by Aiko Hanasaki — AGPL-3.0-only.
import { getContext, extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../slash-commands/SlashCommandArgument.js';
import { nextCollectionRange } from './lore-native-progress.js';
import { shouldIndexBookUpdate } from './lore-automation.js';
import { createSearchToolsPanel } from './lore-native-tools.js';
import { applyNativeTheme } from './lore-native-preferences.js';
import { installSettingsHelp } from './lore-help.js';

globalThis.archiveLoreFork=true;
await import('./index.build.js');
await globalThis.archiveLoreMemoryBooks.initialize();
await import('./archive-lore.js');
const native=globalThis.archiveLoreMemoryBooks;
const search=()=>globalThis.archiveLoreSearch;
installSettingsHelp({
    read:()=>extension_settings.STMemoryBooks?.moduleSettings?.archiveLoreDetailedHelp,
    write:value=>{
        extension_settings.STMemoryBooks.moduleSettings ||= {};
        extension_settings.STMemoryBooks.moduleSettings.archiveLoreDetailedHelp=value;
        saveSettingsDebounced();
    },
});
const fail=e=>toastr.error(e.message,'Archive Lore');
const download=(text,name,type='text/plain;charset=utf-8')=>{
    const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
let generating=false,indexPending=false,indexTimer;

function themedPopup(content,options){
    const popup=new Popup(content,POPUP_TYPE.TEXT,'',options);applyNativeTheme(popup.dlg,native.settings());return popup;
}

async function openRange(){
    const c=getContext(),{start,end}=nextCollectionRange(c.chatMetadata.STMemoryBooks,c.chat.length);
    const node=document.createElement('div');node.className='al-search-tools';node.innerHTML='<h3>범위 지정 수집</h3><p>실리태번 메시지 번호로 범위를 지정합니다. 한 번 수집은 하나의 기억으로, 나눠 수집은 여러 기억으로 저장합니다.</p>';
    const fields={};for(const [key,label,value] of [['start','시작 번호',start],['end','끝 번호',end],['interval','나눠 수집할 메시지 수',20]]){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.dataset.alHelpKey='range-'+key;input.type='number';input.className='text_pole';input.min=key==='interval'?'1':'0';input.value=value;l.append(input);node.append(l);fields[key]=input;}
    const status=document.createElement('p');status.setAttribute('role','status');
    const actions=document.createElement('div');actions.className='al-range-actions';node.append(actions);
    for(const [label,batch] of [['한 번에 수집',false],['나눠서 수집',true]]){const b=document.createElement('button');b.type='button';b.className='menu_button';b.textContent=label;b.onclick=async()=>{const values=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,Number(v.value)]));if(Object.values(values).some(n=>!Number.isInteger(n))||values.start<0||values.end<values.start||values.end>=c.chat.length||values.interval<1){status.textContent='시작·끝 번호와 분할 개수를 확인해 주세요.';return;}b.disabled=true;try{if(getContext().chat!==c.chat)throw Error('채팅이 변경되었습니다. 다시 열어 주세요.');if(batch)await native.catchup(values);else {const ok=await native.collectRange(values.start,values.end);if(!ok){status.textContent='수집이 완료되지 않았습니다. 취소 여부와 메모리북 알림을 확인해 주세요.';return;}}const last=getContext().chatMetadata.STMemoryBooks?.highestMemoryProcessed;status.textContent=Number.isInteger(last)?`저장된 수집 위치: #${last} · 다음 수집은 #${last+1}부터 시작합니다.`:'저장된 수집 위치가 없습니다. 메모리북 알림을 확인해 주세요.';await native.refresh();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}};actions.append(b);}
    node.append(status);await themedPopup(node,{wide:true,okButton:false,cancelButton:'닫기'}).show();
}

async function openRecords(){
    const node=document.createElement('div');node.className='al-search-tools';
    const h=document.createElement('h3');h.textContent='저장된 기억';node.append(h);
    const help=document.createElement('p');help.textContent='저장된 본문을 확인하는 목록입니다. 수정·재생성은 실리태번 로어북 편집기에서 해당 항목을 열어 실행해 주세요.';node.append(help);
    for(const name of search().books()){
        const book=await search().loadBook(name);
        for(const entry of Object.values(book.entries)){
            const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
            summary.textContent=`${entry.disable?'[비활성] ':''}${entry.comment || '제목 없음'} · ${name}`;pre.textContent=entry.content;details.append(summary,pre);node.append(details);
        }
    }
    await themedPopup(node,{wide:true,large:true,allowVerticalScrolling:true,okButton:false,cancelButton:'닫기'}).show();
}

async function openTools(){
    const panel=createSearchToolsPanel({search:search(),download});
    const updated=name=>{if(search().books().includes(name))void panel.refresh();};
    eventSource.on(event_types.WORLDINFO_UPDATED,updated);
    try{await themedPopup(panel.node,{wide:true,large:true,allowVerticalScrolling:true,okButton:false,cancelButton:'닫기'}).show();}
    finally{panel.dispose();eventSource.removeListener(event_types.WORLDINFO_UPDATED,updated);}
}

function queueIndex(){
    if(!indexPending)return;
    clearTimeout(indexTimer);
    indexTimer=setTimeout(async()=>{
        if(!search()?.settings().enabled || search().settings().autoEmbed===false){indexPending=false;return;}
        if(generating||native.busy()||search().controller.state().busy){queueIndex();return;}
        indexPending=false;
        const key=search().context?.().key;
        search().autoEmbeddingState={key,status:'running'};
        try{await search().controller.index();search().autoEmbeddingState={key,status:'done'};}
        catch(e){search().autoEmbeddingState={key,status:e.name==='AbortError'?'cancelled':'failed'};if(e.name!=='AbortError')fail(e);}
        finally{native.refreshHomeStatus?.();if(indexPending)queueIndex();}
    },800);
}

function setup(){
    if(!search()){setTimeout(setup,50);return;}
    search().openTools=openTools;
    search().openRecords=openRecords;search().openRange=openRange;
    const container=document.createElement('div');container.className='extension_container al-fork-settings';
    container.innerHTML='<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Archive Lore</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><p>메모리북의 수집·관리 기능과 아카이브 검색을 함께 사용합니다.</p><button type="button" class="menu_button" data-home>기능별 메뉴 열기</button><button type="button" class="menu_button" data-search>검색·임베딩 설정</button></div></div>';
    container.querySelector('[data-home]').textContent='아카이브 로어 열기';
    const drawer=container.querySelector('.inline-drawer-content'),actions=document.createElement('div');actions.className='al-extension-actions';
    for(const button of [...drawer.querySelectorAll('button')])actions.append(button);drawer.append(actions);
    container.querySelector('[data-home]').onclick=()=>native.open().catch(fail);container.querySelector('[data-search]').onclick=()=>search().openSettings();document.querySelector('#extensions_settings2')?.append(container);
    eventSource.on(event_types.WORLDINFO_UPDATED,(name,_data,metadata)=>{if(shouldIndexBookUpdate(name,search().books(),metadata)){indexPending=true;queueIndex();native.refreshHomeStatus?.();}});
    eventSource.on(event_types.GENERATION_STARTED,(_type,_options,dryRun)=>{if(!dryRun)generating=true;});
    eventSource.on(event_types.GENERATION_ENDED,()=>{generating=false;queueIndex();});
    eventSource.on(event_types.GENERATION_STOPPED,()=>{generating=false;indexPending=false;clearTimeout(indexTimer);native.stop();});
    eventSource.on(event_types.CHAT_CHANGED,()=>{indexPending=false;clearTimeout(indexTimer);});
    for(const [name,fn,help] of [['al',()=>native.open(),'아카이브 로어 기능별 메뉴'],['al-embed',()=>search().controller.index(),'남은 기억 임베딩'],['al-recall',()=>search().controller.recall(),'기억 검색 미리보기'],['al-stop',()=>{native.stop();search().controller.cancel();},'수집·검색 작업 중지']])SlashCommandParser.addCommandObject(SlashCommand.fromProps({name,helpString:help,callback:async()=>{await fn();return '';}}));
    for(const name of ['al-collect','al-catchup'])SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name,helpString:name==='al-collect'?'기억 수집. 선택 범위: /al-collect 0-19':'나눠 수집: /al-catchup 0-245 40',
        unnamedArgumentList:[SlashCommandArgument.fromProps({description:'시작-끝 (분할 개수)',typeList:[ARGUMENT_TYPE.STRING],isRequired:false})],
        callback:async(_args,value)=>{
            const input=String(value || '').trim();
            if(!input && name==='al-collect'){await native.collect();return '';}
            const match=input.match(name==='al-collect'?/^(\d+)\s*-\s*(\d+)$/:/^(\d+)\s*-\s*(\d+)\s+(\d+)$/);
            if(!match)throw Error(name==='al-collect'?'/al-collect 0-19처럼 입력해 주세요.':'/al-catchup 0-245 40처럼 입력해 주세요.');
            if(name==='al-collect')await native.collectRange(Number(match[1]),Number(match[2]));
            else await native.catchup({start:Number(match[1]),end:Number(match[2]),interval:Number(match[3])});
            return '';
        },
    }));
}
setup();
