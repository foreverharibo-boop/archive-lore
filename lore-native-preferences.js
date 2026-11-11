// Archive Lore — AGPL-3.0-only. Preferences never modify SillyTavern bindings.
export const BOOK_MODES = [
    ['legacy','기존 메모리북 연결 방식'], ['chat','채팅 로어북 따라가기'],
    ['character','캐릭터의 월드 로어북 따라가기'], ['fixed','지정한 월드 로어북 계속 사용'],
];
export const PALETTES = [['default','실리태번 기본'],['rose','로즈'],['lavender','라벤더'],['sage','세이지'],['midnight','미드나잇']];
export function nativePreferences(settings = {}) {
    const m=settings.moduleSettings || {};
    return {
        layout:m.archiveLoreLayout==='original'?'original':'archive',
        palette:PALETTES.some(([id])=>id===m.archiveLorePalette)?m.archiveLorePalette:'default',
        mode:BOOK_MODES.some(([id])=>id===m.archiveLoreBookMode)?m.archiveLoreBookMode:'legacy',
        book:typeof m.archiveLoreBook==='string'?m.archiveLoreBook:'',
    };
}
export function resolveBookPreference(settings, {chatBook='',characterBook='',isGroup=false} = {}) {
    const {mode,book}=nativePreferences(settings);
    if(mode==='legacy')return null;
    return {mode, name:mode==='fixed'?book:mode==='chat'?chatBook:!isGroup?characterBook:''};
}
export function applyNativeTheme(root, settings) {
    if(!root)return;
    const {layout,palette}=nativePreferences(settings);
    root.classList.toggle('al-fork-surface',layout!=='original');
    root.classList.toggle('al-original-memorybooks',layout==='original');
    root.dataset.alPalette=layout==='original'?'default':palette;
}
export function createNativePreferences({settings,books=[],activeBook='',save,switchLayout}) {
    const p=nativePreferences(settings), box=document.createElement('section');box.className='al-native-preferences';
    const heading=document.createElement('h4');heading.textContent='로어북 연결·테마';box.append(heading);
    const field=(label,id,items,value)=>{
        const row=document.createElement('label'),text=document.createElement('span'),select=document.createElement('select');
        text.textContent=label;select.id=id;select.className='text_pole';
        for(const [key,name] of items)select.append(new Option(name,key));select.value=value;row.append(text,select);box.append(row);return select;
    };
    const mode=field('따라갈 로어북','al-book-mode',BOOK_MODES,p.mode);
    const choices=[['','로어북 선택'],...books.map(name=>[name,name])];
    if(p.book && !books.includes(p.book))choices.push([p.book,p.book+' · 찾을 수 없음']);
    const book=field('저장·검색에 사용할 책','al-fixed-book',choices,p.book);
    const status=document.createElement('small');status.textContent='현재 대상 · '+(activeBook || '연결된 로어북 없음');box.append(status);
    const help=document.createElement('small');help.textContent='지정한 책은 모든 새 채팅에서도 유지됩니다. 캐릭터 모드는 해당 캐릭터에 연결된 월드 로어북을 따릅니다. 수집 위치는 채팅별로 따로 저장됩니다. 그룹 채팅은 채팅 연결이나 지정한 책을 선택해 주세요.';box.append(help);
    const layout=field('화면 구성','al-layout',[['archive','아카이브 로어'],['original','오리지널 메모리북']],p.layout);
    const layoutHelp=document.createElement('small');layoutHelp.textContent='오리지널 메모리북은 원래 메모리북의 화면·메뉴·하단 버튼을 불러옵니다. 원본 스타일을 사용하며 아카이브 로어의 색상을 덧씌우지 않습니다. 화면 구성은 선택하면 바로 전환됩니다.';box.append(layoutHelp);
    const palette=field('아카이브 로어 색상','al-palette',PALETTES,p.palette);
    const message=document.createElement('p');message.setAttribute('role','status');box.append(message);
    const sync=()=>{book.parentElement.hidden=mode.value!=='fixed';palette.parentElement.hidden=layout.value==='original';};sync();
    // One explicit save keeps a partially chosen destination from becoming active.
    const button=document.createElement('button');button.type='button';button.className='menu_button';button.textContent='적용';box.append(button);
    mode.onchange=sync;
    layout.onchange=async()=>{
        sync();
        if(!switchLayout)return;
        layout.disabled=true;button.disabled=true;message.textContent='화면 전환 중…';
        try{await switchLayout(layout.value);}
        catch(e){layout.value=nativePreferences(settings).layout;sync();message.textContent=e.message;}
        finally{layout.disabled=false;button.disabled=false;}
    };
    button.onclick=async()=>{
        if(mode.value==='fixed' && !books.includes(book.value)){message.textContent='사용할 로어북을 선택해 주세요.';return;}
        button.disabled=true;
        try{await save({archiveLoreBookMode:mode.value,archiveLoreBook:book.value,archiveLoreLayout:layout.value,archiveLorePalette:palette.value});message.textContent='적용했습니다.';}
        catch(e){message.textContent=e.message;}finally{button.disabled=false;}
    };
    return box;
}

// Original native markup and listeners stay in place; only our extra tools are appended.
export function appendOriginalTools(root, actions, content) {
    root.querySelector('.al-original-addons')?.remove();
    const box=document.createElement('section');box.className='al-original-addons';
    const title=document.createElement('h4');title.textContent='아카이브 로어 추가 기능';box.append(title);
    for(const [id,label] of [['al-native-collect','지금 수집'],['al-native-range','범위 지정·지난 대화 수집'],['al-native-undo','직전 수집 되돌리기'],['al-native-books','저장된 기억'],['al-search-settings','검색·임베딩 설정'],['al-search-tools','임베딩·주입 확인'],['al-preferences','로어북 연결·테마']]) {
        if(!actions[id])continue;
        const b=document.createElement('button');b.type='button';b.id=id;b.className='menu_button';b.textContent=label;
        b.onclick=async()=>{b.disabled=true;try{const result=await actions[id]();if(typeof result==='string')globalThis.toastr?.success(result);}catch(e){globalThis.toastr?.error(e.message);}finally{b.disabled=false;}};box.append(b);
    }
    content.append(box);
}
