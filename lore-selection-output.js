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

function schemaRetryReason(error,source) {
    // ST wraps the provider message in Error.cause ("API request failed").
    // Inspect that bounded chain, keeping auth/quota/abort guards at every level.
    const seen=new Set(),messages=[],statuses=[];
    for(let current=error;current&&typeof current==='object'&&!seen.has(current)&&seen.size<6;current=current.cause){
        seen.add(current);
        for(const detail of [current,current.details,current.details?.error]){
            if(!detail||typeof detail!=='object')continue;
            let status=Number(detail.status)||Number(detail.code);
            // ST's server route can wrap a Google 400 in HTTP 500. Only this
            // verified provider envelope supersedes that wrapper for retry
            // classification; retain the original error/status for diagnostics.
            const provider=current.details?.error;
            if(detail===current&&status===500&&['vertexai','makersuite'].includes(source)
                &&Number(provider?.code)===400&&provider?.status==='INVALID_ARGUMENT')status=400;
            if(status)statuses.push(status);
            if(status>=400&&![400,404,422].includes(status))return false;
            if(detail.code==='OUTPUT_TRUNCATED'||['AbortError','TimeoutError'].includes(detail.name)
                ||['canceled','timeout','network','rate-limit','authentication'].includes(detail.category))return false;
            if(typeof detail.message==='string')messages.push(detail.message);
        }
    }
    const message=messages.join('\n');
    const unsupported=/json[_ -]?schema|response[_ -]?schema|response[_ -]?format|structured[_ -]?outputs?|maxItems|additionalProperties/i.test(message)
        && /not supported|unsupported|does not support|doesn't support|not permitted|not allowed|unknown (?:parameter|field)|unrecognized (?:parameter|field)|no endpoints found/i.test(message);
    // An explicit rejection permits a compatibility attempt for any provider.
    const invalidGoogleEnum=/Invalid value at ['"]generation_config\.response_schema[^'"\r\n]*\.enum\[\d+\]['"]\s*\(TYPE_STRING\)/i.test(message);
    if(unsupported||invalidGoogleEnum)return 'unsupported';
    // Google can omit the invalid field entirely. Compare once without the
    // schema, only for this exact provider error, and cache only after success.
    if(['vertexai','makersuite'].includes(source)&&statuses.every(status=>status===400)
        &&messages.some(text=>/^Request contains an invalid argument\.?$/i.test(text.trim())))return 'google-invalid-argument';
    return false;
}

// Cache successful compatibility attempts only for the current route/session.
// A provider that ignores a schema still goes through the unchanged validator.
export async function requestSelectionOutput({data,request,signal,source,log=async()=>{},unsupported=new Set(),route=''}) {
    const schema = selectionOutputSchema(data);
    if (!schema) return request(undefined);
    const report = async (status,message) => {
        try { await log('selection.output-schema',{batch:data.batch,status,message}); } catch {}
    };
    signal?.throwIfAborted();
    if (source === 'vertexai') {
        await report('disabled-vertex','Vertex AI는 첫 요청부터 API 구조화 출력 제한 없이 선별합니다. 프롬프트의 개수 지시·원문 ID 검사·최종 주입 토큰 한도는 유지되지만, 생성 시 형식·개수 준수는 보장되지 않습니다.');
        signal?.throwIfAborted();
        return request(undefined);
    }
    if (unsupported.has(route)) {
        await report('unsupported','이 연결은 구조화 출력 제한 없이 성공한 기록이 있어 기존 지시·검증 방식으로 선별합니다. 생성 시 개수 준수는 보장되지 않습니다.');
        return request(undefined);
    }
    await report('requested','첫 선별 요청부터 구조화 출력 제한을 전달합니다: 중심 사건 최대 48개, 사건별 연결 32개·결과 8개. 우선순위는 정수 2~3(minimum/maximum, 숫자 enum 없음). API의 실제 강제 여부는 별도입니다.');
    try { return await request(schema); }
    catch (error) {
        signal?.throwIfAborted();
        const reason=schemaRetryReason(error,source);
        if (!reason) throw error;
        await report('probe',reason==='google-invalid-argument'
            ? 'Google가 잘못된 인수 오류를 반환했으나 문제 필드를 밝히지 않았습니다. 원인은 아직 확정되지 않았으며, 구조화 출력 제한만 빼고 한 번 비교 요청합니다. 받은 결과의 개수·원문 ID 검증은 유지됩니다.'
            : 'API가 구조화 출력 제한을 거부해 해당 제한 없이 한 번 요청합니다. 받은 결과의 개수·원문 ID 검증은 유지됩니다.');
        signal?.throwIfAborted();
        let result;
        try { result=await request(undefined); }
        catch (fallbackError) {
            await report('probe-failed','구조화 출력 제한을 뺀 요청도 실패했습니다. 호환 방식은 저장하지 않으며, 추가 재시도 없이 해당 API 오류를 반환합니다.');
            throw fallbackError;
        }
        signal?.throwIfAborted();
        unsupported.add(route);
        await report('unsupported','구조화 출력 제한을 뺀 요청이 성공해 이 연결의 현재 세션에 호환 방식을 적용합니다. 생성 시 개수 준수는 보장되지 않으며, 받은 결과의 개수·원문 ID 검증은 유지됩니다.');
        return result;
    }
}
