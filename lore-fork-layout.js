// Archive Lore — AGPL-3.0-only. Presentation only: original actions retain their listeners.
export const FEATURE_GROUPS = [
    ['수집·자동화', '대화를 로어북 기억으로 저장해. 먼저 범위를 선택한 뒤 기억 수집을 눌러 줘.', [
        ['al-native-collect','기억 수집','선택한 대화 범위를 읽고 새 기억을 만들어.'],
        ['al-native-range','범위 지정·지난 대화 수집','시작·끝 번호를 직접 정하거나, 긴 대화를 여러 번으로 나눠 수집해.'],
        ['stmb-automatic-memories-settings','자동 수집·지난 대화 수집','메시지·토큰 기준으로 자동 수집하거나, 밀린 대화를 나눠 수집해.'],
        ['stmb-pending-progress','진행·저장 확인','진행 중인 작업과 아직 반영하지 못한 결과를 확인해.'],
    ]],
    ['기억 관리', '여러 기억을 묶는 것과 기억 하나를 줄이는 것은 달라. 필요한 작업을 골라 줘.', [
        ['al-native-consolidate','기억 묶기 · 아크','여러 기억을 큰 요약으로 묶어. 아크 이후 단계도 여기서 관리해.'],
        ['stmb-compact-review','기억 압축','기억 항목 하나를 더 간결하게 다듬고 결과를 검토해.'],
        ['al-native-books','저장된 기억·재생성','저장된 본문을 확인해. 재생성은 실리태번 로어북 편집기에서 원본 대화를 다시 읽어 작성해.'],
        ['stmb-consolidation-recovery','중단된 통합 복구','중간에 끊긴 기억 통합 작업의 저장 상태를 확인해.'],
    ]],
    ['클립·사이드 기록', '장면 요약과 별개로 문구·주제·계속 바뀌는 상태를 관리해.', [
        ['stmb-topical-clip','주제별 클립','특정 주제의 정보를 대화에서 모아 정리해. 일반 클립은 대화 문구를 선택해서 저장해.'],
        ['stmb-side-prompts','사이드 기록·상태표','관계·약속 같은 기록의 프롬프트를 편집하고 실행 조건을 정해.'],
        ['stmb-clip-review-suggestions','기억 보완 제안','기존 기억에서 보완할 부분을 AI에게 검토받아.'],
    ]],
    ['검색·주입', '저장된 기억을 찾아 다음 답변에 전달해. 수집과 별도로 설정할 수 있어.', [
        ['al-search-settings','검색·임베딩 설정','별도 임베딩 키, 검색 방식, 참고 대화 수와 주입 상한을 설정해.'],
        ['al-search-tools','임베딩·주입 확인','남은 임베딩, 검색 미리보기, 최근 주입과 턴별 TXT 기록을 확인해.'],
    ]],
    ['프롬프트·고급 설정', '원본 메모리북 설정을 유지해. 필요할 때만 펼쳐서 조절하면 돼.', [
        ['stmb-prompt-manager','기억 수집 프롬프트','새 기억을 어떤 형식과 기준으로 요약할지 편집해.'],
        ['stmb-arc-prompt-manager','통합 프롬프트','여러 기억을 아크 등으로 묶는 기준을 편집해.'],
        ['stmb-context-settings','AI에게 보여줄 자료','수집할 때 함께 참고할 로어북·캐릭터 정보 등을 설정해.'],
        ['stmb-general-settings','일반·고급 설정','미리보기·분기·되돌리기 등 나머지 메모리북 기능을 설정해.'],
    ]],
];

const PANES = [
    ['collect','기억 수집','대화를 골라 기억으로 저장해.',['al-native-range','al-native-collect','stmb-pending-progress']],
    ['records','저장된 기억','기억과 사이드 기록을 확인하고 정리해.',['al-native-books','stmb-side-prompts','al-search-tools','al-native-consolidate','stmb-compact-review','stmb-topical-clip','stmb-clip-review-suggestions','stmb-consolidation-recovery']],
    ['settings','설정','연결과 자동 수집, 프롬프트를 설정해.',['al-search-settings','stmb-automatic-memories-settings','stmb-prompt-manager','stmb-arc-prompt-manager','stmb-context-settings','stmb-general-settings']],
];

export function restoreFeatureButtons(root) {
    const home=root?.querySelector('.al-feature-home');if(!home)return;
    root.dataset.alHomeTab=home.dataset.tab || 'collect';
    for(const control of home.querySelectorAll('[data-al-original-container]'))root.querySelector('#'+control.dataset.alOriginalContainer)?.append(control);
    const advanced=root.querySelector('.al-native-advanced');
    if(advanced){for(const child of [...advanced.children].slice(1))home.before(child);advanced.remove();}
    for(const id of ['stmb-scene','stmb-memory-status']){const el=home.querySelector('#'+id);if(el)home.before(el);}
    home.remove();
}

export function organizeMemoryBooks(root, actions = {}, explicitContent = null) {
    if (!root || root.querySelector('.al-feature-home')) return;
    const anchor=root.querySelector('#stmb-profile-select');if(!anchor)return;
    // The host popup's content node is authoritative; do not assume its CSS class.
    const content=explicitContent || anchor.closest('.popup-content') || root;
    const home=document.createElement('div');home.className='al-feature-home';
    const heading=content.querySelector('h2');if(heading){heading.removeAttribute('data-i18n');heading.textContent='Archive Lore';heading.classList.add('al-home-title');}
    const book=root.querySelector('#stmb-active-lorebook')?.textContent.trim();
    const progress=root.querySelector('#stmb-memory-status')?.textContent.match(/#(\d+)/)?.[1];
    const advanced=document.createElement('details');advanced.className='al-native-advanced';
    const summary=document.createElement('summary');summary.textContent='고급 설정 · 원본 메모리북';advanced.append(summary);
    for(const child of [...content.children])if(child!==heading)advanced.append(child);
    content.append(home);
    if(actions['al-migrate']){
        const box=document.createElement('div');box.className='al-migration-panel';
        const label=document.createElement('strong');label.textContent='기존 아카이브 로어를 쓰고 있었어?';
        const help=document.createElement('small');help.textContent='기존 기억을 새 형식으로 옮겨. 원본은 남겨둘게.';
        const b=document.createElement('button');b.type='button';b.className='menu_button';b.textContent='기존 기억 가져오기';
        const state=document.createElement('p');state.setAttribute('role','status');
        b.onclick=async()=>{b.disabled=true;state.textContent='백업·이관 중…';try{state.textContent=await actions['al-migrate']();}catch(e){state.textContent=e.message;}finally{b.disabled=false;}};
        box.append(label,help,b,state);home.append(box);
    }
    const nav=document.createElement('nav');nav.className='al-home-tabs';nav.setAttribute('aria-label','아카이브 로어 메뉴');home.append(nav);
    const features=new Map(FEATURE_GROUPS.flatMap(g=>g[2]).map(f=>[f[0],f]));
    const panes=new Map();
    for(const [key,title,description,ids] of PANES){
        const tab=document.createElement('button');tab.type='button';tab.textContent=title;tab.dataset.homeTab=key;nav.append(tab);
        const pane=document.createElement('section');pane.className='al-home-pane';pane.dataset.homePane=key;
        const intro=document.createElement('p');intro.className='al-home-intro';intro.textContent=description;pane.append(intro);
        if(key==='collect'){
            const stats=document.createElement('div');stats.className='al-home-status';
            const status=document.createElement('strong');status.textContent=progress?'#'+progress+'까지 수집했어':'아직 수집한 대화가 없어';
            const target=document.createElement('small');target.textContent=book?'저장할 책 · '+book:'저장할 책은 수집할 때 선택할 수 있어';stats.append(status,target);pane.append(stats);
        }
        for(const id of ids){
            const [,label,help]=features.get(id);
            // Native controls are still in the detached advanced node at this point.
            let control=advanced.querySelector('#'+id);
            if(!control && actions[id]){control=document.createElement('button');control.type='button';control.id=id;control.addEventListener('click',()=>Promise.resolve().then(actions[id]).catch(e=>globalThis.toastr?.error(e.message,'Archive Lore')));}
            if(!control)continue;
            if(control.parentElement?.id)control.dataset.alOriginalContainer=control.parentElement.id;
            control.removeAttribute('data-i18n');control.className='menu_button interactable al-feature-button';control.textContent=label;
            if(control.tagName!=='BUTTON'){control.setAttribute('role','button');control.tabIndex=0;control.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();control.click();}});}
            const card=document.createElement('div');card.className='al-feature-card';const desc=document.createElement('small');desc.textContent=help;card.append(control,desc);pane.append(card);
        }
        panes.set(key,pane);home.append(pane);
    }
    const scene=advanced.querySelector('#stmb-scene');
    if(scene){const details=document.createElement('details');details.className='al-selected-scene';const label=document.createElement('summary');label.textContent='선택한 대화 범위 확인';details.append(label,scene);
        if(actions['al-native-clear']){const b=document.createElement('button');b.type='button';b.className='menu_button';b.textContent='선택 범위 지우기';b.onclick=actions['al-native-clear'];details.append(b);}panes.get('collect').append(details);}
    panes.get('settings').append(advanced);
    function select(key){
        if(!panes.has(key))key='collect';home.dataset.tab=key;root.dataset.alHomeTab=key;
        for(const [name,pane] of panes)pane.hidden=name!==key;
        for(const tab of nav.children)tab.setAttribute('aria-pressed',String(tab.dataset.homeTab===key));
    }
    for(const tab of nav.children)tab.onclick=()=>select(tab.dataset.homeTab);
    select(root.dataset.alHomeTab || 'collect');
}
