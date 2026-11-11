// SPDX-License-Identifier: AGPL-3.0-only
export const NO_SIDE_CHANGES = '[NO_NEW_SIDE_FACTS]';

export function sideWriteMode(settings) {
    return settings?.sideWriteMode === 'append' ? 'append' : 'update';
}

export const SIDE_APPEND_RULES = `=== APPEND-ONLY SIDE RECORD ===
The application preserves the PRIOR ENTRY verbatim. Output ONLY new facts or later developments supported by the supplied SCENE TEXT, in the requested category and language. Do not copy, paraphrase, replace, reorder, or summarize the prior record. Prior memories and additional context are background, not new events.
If a prior state changed, append a clear later update; do not present the old state as still current. Never invent a date. Do not output headings or explanations about this task.
If there is nothing new to add, output exactly ${NO_SIDE_CHANGES}.
These append-only output rules override instructions requesting a complete rewritten record, including the response-format template.\n`;

export function appendSideRecord(prior, addition) {
    const original = String(prior ?? '');
    let next = String(addition ?? '').trim();
    if (!next) throw new Error('사이드 응답이 비어 있어 저장하지 않았습니다. 기존 기록은 유지됩니다.');
    if (next === NO_SIDE_CHANGES) return original || 'Not established.';
    // Some models echo the full prior record despite the delta instruction.
    const previous = original.trim();
    if (previous && next.startsWith(previous)) next = next.slice(previous.length).trim();
    if (!next) return original;
    return original ? `${original}\n\n${next}` : next;
}

export function sideWriteModeControl(prefix, settings = {}) {
    const mode = sideWriteMode(settings);
    return `<div class="world_entry_form_control">
        <label for="${prefix}-write-mode"><h4>기존 내용 처리 방식</h4>
        <select id="${prefix}-write-mode" class="text_pole">
            <option value="update" ${mode === 'update' ? 'selected' : ''}>전체 내용 갱신 (기존 방식)</option>
            <option value="append" ${mode === 'append' ? 'selected' : ''}>기존 내용에 이어서 쓰기</option>
        </select></label>
        <small class="opacity70p">전체 갱신은 기존 기록과 이번 대화를 읽고 전체 본문을 다시 작성합니다. 이어서 쓰기는 기존 원문을 그대로 보존하고 새 내용만 뒤에 붙입니다. 전체 갱신도 전체 채팅을 처음부터 다시 읽는 기능은 아닙니다.</small>
    </div>`;
}
