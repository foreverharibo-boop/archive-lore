// SPDX-License-Identifier: AGPL-3.0-only
export function normalizeSideSearchExclusions(value) {
    return [...new Set((Array.isArray(value) ? value : []).filter(key => typeof key === 'string' && key.trim()))].sort();
}

export function excludedSidePromptKeys(templates) {
    return normalizeSideSearchExclusions(templates.filter(t => t.settings?.archiveLoreSearchEnabled === false).map(t => t.key));
}

/** Filter only Archive retrieval. Never rewrite native activation or generation settings. */
export function entrySearchAllowed(entry, excludedKeys = []) {
    const key = entry?.STMB_sidePromptHistory?.templateKey || entry?.STMB_sidePromptRegeneration?.templateKey;
    return !key || !excludedKeys.includes(key);
}

export function sideSearchControl(prefix, settings = {}) {
    if (!globalThis.archiveLoreFork) return '';
    return `<div class="world_entry_form_control"><label class="checkbox_label">
        <input type="checkbox" id="${prefix}-archive-search" ${settings.archiveLoreSearchEnabled !== false ? 'checked' : ''}>
        <span>아카이브 검색에 포함</span>
    </label></div>`;
}
