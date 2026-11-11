// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import { applyNativeTheme } from './lore-native-preferences.js';
import { DEFAULT_PROMPTS, SIDE_PROMPT, NS, normalizeSettings, isCore } from './lore-core.js';

import { normalizeSides, DEFAULT_SIDES, SIDE_COMMON } from './lore-side-config.js';
import { tierLabel } from './lore-maintenance.js';
import { loreIcon } from './lore-icons.js';
import { makeId } from './lore-api.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const button = (action, label, extra = '') => `<button type="button" class="al-button" data-action="${action}" ${extra}>${label}</button>`;
const iconButton = (action, icon, label, extra = '') => button(action,loreIcon(icon),`data-icon-button aria-label="${label}" title="${label}" ${extra}`);
const field = (label, control) => `<label class="al-field"><span>${label}</span>${control}</label>`;
const input = (name, value, type = 'text', extra = '') => `<input class="text_pole" name="${name}" type="${type}" value="${escape(value)}" ${extra}>`;
const options = (items, value) => items.map(([id,label]) => `<option value="${escape(id)}" ${id === value ? 'selected' : ''}>${escape(label)}</option>`).join('');
const select = (name, items, value) => `<select class="text_pole" name="${name}">${options(items, value)}</select>`;
const translationHtml = (translation, label='로어북 매니저 번역') => translation ? `<details class="al-translation"><summary>${escape(label)} · ${escape(translation.language)}${translation.stale?' · 원문 변경됨 (이전 번역)':''}</summary><pre>${escape(translation.text)}</pre></details>` : '';
const download = (text, filename, type='text/plain;charset=utf-8') => {const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const check = (name, label, checked) => `<label class="al-check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;

// Merge repeated refresh requests; never discard a completed render just because another was requested.
export function coalesceRefresh(render) {
    let pending=null,again=false;
    return function refresh(){
        again=true;if(pending)return pending;
        pending=Promise.resolve().then(async()=>{do{again=false;await render();}while(again);}).finally(()=>{pending=null;});
        return pending;
    };
}

export function createLoreUI(api) {
    let dialog = null, page = 0, redraw = 0, filter = '', selected=new Set(), viewTab='memory';
    const settingsContainers=new Set();
    const safe = callback => async event => { try { await callback(event); } catch(error) { api.error(error); } };
    function settingsHtml() {
        const s = normalizeSettings(api.settings());
        const profiles = [['', '현재 연결 프로필'], ...api.profiles().map(p => [p.id, p.name])];
        return `<div class="al-root al-settings">
            <div class="al-settings-top">${check('enabled','아카이브 로어 활성화',s.enabled)}${button('open',loreIcon('book')+'열기')}</div>
            <nav class="al-tabs al-settings-tabs" aria-label="설정 분류">${[['connection','연결'],['collection','수집·검색'],['prompts','프롬프트'],['server','서버']].map(([id,label])=>button('settings-tab',label,`data-settings-tab="${id}" aria-pressed="${id==='connection'}"`)).join('')}</nav>
            <section data-settings-pane="server" hidden>
            <details><summary>서버 실행</summary>${check('serverEnabled','서버에서 실행 · 플러그인 필요',s.serverEnabled)}${button('server-check','서버 연결 확인')}<span data-server-status role="status"></span></details>
            </section><section data-settings-pane="connection"><details open><summary>기억 작성·검색 AI</summary><div class="al-fields">
            ${field('기억 작성 AI 프로필',select('profile', profiles, s.profile))}
            ${field('검색·선별 프로필',select('searchProfile', [['','기억 작성 AI와 동일'],...profiles.slice(1)], s.searchProfile))}
            </div>${button('profiles','프로필 새로고침')}</details>
            <details open data-embedding-settings><summary>임베딩 연결</summary><div class="al-fields">
            ${field('임베딩 제공자',select('embeddingProvider',[['gemini','Google AI Studio'],['vertex','Vertex AI Express'],...(s.embeddingProvider==='openai'?[['openai','OpenAI 호환 API (기존 설정)']]:[])],s.embeddingProvider))}
            ${s.embeddingProvider==='openai'?field('임베딩 모델',input('embeddingModel',s.embeddingModel)):''}
            ${field(s.embeddingProvider==='vertex'?'Vertex AI Express API 키':s.embeddingProvider==='gemini'?'Google AI Studio API 키':'임베딩 API 키',input('embeddingKey',s.embeddingKeys?.[s.embeddingProvider] || '', 'password','autocomplete="off" spellcheck="false"'))}
            ${s.embeddingProvider==='vertex'?field('Google Cloud 프로젝트 ID',input('embeddingVertexProjectId',s.embeddingVertexProjectId,'text','spellcheck="false"'))+field('리전',input('embeddingVertexRegion',s.embeddingVertexRegion,'text','placeholder="global" spellcheck="false"')):''}
            <div data-openai ${s.embeddingProvider === 'openai' ? '' : 'hidden'}>${field('임베딩 API 주소',input('embeddingUrl',s.embeddingUrl,'url'))}</div>
            </div><div class="al-actions">${button('embedding-test','임베딩 연결 확인')}</div><div data-embedding-status role="status"></div></details>
            </section><section data-settings-pane="collection" hidden><details open><summary>수집·검색 설정</summary><div class="al-fields">
            ${field('검색 방식',select('mode',[['dialogue','대화로 검색'],['questions','질문으로 검색'],['embedding','일반 임베딩']],s.mode))}
            ${field('최근 대화 참고 개수',input('recentCount',s.recentCount,'number','min="1" max="200"'))}
            ${field('최종 주입 토큰 상한',input('injectionTokens',s.injectionTokens,'number','min="256" max="32000"'))}
            ${field('한 번에 수집할 메시지',input('batchSize',s.batchSize,'number','min="1" max="100"'))}
            ${field('검색 후보 구간',input('candidateCount',s.candidateCount,'number','min="1" max="40"'))}
            </div>${check('keywordActivation','기존 키워드 발동도 허용',s.keywordActivation)}
            ${check('sideEnabled','사이드 기록 변화 자동 반영',s.sideEnabled !== false)}</details>
            <details><summary>자동 수집·숨기기</summary>
            ${check('autoCollect','새 대화 자동 수집',s.autoCollect)}
            ${field('수집 기준',select('autoMode',[['messages','메시지 개수'],['tokens','대화 토큰 수']],s.autoMode))}
            ${field('메시지 기준',input('autoMessages',s.autoMessages,'number','min="1" max="1000"'))}
            ${field('토큰 기준 · 추정값',input('autoTokens',s.autoTokens,'number','min="100" max="100000"'))}
            ${field('수집 후 남길 메시지',input('keepMessages',s.keepMessages,'number','min="0" max="1000"'))}
            </details>
            </section><section data-settings-pane="prompts" hidden><details data-side-settings><summary>사이드 항목 편집</summary>
            ${s.sideTemplates.map(row=>`<details class="al-card" data-side="${escape(row.id)}"><summary>${escape(row.label)}</summary>
                <label class="al-check"><input type="checkbox" data-side-field="enabled" ${row.enabled?'checked':''}><span>수집할 때 함께 갱신</span></label>
                ${field('이름',`<input class="text_pole" data-side-field="title" value="${escape(row.title)}">`)}
                <textarea class="text_pole al-prompt" data-side-field="prompt" spellcheck="false">${escape(row.prompt)}</textarea>
                <div class="al-actions al-prompt-actions">${button('expand-side','전체화면 편집')}${DEFAULT_SIDES.some(r=>r.id===row.id)?button('reset-side','기본 프롬프트 복원'):button('remove-side','항목 삭제')}</div>
            </details>`).join('')}${button('add-side','사이드 항목 추가')}</details>
            <details><summary>기본 프롬프트 편집</summary>
            ${[['collect','기억 수집'],['sides','사이드 공통 지침'],['questions','질문 만들기'],['select','원문 선별']].map(([key,label]) => `<details><summary>${label}</summary><textarea class="text_pole al-prompt" name="prompt.${key}" spellcheck="false">${escape(key === 'sides' ? (s.sidePrompt && s.sidePrompt!==SIDE_PROMPT ? s.sidePrompt : SIDE_COMMON) : s.prompts[key])}</textarea><div class="al-actions al-prompt-actions">${button('expand-prompt','전체화면 편집',`data-key="${key}"`)}${button('reset-prompt','이 프롬프트 초기화',`data-key="${key}"`)}</div></details>`).join('')}
            <div class="al-actions">${button('export-prompts','프롬프트 내보내기')}${button('import-prompts','프롬프트 가져오기')}<input type="file" data-prompt-file accept="application/json,.json" hidden></div>
            </details></section>
            </div>`;
    }
    function expandPrompt(container,key,sideId=null) {
        const source=sideId?container.querySelector(`[data-side="${sideId}"] [data-side-field="prompt"]`):container.querySelector(`[name="prompt.${key}"]`);
        const editor=document.createElement('dialog');editor.className='al-root al-editor';
        editor.innerHTML=`<header><strong>프롬프트 전체화면 편집</strong><div class="al-actions">${button('editor-save','저장 후 닫기')}${button('editor-cancel','취소')}</div></header><textarea class="text_pole" aria-label="전체화면 프롬프트" spellcheck="false"></textarea>`;
        editor.querySelector('textarea').value=source.value;
        editor.addEventListener('click',safe(async event=>{
            const action=event.target.closest('[data-action]')?.dataset.action;
            if(action==='editor-save'){
                const value=editor.querySelector('textarea').value;
                if(sideId)saveSide(sideId,{prompt:value});else api.saveSettings(key==='sides'?{sidePrompt:value}:{prompts:{...api.settings().prompts,[key]:value}});source.value=value;editor.close();
            } else if(action==='editor-cancel')editor.close();
        }));
        editor.addEventListener('close',()=>editor.remove(),{once:true});document.body.append(editor);editor.showModal();const textarea=editor.querySelector('textarea');textarea.focus();textarea.setSelectionRange(0,0);textarea.scrollTop=0;
    }
    function saveSide(id,patch) { api.saveSettings({sideTemplates:normalizeSides(api.settings().sideTemplates).map(row=>row.id===id?{...row,...patch}:row)}); }
    function settingsTab(container,tab) {
        container.dataset.settingsTab=tab;
        for(const pane of container.querySelectorAll('[data-settings-pane]'))pane.hidden=pane.dataset.settingsPane!==tab;
        for(const button of container.querySelectorAll('[data-settings-tab]'))button.setAttribute('aria-pressed',String(button.dataset.settingsTab===tab));
    }
    function paintSettings(container) {
        container.innerHTML=settingsHtml();settingsTab(container,container.dataset.settingsTab || 'connection');
        if(api.retrievalOnly){
            const tab=container.querySelector('[data-settings-tab="collection"]');if(tab)tab.textContent='검색·주입';
            const enabled=container.querySelector('[name="enabled"]')?.closest('label')?.querySelector('span');if(enabled)enabled.textContent='아카이브 검색·주입 활성화';
            for(const name of ['batchSize','sideEnabled'])container.querySelector(`[name="${name}"]`)?.closest('label')?.remove();
            container.querySelector('[name="autoCollect"]')?.closest('details')?.remove();
            container.querySelector('[data-side-settings]')?.remove();
            for(const key of ['collect','sides'])container.querySelector(`[name="prompt.${key}"]`)?.closest('details')?.remove();
            const profile=container.querySelector('[name="profile"]')?.closest('label')?.querySelector('span');if(profile)profile.textContent='기본 검색 AI 프로필';
            const connectionHeading=container.querySelector('[data-settings-pane="connection"] summary');if(connectionHeading)connectionHeading.textContent='검색·선별 AI';
            const same=container.querySelector('[name="searchProfile"] option[value=""]');if(same)same.textContent='기본 검색 AI와 동일';
            const pane=container.querySelector('[data-settings-pane="collection"]');
            const heading=pane.querySelector('summary');if(heading)heading.textContent='검색·주입 설정';
            const auto=document.createElement('div');auto.innerHTML=check('autoEmbed','기억 저장·수정 후 자동 임베딩',api.settings().autoEmbed!==false);pane.append(auto);
            const note=document.createElement('p');note.textContent='서버 실행은 검색·선별·임베딩에 적용됩니다. 메모리북 수집·사이드 작업은 브라우저에서 실행됩니다.';container.querySelector('[data-settings-pane="server"]').append(note);
            const top=container.querySelector('[data-action="open"]');if(top)top.textContent='메모리북 열기';
        }

    }
    function openSettings() {
        const panel=document.createElement('dialog');panel.className='al-root al-dialog al-settings-dialog';panel.setAttribute('aria-label','아카이브 로어 설정');
        panel.innerHTML=`<header><span class="al-brand">${loreIcon('settings')}설정</span>${iconButton('settings-close','close','설정 닫기')}</header><div class="al-scroll" data-settings-body></div>`;
        if(globalThis.archiveLoreFork)applyNativeTheme(panel,globalThis.archiveLoreMemoryBooks?.settings());
        document.body.append(panel);mountSettings(panel.querySelector('[data-settings-body]'));
        panel.querySelector('[data-action="settings-close"]').onclick=()=>panel.close();
        panel.addEventListener('close',()=>{panel.remove();for(const container of settingsContainers){if(container.isConnected)paintSettings(container);else settingsContainers.delete(container);}void refresh().catch(api.error);},{once:true});panel.showModal();
    }
    function mountSettings(container) {
        settingsContainers.add(container);
        paintSettings(container);
        container.addEventListener('change', safe(async event => {
            const element = event.target;
            if (element.matches('[data-prompt-file]')) {
                const file = element.files?.[0]; if (!file) return;
                const payload = JSON.parse(await file.text());
                const fields = ['collect','questions','select'];
                if (payload.format !== 'archive-lore-prompts-v1' || fields.some(k => typeof payload.prompts?.[k] !== 'string') || typeof payload.sidePrompt !== 'string') throw new Error('아카이브 로어 프롬프트 파일이 아니야.');
                api.saveSettings({ prompts: payload.prompts, sidePrompt: payload.sidePrompt, ...(payload.sideTemplates?{sideTemplates:normalizeSides(payload.sideTemplates)}:{}) }); paintSettings(container); return;
            }
            if(element.dataset.sideField){const name=element.dataset.sideField;saveSide(element.closest('[data-side]').dataset.side,{[name]:name==='enabled'?element.checked:element.value,...(name==='title'?{label:element.value}:{})});if(name==='title')element.closest('[data-side]').querySelector('summary').textContent=element.value;return;}
            if (!element.name) return;
            let value = element.type === 'checkbox' ? element.checked : element.value;
            if (element.name.startsWith('prompt.')) {
                const key = element.name.slice(7);
                api.saveSettings(key === 'sides' ? { sidePrompt: value } : { prompts: { ...api.settings().prompts, [key]: value } });
            } else {
                if (element.type === 'number') value = Number(value);
                if(element.name==='embeddingProvider') {
                    const current=api.settings(),keys={...current.embeddingKeys,[current.embeddingProvider]:current.embeddingKeys?.[current.embeddingProvider] ?? current.embeddingKey ?? ''};
                    api.saveSettings({embeddingProvider:value,embeddingKeys:keys,embeddingKey:keys[value] || '',embeddingModel:value==='openai'?'text-embedding-3-small':'gemini-embedding-001'});
                    paintSettings(container);
                } else if(element.name==='embeddingKey') api.saveSettings({embeddingKey:value,embeddingKeys:{...api.settings().embeddingKeys,[api.settings().embeddingProvider]:value}});
                else api.saveSettings({ [element.name]: value });
            }
        }));
        container.addEventListener('click', safe(async event => {
            const target = event.target.closest('[data-action]'); if (!target) return;
            switch (target.dataset.action) {
                case 'settings-tab':settingsTab(container,target.dataset.settingsTab);break;
                case 'server-check':case 'embedding-test':{
                    const node=container.querySelector(target.dataset.action==='server-check'?'[data-server-status]':'[data-embedding-status]');node.textContent='연결 확인 중';target.disabled=true;
                    try{const result=await (target.dataset.action==='server-check'?api.serverCheck():api.embeddingTest());node.textContent=target.dataset.action==='server-check'?`연결됨 · 서버 ${result.version}`:`임베딩 성공 · ${result.dimensions}차원`;}
                    catch(error){node.textContent=error.message;throw error;}finally{target.disabled=false;}break;
                }
                case 'open': container.closest('.al-settings-dialog')?.close();await (api.openHome ? api.openHome() : open()); break;
                case 'expand-prompt': expandPrompt(container,target.dataset.key);break;
                case 'expand-side':expandPrompt(container,null,target.closest('[data-side]').dataset.side);break;
                case 'add-side':{
                    const sideTemplates=normalizeSides(api.settings().sideTemplates);
                    sideTemplates.push({id:'custom_'+makeId().replace(/[^a-zA-Z0-9_-]/g,''),label:'새 사이드',title:'New side record',enabled:true,prompt:'Track changes to this topic only. Preserve unchanged facts; add or update only facts directly supported by exact dialogue evidence.'});
                    api.saveSettings({sideTemplates});paintSettings(container);container.querySelector('[data-side-settings]').open=true;container.querySelector('[data-side]:last-of-type').open=true;break;
                }
                case 'reset-side':{
                    const id=target.closest('[data-side]').dataset.side;if(!window.confirm('이 사이드 프롬프트를 기본값으로 되돌릴까?'))return;
                    const original=DEFAULT_SIDES.find(r=>r.id===id);saveSide(id,{prompt:original.prompt});target.closest('[data-side]').querySelector('textarea').value=original.prompt;break;
                }
                case 'remove-side':{
                    const id=target.closest('[data-side]').dataset.side;if(!window.confirm('이 사이드 설정을 삭제할까? 이미 저장된 기록은 남아 있어.'))return;
                    api.saveSettings({sideTemplates:normalizeSides(api.settings().sideTemplates).filter(r=>r.id!==id)});target.closest('[data-side]').remove();break;
                }
                case 'profiles': paintSettings(container); break;
                case 'reset-prompt': {
                    const key = target.dataset.key;
                    if (!window.confirm('편집한 프롬프트를 기본값으로 되돌릴까?')) return;
                    api.saveSettings(key === 'sides' ? { sidePrompt: SIDE_COMMON } : { prompts: { ...api.settings().prompts, [key]: DEFAULT_PROMPTS[key] } });
                    container.querySelector(`[name="prompt.${key}"]`).value = key === 'sides' ? SIDE_COMMON : DEFAULT_PROMPTS[key]; break;
                }
                case 'export-prompts': {
                    const s = normalizeSettings(api.settings());
                    const blob = new Blob([JSON.stringify({format:'archive-lore-prompts-v1',prompts:s.prompts,sidePrompt:(s.sidePrompt && s.sidePrompt!==SIDE_PROMPT ? s.sidePrompt : SIDE_COMMON),sideTemplates:s.sideTemplates}, null, 2)], {type:'application/json'});
                    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download='archive-lore-prompts.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); break;
                }
                case 'import-prompts': container.querySelector('[data-prompt-file]').click(); break;
            }
        }));
    }
    const refresh=coalesceRefresh(async()=>{
        try{await render();}catch(error){if(dialog?.isConnected)dialog.querySelector('[data-status]').textContent=`목록 확인 실패 · ${error.message}`;throw error;}
    });
    async function render() {
        if (!dialog?.isConnected) return;
        const state = api.controller.state();
        dialog.querySelector('[data-status]').textContent = state.status;
        for (const element of dialog.querySelectorAll('[data-job]')) element.disabled = state.busy;
        dialog.querySelector('[data-action="stop"]').disabled = !state.busy;
        dialog.querySelector('[data-action="stop"]').hidden = !state.busy;
        dialog.setAttribute('aria-busy',String(state.busy));
        const node=dialog,key=api.context().key;
        node.querySelector('[data-chat]').textContent=api.context().name || '채팅방을 열어 줘';
        if(!node.querySelector('[data-counts]').textContent)node.querySelector('[data-counts]').textContent='기억·임베딩 상태 불러오는 중…';
        if (state.busy) return;
        const generation = ++redraw, view = await api.controller.dashboard();
        if(dialog!==node||key!==api.context().key)return;
        if (!dialog?.isConnected || generation !== redraw) return;
        const context = api.context();
        dialog.querySelector('[data-chat]').textContent = context.name || '채팅방을 열어 줘';
        dialog.querySelector('[data-counts]').innerHTML = `<span>기억 ${view.records.filter(r=>!r.entry[NS]?.sideCategory).length}</span><span>사이드 ${view.records.filter(r=>r.entry[NS]?.sideCategory).length}</span><span>임베딩 ${view.embedded}</span><span>대기 ${view.pending}</span>`;
        dialog.querySelector('[data-range]').textContent = view.ranges.length ? view.ranges.map(r=>`#${r.start}–#${r.end}`).join(' · ') : '아직 수집한 대화 없음';
        dialog.querySelector('[data-next]').textContent = view.next < context.messages.length ? `다음 수집 #${view.next}–#${context.messages.length-1}` : '새 대화 없음';
        dialog.querySelector('[name="rangeStart"]').value = view.next;
        dialog.querySelector('[name="rangeEnd"]').value = Math.max(0,context.messages.length-1);
        selected=new Set([...selected].filter(id=>view.records.some(r=>r.id===id&&!r.entry[NS]?.sideCategory&&!isCore(r.entry))));
        dialog.querySelector('[data-selected]').textContent=`${selected.size}개 선택`;
        const names = api.bookNames();
        dialog.querySelector('[name="target"]').innerHTML = options([['','연결된 책 없음 · 수집 시 새로 만들기'], ...names.map(n=>[n,n])], api.target());
        const chosen = api.books();
        dialog.querySelector('[data-books]').innerHTML = names.map(n => `<label class="al-check"><input type="checkbox" data-book="${escape(n)}" ${chosen.includes(n)?'checked':''}><span>${escape(n)}</span></label>`).join('');
        const rows = view.records.filter(r => (viewTab==='side'?!!r.entry[NS]?.sideCategory:!r.entry[NS]?.sideCategory)).filter(r => `${r.entry.comment}\n${r.entry.content}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
        const pages = Math.max(1,Math.ceil(rows.length/12)); page=Math.min(page,pages-1);
        dialog.querySelector('[data-page]').textContent = `${page+1}/${pages} · ${rows.length}항목`;
        dialog.querySelector('[data-action="prev"]').disabled = !page;
        dialog.querySelector('[data-action="next"]').disabled = page+1 >= pages;
        dialog.querySelector('[data-records]').innerHTML = rows.slice(page*12,page*12+12).map(row => {
            const e=row.entry, side=e[NS]?.sideCategory;
            return `<details class="al-record" data-record="${escape(row.id)}"><summary><div class="al-record-heading"><small>${side?'사이드':isCore(e)?'코어':tierLabel(e)} · ${escape(row.book)}</small><span>${escape(e.comment || '제목 없음')}</span><p>${escape(String(e.content || '').replace(/\s+/g,' ').slice(0,150))}</p></div>${loreIcon('chevron')}</summary>
            <div class="al-record-body"><span class="al-muted">${escape(row.book)}</span>
            ${check('core','코어 · 항상 주입',isCore(e))}
            ${!side&&!isCore(e)?`<label class="al-check"><input type="checkbox" data-select-memory ${selected.has(row.id)?'checked':''}><span>묶을 기억으로 선택</span></label>`:''}
            ${side === 'relationship' ? `<strong>${escape(e.content)}</strong>${field('관계 명칭', input('relationshipLabel', e[NS].facts?.[0]?.text || 'Undefined'))}${field('기간 기준', select('relationshipKind', [['start','관계 시작'],['breakup','이별'],['reunion','재회'],['other','기타']], e[NS].facts?.[0]?.relationship?.kind || 'other'))}${field('시작일 · 미상은 빈칸', input('relationshipSince', e[NS].facts?.[0]?.relationship?.since || '', 'date'))}${field('현재 RP 날짜', input('relationshipToday', e[NS].storyDate || '', 'date'))}` : side ? (e[NS].facts || []).map(f=>`<textarea class="text_pole" data-fact="${escape(f.id)}">${escape(f.text)}</textarea>`).join('') : `<textarea class="text_pole" name="content">${escape(e.content)}</textarea>`}
            <div class="al-actions">${button('save-record','저장','data-job')}${!side&&!isCore(e)?button('compact','짧게 다듬기','data-job')+button('regenerate','다시 만들기','data-job'):''}</div>
            ${e[NS]?.members?.length?`<details><summary>묶기 전 원본 (${e[NS].members.length})</summary>${e[NS].members.map(m=>`<strong>${escape(m.title)}</strong><pre>${escape(m.content)}</pre>`).join('')}</details>`:''}
            ${translationHtml(api.translation?.(row.book,e))}
            ${e[NS]?.history?.length ? `<details><summary>변경 전 기록 (${e[NS].history.length})</summary>${[...e[NS].history].reverse().map(h=>`<pre>${escape(h.content)}</pre>`).join('')}</details>`:''}
            </div></details>`;
        }).join('') || '<div class="al-muted">표시할 기억 없음</div>';
        const serverJobs=api.serverJobs?.()||[];
        dialog.querySelector('[data-server-jobs]').innerHTML=serverJobs.slice().reverse().map(job=>`<div class="al-record"><span>${escape(job.kind)} · ${escape(job.status)}</span><div>${escape(job.message)}</div>${job.kind==='prepareMaintenance'&&job.status==='completed'&&job.draftAvailable!==false?button('server-draft','초안 열기',`data-id="${escape(job.id)}"`):''}</div>`).join('')||'서버 작업 없음';
        const recall = state.lastRecall;
        dialog.querySelector('[data-recall]').textContent = recall ? `${recall.timings ? `기억 준비 ${((recall.timings.injectionMs ?? recall.timings.clientTotalMs ?? recall.timings.totalMs)/1000).toFixed(1)}초 · 질문 ${((recall.timings.questionMs || 0)/1000).toFixed(1)}초 · 임베딩 ${((recall.timings.embeddingMs || 0)/1000).toFixed(1)}초 · 선별 ${((recall.timings.selectionMs || 0)/1000).toFixed(1)}초\n` : ''}${recall.tokens}토큰 · 후보 ${recall.candidateTotal}구간 · 미임베딩 ${recall.pending}구간${recall.shortened?' · 긴 대화 일부 생략':''}\n${recall.questions.join('\n')}\n\n[코어 · 항상 주입]\n${recall.core || '없음'}\n\n[검색으로 선별한 기억]\n${recall.text || '선별한 기억 없음'}` : '아직 회상한 기록 없음';
        dialog.querySelector('[data-recall-translations]').innerHTML=(recall?.records || []).map(r=>translationHtml(api.translation?.(r.book,r.entry),`${isCore(r.entry)?'코어':'선택된 기억'} 전체 번역 · ${r.entry.comment || r.book}`)).join('');
        const runs=await api.diagnostics?.list(context.key) || [];
        if(!dialog?.isConnected || generation!==redraw)return;
        const attempts=runs.filter(r=>r.kind==='generation');
        dialog.querySelector('[data-log-counts]').textContent=`대화로 검색 ${attempts.filter(r=>r.mode==='dialogue'&&!['skipped','error','canceled'].includes(r.status)).length}회 · 질문으로 검색 ${attempts.filter(r=>r.mode==='questions'&&!['skipped','error','canceled'].includes(r.status)).length}회 · 일반 임베딩 ${attempts.filter(r=>r.mode==='embedding'&&!['skipped','error','canceled'].includes(r.status)).length}회 · 전체 기록 ${runs.length}개`;
        dialog.querySelector('[data-log-list]').innerHTML=runs.slice(-30).reverse().map(r=>`<details><summary>${escape(r.started)} · ${escape(r.kind)} · ${escape(r.mode)} · ${escape(r.status)}</summary><pre>${escape(JSON.stringify(r,null,2))}</pre></details>`).join('');
    }
    function openDraft(draft) {
        const editor=document.createElement('dialog');editor.className='al-root al-editor';
        editor.innerHTML=`<header><strong>기억 정리 초안 · ${draft.beforeTokens} → ${draft.afterTokens} 추정 토큰</strong><div class="al-actions">${button('apply-draft','적용')}${button('cancel-draft','취소')}</div></header>
            ${field('제목',input('draftTitle',draft.title))}<textarea class="text_pole" aria-label="기억 정리 초안"></textarea>
            <details class="al-draft-originals"><summary>원본 확인</summary>${draft.originals.map(e=>`<strong>${escape(e.title)}</strong><pre>${escape(e.content)}</pre>`).join('')}</details>`;
        editor.querySelector('textarea').value=draft.content;
        editor.addEventListener('click',safe(async event=>{
            const action=event.target.closest('[data-action]')?.dataset.action;
            if(action==='cancel-draft')editor.close();
            if(action==='apply-draft'){
                const buttons=[...editor.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
                try{await api.controller.applyMaintenance({token:draft.token,draftJobId:draft.serverJobId,title:editor.querySelector('[name="draftTitle"]').value,content:editor.querySelector('textarea').value});selected.clear();editor.close();await refresh();}
                finally{buttons.forEach(b=>b.disabled=false);}
            }
        }));
        editor.addEventListener('close',()=>{api.controller.discardDraft();editor.remove();},{once:true});document.body.append(editor);editor.showModal();
    }
    function showView(tab) {
        if(api.controller.state().busy && (tab==='memory'||tab==='side') && viewTab!==tab)dialog.querySelector('[data-records]').innerHTML='<div class="al-muted">작업 완료 후 목록을 새로고침해요.</div>';
        viewTab=tab;page=0;
        for(const pane of dialog.querySelectorAll('[data-main-pane]'))pane.hidden=pane.dataset.mainPane!==(tab==='memory'||tab==='side'?'records':tab);
        for(const button of dialog.querySelectorAll('[data-view-tab]'))button.setAttribute('aria-pressed',String(button.dataset.viewTab===tab));
        dialog.querySelector('[data-action="tools"]').setAttribute('aria-pressed',String(tab==='tools'));
        dialog.querySelector('.al-organize').hidden=tab==='side';
        dialog.querySelector('[name="filter"]').placeholder=tab==='side'?'사이드 검색':'기억 검색';
        dialog.querySelector('.al-scroll').scrollTop=0;
    }
    async function open() {
        if (dialog?.isConnected) { await refresh(); return; }
        dialog = document.createElement('dialog'); dialog.className='al-dialog al-root';dialog.setAttribute('aria-label','아카이브 로어');
        viewTab='memory';page=0;filter='';
        dialog.innerHTML = `<header><span class="al-brand">${loreIcon('book')}ARCHIVE LORE</span><div class="al-header-actions">${iconButton('settings','settings','설정')}${iconButton('tools','tools','도구','aria-pressed="false"')}${iconButton('close','close','닫기')}</div></header>
        <div class="al-hero"><h3 data-chat></h3><div class="al-counts" data-counts></div></div>
        <nav class="al-tabs" aria-label="아카이브 보기">${[['memory','기억'],['side','사이드'],['recall','최근 주입']].map(([id,label])=>button('view-tab',label,`data-view-tab="${id}" aria-pressed="${id==='memory'}"`)).join('')}</nav>
        <div class="al-scroll">
        <section data-main-pane="records"><div class="al-search-row"><label class="al-search">${loreIcon('search')}<input class="text_pole" name="filter" placeholder="기억 검색" aria-label="내용·제목 검색"></label>${iconButton('refresh','refresh','새로고침')}</div>
        <details class="al-organize"><summary>기억 정리 <span data-selected>0개 선택</span></summary><div class="al-actions">${button('merge','선택 기억 묶기 · 아크','data-job')}${button('clear-selection','선택 해제')}</div></details>
        <div data-records></div><div class="al-actions al-pagination">${iconButton('prev','left','이전')}<span data-page></span>${iconButton('next','chevron','다음')}</div></section>
        <section data-main-pane="recall" hidden><div class="al-section-heading"><strong>최근 주입</strong>${button('preview',loreIcon('refresh')+'회상 미리보기','data-job')}</div><pre data-recall></pre><div data-recall-translations></div></section>
        <section data-main-pane="tools" hidden><div class="al-section-heading"><strong>도구</strong>${button('index',loreIcon('layers')+'남은 임베딩','data-job')}</div>
        <details class="al-card"><summary>지난 대화 한꺼번에 수집·로어북</summary>
        ${field('저장할 로어북',select('target',[],''))}
        <details><summary>검색할 로어북 선택</summary><div data-books></div></details>
        <div class="al-range">${field('시작 번호',input('rangeStart',0,'number','min="0"'))}${field('끝 번호',input('rangeEnd',0,'number','min="0"'))}</div>
        ${field('분할 메시지 개수',input('rangeBatch',normalizeSettings(api.settings()).batchSize,'number','min="1" max="100"'))}
        <div class="al-actions">${button('collect-range','범위 나눠 수집','data-job')}${button('start-here','다음 수집 시작점 지정','data-job')}${button('reindex','전체 임베딩 다시 만들기','data-job')}</div></details>
        <details class="al-card"><summary>서버 작업 내역</summary>${button('server-refresh','서버 내역 새로고침')}<div data-server-jobs></div></details>
        <details class="al-card"><summary>턴별 진단 기록</summary><div data-log-counts></div><div class="al-actions">${select('logMode',[['all','전체 방식'],['dialogue','대화로 검색'],['questions','질문으로 검색'],['embedding','일반 임베딩']],'all')}${button('export-logs','진단 TXT 다운로드')}</div><div data-log-list></div></details>
        </section></div>
        <footer class="al-collection"><div class="al-range-status"><strong data-next></strong><span class="al-muted" data-range></span></div><div data-status role="status" aria-live="polite"></div><div class="al-collect-actions">${button('collect',loreIcon('plus')+'기억 수집','data-job')}${button('stop','중지','hidden')}</div></footer>`;
        document.body.append(dialog); dialog.showModal();
        dialog.addEventListener('close',()=>{dialog?.remove();dialog=null;redraw++;});
        dialog.addEventListener('change',safe(async event=>{
            if(event.target.matches('[data-select-memory]')){const id=event.target.closest('[data-record]').dataset.record;event.target.checked?selected.add(id):selected.delete(id);dialog.querySelector('[data-selected]').textContent=`${selected.size}개 선택`;}
            if(event.target.name==='target'){await api.setTarget(event.target.value);await refresh();}
            if(event.target.dataset.book){await api.setBooks([...dialog.querySelectorAll('[data-book]:checked')].map(e=>e.dataset.book));await refresh();}
        }));
        let searchTimer;
        dialog.querySelector('[name="filter"]').addEventListener('input',event=>{filter=event.target.value;page=0;clearTimeout(searchTimer);searchTimer=setTimeout(()=>void refresh().catch(api.error),180);});
        dialog.addEventListener('click',safe(async event=>{
            const b=event.target.closest('[data-action]');if(!b)return;
            switch(b.dataset.action){
                case 'settings':openSettings();return;
                case 'tools':showView(viewTab==='tools'?'memory':'tools');await refresh();return;
                case 'view-tab':showView(b.dataset.viewTab);await refresh();return;
                case 'server-refresh':await api.controller.restore(true);break;
                case 'server-draft':openDraft(await api.controller.getDraft(b.dataset.id));break;
                case 'close':dialog.close();return;
                case 'collect':await api.controller.collect();break;
                case 'index':await api.controller.index();break;
                case 'stop':api.controller.cancel();break;
                case 'reindex':if(window.confirm('전체 기억을 다시 임베딩할까? 임베딩 API를 사용해.'))await api.controller.index(true);break;
                case 'collect-range':await api.controller.collect({start:Number(dialog.querySelector('[name="rangeStart"]').value),end:Number(dialog.querySelector('[name="rangeEnd"]').value),batchSize:Number(dialog.querySelector('[name="rangeBatch"]').value)});break;
                case 'start-here':await api.setInitialStart(Number(dialog.querySelector('[name="rangeStart"]').value));break;
                case 'clear-selection':selected.clear();break;
                case 'merge':case 'compact':case 'regenerate':{
                    const ids=b.dataset.action==='merge'?[...selected]:[b.closest('[data-record]').dataset.record];
                    const draft=await api.controller.prepareMaintenance({kind:b.dataset.action,ids});openDraft(draft);break;
                }
                case 'preview':await api.controller.recall();break;
                case 'export-logs':{const mode=dialog.querySelector('[name="logMode"]').value;download(await api.diagnostics.export(api.context().key,mode),`archive-lore-${mode}-${new Date().toISOString().replace(/[:.]/g,'-')}.txt`);break;}
                case 'prev':page--;break;
                case 'next':page++;break;
                case 'save-record':{
                    const node=b.closest('[data-record]');
                    await api.saveRecord(node.dataset.record,{core:node.querySelector('[name="core"]').checked,
                        content:node.querySelector('[name="content"]')?.value,
                        facts:[...node.querySelectorAll('[data-fact]')].map(e=>({id:e.dataset.fact,text:e.value})),
                        relationship: node.querySelector('[name="relationshipLabel"]') ? { label:node.querySelector('[name="relationshipLabel"]').value, kind:node.querySelector('[name="relationshipKind"]').value, since:node.querySelector('[name="relationshipSince"]').value || null, today:node.querySelector('[name="relationshipToday"]').value || null } : null});break;
                }
            }
            await refresh();
        }));
        await refresh();
    }
    return { mountSettings, open, openSettings, refresh };
}
