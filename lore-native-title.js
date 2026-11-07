// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
export const ARCHIVE_LORE_TITLE_FORMAT = '[[000]] {{archiveLoreTitle}}';
export function titleFormatLabel(format) {
    return format === ARCHIVE_LORE_TITLE_FORMAT
        ? '아카이브 로어 · [번호] 작중 날짜 · 사건 제목' : format;
}
export function withArchiveLoreTitle(prompt, format) {
    if (!String(format || '').includes('{{archiveLoreTitle}}')) return prompt;
    return `${prompt}\n\nARCHIVE LORE TITLE FORMAT\nKeep the requested JSON schema unchanged. In its title field, write "YYYY-MM-DD · Short English event title". Use only the fictional date explicitly established for the event in the scene being summarized, never the real-world date, message timestamps, or the date of an unrelated flashback. If the event spans explicitly established dates, use "YYYY-MM-DD–YYYY-MM-DD · Short English event title". If no exact event date is established, write ONLY the short English event title: omit the date and separator, and never guess. Do not add a sequence number or enclosing brackets; the extension adds the number. These title formatting rules override any earlier title formatting instructions; all other memory instructions remain in effect.`;
}
