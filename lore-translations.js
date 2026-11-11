// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
// Read-only compatibility with lore-manager's simple-lorebook translation schema.
// Its sourceHash is unsigned FNV-1a over UTF-16 code units, base36 + '_' + length.
export function managerSourceHash(text) {
    text = String(text ?? '');let value = 0x811c9dc5;
    for (let i=0;i<text.length;i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return value.toString(36) + '_' + text.length;
}
export function linkedTranslation(settings, book, entry) {
    const manager = settings?.['simple-lorebook'];
    const record = manager?.translations?.[`${book}\u241f${entry.uid}`];
    if (!record || typeof record.text !== 'string' || !record.text.trim()) return null;
    const expected = manager.entryLanguagePairs?.[`${book}\u241f${entry.uid}`]?.translationLanguage;
    if (expected && record.language !== expected) return null;
    return { text:record.text, language:record.language || '', stale:record.sourceHash !== managerSourceHash(entry.content), updatedAt:record.updatedAt || null };
}
