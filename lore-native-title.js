// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
export const ARCHIVE_LORE_TITLE_FORMAT = '{{archiveLoreTitle}}';
export const LEGACY_ARCHIVE_LORE_TITLE_FORMAT = '[[000]] {{archiveLoreTitle}}';
export function isArchiveLoreDateFormat(format) {
    return format === ARCHIVE_LORE_TITLE_FORMAT || format === LEGACY_ARCHIVE_LORE_TITLE_FORMAT;
}
export function migrateArchiveLoreTitleFormat(settings) {
    let changed = false;
    for (const target of [settings, ...(Array.isArray(settings?.profiles) ? settings.profiles : [])]) {
        if (target?.titleFormat !== LEGACY_ARCHIVE_LORE_TITLE_FORMAT) continue;
        target.titleFormat = ARCHIVE_LORE_TITLE_FORMAT;
        changed = true;
    }
    return changed;
}
// The model supplies story time. Never substitute today's date or a message timestamp.
export function archiveLoreDateTitle(title) {
    const match = String(title || '').trim().match(/^(?:\[\d+\]\s*)?(\d{4}-\d{2}-\d{2})(?:\s*[–—~～]\s*(\d{4}-\d{2}-\d{2}))?(?=$|\s|[·:])/u);
    if (!match) return '날짜 미상';
    const valid = value => {
        const date = new Date(`${value}T00:00:00Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!valid(match[1]) || (match[2] && !valid(match[2]))) return '날짜 미상';
    return match[2] && match[2] !== match[1] ? `${match[1]}–${match[2]}` : match[1];
}
export function titleFormatLabel(format) {
    return isArchiveLoreDateFormat(format)
        ? '아카이브 로어 · 작중 날짜만' : format;
}
export function withArchiveLoreTitle(prompt, format) {
    if (!String(format || '').includes('{{archiveLoreTitle}}')) return prompt;
    return `${prompt}\n\nARCHIVE LORE TITLE FORMAT\nKeep the requested JSON schema unchanged. In its title field, write ONLY "YYYY-MM-DD". Use only the fictional date explicitly established for the event in the scene being summarized, never the real-world date, message timestamps, or the date of an unrelated flashback. If the event spans explicitly established dates, use "YYYY-MM-DD–YYYY-MM-DD". If no exact event date is established, write "날짜 미상" and never guess. Do not add a sequence number, enclosing brackets, event title, or description. These title formatting rules override any earlier title formatting instructions; all other memory instructions remain in effect.`;
}
