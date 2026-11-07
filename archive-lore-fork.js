// Archive Lore, based on Memory Books by Aiko Hanasaki — AGPL-3.0-only.
import { getContext, extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { METADATA_KEY, world_names, updateWorldInfoList } from '../../../world-info.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../slash-commands/SlashCommandArgument.js';
import { migrateLegacyChat, migrationSideTemplates } from './lore-migration.js';
import { embeddingKey } from './lore-api.js';
import { embeddingChunks, entryId } from './lore-core.js';

globalThis.archiveLoreFork=true;
await import('./index.build.js');
await globalThis.archiveLoreMemoryBooks.initialize();
await import('./archive-lore.js');
const native=globalThis.archiveLoreMemoryBooks;
const search=()=>globalThis.archiveLoreSearch;
const fail=e=>toastr.error(e.message,'Archive Lore');
const download=(text,name,type='text/plain;charset=utf-8')=>{
    const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
let migrating=false,generating=false,indexPending=false,indexTimer;

async function openRange(){
    const c=getContext(),start=(c.chatMetadata.STMemoryBooks?.highestMemoryProcessed ?? -1)+1,end=c.chat.length-1;
    const node=document.createElement('div');node.className='al-search-tools';node.innerHTML='<h3>범위 지정 수집</h3><p>번호는 실리태번 메시지 번호야. 한 번 수집은 하나의 기억으로, 나눠 수집은 여러 기억으로 저장해.</p>';
    const fields={};for(const [key,label,value] of [['start','시작 번호',start],['end','끝 번호',end],['interval','나눠 수집할 메시지 수',20]]){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='number';input.className='text_pole';input.min=key==='interval'?'1':'0';input.value=value;l.append(input);node.append(l);fields[key]=input;}
    const status=document.createElement('p');status.setAttribute('role','status');
    for(const [label,batch] of [['한 번에 수집',false],['나눠서 수집',true]]){const b=document.createElement('button');b.type='button';b.className='menu_button';b.textContent=label;b.onclick=async()=>{const values=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,Number(v.value)]));if(Object.values(values).some(n=>!Number.isInteger(n))||values.start<0||values.end<values.start||values.end>=c.chat.length||values.interval<1){status.textContent='시작·끝 번호와 분할 개수를 확인해 줘.';return;}b.disabled=true;try{if(getContext().chat!==c.chat)throw Error('채팅이 바뀌었어. 다시 열어 줘.');if(batch)await native.catchup(values);else await native.collectRange(values.start,values.end);status.textContent='작업이 끝났어. 수집 위치와 메모리북 알림을 확인해 줘.';}catch(e){status.textContent=e.message;}finally{b.disabled=false;}};node.append(b);}
    node.append(status);await new Popup(node,POPUP_TYPE.TEXT,'',{wide:true,okButton:false,cancelButton:'닫기'}).show();
}

async function openRecords(){
    const node=document.createElement('div');node.className='al-search-tools';
    const h=document.createElement('h3');h.textContent='저장된 기억';node.append(h);
    const help=document.createElement('p');help.textContent='본문 확인용 목록이야. 수정·재생성은 실리태번 로어북 편집기에서 해당 항목을 열어 사용해.';node.append(help);
    for(const name of search().books()){
        const book=await search().loadBook(name);
        for(const entry of Object.values(book.entries)){
            const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
            summary.textContent=`${entry.disable?'[비활성] ':''}${entry.comment || '제목 없음'} · ${name}`;pre.textContent=entry.content;details.append(summary,pre);node.append(details);
        }
    }
    await new Popup(node,POPUP_TYPE.TEXT,'',{wide:true,large:true,allowVerticalScrolling:true,okButton:false,cancelButton:'닫기'}).show();
}

async function openTools(){
    const node=document.createElement('div');node.className='al-search-tools';
    node.innerHTML='<h3>검색·주입 확인</h3><p>임베딩은 저장된 기억을 검색할 준비를 하는 작업이야. 미리보기는 다음 답변에 넣을 기억을 선별해.</p><div class="al-tool-buttons"></div><p role="status"></p><pre></pre>';
    const state=node.querySelector('[role=status]'),output=node.querySelector('pre');
    const run=async(action)=>{try{state.textContent='처리 중…';await action();state.textContent=search().controller.state().status || '완료';}catch(e){state.textContent=e.message;}};
    const add=(label,action)=>{const b=document.createElement('button');b.type='button';b.className='menu_button';b.textContent=label;b.onclick=()=>run(action);node.querySelector('.al-tool-buttons').append(b);};
    add('남은 임베딩',()=>search().controller.index());
    add('지금 검색 미리보기',async()=>{const r=await search().controller.recall();output.textContent=[r.core,r.text].filter(Boolean).join('\n\n') || '선택된 기억 없음';});
    add('최근 주입',()=>{const r=search().controller.state().lastRecall;output.textContent=r?JSON.stringify(r,null,2):'아직 검색한 기억 없음';});
    add('진단 TXT 다운로드',async()=>download(await search().diagnostics.export(search().context().key,'all'),'archive-lore-diagnostics.txt'));
    add('서버 작업 내역',async()=>{output.textContent=JSON.stringify(await search().controller.jobs(),null,2);});
    add('중지',()=>search().controller.cancel());
    await new Popup(node,POPUP_TYPE.TEXT,'',{wide:true,large:true,allowVerticalScrolling:true,okButton:false,cancelButton:'닫기'}).show();
}

globalThis.archiveLoreMigration=async()=>{
    if(migrating || search().controller.state().busy || generating || native.busy())throw Error('진행 중인 작업이 끝난 뒤 이관해 줘.');
    migrating=true;globalThis.archiveLoreMigrating=true;search().controller.cancel();
    const c=getContext(),config=structuredClone(search().settings()),oldMeta=structuredClone(c.chatMetadata);
    const oldNativeSettings=structuredClone(extension_settings.STMemoryBooks);
    const originKey=search().context().key;
    const setKey='archive-lore-imported-sides';
    try{return await migrateLegacyChat({
        snapshot:()=>({key:search().context().key,chatId:String(c.getCurrentChatId?.() || c.chatId || ''),messages:structuredClone(c.chat),books:search().books(),target:search().target(),metadata:oldMeta,initialStart:oldMeta.archiveLore?.initialStart || 0,config,completed:oldMeta.archiveLore?.nativeFormat}),
        assertCurrent:key=>{if(search().context().key!==key)throw Error('채팅이 바뀌어서 이관을 멈췄어. 원본 책은 유지했어.');},
        load:search().loadBook,save:search().saveBook,
        backup:async data=>download(JSON.stringify({...data,searchSettings:{...config,embeddingKey:undefined,embeddingKeys:undefined}},null,2),'archive-lore-before-migration.json','application/json'),
        destination:async(from,key)=>{
            // Persist destination allocation before writing, so failed retries cannot create duplicate books.
            c.chatMetadata.archiveLoreMigration ||= {destinations:{}};
            const map=c.chatMetadata.archiveLoreMigration.destinations;
            if(map[from])return map[from];
            let name=from.slice(0,48)+' · AL',n=2;
            while(world_names.includes(name)||Object.values(map).includes(name))name=from.slice(0,45)+` · AL ${n++}`;
            map[from]=name;await c.saveMetadata();return name;
        },
        copyVectors:async(from,to,before,after)=>{
            for(const entry of Object.values(after.entries)){
                const original=before.entries[entry.uid];if(!original)continue;
                const oldChunks=embeddingChunks(original),newChunks=embeddingChunks(entry);
                for(const chunk of newChunks){const old=oldChunks.find(x=>x.text===chunk.text);if(!old)continue;
                    const vector=await search().store.get(await embeddingKey(config,entryId(from,entry.uid),old.text));
                    if(vector)await search().store.put(await embeddingKey(config,entryId(to,entry.uid),chunk.text),vector);
                }
            }
        },
        savePrompts:cfg=>native.saveMigrationPrompts(cfg,migrationSideTemplates(cfg,'archive-lore-imported'),setKey),
        commit:async(snapshot,copies,next)=>{
            await updateWorldInfoList();
            if(search().context().key!==originKey)throw Error('채팅이 바뀌어서 연결 변경을 멈췄어. 원본은 유지했어.');
            const target=copies.find(x=>x.from===snapshot.target)?.name || copies[0].name;
            const prior=structuredClone(c.chatMetadata);
            c.chatMetadata[METADATA_KEY]=target;
            c.chatMetadata.archiveLore={...c.chatMetadata.archiveLore,target,books:copies.map(x=>x.name),nativeExcludedBooks:copies.map(x=>x.from),nativeFormat:1};
            c.chatMetadata.STMemoryBooks={...c.chatMetadata.STMemoryBooks,sidePromptAfterMemorySetKey:setKey};
            if(next>0)c.chatMetadata.STMemoryBooks.highestMemoryProcessed=next-1;
            else delete c.chatMetadata.STMemoryBooks.highestMemoryProcessed;
            // This chat uses the copied book; manual global mode must not route new writes back to the source.
            c.chatMetadata.STMemoryBooks.manualLorebook=target;
            try{await c.saveMetadata();}catch(e){Object.keys(c.chatMetadata).forEach(k=>delete c.chatMetadata[k]);Object.assign(c.chatMetadata,prior);throw e;}
            search().clearPrompts();
        },
    });}catch(e){extension_settings.STMemoryBooks=oldNativeSettings;saveSettingsDebounced();throw e;}
    finally{migrating=false;globalThis.archiveLoreMigrating=false;}
};

function queueIndex(){
    if(!indexPending)return;
    clearTimeout(indexTimer);
    indexTimer=setTimeout(async()=>{
        if(!search()?.settings().enabled || search().settings().autoEmbed===false){indexPending=false;return;}
        if(migrating||generating||native.busy()||search().controller.state().busy){queueIndex();return;}
        indexPending=false;
        try{await search().controller.index();}catch(e){fail(e);}finally{if(indexPending)queueIndex();}
    },800);
}

function setup(){
    if(!search()){setTimeout(setup,50);return;}
    search().openTools=openTools;
    search().openRecords=openRecords;search().openRange=openRange;
    const container=document.createElement('div');container.className='extension_container';
    container.innerHTML='<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Archive Lore</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><p>메모리북의 수집·관리 기능과 아카이브 검색을 함께 사용해.</p><button type="button" class="menu_button" data-home>기능별 메뉴 열기</button><button type="button" class="menu_button" data-search>검색·임베딩 설정</button></div></div>';
    container.querySelector('[data-home]').onclick=()=>native.open().catch(fail);container.querySelector('[data-search]').onclick=()=>search().openSettings();document.querySelector('#extensions_settings2')?.append(container);
    eventSource.on(event_types.WORLDINFO_UPDATED,name=>{if(search().books().includes(name)){indexPending=true;queueIndex();}});
    eventSource.on(event_types.GENERATION_STARTED,()=>{generating=true;});
    for(const event of [event_types.GENERATION_ENDED,event_types.GENERATION_STOPPED])eventSource.on(event,()=>{generating=false;queueIndex();});
    eventSource.on(event_types.CHAT_CHANGED,()=>{indexPending=false;clearTimeout(indexTimer);});
    for(const [name,fn,help] of [['al',()=>native.open(),'아카이브 로어 기능별 메뉴'],['al-embed',()=>search().controller.index(),'남은 기억 임베딩'],['al-recall',()=>search().controller.recall(),'기억 검색 미리보기'],['al-stop',()=>{native.stop();search().controller.cancel();},'수집·검색 작업 중지']])SlashCommandParser.addCommandObject(SlashCommand.fromProps({name,helpString:help,callback:async()=>{await fn();return '';}}));
    for(const name of ['al-collect','al-catchup'])SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name,helpString:name==='al-collect'?'기억 수집. 선택 범위: /al-collect 0-19':'나눠 수집: /al-catchup 0-245 40',
        unnamedArgumentList:[SlashCommandArgument.fromProps({description:'시작-끝 (분할 개수)',typeList:[ARGUMENT_TYPE.STRING],isRequired:false})],
        callback:async(_args,value)=>{
            if(globalThis.archiveLoreMigrating)throw Error('이관이 끝난 뒤 수집해 줘.');
            const input=String(value || '').trim();
            if(!input && name==='al-collect'){await native.collect();return '';}
            const match=input.match(name==='al-collect'?/^(\d+)\s*-\s*(\d+)$/:/^(\d+)\s*-\s*(\d+)\s+(\d+)$/);
            if(!match)throw Error(name==='al-collect'?'/al-collect 0-19처럼 입력해 줘.':'/al-catchup 0-245 40처럼 입력해 줘.');
            if(name==='al-collect')await native.collectRange(Number(match[1]),Number(match[2]));
            else await native.catchup({start:Number(match[1]),end:Number(match[2]),interval:Number(match[3])});
            return '';
        },
    }));
}
setup();
