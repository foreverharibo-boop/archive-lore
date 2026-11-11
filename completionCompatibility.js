// Archive Lore © 2026 foreverharibo-boop — AGPL-3.0-only
/** Normalize only OpenAI reasoning-model requests; never mutate saved profiles. */
export function normalizeCompletionRequest(body, source = body.chat_completion_source) {
    if (!['openai', 'azure_openai', 'custom'].includes(source)
        || !/^(?:gpt-[56](?:[.-]|$)|o[134](?:-|$))/i.test(String(body.model || ''))) return body;
    return {
        ...body,
        max_completion_tokens: body.max_completion_tokens ?? body.max_tokens,
        max_tokens: undefined,
        // Match ST's compatible test request. Do not force sampling settings
        // that reasoning models reject (including values inherited from presets).
        temperature: undefined,
        top_p: undefined,
        presence_penalty: undefined,
        frequency_penalty: undefined,
    };
}
