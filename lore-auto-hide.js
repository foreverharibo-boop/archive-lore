// SPDX-License-Identifier: AGPL-3.0-only
import { getContext } from '../../../extensions.js';
import { hideChatMessageRange } from '../../../chats.js';

// Native hiding changes flags before saving. Retain failed saves even when
// every message already looks hidden, without retaining closed chats in memory.
const pendingHideSaves = new WeakSet();

// Use the host's native hide/save path, then check the actual message flags.
// A chat change must never redirect a completed job's hide operation.
export async function applyAutoHideRanges(ranges, expectedChat = getContext().chat) {
    let changed = 0;
    for (const range of ranges) {
        const ctx = getContext();
        if (ctx.chat !== expectedChat) throw new Error('채팅이 변경되어 메시지 숨기기를 중단했습니다.');
        const { start, end } = range;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= ctx.chat.length) {
            throw new Error('숨길 메시지 범위가 현재 대화와 일치하지 않습니다.');
        }
        const count = ctx.chat.slice(start, end + 1).filter(message => message && !message.is_system).length;
        if (!count && !pendingHideSaves.has(expectedChat)) continue;
        for (let attempt = 0; attempt < 2; attempt++) {
            // Recheck before the immediate retry so it cannot affect another chat.
            if (getContext().chat !== expectedChat) throw new Error('채팅이 변경되어 메시지 숨기기를 중단했습니다.');
            pendingHideSaves.add(expectedChat);
            try {
                await hideChatMessageRange(start, end, false);
                if (getContext().chat !== expectedChat) throw new Error('채팅이 변경되어 메시지 숨기기 결과를 확인하지 못했습니다.');
                if (expectedChat.slice(start, end + 1).some(message => message && !message.is_system)) {
                    throw new Error('숨기기 실행 후에도 표시 상태인 메시지가 남아 있습니다.');
                }
                pendingHideSaves.delete(expectedChat);
                break;
            } catch (error) {
                pendingHideSaves.add(expectedChat);
                if (attempt === 1 || getContext().chat !== expectedChat) throw error;
            }
        }
        changed += count;
    }
    return changed;
}
