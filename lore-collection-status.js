// SPDX-License-Identifier: AGPL-3.0-only
// Small session receipts contain counts only, never generated text or credentials.
const recent = new Map();
const dismissed = new Map();
const flushedHides = new Map();
const terminal = new Set(['completed', 'failed', 'cancelled', 'canceled', 'needs_review', 'blocked']);
export function recordCollectionResult(key, value) {
    if (!key) return null;
    const receipt = { id: globalThis.crypto?.randomUUID?.() || String(Date.now()), at: Date.now(), side: { pending: true }, ...value };
    recent.delete(key); recent.set(key, receipt);
    if (recent.size > 20) recent.delete(recent.keys().next().value);
    return receipt;
}
export function dismissCollectionResult(key) {
    recent.delete(key); dismissed.set(key, Date.now());
    if (dismissed.size > 20) dismissed.delete(dismissed.keys().next().value);
}
export function markDeferredCollectionHideDone(key) {
    flushedHides.set(key,Date.now());
    if(flushedHides.size>20)flushedHides.delete(flushedHides.keys().next().value);
}
export function collectionResult(key, jobs = []) {
    const cutoff = dismissed.get(key) || 0;
    const memory = jobs.filter(j => j.chatKey === key && j.type === 'memory' && j.result?.memorySaved && j.createdAt > cutoff)
        .sort((a,b) => b.createdAt - a.createdAt)[0];
    const direct = recent.get(key);
    const result = memory && (!direct || memory.createdAt > direct.at)
        ? { id: memory.id, at: memory.createdAt, range: memory.range, memoryCount: memory.result.memoryCount ?? 1,
            hide: memory.result.autoHide, complete: terminal.has(memory.state), interrupted: memory.state !== 'completed' && terminal.has(memory.state),
            side: memory.result.sideSummary || { updated: 0, failed: 0 } }
        : direct ? { ...direct } : null;
    if (!result) return null;
    if(['failed','deferred'].includes(result.hide?.status) && result.hide.recordedAt && (flushedHides.get(key)||0)>=result.hide.recordedAt)
        result.hide={...result.hide,status:'deferredDone'};
    const children = jobs.filter(j => j.chatKey === key && j.parentJobId === result.id && ['sidePrompt','sidePromptBatch'].includes(j.type));
    if (children.length) {
        const side = { updated: 0, failed: result.side?.failed || 0, pending: false, interrupted: !!result.side?.interrupted };
        for (const child of children) {
            side.updated += Array.isArray(child.result?.successes) ? child.result.successes.length : child.result?.title ? 1 : 0;
            side.failed += Array.isArray(child.result?.failures) ? child.result.failures.length : child.state === 'failed' ? 1 : 0;
            side.pending ||= !terminal.has(child.state);
            side.interrupted ||= ['cancelled','canceled','needs_review','blocked'].includes(child.state);
        }
        result.side = side;
    }
    return result;
}

export function collectionResultLines(result) {
    const side = result.side || {};
    const lines = [`기억 ${result.memoryCount ?? 1}개 저장 · 사이드 ${side.updated ?? 0}개 갱신`];
    if (side.pending) lines.push('사이드 작업 대기·진행 중');
    if (side.failed) lines.push(`사이드 ${side.failed}개 실패`);
    if (side.interrupted || result.interrupted) lines.push('일부 후속 작업 중단 · 진행·저장 확인에서 확인해 주세요.');
    const hide = result.hide;
    if (!hide) lines.push('메시지 숨김 결과 확인 필요');
    else if (hide.status === 'off') lines.push('메시지 자동 숨기기 꺼짐');
    else if (hide.status === 'failed') lines.push('메시지 숨김 실패 · 기억은 저장되었습니다.');
    else if (hide.status === 'deferred') lines.push('메시지 숨김 보류 · 원래 채팅에서 처리합니다.');
    else if (hide.status === 'deferredDone') lines.push('보류했던 메시지 숨김 완료');
    else lines.push(`메시지 ${hide.changed}개 숨김 · 최근 ${hide.keep}개 유지 설정`);
    return lines;
}

export function createCollectionStatusPanel({ search, readResult, busy, subscribeJobs, openRecords, undo, retainResult = false, document: doc = globalThis.document }) {
    const key = search.context().key;
    let disposed = false, reading = false, rerun = false, counts = search.controller.cachedEmbeddingCounts?.() || null;
    let wasBusy = search.controller.state().busy;
    let wasNativeBusy = busy();
    const status = doc.createElement('div'); status.className = 'al-collection-status'; status.setAttribute('aria-live','polite');
    const enabled = doc.createElement('span'), pending = doc.createElement('span'); status.append(enabled,pending);
    const card = doc.createElement('section'); card.className = 'al-collection-result'; card.hidden = true; card.setAttribute('aria-live','polite');
    const title = doc.createElement('strong'), lines = doc.createElement('div'), embedding = doc.createElement('p'), actions = doc.createElement('div'), notice = doc.createElement('p');
    actions.className = 'al-range-actions'; notice.setAttribute('role','status'); card.append(title,lines,embedding,actions,notice);
    const current = () => !disposed && search.context().key === key;
    let acting = false;
    const button = (label, action) => {
        const b = doc.createElement('button'); b.type='button'; b.className='menu_button'; b.textContent=label;
        b.onclick=async()=>{if(!current() || acting)return;acting=true;paint();try{await action();}catch(e){if(current())notice.textContent=e.message;}finally{acting=false;if(current())paint();}};
        actions.append(b);return b;
    };
    const view = button('저장된 기억 보기',openRecords), back = button('되돌리기',undo);
    function paint() {
        if(!current()){
            status.hidden=true;
            if(retainResult && !disposed){view.disabled=true;back.disabled=true;notice.textContent='채팅이 변경되었습니다. 원래 채팅으로 돌아오면 결과 작업을 사용할 수 있습니다.';}
            else card.hidden=true;
            return;
        }
        if(retainResult && notice.textContent==='채팅이 변경되었습니다. 원래 채팅으로 돌아오면 결과 작업을 사용할 수 있습니다.')notice.textContent='';
        const config=search.settings(),state=search.controller.state(),auto=search.autoEmbeddingState;
        enabled.textContent=`검색·주입 ${config.enabled?'켜짐':'꺼짐'}`;
        pending.textContent=counts ? `임베딩 대기 ${counts.pending}개` : '임베딩 개수 확인 중…';
        const result=readResult();card.hidden=!result;if(!result)return;
        title.textContent=result.undone?'수집 되돌림':result.complete && !result.side?.pending ? '수집 완료' : '기억 저장 완료 · 후속 작업 중';
        if(result.interrupted || result.side?.failed || result.side?.interrupted)title.textContent='수집 결과 · 확인 필요';
        if(result.range)title.textContent+=` · #${result.range.sceneStart}–#${result.range.sceneEnd}`;
        lines.replaceChildren();for(const text of result.undone?['직전 수집을 되돌렸습니다.']:collectionResultLines(result)){const p=doc.createElement('p');p.textContent=text;lines.append(p);}
        embedding.textContent=!config.enabled?'자동 임베딩 미실행 · 검색·주입 꺼짐':config.autoEmbed===false?'자동 임베딩 꺼짐':
            state.busy && /^임베딩/.test(state.status)?'임베딩 진행 중':
            counts?.pending===0?'연결된 로어북 임베딩 완료':
            auto?.key===key && auto.status==='failed'?'자동 임베딩 실패 · 남은 임베딩에서 다시 실행할 수 있습니다.':
            auto?.key===key && auto.status==='cancelled'?'자동 임베딩 중단':
            counts?'임베딩 대기 중':'임베딩 상태 확인 중…';
        view.disabled=acting;back.disabled=acting||busy()||state.busy||!result.complete||!!result.side?.pending||!!result.undone;
    }
    async function refresh() {
        paint();if(!current()||search.controller.state().busy||busy())return;
        if(reading){rerun=true;return;}reading=true;
        try{const next=await search.controller.embeddingCounts();if(current()){counts=next;paint();}}
        catch(e){if(current()){counts=null;pending.textContent='임베딩 개수 확인 불가';if(e.name==='AbortError')rerun=true;}}
        finally{reading=false;if(rerun){rerun=false;if(current())void refresh();}}
    }
    const stopSearch=search.subscribe?.(()=>{if(!current())return;const now=search.controller.state().busy;const finished=wasBusy&&!now;wasBusy=now;paint();if(finished)void refresh();});
    const stopJobs=subscribeJobs?.(()=>{const now=busy(),finished=wasNativeBusy&&!now;wasNativeBusy=now;paint();if(finished)void refresh();});
    paint();void refresh();
    return { status, card, refresh, paint, dispose(){disposed=true;stopSearch?.();stopJobs?.();} };
}

// Completion notices run independently of the home screen and never block a
// collection/embedding task while waiting for the user's explicit close.
export function createCollectionResultPopup({search,native,snapshot,key,createPopup,affirmative,openRecords}) {
    let undone=false;
    const readResult=()=>{
        const latest=native.collectionKey()===key?native.collectionResult():null;
        return {...(latest?.id===snapshot.id?latest:snapshot),undone};
    };
    const panel=createCollectionStatusPanel({search,readResult,busy:()=>native.busy(),subscribeJobs:native.subscribeJobs,
        openRecords,retainResult:true,
        undo:async()=>{
            if(native.collectionKey()!==key || native.collectionResult()?.id!==snapshot.id)
                throw Error('더 최근 수집이 있거나 채팅이 변경되었습니다. 원래 채팅의 되돌리기 메뉴에서 확인해 주세요.');
            await native.undo();undone=native.collectionResult()?.id!==snapshot.id;
        },
    });
    panel.card.classList.add('al-collection-result-popup');
    const popup=createPopup(panel.card,{okButton:'닫기',cancelButton:false,allowVerticalScrolling:true,
        onClosing:closing=>closing.result===affirmative});
    popup.dlg.classList.add('al-collection-completion');
    // Keep the host close button and its keyboard/click handlers in the same row.
    panel.card.querySelector('.al-range-actions').append(popup.okButton);
    popup.dlg.addEventListener('cancel',event=>{event.preventDefault();event.stopImmediatePropagation();},true);
    return {panel,popup};
}

export function createCollectionCompletionNotifier({readResult,currentKey,busy,open,onError=()=>{}}) {
    const seen=new Set(),waiting=new Map();let active=false,scheduled=false;
    const token=(key,result)=>JSON.stringify([key,result.id]);
    function check(){
        const key=currentKey(),result=readResult();
        if(result?.complete && !result.side?.pending && !result.undone){
            const id=token(key,result);
            if(!seen.has(id))waiting.set(id,{key,result:structuredClone(result)});
        }
        if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;void pump();});}
    }
    async function pump(){
        if(active||busy())return;
        const next=[...waiting].find(([,item])=>item.key===currentKey());if(!next)return;
        const [id,item]=next;waiting.delete(id);seen.add(id);
        if(seen.size>100)seen.delete(seen.values().next().value);
        active=true;
        try{await open(item.result,item.key);}catch(error){onError(error);}
        finally{active=false;check();}
    }
    return {check};
}
