// Archive Lore — AGPL-3.0-only.
export function createSearchToolsPanel({search,download,document:doc=globalThis.document}) {
    const key=search.context().key,controller=search.controller;
    let disposed=false,reading=false,rerun=false,counts=null,revision=0,wasBusy=controller.state().busy;
    const node=doc.createElement('div');node.className='al-search-tools';
    node.innerHTML='<h3>검색·주입 확인</h3><p class="al-optional-help">임베딩은 저장된 기억을 검색할 준비를 하는 작업입니다. 미리보기는 다음 답변에 넣을 기억을 선별합니다.</p><section class="al-embedding-summary"><strong data-embedding-count aria-live="polite">임베딩 개수 확인 중…</strong><progress hidden></progress><small class="al-optional-help">로어북 항목 기준입니다. 한 항목의 모든 구간이 처리되어야 완료로 셉니다. 상시 주입·비활성 항목은 제외합니다.</small><div class="al-range-actions"></div></section><div class="al-tool-buttons"></div><p role="status"></p><pre></pre>';
    const count=node.querySelector('[data-embedding-count]'),bar=node.querySelector('progress'),state=node.querySelector('[role=status]'),output=node.querySelector('pre');
    const current=()=>!disposed&&search.context().key===key;
    const controls=()=>{const unavailable=!current()||controller.state().busy;index.disabled=unavailable||reading||!counts||!counts.pending;reload.disabled=unavailable||reading;};
    const run=async action=>{if(!current()){state.textContent='채팅이 변경되었습니다. 이 창을 다시 열어 주세요.';return;}const before=revision;try{state.textContent='처리 중…';await action();if(current()){const value=controller.state().status;state.textContent=/^임베딩 완료/.test(value)?'':value||'완료';}}catch(e){if(current())state.textContent=e.message;}finally{if(before===revision)await refresh();}};
    const add=(parent,label,action)=>{const b=doc.createElement('button');b.type='button';b.className='menu_button';b.textContent=label;b.onclick=()=>run(action);parent.append(b);return b;};
    const actions=node.querySelector('.al-range-actions'),index=add(actions,'남은 임베딩 실행',()=>controller.index()),reload=add(actions,'개수 새로고침',()=>refresh());
    const tools=node.querySelector('.al-tool-buttons');
    add(tools,'지금 검색 미리보기',async()=>{const r=await controller.recall();if(current())output.textContent=[r.core,r.text].filter(Boolean).join('\n\n')||'선택된 기억 없음';});
    add(tools,'최근 주입',()=>{const r=controller.state().lastRecall;output.textContent=r?JSON.stringify(r,null,2):'아직 검색한 기억 없음';});
    add(tools,'진단 TXT 다운로드',async()=>{const text=await search.diagnostics.export(key,'all');if(current())download(text,'archive-lore-diagnostics.txt');});
    add(tools,'서버 작업 내역',async()=>{await controller.restore(true);if(current())output.textContent=JSON.stringify(controller.jobs(),null,2);});
    add(tools,'중지',()=>controller.cancel());
    async function refresh(){
        if(!current()||controller.state().busy){controls();return;}
        if(reading){rerun=true;return;}reading=true;revision++;controls();
        try{const view=await controller.dashboard();if(!current())return;
            counts={embedded:view.embedded,pending:view.pending};const total=counts.embedded+counts.pending;
            count.textContent=`${counts.embedded}/${total} 완료 · 남은 임베딩 ${counts.pending}개`;
            bar.hidden=false;bar.max=total||1;bar.value=counts.embedded;bar.setAttribute('aria-label',count.textContent);
            index.textContent=counts.pending?'남은 임베딩 실행':'임베딩 완료';
        }catch(e){if(current()){counts=null;bar.hidden=true;count.textContent='임베딩 개수를 확인하지 못했습니다.';state.textContent=e.message;}}
        finally{reading=false;controls();if(rerun){rerun=false;void refresh();}}
    }
    const unsubscribe=search.subscribe?.(()=>{if(!current())return;const {busy,status}=controller.state();if(busy)state.textContent=status;const finished=wasBusy&&!busy;wasBusy=busy;controls();if(finished){if(/^임베딩 완료/.test(status))state.textContent='';void refresh();}});
    void refresh();return {node,refresh,dispose(){disposed=true;unsubscribe?.();}};
}
