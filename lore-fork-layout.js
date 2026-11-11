// Archive Lore — AGPL-3.0-only. Presentation only: original actions retain their listeners.
export const FEATURE_GROUPS = [
    ['수집·자동화', '대화를 로어북 기억으로 저장합니다. 범위를 선택한 뒤 기억 수집을 눌러 주세요.', [
        ['al-native-collect','지금 수집','마지막 저장 위치 다음부터 현재 마지막 메시지까지 수집합니다.'],
        ['al-native-range','범위 지정·지난 대화 수집','시작·끝 번호를 지정하거나 긴 대화를 나누어 수집합니다.'],
        ['al-native-undo','직전 수집 되돌리기','추가된 기억·사이드를 로어북에서 삭제하고, 갱신된 사이드는 이전 내용으로 복원합니다.'],
        ['stmb-automatic-memories-settings','자동 수집·지난 대화 수집','메시지·토큰 기준으로 자동 수집하거나 지난 대화를 나누어 수집합니다.'],
        ['stmb-pending-progress','진행·저장 확인','진행 중인 작업과 아직 반영되지 않은 결과를 확인합니다.'],
    ]],
    ['기억 관리', '여러 기억을 통합하거나 개별 기억을 압축할 수 있습니다.', [
        ['al-native-consolidate','기억 묶기 · 아크','여러 기억을 큰 요약으로 묶고 아크 이후 단계도 관리합니다.'],
        ['stmb-compact-review','기억 압축','개별 기억을 간결하게 다듬고 결과를 검토합니다.'],
        ['al-native-books','저장된 기억·재생성','저장된 본문을 확인합니다. 원본 대화를 다시 읽는 재생성은 실리태번 로어북 편집기에서 실행합니다.'],
        ['stmb-consolidation-recovery','중단된 통합 복구','중단된 기억 통합 작업의 저장 상태를 확인합니다.'],
    ]],
    ['클립·사이드 기록', '장면 요약과 별도로 문구·주제·변화하는 상태를 관리합니다.', [
        ['stmb-topical-clip','주제별 클립','특정 주제의 정보를 모아 정리합니다. 일반 클립은 대화 문구를 선택해 저장합니다.'],
        ['stmb-side-prompts','사이드 기록·상태표','관계·약속 등 기록의 프롬프트와 실행 조건을 설정합니다.'],
        ['stmb-clip-review-suggestions','기억 보완 제안','기존 기억에서 보완할 부분을 AI에게 검토받습니다.'],
    ]],
    ['검색·주입', '저장된 기억을 찾아 다음 답변에 전달합니다. 수집과 별도로 설정할 수 있습니다.', [
        ['al-search-settings','검색·임베딩 설정','임베딩 키, 검색 방식, 참고 대화 수와 주입 상한을 설정합니다.'],
        ['al-search-tools','임베딩·주입 확인','남은 임베딩, 검색 미리보기, 최근 주입과 턴별 TXT 기록을 확인합니다.'],
    ]],
    ['화면·연결', '', [['al-preferences','로어북 연결·테마','따라갈 로어북, 오리지널 메모리북 화면과 색상을 선택합니다.']]],
    ['프롬프트·고급 설정', '원본 메모리북 설정을 필요에 따라 펼쳐 조절할 수 있습니다.', [
        ['stmb-prompt-manager','기억 수집 프롬프트','새 기억을 요약할 형식과 기준을 편집합니다.'],
        ['stmb-arc-prompt-manager','통합 프롬프트','여러 기억을 아크 등으로 묶는 기준을 편집합니다.'],
        ['stmb-context-settings','AI에게 보여줄 자료','수집할 때 참고할 로어북·캐릭터 정보 등을 설정합니다.'],
        ['stmb-general-settings','일반·고급 설정','미리보기·분기·되돌리기 등 메모리북 기능을 설정합니다.'],
    ]],
];

const PANES = [
    ['collect','수집','새 대화는 지금 수집, 특정 대화는 범위 지정으로 저장합니다.',['al-native-collect','al-native-range','al-native-undo','stmb-pending-progress']],
    ['records','저장된 기억','기억과 사이드 기록을 확인하고 정리합니다.',['al-native-books','stmb-side-prompts','al-search-tools','al-native-consolidate','stmb-compact-review','stmb-topical-clip','stmb-clip-review-suggestions','stmb-consolidation-recovery']],
    ['settings','설정','연결, 자동 수집과 프롬프트를 설정합니다.',['al-preferences','al-search-settings','stmb-automatic-memories-settings','stmb-prompt-manager','stmb-arc-prompt-manager','stmb-context-settings','stmb-general-settings']],
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
    if(actions['al-context-panel'])home.append(actions['al-context-panel']());
    const nav=document.createElement('nav');nav.className='al-home-tabs';nav.setAttribute('aria-label','아카이브 로어 메뉴');home.append(nav);
    const features=new Map(FEATURE_GROUPS.flatMap(g=>g[2]).map(f=>[f[0],f]));
    const panes=new Map();
    for(const [key,title,description,ids] of PANES){
        const tab=document.createElement('button');tab.type='button';tab.textContent=title;tab.dataset.homeTab=key;nav.append(tab);
        const pane=document.createElement('section');pane.className='al-home-pane';pane.dataset.homePane=key;
        const intro=document.createElement('p');intro.className='al-home-intro';intro.textContent=description;pane.append(intro);
        if(key==='settings' && actions['al-connection-panel']) pane.append(actions['al-connection-panel']());
        if(key==='collect' && !actions['al-context-panel']){
            const stats=document.createElement('div');stats.className='al-home-status';
            const status=document.createElement('strong');status.textContent=progress?'#'+progress+'까지 수집했습니다':'아직 수집한 대화가 없습니다';
            const target=document.createElement('small');target.textContent=book?'저장할 책 · '+book:'저장할 책은 수집할 때 선택할 수 있습니다';stats.append(status,target);pane.append(stats);
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
            if(id==='al-native-collect' && actions['al-collection-result'])pane.append(actions['al-collection-result']());
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
