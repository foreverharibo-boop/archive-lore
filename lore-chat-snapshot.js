// SPDX-License-Identifier: AGPL-3.0-only
import {sourceRange,matchesRange} from './lore-core.js';

// Reuse the existing message fingerprints without transporting message bodies.
// Hiding a collected message must not invalidate its source identity.
export function serverChatSnapshot(context) {
    const messages=context.messages;
    return {key:context.key,name:context.name,snapshotVersion:1,messageCount:messages.length,
        source:messages.length?sourceRange(messages,0,messages.length-1):null};
}

export function chatSnapshotInfo(context) {
    // Keep older clients working when only the server plugin has been updated.
    if(context?.snapshotVersion===undefined && Array.isArray(context?.messages))return serverChatSnapshot(context);
    const count=context?.messageCount,source=context?.source;
    if(context?.snapshotVersion!==1 || !Number.isSafeInteger(count) || count<0
        || (count===0 ? source!==null : !source || source.start!==0 || source.end!==count-1
            || !Array.isArray(source.hashes) || source.hashes.length!==count
            || !source.hashes.every(hash=>typeof hash==='string')))
        throw Error('서버 대화 확인 정보가 올바르지 않아. 확장과 서버 플러그인을 함께 업데이트해 줘.');
    return {messageCount:count,source};
}

export function matchesChatSnapshot(snapshot,messages,exact=true) {
    const {messageCount,source}=chatSnapshotInfo(snapshot);
    return (exact?messages.length===messageCount:messages.length>=messageCount)
        && (messageCount===0 || matchesRange(source,messages));
}
