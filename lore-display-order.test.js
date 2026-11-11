import test from 'node:test';
import assert from 'node:assert/strict';
import { isArchiveSideEntry, maintainArchiveDisplayOrder } from './lore-display-order.js';
import { fingerprintRollbackEntry, applySidePromptRestoration } from './memoryRollback.js';
import { buildSidePromptRegenerationSnapshot } from './memoryRegeneration.js';

const order = data => Object.values(data.entries).sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid)).map(e => e.uid);
const side = (uid, displayIndex) => ({ uid, displayIndex, comment: 'Relationship', content: 'side', order: 100,
    vectorized: true, STMB_sidePromptHistory: { templateKey: 'relationship' } });

test('new memory follows existing ordinary order and precedes sides even when UID is reused', () => {
    const a = { uid: 4, displayIndex: 80, comment: 'earlier memory', order: 24 };
    const b = { uid: 2, displayIndex: 90, comment: 'later memory', order: 25 };
    const s = side(5, 91);
    const next = { uid: 0, displayIndex: 92, comment: 'new memory', order: 26 };
    const data = { entries: { 4: a, 2: b, 5: s, 0: next } };
    assert.equal(maintainArchiveDisplayOrder(data, next), true);
    assert.deepEqual(order(data), [4, 2, 0, 5]);
    assert.equal(next.displayIndex, 91);
    assert.equal(s.displayIndex, 92);
    assert.equal(a.displayIndex, 80);
    assert.equal(b.displayIndex, 90);
    assert.deepEqual(Object.values(data.entries).map(e => e.order), [26, 25, 24, 100]);
    assert.equal(maintainArchiveDisplayOrder(data), false);
});

test('repair moves only sides, preserves relative order and all unrelated content/settings', () => {
    const data = { entries: { 0: side(0, 5), 1: { uid: 1, displayIndex: 10, order: 24, content: 'memory' },
        2: side(2, 2), 3: { uid: 3, displayIndex: 9, order: 500, content: 'manual first' } } };
    const before = structuredClone(data);
    maintainArchiveDisplayOrder(data);
    assert.deepEqual(order(data), [3, 1, 2, 0]);
    for (const [uid, entry] of Object.entries(data.entries)) {
        assert.deepEqual({ ...entry, displayIndex: before.entries[uid].displayIndex }, before.entries[uid]);
    }
    assert.equal(maintainArchiveDisplayOrder(data), false);
});

test('side identification uses history, regeneration, old Archive metadata and exact legacy suffixes', () => {
    for (const entry of [side(0, 0), { STMB_sidePromptRegeneration: { templateKey: 'a' } },
        { archiveLore: { sideCategory: 'relationship' } }, { comment: 'A (STMB SidePrompt)' }, { comment: 'B (STMB Tracker)' }]) {
        assert.equal(isArchiveSideEntry(entry), true);
    }
    assert.equal(isArchiveSideEntry({ comment: 'Relationship', stmemorybooks: true }), false);
    assert.equal(isArchiveSideEntry({ comment: 'A (STMB SidePrompt) mentioned in scene' }), false);
});

test('moving a side refreshes valid rollback fingerprints without blessing edited content', () => {
    for (const edited of [false, true]) {
        const prior = side(0, 0); prior.content = 'previous';
        const current = side(0, 0);
        current.STMB_sidePromptRegeneration = buildSidePromptRegenerationSnapshot({
            templateKey: 'relationship', priorEntry: prior, writtenEntry: current,
            compiledScene: { metadata: { chatId: 'chat', sceneStart: 0, sceneEnd: 1 } },
        });
        const originalFingerprint = current.STMB_sidePromptRegeneration.writtenFingerprint;
        if (edited) current.content = 'user edited';
        const data = { entries: { 0: current, 1: { uid: 1, displayIndex: 3, comment: 'memory' } } };
        maintainArchiveDisplayOrder(data);
        assert.equal(current.displayIndex, 4);
        if (edited) {
            assert.equal(current.STMB_sidePromptRegeneration.writtenFingerprint, originalFingerprint);
            assert.equal(applySidePromptRestoration(data, { entryKey: '0' }).changed, false);
        } else {
            assert.equal(current.STMB_sidePromptRegeneration.writtenFingerprint,
                fingerprintRollbackEntry(current, { excludeSidePromptSnapshot: true }));
            assert.equal(applySidePromptRestoration(data, { entryKey: '0' }).changed, true);
            assert.equal(data.entries[0].content, 'previous');
            maintainArchiveDisplayOrder(data);
            assert.deepEqual(order(data), [1, 0]);
        }
    }
});
