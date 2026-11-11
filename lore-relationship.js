// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
export function dateDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
    const ms = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
    return Math.floor(ms / 86400000);
}
export function relationshipLabel(text) {
    if (typeof text !== 'string' || !/^[A-Za-z]+(?:[ -][A-Za-z]+){0,2}$/.test(text.trim()) || text.length > 40)
        throw new Error('관계는 Lovers처럼 짧은 영어 명칭으로 입력해 줘.');
    return text.trim();
}
export function relationshipPhase(label, details, prior = null) {
    label = relationshipLabel(label);
    const same = prior?.text?.toLowerCase() === label.toLowerCase();
    const kind = details?.kind ?? (same ? prior.relationship?.kind : null)
        ?? (/^ex[ -]/i.test(label) ? 'breakup' : /^(lovers|married|partners)$/i.test(label) ? 'start' : 'other');
    if (!['start', 'breakup', 'reunion', 'other'].includes(kind)) throw new Error('관계 날짜의 종류를 확인해 줘.');
    const samePhase = same && kind === prior?.relationship?.kind;
    // Null from an unchanged status means "no newly established date", not "erase the known date".
    const since = details?.since ?? (samePhase ? prior?.relationship?.since : null) ?? null;
    if (since !== null && dateDay(since) === null) throw new Error('관계 시작일은 유효한 YYYY-MM-DD 날짜여야 해.');
    return { kind, since };
}
export function formatRelationship(fact, currentDate) {
    const label = fact?.text || 'Undefined', phase = fact?.relationship;
    if (!phase) return label;
    const start = dateDay(phase.since), now = dateDay(currentDate);
    const suffix = phase.kind === 'breakup' ? ' since breakup' : phase.kind === 'reunion' ? ' since reunion' : '';
    if (start === null) return `${label} · Start date unknown`;
    if (now === null || now < start) return `${label} · Current story date unknown`;
    return `${label} · D+${now - start + 1}${suffix}`;
}
