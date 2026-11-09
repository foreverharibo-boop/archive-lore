// Archive Lore — AGPL-3.0-only. Saved editor placement, independent of injection order.
import { fingerprintRollbackEntry } from './memoryRollback.js';

export function isArchiveSideEntry(entry) {
    return Boolean(entry?.STMB_sidePromptHistory?.templateKey
        || entry?.STMB_sidePromptRegeneration?.templateKey
        || entry?.archiveLore?.sideCategory
        || / \(STMB (?:SidePrompt|Plotpoints|Scoreboard|Tracker)\)$/.test(String(entry?.comment || '').trimEnd()));
}

function displayIndex(entry) {
    const value = Number(entry.displayIndex ?? entry.uid);
    return Number.isFinite(value) ? value : (Number(entry.uid) || 0);
}

/** New ordinary records append to ordinary records; only sides move as the book grows. */
export function maintainArchiveDisplayOrder(data, newEntry = null) {
    const entries = Object.values(data?.entries || {}).filter(entry => entry && typeof entry === 'object');
    const sides = entries.filter(isArchiveSideEntry).sort((a, b) => displayIndex(a) - displayIndex(b) || Number(a.uid) - Number(b.uid));
    let changed = false;
    const update = (entry, index) => {
        if (entry.displayIndex === index) return;
        const snapshot = entry.STMB_sidePromptRegeneration;
        const valid = snapshot?.version === 2
            && snapshot.writtenFingerprint === fingerprintRollbackEntry(entry, { excludeSidePromptSnapshot: true });
        entry.displayIndex = index;
        // Refresh only a snapshot that was already valid; never bless unrelated edits.
        if (valid) snapshot.writtenFingerprint = fingerprintRollbackEntry(entry, { excludeSidePromptSnapshot: true });
        changed = true;
    };
    let lastOrdinary = Math.max(-1, ...entries.filter(entry => entry !== newEntry && !isArchiveSideEntry(entry)).map(displayIndex));
    if (newEntry && !isArchiveSideEntry(newEntry)) {
        update(newEntry, lastOrdinary + 1);
        lastOrdinary = displayIndex(newEntry);
    }
    if (sides.some(entry => displayIndex(entry) <= lastOrdinary)) {
        sides.forEach((entry, index) => update(entry, lastOrdinary + 1 + index));
    }
    return changed;
}
