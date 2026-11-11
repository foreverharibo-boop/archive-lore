// Archive Lore — AGPL-3.0-only. Per-chat switch; existing chats keep their behavior.
export const SIDE_AUTO_KEY = 'archiveLoreSideAfterMemoryEnabled';
export const sideAutoEnabled = markers => markers?.[SIDE_AUTO_KEY] !== false;

export function mountSideAutoToggle(container, {markers, save, document:doc=globalThis.document}) {
    const box=doc.createElement('div');box.className='al-side-auto-toggle';
    const label=doc.createElement('label'),input=doc.createElement('input'),text=doc.createElement('span');
    input.type='checkbox';input.id='al-side-after-memory-enabled';input.checked=sideAutoEnabled(markers);
    text.textContent='기억 수집 후 사이드 프롬프트 자동 실행';label.append(input,text);
    const note=doc.createElement('small');note.className='al-optional-help';
    note.textContent='이 채팅에 적용됩니다. 끄면 다음 기억 수집 후 사이드 기록을 생성·갱신하지 않습니다. 기존 기록과 항목별 설정은 유지됩니다. 이미 실행 중인 작업과 수동·메시지 간격 실행은 별도입니다.';
    input.addEventListener('change',()=>{markers[SIDE_AUTO_KEY]=input.checked;save();});
    box.append(label,note);container.prepend(box);return input;
}
