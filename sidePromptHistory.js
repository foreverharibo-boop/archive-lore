export const SIDE_PROMPT_HISTORY_KEY = 'STMB_sidePromptHistory';
export const SIDE_PROMPT_SUFFIX = ' (STMB SidePrompt)';

/** Builds the history identity independently of prompt display names and inclusion groups. */
export function buildSidePromptHistoryRequest(template, settings, sceneContext, titleBase, legacyTitles) {
    const ref = sceneContext?.chatRef;
    return {
        templateKey: String(template?.key || ''),
        chatKey: ref?.type === 'group'
            ? JSON.stringify(['group', sceneContext.groupId, ref.chatId])
            : JSON.stringify(['character', ref?.avatarUrl, ref?.fileName]),
        chatId: String(sceneContext?.chatId || ''),
        titleBase: titleBase.endsWith(SIDE_PROMPT_SUFFIX) ? titleBase.slice(0, -SIDE_PROMPT_SUFFIX.length) : titleBase,
        // A template rename changes its default title, not its history. Macro-resolved overrides are separate streams.
        titleSource: String(template?.settings?.lorebook?.entryTitleOverride || '').trim() ? 'override' : 'name',
        group: `${template?.name || ''}-${sceneContext?.chatId || ''}`.replace(/\s/g, '').replace(/,/g, '-'),
        append: settings?.moduleSettings?.sidePromptVersioningEnabled === true && template?.settings?.saveAllVersions === true,
        legacyTitles,
    };
}

/** Rejects malformed or ambiguous history requests without including entry data in errors. */
export function sidePromptHistoryError(status = 409) {
    return Object.assign(new Error(status === 400 ? 'Invalid side-prompt history request.' : 'Side-prompt history is ambiguous. No changes were saved.'), {
        status, type: status === 400 ? 'StmbSidePromptHistoryInvalid' : 'StmbSidePromptHistoryConflict',
    });
}

/** Validates the optional history request at the save boundary. */
export function validateSidePromptHistoryRequest(history) {
    if (!history || typeof history !== 'object' || Array.isArray(history)
        || ['templateKey', 'chatKey', 'chatId', 'titleBase', 'group'].some(key => typeof history[key] !== 'string' || !history[key].trim() || history[key].length > 4096)
        || !['name', 'override'].includes(history.titleSource) || typeof history.append !== 'boolean'
        || /[\s,]/u.test(history.group)
        || !Array.isArray(history.legacyTitles) || history.legacyTitles.length > 4
        || history.legacyTitles.some(title => typeof title !== 'string' || !title.trim() || title.length > 4096)) {
        throw sidePromptHistoryError(400);
    }
    let identity;
    try { identity = JSON.parse(history.chatKey); } catch { throw sidePromptHistoryError(400); }
    if (!Array.isArray(identity) || identity.length !== 3 || !['character', 'group'].includes(identity[0])
        || identity.some(value => typeof value !== 'string' || !value.trim()) || identity[2] !== history.chatId) {
        throw sidePromptHistoryError(400);
    }
}

/** Matches a stored stream; display-name changes never merge unrelated macro variants. */
function isSameSidePromptHistory(stored, requested) {
    return stored?.version === 1 && stored.templateKey === requested.templateKey && stored.chatKey === requested.chatKey
        && stored.titleSource === requested.titleSource
        && (stored.titleSource === 'name' || stored.titleBase === requested.titleBase);
}

/** Stable stream key shared by history lookup and rollback reconciliation. */
export function getSidePromptHistoryStreamKey(history) {
    if (!history || history.version !== 1 || typeof history.templateKey !== 'string' || typeof history.chatKey !== 'string'
        || !['name', 'override'].includes(history.titleSource)) return null;
    return JSON.stringify([history.templateKey, history.chatKey, history.titleSource,
        history.titleSource === 'override' ? String(history.titleBase || '') : '']);
}

function resolveVersions(versions) {
    const sequences = new Set();
    for (const entry of versions) {
        const sequence = entry[SIDE_PROMPT_HISTORY_KEY].sequence;
        if (!Number.isSafeInteger(sequence) || sequence < 1 || sequences.has(sequence)) throw sidePromptHistoryError();
        sequences.add(sequence);
    }
    versions.sort((a, b) => a[SIDE_PROMPT_HISTORY_KEY].sequence - b[SIDE_PROMPT_HISTORY_KEY].sequence);
    return { versions, latest: versions.at(-1) || null, legacy: null };
}

/** Overwrite mode can continue a unique output in the selected book after chat import/rename. */
function resolveInheritedOutput(entries, history) {
    const requestedOwner = JSON.parse(history.chatKey).slice(0, 2);
    const inherited = entries.filter(entry => {
        if (entry?.stmemorybooks === true) return false;
        const stored = entry?.[SIDE_PROMPT_HISTORY_KEY];
        if (stored) {
            if (!isSameSidePromptHistory(stored, { ...history, chatKey: stored.chatKey })) return false;
            try {
                const owner = JSON.parse(stored.chatKey);
                return Array.isArray(owner) && owner.length === 3
                    && owner[0] === requestedOwner[0] && owner[1] === requestedOwner[1];
            } catch { return false; }
        }
        // A matching title alone cannot identify a record owned by another prompt.
        const snapshot = entry?.STMB_sidePromptRegeneration;
        return snapshot?.templateKey === history.templateKey
            && history.legacyTitles.includes(String(entry.comment || ''));
    });
    if (!inherited.length) return { versions: [], latest: null, legacy: null };
    const versions = inherited.filter(entry => entry[SIDE_PROMPT_HISTORY_KEY]);
    if (versions.length) {
        const streams = new Set(versions.map(entry => getSidePromptHistoryStreamKey(entry[SIDE_PROMPT_HISTORY_KEY])));
        if (versions.length !== inherited.length || streams.size !== 1) throw sidePromptHistoryError();
        return resolveVersions(versions);
    }
    if (inherited.length !== 1) throw sidePromptHistoryError();
    return { versions: [], latest: inherited[0], legacy: inherited[0] };
}

/** Resolves the newest version or an unambiguous legacy output for reads and locked writes. */
export function resolveSidePromptHistory(lorebookData, history) {
    validateSidePromptHistoryRequest(history);
    const entries = Object.values(lorebookData?.entries || {});
    const resolved = resolveVersions(entries.filter(entry => isSameSidePromptHistory(entry?.[SIDE_PROMPT_HISTORY_KEY], history)));
    if (resolved.latest) return resolved;
    const { versions } = resolved;
    const candidates = entries.filter(entry => {
        if (entry?.stmemorybooks === true) return false;
        if (entry?.[SIDE_PROMPT_HISTORY_KEY]) return false;
        const snapshot = entry?.STMB_sidePromptRegeneration;
        return !(snapshot && (snapshot.templateKey !== history.templateKey || snapshot.chatId !== history.chatId));
    });
    for (const title of history.legacyTitles) {
        const legacy = candidates.filter(entry => String(entry?.comment || '') === title);
        if (legacy.length > 1) throw sidePromptHistoryError();
        if (legacy.length === 1) return { versions, latest: legacy[0], legacy: legacy[0] };
    }
    // Old overwrite-mode records did not receive history IDs. Recover a unique
    // name-based record from its existing regeneration identity after a rename.
    // Explicit/macro-resolved titles remain independent streams.
    if(history.titleSource==='name') {
        const identified=candidates.filter(entry=>entry.STMB_sidePromptRegeneration?.templateKey===history.templateKey
            && entry.STMB_sidePromptRegeneration?.chatId===history.chatId);
        if(identified.length>1)throw sidePromptHistoryError();
        if(identified.length===1)return {versions,latest:identified[0],legacy:identified[0]};
    }
    // Prefer current-chat records above. Only inherit in overwrite mode, and never
    // guess between multiple old streams or remove already-created duplicates.
    return history.append ? resolved : resolveInheritedOutput(entries, history);
}

/** Formats a version title without truncating sequence numbers above 999. */
export function formatSidePromptVersionTitle(base, sequence) {
    return `${base}-${String(sequence).padStart(3, '0')}${SIDE_PROMPT_SUFFIX}`;
}
