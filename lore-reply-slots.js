// SPDX-License-Identifier: AGPL-3.0-only
export const REPLY_PROVIDER = 'archive-lore';
const ID = /^[a-f0-9]{32}$/;
export function slotTags(ticket, slot) {
    if (!ID.test(ticket) || !['memory','guidance'].includes(slot)) throw Error('Invalid recall slot');
    const name = `AL_${slot}_${ticket}`;
    return [`[${name}]`, `[/${name}]`];
}
export async function reserveReplySlots(ticket, budget, countTokens) {
    const [start,end] = slotTags(ticket,'memory');
    const [gs,ge] = slotTags(ticket,'guidance');
    let n = budget, text;
    // This content is a capacity reservation, NEVER an AI instruction. Both
    // markers must be removed by the authenticated server before generation.
    for (let attempt=0;attempt<12;attempt++) {
        text = `${start}\n${' memory'.repeat(n)}\n${end}`;
        const count = await countTokens(text);
        if (Number.isFinite(count) && count >= budget + 64) return {text,guidance:`${gs}${ge}`};
        if (!Number.isFinite(count) || count <= 0) throw Error('기억 자리의 토큰 수를 확인하지 못했어.');
        n = Math.ceil(n * (budget + 80) / count) + 16;
        if (n > 200000) break;
    }
    throw Error('기억 주입 자리를 확보하지 못했어.');
}
export function replaceReplySlots(payload,ticket,values) {
    if (!Array.isArray(payload?.messages)) throw Error('Chat Completion messages required');
    const result = structuredClone(payload), seen = {memory:0,guidance:0};
    const encoded=JSON.stringify(result);
    for(const slot of ['memory','guidance'])for(const tag of slotTags(ticket,slot))
        if(encoded.split(tag).length!==2)throw Error('기억 주입 자리가 중복되거나 잘렸어.');
    function replace(text) {
        for (const slot of ['memory','guidance']) {
            const [start,end] = slotTags(ticket,slot), at = text.indexOf(start);
            if (at < 0) continue;
            const until = text.indexOf(end,at+start.length);
            if (until < 0 || text.indexOf(start,at+start.length)>=0 || ++seen[slot] !== 1) throw Error('기억 주입 자리가 중복되거나 잘렸어.');
            text = text.slice(0,at) + String(values[slot] || '') + text.slice(until+end.length);
        }
        return text;
    }
    for (const message of result.messages) {
        if (typeof message.content==='string') message.content=replace(message.content);
        else if (Array.isArray(message.content)) for (const part of message.content) {
            if (part.type==='text' && typeof part.text==='string') part.text=replace(part.text);
        }
    }
    if (seen.memory!==1 || seen.guidance!==1 || JSON.stringify(result).includes(`AL_memory_${ticket}`)
        || JSON.stringify(result).includes(`AL_guidance_${ticket}`)) throw Error('기억 주입 자리가 없어 요청을 중단했어.');
    return result;
}
