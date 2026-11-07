// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_PROMPTS, SIDE_PROMPT, SIDE_CATEGORIES, NS, normalizeSettings, isCore } from './lore-core.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const button = (action, label, extra = '') => `<button type="button" class="menu_button al-button" data-action="${action}" ${extra}>${label}</button>`;
const field = (label, control) => `<label class="al-field"><span>${label}</span>${control}</label>`;
const input = (name, value, type = 'text', extra = '') => `<input class="text_pole" name="${name}" type="${type}" value="${escape(value)}" ${extra}>`;
const options = (items, value) => items.map(([id,label]) => `<option value="${escape(id)}" ${id === value ? 'selected' : ''}>${escape(label)}</option>`).join('');
const select = (name, items, value) => `<select class="text_pole" name="${name}">${options(items, value)}</select>`;
const translationHtml = (translation, label='로어북 매니저 번역') => translation ? `<details class="al-translation"><summary>${escape(label)} · ${escape(translation.language)}${translation.stale?' · 원문 변경됨 (이전 번역)':''}</summary><pre>${escape(translation.text)}</pre></details>` : '';
const download = (text, filename, type='text/plain;charset=utf-8') => {const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const check = (name, label, checked) => `<label class="al-check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;

export function createLoreUI(api) {
    let dialog = null, page = 0, redraw = 0, filter = '';
    const safe = callback => async event => { try { await callback(event); } catch(error) { api.error(error); } };
    function settingsHtml() {
        const s = normalizeSettings(api.settings());
        const profiles = [['', '현재 연결 프로필'], ...api.profiles().map(p => [p.id, p.name])];
        return `<div class="al-root al-settings">
            ${check('enabled','아카이브 로어 활성화',s.enabled)}
            <details open><summary>연결 설정</summary><div class="al-fields">
            ${field('수집 프로필',select('profile', profiles, s.profile))}
            ${field('검색·선별 프로필',select('searchProfile', [['','수집 프로필과 동일'],...profiles.slice(1)], s.searchProfile))}
            ${field('임베딩 연결',select('embeddingProvider',[['gemini','Google AI Studio'],['vertex','Vertex AI Express'],...(s.embeddingProvider==='openai'?[['openai','OpenAI 호환 API (기존 설정)']]:[])],s.embeddingProvider))}
            ${field('임베딩 모델',input('embeddingModel',s.embeddingModel))}
            ${field(s.embeddingProvider==='vertex'?'Vertex AI Express API 키':s.embeddingProvider==='gemini'?'Google AI Studio API 키':'임베딩 API 키',input('embeddingKey',s.embeddingKeys?.[s.embeddingProvider] || '', 'password','autocomplete="off" spellcheck="false"'))}
            <div data-openai ${s.embeddingProvider === 'openai' ? '' : 'hidden'}>${field('임베딩 API 주소',input('embeddingUrl',s.embeddingUrl,'url'))}</div>
            </div>${button('profiles','프로필 새로고침')}</details>
            <details><summary>수집·검색 설정</summary><div class="al-fields">
            ${field('검색 방식',select('mode',[['dialogue','대화로 검색'],['questions','질문으로 검색']],s.mode))}
            ${field('최근 대화 참고 개수',input('recentCount',s.recentCount,'number','min="1" max="200"'))}
            ${field('최종 주입 토큰 상한',input('injectionTokens',s.injectionTokens,'number','min="256" max="32000"'))}
            ${field('한 번에 수집할 메시지',input('batchSize',s.batchSize,'number','min="1" max="100"'))}
            ${field('검색 후보 구간',input('candidateCount',s.candidateCount,'number','min="1" max="40"'))}
            </div>${check('keywordActivation','기존 키워드 발동도 허용',s.keywordActivation)}
            ${check('sideEnabled','사이드 기록 변화 자동 반영',s.sideEnabled !== false)}</details>
            <details><summary>기본 프롬프트 편집</summary>
            ${[['collect','기억 수집'],['sides','사이드 기록 · 변화만 반영'],['questions','질문 만들기'],['select','원문 선별']].map(([key,label]) => `<details><summary>${label}</summary><textarea class="text_pole al-prompt" name="prompt.${key}" spellcheck="false">${escape(key === 'sides' ? s.sidePrompt || SIDE_PROMPT : s.prompts[key])}</textarea><div class="al-actions al-prompt-actions">${button('expand-prompt','전체화면 편집',`data-key="${key}"`)}${button('reset-prompt','이 프롬프트 초기화',`data-key="${key}"`)}</div></details>`).join('')}
            <div class="al-actions">${button('export-prompts','프롬프트 내보내기')}${button('import-prompts','프롬프트 가져오기')}<input type="file" data-prompt-file accept="application/json,.json" hidden></div>
            </details>${button('open','아카이브 로어 열기')}
            </div>`;
    }
    function expandPrompt(container,key) {
        const source=container.querySelector(`[name="prompt.${key}"]`);
        const editor=document.createElement('dialog');editor.className='al-root al-editor';
        editor.innerHTML=`<header><strong>프롬프트 전체화면 편집</strong><div class="al-actions">${button('editor-save','저장 후 닫기')}${button('editor-cancel','취소')}</div></header><textarea class="text_pole" aria-label="전체화면 프롬프트" spellcheck="false"></textarea>`;
        editor.querySelector('textarea').value=source.value;
        editor.addEventListener('click',safe(async event=>{
            const action=event.target.closest('[data-action]')?.dataset.action;
            if(action==='editor-save'){
                const value=editor.querySelector('textarea').value;
                api.saveSettings(key==='sides'?{sidePrompt:value}:{prompts:{...api.settings().prompts,[key]:value}});source.value=value;editor.close();
            } else if(action==='editor-cancel')editor.close();
        }));
        editor.addEventListener('close',()=>editor.remove(),{once:true});document.body.append(editor);editor.showModal();const textarea=editor.querySelector('textarea');textarea.focus();textarea.setSelectionRange(0,0);textarea.scrollTop=0;
    }
    function mountSettings(container) {
        container.innerHTML = settingsHtml();
        container.addEventListener('change', safe(async event => {
            const element = event.target;
            if (element.matches('[data-prompt-file]')) {
                const file = element.files?.[0]; if (!file) return;
                const payload = JSON.parse(await file.text());
                const fields = ['collect','questions','select'];
                if (payload.format !== 'archive-lore-prompts-v1' || fields.some(k => typeof payload.prompts?.[k] !== 'string') || typeof payload.sidePrompt !== 'string') throw new Error('아카이브 로어 프롬프트 파일이 아니야.');
                api.saveSettings({ prompts: payload.prompts, sidePrompt: payload.sidePrompt }); container.innerHTML = settingsHtml(); return;
            }
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
                    container.innerHTML=settingsHtml();
                } else if(element.name==='embeddingKey') api.saveSettings({embeddingKey:value,embeddingKeys:{...api.settings().embeddingKeys,[api.settings().embeddingProvider]:value}});
                else api.saveSettings({ [element.name]: value });
            }
        }));
        container.addEventListener('click', safe(async event => {
            const target = event.target.closest('[data-action]'); if (!target) return;
            switch (target.dataset.action) {
                case 'open': await open(); break;
                case 'expand-prompt': expandPrompt(container,target.dataset.key);break;
                case 'profiles': container.innerHTML = settingsHtml(); break;
                case 'reset-prompt': {
                    const key = target.dataset.key;
                    if (!window.confirm('편집한 프롬프트를 기본값으로 되돌릴까?')) return;
                    api.saveSettings(key === 'sides' ? { sidePrompt: SIDE_PROMPT } : { prompts: { ...api.settings().prompts, [key]: DEFAULT_PROMPTS[key] } });
                    container.querySelector(`[name="prompt.${key}"]`).value = key === 'sides' ? SIDE_PROMPT : DEFAULT_PROMPTS[key]; break;
                }
                case 'export-prompts': {
                    const s = normalizeSettings(api.settings());
                    const blob = new Blob([JSON.stringify({format:'archive-lore-prompts-v1',prompts:s.prompts,sidePrompt:s.sidePrompt || SIDE_PROMPT}, null, 2)], {type:'application/json'});
                    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download='archive-lore-prompts.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); break;
                }
                case 'import-prompts': container.querySelector('[data-prompt-file]').click(); break;
            }
        }));
    }
    async function refresh() {
        if (!dialog?.isConnected) return;
        const state = api.controller.state();
        dialog.querySelector('[data-status]').textContent = state.status;
        for (const element of dialog.querySelectorAll('[data-job]')) element.disabled = state.busy;
        dialog.querySelector('[data-action="stop"]').disabled = !state.busy;
        if (state.busy) return;
        const generation = ++redraw, view = await api.controller.dashboard();
        if (!dialog?.isConnected || generation !== redraw) return;
        const context = api.context();
        dialog.querySelector('[data-chat]').textContent = context.name || '채팅방을 열어 줘';
        dialog.querySelector('[data-counts]').innerHTML = `<span>기억 ${view.records.filter(r=>!r.entry[NS]?.sideCategory).length}</span><span>사이드 ${view.records.filter(r=>r.entry[NS]?.sideCategory).length}</span><span>임베딩 ${view.embedded}</span><span>대기 ${view.pending}</span>`;
        dialog.querySelector('[data-range]').textContent = view.ranges.length ? view.ranges.map(r=>`#${r.start}–#${r.end}`).join(' · ') : '아직 수집한 대화 없음';
        dialog.querySelector('[data-next]').textContent = view.next < context.messages.length ? `다음 수집 #${view.next}–#${context.messages.length-1}` : '새 대화 없음';
        dialog.querySelector('[name="rangeStart"]').value = view.next;
        dialog.querySelector('[name="rangeEnd"]').value = Math.max(0,context.messages.length-1);
        const names = api.bookNames();
        dialog.querySelector('[name="target"]').innerHTML = options([['','연결된 책 없음 · 수집 시 새로 만들기'], ...names.map(n=>[n,n])], api.target());
        const chosen = api.books();
        dialog.querySelector('[data-books]').innerHTML = names.map(n => `<label class="al-check"><input type="checkbox" data-book="${escape(n)}" ${chosen.includes(n)?'checked':''}><span>${escape(n)}</span></label>`).join('');
        const rows = view.records.filter(r => `${r.entry.comment}\n${r.entry.content}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
        const pages = Math.max(1,Math.ceil(rows.length/12)); page=Math.min(page,pages-1);
        dialog.querySelector('[data-page]').textContent = `${page+1}/${pages} · ${rows.length}항목`;
        dialog.querySelector('[data-action="prev"]').disabled = !page;
        dialog.querySelector('[data-action="next"]').disabled = page+1 >= pages;
        dialog.querySelector('[data-records]').innerHTML = rows.slice(page*12,page*12+12).map(row => {
            const e=row.entry, side=e[NS]?.sideCategory;
            return `<details class="al-record" data-record="${escape(row.id)}"><summary><span>${escape(e.comment || '제목 없음')}</span><small>${side?'사이드':isCore(e)?'코어':'기억'}</small></summary>
            <div class="al-record-body"><span class="al-muted">${escape(row.book)}</span>
            ${check('core','코어 · 항상 주입',isCore(e))}
            ${side === 'relationship' ? `<strong>${escape(e.content)}</strong>${field('관계 명칭', input('relationshipLabel', e[NS].facts?.[0]?.text || 'Undefined'))}${field('기간 기준', select('relationshipKind', [['start','관계 시작'],['breakup','이별'],['reunion','재회'],['other','기타']], e[NS].facts?.[0]?.relationship?.kind || 'other'))}${field('시작일 · 미상은 빈칸', input('relationshipSince', e[NS].facts?.[0]?.relationship?.since || '', 'date'))}${field('현재 RP 날짜', input('relationshipToday', e[NS].storyDate || '', 'date'))}` : side ? (e[NS].facts || []).map(f=>`<textarea class="text_pole" data-fact="${escape(f.id)}">${escape(f.text)}</textarea>`).join('') : `<textarea class="text_pole" name="content">${escape(e.content)}</textarea>`}
            ${button('save-record','저장')}
            ${translationHtml(api.translation?.(row.book,e))}
            ${e[NS]?.history?.length ? `<details><summary>변경 전 기록 (${e[NS].history.length})</summary>${[...e[NS].history].reverse().map(h=>`<pre>${escape(h.content)}</pre>`).join('')}</details>`:''}
            </div></details>`;
        }).join('') || '<div class="al-muted">표시할 기억 없음</div>';
        const recall = state.lastRecall;
        dialog.querySelector('[data-recall]').textContent = recall ? `${recall.tokens}토큰 · 후보 ${recall.candidateTotal}구간 · 미임베딩 ${recall.pending}구간${recall.shortened?' · 긴 대화 일부 생략':''}\n${recall.questions.join('\n')}\n\n[코어 · 항상 주입]\n${recall.core || '없음'}\n\n[검색으로 선별한 기억]\n${recall.text || '선별한 기억 없음'}` : '아직 회상한 기록 없음';
        dialog.querySelector('[data-recall-translations]').innerHTML=(recall?.records || []).map(r=>translationHtml(api.translation?.(r.book,r.entry),`${isCore(r.entry)?'코어':'선택된 기억'} 전체 번역 · ${r.entry.comment || r.book}`)).join('');
        const runs=await api.diagnostics?.list(context.key) || [];
        if(!dialog?.isConnected || generation!==redraw)return;
        const attempts=runs.filter(r=>r.kind==='generation');
        dialog.querySelector('[data-log-counts]').textContent=`대화로 검색 ${attempts.filter(r=>r.mode==='dialogue'&&!['skipped','error','canceled'].includes(r.status)).length}회 · 질문으로 검색 ${attempts.filter(r=>r.mode==='questions'&&!['skipped','error','canceled'].includes(r.status)).length}회 · 전체 기록 ${runs.length}개`;
        dialog.querySelector('[data-log-list]').innerHTML=runs.slice(-30).reverse().map(r=>`<details><summary>${escape(r.started)} · ${escape(r.kind)} · ${escape(r.mode)} · ${escape(r.status)}</summary><pre>${escape(JSON.stringify(r,null,2))}</pre></details>`).join('');
    }
    async function open() {
        if (dialog?.isConnected) { await refresh(); return; }
        dialog = document.createElement('dialog'); dialog.className='al-dialog al-root';
        dialog.innerHTML = `<header><div><small>ARCHIVE LORE</small><h3 data-chat></h3></div>${button('close','✕','aria-label="닫기"')}</header>
        <div class="al-scroll"><div class="al-counts" data-counts></div>
        <section class="al-card"><strong data-next></strong><div class="al-muted" data-range></div>
        <div class="al-actions">${button('collect','기억 수집','data-job')}${button('index','남은 임베딩','data-job')}${button('stop','중지')}</div><div data-status role="status" aria-live="polite"></div></section>
        <details class="al-card"><summary>수집 범위·로어북</summary>
        ${field('저장할 로어북',select('target',[],''))}
        <details><summary>검색할 로어북 선택</summary><div data-books></div></details>
        <div class="al-range">${field('시작 번호',input('rangeStart',0,'number','min="0"'))}${field('끝 번호',input('rangeEnd',0,'number','min="0"'))}</div>
        <div class="al-actions">${button('collect-range','이 범위 수집','data-job')}${button('start-here','다음 수집 시작점 지정','data-job')}${button('reindex','전체 임베딩 다시 만들기','data-job')}</div></details>
        <details class="al-card"><summary>최근 주입 확인</summary>${button('preview','지금 회상 미리보기','data-job')}<pre data-recall></pre><div data-recall-translations></div></details>
        <details class="al-card"><summary>턴별 진단 기록</summary><div data-log-counts></div><div class="al-actions">${select('logMode',[['all','전체 방식'],['dialogue','대화로 검색'],['questions','질문으로 검색']],'all')}${button('export-logs','진단 TXT 다운로드')}</div><div data-log-list></div></details>
        <section class="al-card"><div class="al-actions al-between"><strong>저장된 기억·사이드 기록</strong>${button('refresh','새로고침')}</div>
        <input class="text_pole" name="filter" placeholder="내용·제목 검색" aria-label="내용·제목 검색"><div data-records></div>
        <div class="al-actions al-pagination">${button('prev','이전')}<span data-page></span>${button('next','다음')}</div></section></div>`;
        document.body.append(dialog); dialog.showModal();
        dialog.addEventListener('close',()=>{dialog?.remove();dialog=null;redraw++;});
        dialog.addEventListener('change',safe(async event=>{
            if(event.target.name==='target'){await api.setTarget(event.target.value);await refresh();}
            if(event.target.dataset.book){await api.setBooks([...dialog.querySelectorAll('[data-book]:checked')].map(e=>e.dataset.book));await refresh();}
        }));
        let searchTimer;
        dialog.querySelector('[name="filter"]').addEventListener('input',event=>{filter=event.target.value;page=0;clearTimeout(searchTimer);searchTimer=setTimeout(()=>void refresh().catch(api.error),180);});
        dialog.addEventListener('click',safe(async event=>{
            const b=event.target.closest('[data-action]');if(!b)return;
            switch(b.dataset.action){
                case 'close':dialog.close();return;
                case 'collect':await api.controller.collect();break;
                case 'index':await api.controller.index();break;
                case 'stop':api.controller.cancel();break;
                case 'reindex':if(window.confirm('전체 기억을 다시 임베딩할까? 임베딩 API를 사용해.'))await api.controller.index(true);break;
                case 'collect-range':await api.controller.collect({start:Number(dialog.querySelector('[name="rangeStart"]').value),end:Number(dialog.querySelector('[name="rangeEnd"]').value)});break;
                case 'start-here':await api.setInitialStart(Number(dialog.querySelector('[name="rangeStart"]').value));break;
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
    return { mountSettings, open, refresh };
}
