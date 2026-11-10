// Archive Lore — AGPL-3.0-only. Interval sides share the successful memory's snapshot.
export function captureIntervalScene(scene, { chat, compileScene, createSceneRequest }) {
    const end = scene.metadata.sceneEnd;
    const visibleIds = [];
    for (let id = 0; id <= end && id < chat.length; id++) {
        if (chat[id] && !chat[id].is_system) visibleIds.push(id);
    }
    // Preserve the existing interval runner's 200-message input cap, without
    // unhiding anything or reading messages received after this memory started.
    const start = Math.max(0, end - 199);
    const snapshot = visibleIds.some(id => id >= start)
        ? compileScene(createSceneRequest(start, end))
        : { metadata: { ...scene.metadata }, messages: [...scene.messages] };
    scene.archiveLoreInterval = { visibleIds, scene: snapshot };
    return scene;
}

export function intervalSceneAfterMemory(scene, template, existing) {
    const snapshot = scene?.archiveLoreInterval;
    // Older queued snapshots may lack the extra history; use only their saved
    // scene, never the currently open chat.
    const source = snapshot?.scene || scene;
    const ids = snapshot?.visibleIds || source?.messages?.map(message => message.id) || [];
    const raw = existing?.[`STMB_sp_${template.key}_lastMsgId`]
        ?? existing?.STMB_score_lastMsgId ?? existing?.STMB_tracker_lastMsgId;
    const last = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : -1;
    const end = Number(scene?.metadata?.sceneEnd);
    const threshold = Number(template?.triggers?.onInterval?.visibleMessages);
    if (!Number.isFinite(end) || !Number.isFinite(threshold) || threshold < 1) return null;
    if (ids.filter(id => id > last && id <= end).length < threshold) return null;
    const messages = (source?.messages || []).filter(message => message.id > last && message.id <= end);
    if (!messages.length) return null;
    return { metadata: { ...source.metadata, sceneStart: messages[0].id, sceneEnd: end,
        messageCount: messages.length }, messages };
}

export function mergeAfterMemoryItems(after, interval) {
    // Set rows may intentionally use one template with different macro values.
    const key = item => JSON.stringify([item.tpl?.key, item.item?.id || '', item.runtimeMacros || {}]);
    const seen = new Set(after.map(key));
    return [...after, ...interval.filter(item => {
        const id = key(item);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    }).map(item => ({ ...item, archiveInterval: true }))];
}
