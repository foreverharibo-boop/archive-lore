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

/** One explicit action repairs an existing book; opening the editor never writes data. */
export function installArchiveDisplayOrderAction({ document, getBook, loadBook, saveBook, refresh, busy, notify }) {
    const anchor = document.getElementById('world_refresh');
    if (!anchor || document.getElementById('al-repair-display-order')) return;
    const button = document.createElement('button');
    button.id = 'al-repair-display-order'; button.type = 'button'; button.className = 'menu_button';
    button.textContent = '사이드 아래로 정리';
    button.title = '아카이브 로어: 요약 순서를 유지하고 사이드 표시 위치만 아래로 정리';
    anchor.after(button);
    let running = false;
    button.addEventListener('click', async () => {
        if (running) return;
        running = true; button.disabled = true;
        try {
            const book = getBook();
            if (!book) throw Error('먼저 로어북을 선택해 줘.');
            if (busy()) throw Error('수집·사이드 작업이 끝난 뒤 눌러 줘.');
            const source = await loadBook(book);
            if (!source?.entries) throw Error('로어북을 불러올 수 없어.');
            const before = fingerprintRollbackEntry(source), data = structuredClone(source);
            const changed = maintainArchiveDisplayOrder(data);
            const fresh = await loadBook(book);
            if (getBook() !== book || busy() || fingerprintRollbackEntry(fresh) !== before) {
                throw Error('작업 중 로어북이 바뀌었어. 다시 눌러 줘.');
            }
            if (changed) await saveBook(book, data);
            if (getBook() === book) {
                const select = document.getElementById('world_info_sort_order');
                const custom = Array.from(select?.options || []).find(option => option.dataset.rule === 'custom');
                if (custom && select.value !== custom.value) {
                    select.value = custom.value;
                    select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
                } else await refresh(book);
            }
            notify(changed ? '사이드를 아래로 정리했어. 요약 순서와 내용은 그대로야.' : '저장된 기본 표시 순서로 전환했어.', 'success');
        } catch (error) { notify(error.message || String(error), 'error'); }
        finally { running = false; button.disabled = false; }
    });
}
