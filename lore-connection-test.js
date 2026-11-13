// Archive Lore — AGPL-3.0-only
import { parseJson } from './lore-core.js';
import { errorInfo, observer } from './lore-telemetry.js';
export const CONNECTION_TEST_SYSTEM='Connection test. Return only this JSON object: {"ok":true}. Do not add commentary.';
export const CONNECTION_TEST_DATA={test:'Archive Lore search AI connection'};
export const CONNECTION_TEST_TOKENS=1024;
export async function testSearchConnection({settings,context,diagnostics,request}) {
    const trace=diagnostics.begin({kind:'connection-test',chatKey:context.key,chatName:context.name,mode:settings.mode});
    let profile;const started=Date.now();
    const log=observer((stage,data)=>{if(stage==='profile.resolved')profile=data;return trace.event(stage,data);});
    try {
        await log('connection-test.start',{profile:settings.profile,searchProfile:settings.searchProfile,serverEnabled:settings.serverEnabled});
        const response=await request(settings.searchProfile || settings.profile,CONNECTION_TEST_SYSTEM,CONNECTION_TEST_DATA,undefined,CONNECTION_TEST_TOKENS,log);
        let formatValid=false;try { formatValid=parseJson(response)?.ok===true; } catch {}
        const result={connected:true,formatValid,profile:profile?{name:profile.name,id:profile.resolvedProfile,model:profile.model,source:profile.source}:undefined,
            elapsedMs:Date.now()-started,traceId:trace.id};
        await log('connection-test.result',{...result,response});await trace.finish(formatValid?'success':'warning',result);return result;
    } catch(error) {
        await log('connection-test.error',errorInfo(error));await trace.finish('error',errorInfo(error));throw error;
    }
}
