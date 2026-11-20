// SPDX-License-Identifier: AGPL-3.0-only
// Recall only: a provider-confirmed truncation gets one larger, complete retry.
// Never parse partial JSON, retry transport failures, or change injection limits.
export async function recallOutput(request,tokens,signal,log=async()=>{},phase='selectionMs') {
    try { return await request(tokens); }
    catch(error) {
        signal.throwIfAborted();
        if(error.code!=='OUTPUT_TRUNCATED')throw error;
        const larger=Math.min(24000,Math.max(6000,tokens*2));
        if(larger<=tokens)throw error;
        await log('ai.output-retry',{phase,reason:'output-truncated',max_tokens:larger,message:'출력 한도를 늘려 완전한 응답을 한 번 다시 요청합니다.'});
        signal.throwIfAborted();
        return request(larger);
    }
}
