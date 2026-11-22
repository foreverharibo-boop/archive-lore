// Archive Lore — AGPL-3.0-only
import { MAX_EVENT_SELECTIONS, normalizeSelectionFocus } from './lore-selection-focus.js';
import { SELECTION_REFERENCE_LIMITS } from './lore-selection-repair.js';

// ST translates json_schema to the selected provider's structured-output format.
// This is a generation constraint when the provider enforces it, not a substitute
// for source validation. Do not truncate or repair returned evidence here.
export function selectionOutputSchema(data) {
    if (!['ranked', 'generous'].includes(data?.selectionFormat) || !Array.isArray(data.memories)) return undefined;
    const ids = limit => ({ type:'array', items:{type:'string'}, maxItems:limit });
    const properties = {
        id:{type:'string',description:'One exact source ID from the supplied memories.'},
        // Google's response_schema accepts only strings in enum. Integer bounds
        // preserve numeric priorities 2/3 without provider-specific enum values.
        priority:{type:'integer',minimum:2,maximum:3},
        ...(data.selectionFormat === 'ranked' ? {reason:{type:'string',description:'A nonempty, concrete reason this event matters to the current scene.'}} : {}),
        contextIds:ids(SELECTION_REFERENCE_LIMITS.contextIds),
        outcomeIds:ids(SELECTION_REFERENCE_LIMITS.outcomeIds),
    };
    const focus = normalizeSelectionFocus(data.selectionFocus);
    if (focus.length) properties.focusMatches = {type:'array',items:{type:'string',enum:focus},maxItems:focus.length};
    return {
        name:'archive_lore_selection', strict:true,
        value:{type:'object',properties:{selections:{type:'array',maxItems:MAX_EVENT_SELECTIONS,
            items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}},
        required:['selections'],additionalProperties:false},
    };
}

function unsupportedSchema(error) {
    // Never retry authentication, quota, transport, truncation or generic errors.
    const status = Number(error?.status);
    if (status && ![400,404,422].includes(status)) return false;
    if (error?.code === 'OUTPUT_TRUNCATED' || ['canceled','timeout','network','rate-limit','authentication'].includes(error?.category)) return false;
    const message = [error?.message, error?.details?.error?.message, error?.details?.message].filter(x=>typeof x === 'string').join('\n');
    return /json[_ -]?schema|response[_ -]?format|structured[_ -]?outputs?|maxItems|additionalProperties/i.test(message)
        && /not supported|unsupported|does not support|doesn't support|not permitted|not allowed|unknown (?:parameter|field)|unrecognized (?:parameter|field)|no endpoints found/i.test(message);
}

// Cache explicit lack of support only for the caller's current route/session.
// A provider that ignores a schema still goes through the unchanged validator.
export async function requestSelectionOutput({data,request,signal,log=async()=>{},unsupported=new Set(),route=''}) {
    const schema = selectionOutputSchema(data);
    if (!schema) return request(undefined);
    const report = async (status,message) => {
        try { await log('selection.output-schema',{batch:data.batch,status,message}); } catch {}
    };
    signal?.throwIfAborted();
    if (unsupported.has(route)) {
        await report('unsupported','이 연결은 구조화 출력 제한을 지원하지 않아 기존 지시·검증 방식으로 선별합니다. 개수 준수는 보장되지 않습니다.');
        return request(undefined);
    }
    await report('requested','첫 선별 요청부터 구조화 출력 제한을 전달합니다: 중심 사건 최대 48개, 사건별 연결 32개·결과 8개. API의 실제 강제 여부는 별도입니다.');
    try { return await request(schema); }
    catch (error) {
        signal?.throwIfAborted();
        if (!unsupportedSchema(error)) throw error;
        unsupported.add(route);
        await report('unsupported','API가 구조화 출력 제한을 지원하지 않는다고 응답해 기존 방식으로 한 번 요청합니다. 개수 준수는 보장되지 않습니다.');
        return request(undefined);
    }
}
