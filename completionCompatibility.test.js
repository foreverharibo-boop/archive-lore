import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCompletionRequest } from './completionCompatibility.js';
import { ask } from './lore-api.js';

test('Luna search request survives preset merging with its own token limit and credentials', async () => {
    const profile = { model: 'gpt-5.6-luna', 'secret-id': 'collector-key' };
    const context = { extensionSettings: { connectionManager: { selectedProfile: 'rp' } },
        ConnectionManagerRequestService: {
            getProfile: id => { assert.equal(id, 'collector'); return profile; },
            validateProfile: () => ({ selected: 'openai', source: 'openai' }),
            sendRequest: async (id, messages, limit, options, overrides) => {
                assert.equal(id, 'collector'); assert.equal(limit, 1200);
                assert.equal(options.includePreset, true);
                const payload = JSON.parse(JSON.stringify({ temperature: 1, top_p: .95, top_k: 0,
                    max_tokens: limit, max_completion_tokens: 15000, secret_id: profile['secret-id'], ...overrides }));
                assert.equal(payload.max_completion_tokens, 1200);
                for (const field of ['max_tokens', 'temperature', 'top_p', 'top_k']) assert.equal(field in payload, false);
                assert.equal(payload.secret_id, 'collector-key');
                assert.equal(messages[0].content, 'Extract facts');
                return { choices: [{ message: { content: 'facts' }, finish_reason: 'stop' }] };
            },
        } };
    assert.equal(await ask(context, 'collector', 'Extract facts', { text: 'scene' }, null, 1200), 'facts');
    assert.equal(context.extensionSettings.connectionManager.selectedProfile, 'rp');
    assert.deepEqual(profile, { model: 'gpt-5.6-luna', 'secret-id': 'collector-key' });
});

test('server template top_k is omitted from serialized OpenAI requests without changing the template', () => {
    for (const top_k of [0, 40]) {
        const template = { chat_completion_source: 'openai', model: 'gpt-5.6-luna', top_k, max_tokens: 1200 };
        const payload = JSON.parse(JSON.stringify(normalizeCompletionRequest(template)));
        assert.equal('top_k' in payload, false);
        assert.equal(payload.max_completion_tokens, 1200);
        assert.equal(template.top_k, top_k);
    }
});

test('modern OpenAI families convert limits without raising the budget', () => {
    for (const source of ['openai', 'custom', 'azure_openai']) {
        for (const model of ['gpt-5.6-luna', 'gpt-6.1-sol', 'gpt-6-astra', 'o3-mini']) {
            const body = { chat_completion_source: source, model, temperature: .2, max_tokens: 1200 };
            const result = normalizeCompletionRequest(body);
            assert.equal(result.max_completion_tokens, 1200);
            assert.equal(result.max_tokens, undefined);
            assert.equal(result.temperature, undefined);
            assert.equal(body.max_tokens, 1200);
            assert.equal(normalizeCompletionRequest({ ...body, max_completion_tokens: 800 }).max_completion_tokens, 800);
        }
    }
});

test('Gemini, Claude, aggregators and older OpenAI requests retain existing options', () => {
    for (const [source, model] of [['vertexai', 'gemini-3.8-flash'], ['claude', 'claude-sonnet'],
        ['openrouter', 'gpt-5.6-luna'], ['openai', 'gpt-4o'], ['custom', 'deepseek-chat']]) {
        const body = { chat_completion_source: source, model, temperature: .2, max_tokens: 1200 };
        assert.equal(normalizeCompletionRequest(body), body);
    }
});
