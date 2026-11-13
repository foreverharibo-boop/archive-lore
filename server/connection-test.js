// Archive Lore — AGPL-3.0-only
import { normalizeCompletionRequest } from '../completionCompatibility.js';
import { CONNECTION_TEST_SYSTEM, CONNECTION_TEST_DATA, CONNECTION_TEST_TOKENS } from '../lore-connection-test.js';
import { observer, errorInfo } from '../lore-telemetry.js';
import { diagnosticSummary,DIAGNOSTIC_EVENT_LIMIT } from '../lore-retention.js';
// Bounded, redacted events are returned to the browser's ordinary trace store.
export async function captureTransport(work,{detailed=false,secrets=[]}={}) {
    const events=[];let eventsOmitted=0;
    const log=observer((stage,data)=>{
        if(!detailed)return;
        if(events.length>=DIAGNOSTIC_EVENT_LIMIT){events.shift();eventsOmitted++;}
        events.push({stage,data:{...data,serverObservedAt:new Date().toISOString()}});
    },secrets);
    try {return {result:await work(log),events,eventsOmitted};}
    catch(error){await log('transport.error',errorInfo(error));return {error:await sanitizedError(error,secrets),events,eventsOmitted};}
}

async function sanitizedError(error,secrets) { let result;await observer((_stage,data)=>{result=data;},secrets)('error',errorInfo(error));return result; }
export function probePayload(template) {
    if(!template || typeof template.chat_completion_source!=='string' || !template.chat_completion_source)throw Object.assign(Error('검색 AI 연결 프로필을 확인해 줘.'),{category:'profile'});
    return normalizeCompletionRequest({...template,stream:false,temperature:.2,max_tokens:CONNECTION_TEST_TOKENS,
        max_completion_tokens:undefined,max_output_tokens:undefined,max_new_tokens:undefined,json_schema:undefined,
        messages:[{role:'system',content:CONNECTION_TEST_SYSTEM},{role:'user',content:JSON.stringify(CONNECTION_TEST_DATA)}]});
}
