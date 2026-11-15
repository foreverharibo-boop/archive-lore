// Archive Lore — AGPL-3.0-only.
// Dates come only from scene headings / labelled story-time fields, never send_date.
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export function normalizeStoryDate(value) {
    const text = String(value || '').trim().replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*,?\s+/i, '');
    let match = text.match(/^(\d{4})\s*(?:[-/.]|년)\s*(\d{1,2})\s*(?:[-/.]|월)\s*(\d{1,2})(?:일)?(?=$|\D)/u);
    let year, month, day;
    if (match) [, year, month, day] = match;
    else {
        match = text.match(/^(\d{1,2})\s+([a-z]+)\s*,?\s*(\d{4})\b/i);
        if (match) { [, day, month, year] = match; }
        else {
            match = text.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(\d{4})\b/i);
            if (!match) return null;
            [, month, day, year] = match;
        }
        month = months.findIndex(name => name === month.toLowerCase() || name.slice(0,3) === month.toLowerCase()) + 1;
    }
    const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const date = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === iso ? iso : null;
}

export function storyDateMarker(message) {
    // Keep line boundaries from common HTML panels, but never interpret their code.
    const text = String(message?.mes || '').replace(/^\s*```[^\n]*$/gm, '')
        .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '')
        .replace(/<\/?(?:div|p|tr|li|h[1-6])\b[^>]*>|<br\s*\/?\s*>/gi,'\n')
        .replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ');
    const markers = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/^[\s#>*|\[📅🗓️-]+/u,'').replace(/[*_`]/g,'').trim();
        const labelled = line.match(/^(?:(?:current|story|in[- ]story)\s+)?(?:date(?:\s*[/&·]\s*time)?|날짜(?:\s*[/·]\s*시간)?|일자|현재 날짜|작중 날짜)\s*[:：|]\s*(.*)$/i);
        const value = labelled ? labelled[1] : line;
        const date = normalizeStoryDate(value);
        // A date at the beginning of a line or in an explicit Date field is a
        // scene marker. Dates quoted inside narrative sentences are not markers.
        if (date) markers.push({ date, evidence: raw.trim().slice(0,160) });
        else if (labelled) markers.push({ date: null, evidence: raw.trim().slice(0,160) });
    }
    if (!markers.length) return null;
    const distinct = new Set(markers.map(m => m.date));
    return distinct.size === 1 ? markers[0] : { date: null, evidence: '한 메시지에 여러 날짜 표기 · 원문 확인 필요', ambiguous: true };
}

export function planDateCollection(messages, start, end) {
    if (!Array.isArray(messages) || !Number.isInteger(start) || !Number.isInteger(end)
        || start < 0 || end < start || end >= messages.length) throw Error('수집할 시작·끝 번호를 확인해 주세요.');
    let current = { date: null, evidence: '확인된 날짜 표기 없음' };
    // A selection may start halfway through a day. Only carry forward an actual
    // preceding scene marker, never infer a date from the computer's calendar.
    for (let i = 0; i < start; i++) current = storyDateMarker(messages[i]) || current;
    const ranges = [];
    for (let i = start; i <= end; i++) {
        if (!messages[i]) throw Error(`메시지 #${i}을 찾을 수 없습니다.`);
        const marker = storyDateMarker(messages[i]);
        if (marker) current = marker;
        const last = ranges.at(-1);
        if (last && last.date === current.date && !marker?.ambiguous) last.end = i;
        else ranges.push({ start: i, end: i, ...current });
    }
    return ranges;
}

export function validateDateRanges(ranges, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) throw Error('수집할 시작·끝 번호를 확인해 주세요.');
    if (!Array.isArray(ranges) || !ranges.length) throw Error('날짜별 수집 구간이 없습니다.');
    let next = start;
    return ranges.map(range => {
        const date = range.date == null || range.date === '' ? null : String(range.date);
        if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start !== next
            || range.end < range.start || range.end > end || (date !== null && normalizeStoryDate(date) !== date)) {
            throw Error('날짜와 구간을 확인해 주세요. 메시지 범위는 빈틈이나 중복 없이 이어져야 합니다.');
        }
        next = range.end + 1;
        return { start: range.start, end: range.end, date };
    }).map((range, i, result) => {
        if (i === result.length - 1 && next !== end + 1) throw Error('끝 메시지까지 모든 구간을 포함해 주세요.');
        return range;
    });
}

export function dateCollectionSource(messages, start, end) {
    // Auto-hide changes is_system during our own batch; text edits, deletions,
    // swipes and speaker changes must still invalidate the remaining work.
    return JSON.stringify(messages.slice(start,end+1).map(m => m && [m.mes,m.is_user,m.name,m.swipe_id]));
}

export async function runDateCollection({ ranges, assertCurrent, collect, onProgress = () => {} }) {
    let saved = 0;
    for (let index = 0; index < ranges.length; index++) {
        assertCurrent();
        const range = ranges[index];
        onProgress({ saved, total: ranges.length, range });
        const success = await collect(range, index === ranges.length - 1);
        if (!success) throw Error(`날짜별 수집 중단 · ${saved}/${ranges.length}개 완료. #${range.start}부터 확인해 주세요.`);
        saved++;
    }
    return { saved, total: ranges.length };
}

export function withCollectionDate(prompt, metadata = {}) {
    if (!Object.hasOwn(metadata, 'archiveLoreCollectionDate')) return prompt;
    const date = metadata.archiveLoreCollectionDate;
    return `${prompt}\n\nDATE-GROUPED COLLECTION\nThis selected message range has the user-reviewed story-date label: ${date || 'unknown'}. Preserve the full detail of the supplied scene. Do not import events from other dates or from reference memories into this scene. Write the JSON title field as exactly "${date || '날짜 미상'}". This is a story-date label, never a real message timestamp. Do not invent a missing date. Keep every required JSON field and the user's memory instructions.`;
}
