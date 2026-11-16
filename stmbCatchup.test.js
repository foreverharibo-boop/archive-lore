// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { collectCanceledAfterMemoryJobs } from './stmbJobRetryPolicy.js';
import { dateCollectionSource } from './lore-date-collection.js';

const index = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const jobs = readFileSync(new URL('./stmbJobs.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
const section = (start, end) => index.slice(index.indexOf(start), index.indexOf(end, index.indexOf(start)));
const range = section('async function runSceneMemoryRange(', 'async function collectArchiveDates(');
const catchup = section('async function handleStmbCatchupCommand(', 'async function handleNextMemoryCommand(');
const initiate = section('async function initiateMemoryCreation(', '/**\n * Helper function to convert old boolean auto-hide');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ queued = true, sides = 0 } = {}) {
    const state = { key: 'A', epoch: 0, markers: {}, logs: [], started: [], saved: [], releases: [], sides: [], sideReleases: [] };
    const settings = { moduleSettings: { alwaysUseDefault: true, showMemoryPreviews: false } };
    const chat = Array.from({ length: 200 }, () => ({ mes: 'Synthetic source' }));
    state.chat = chat;
    const sceneContext = { isGroupChat: false };
    const tag = (parts, ...values) => parts.reduce((out, part, i) => out + part + (values[i] ?? ''), '');
    const deps = {
        state, settings, chat, console, structuredClone, setTimeout, clearTimeout, AbortController,
        extension_settings: { STMemoryBooks: settings }, collectCanceledAfterMemoryJobs, dateCollectionSource,
        POPUP_RESULT: { CUSTOM1: 1001 }, translate: text => text, __st_t_tag: tag,
        createViewSort: () => ({}), guardPendingProgress: () => false,
        document: { getElementById: () => queued ? {} : null },
        getContext: () => ({ characterId: 0, chatId: state.key,
            characters: [{ avatar: 'A.png', chat: state.key, name: 'A' }] }),
        getCurrentMemoryBooksContext: () => sceneContext,
        getStmbStopEpoch: () => state.epoch,
        getMemoryReminderController: () => ({ check() {} }), refreshCollectionStatus() {},
        parseRequiredIntegerArg: (args, key) => args[key], initializeSettings: () => settings,
        validateStmbCatchupNonInteractive: async () => null,
        validateSceneMemoryRange: (start, end) => start >= 0 && end < chat.length,
        setSceneRange: (sceneStart, sceneEnd) => { state.markers = { sceneStart, sceneEnd }; },
        getSceneData: async () => ({ ...state.markers, estimatedTokens: 10 }),
        captureMemoryOriginSnapshot: () => ({ chatKey: state.key }),
        validateLorebook: async () => ({ valid: true, name: 'Book', data: {} }),
        validateMultiCharacterLorebookBindingsForMemory: async () => ({ valid: true }),
        identifyMemoryEntries: () => [],
        showAndGetMemorySettings: async () => ({ settings, profileSettings: {} }),
        buildQueuedMemoryJob: async scene => ({ type: 'memory', range: scene,
            payload: { sceneData: scene } }),
        executeMemoryGeneration: async scene => { state.started.push([scene.sceneStart, scene.sceneEnd]); return true; },
        toastr: Object.fromEntries(['info', 'error', 'success'].map(key => [key, text => state.logs.push([key, text])])),
    };
    const api = vm.runInNewContext(`(function () {
        ${jobs}
        globalThis.archiveLoreFork = true;
        jobsEnabled = true;
        let isProcessingMemory = false, archiveDateCollection = null, currentPopupInstance = null, reminderChatKey = '';
        const characters = [{}], this_chid = 0;
        function isMemoryProcessing() { return isProcessingMemory || hasActiveStmbJobs(getStmbChatKey()); }
        ${range}
        ${initiate}
        ${catchup}
        return { handleStmbCatchupCommand, runSceneMemoryRange, enqueueStmbJob, awaitStmbJobCompletion,
            registerStmbJobExecutor, hasActiveStmbJobs, cancelAllStmbJobs,
            listeners: () => jobListeners.size };
    })()`, deps);
    api.registerStmbJobExecutor('memory', async (job, context) => {
        state.started.push([job.range.sceneStart, job.range.sceneEnd]);
        await new Promise((resolve, reject) => state.releases.push({ resolve, reject }));
        context.throwIfCancelled();
        state.saved.push(job.range.sceneEnd);
        for (let i = 0; i < sides; i++) context.enqueue({ type: 'sidePrompt', parentJobId: job.id });
    });
    api.registerStmbJobExecutor('sidePrompt', async job => {
        state.sides.push(job.id);
        await new Promise((resolve, reject) => state.sideReleases.push({ resolve, reject }));
    });
    return { api, state };
}

test('catch-up waits for actual saves and after-memory jobs across all ranges', async () => {
    const { api, state } = harness({ sides: 1 });
    const done = api.handleStmbCatchupCommand({ start: 125, end: 178, interval: 20 });
    await flush();
    for (let i = 0; i < 3; i++) {
        assert.equal(state.started.length, i + 1, 'no next chunk on queue acceptance');
        // Normal post-save hiding must not invalidate the remaining batch.
        state.chat[125 + i * 20].is_system = true;
        state.releases[i].resolve(); await flush();
        assert.equal(state.started.length, i + 1, 'wait for post-save side prompts too');
        state.sideReleases[i].resolve(); await flush();
    }
    await done;
    assert.deepEqual(state.started, [[125, 144], [145, 164], [165, 178]]);
    assert.deepEqual(state.saved, [144, 164, 178]);
    assert.ok(state.logs.some(([kind, text]) => kind === 'success' && text.includes('3 chunks processed')));
    assert.equal(state.logs.filter(([kind]) => kind === 'error').length, 0);
    assert.equal(api.listeners(), 0);
});

for (const failure of ['failed', 'canceled', 'side-failed', 'chat-changed', 'source-changed', 'stopped']) {
    test(`catch-up never advances after ${failure}`, async () => {
        const { api, state } = harness({ sides: failure === 'side-failed' ? 1 : 0 });
        const done = api.handleStmbCatchupCommand({ start: 0, end: 39, interval: 20 });
        await flush();
        if (failure === 'failed') state.releases[0].reject(new Error('Synthetic save failure'));
        else {
            if (failure === 'canceled') api.cancelAllStmbJobs();
            if (failure === 'chat-changed') state.key = 'B';
            if (failure === 'source-changed') state.chat[20].mes = 'Edited source';
            if (failure === 'stopped') state.epoch++;
            state.releases[0].resolve();
        }
        await flush();
        if (failure === 'side-failed') { state.sideReleases[0].reject(new Error('Synthetic side failure')); await flush(); }
        await done;
        assert.equal(state.started.length, 1);
        assert.ok(state.logs.some(([kind, text]) => kind === 'error' && text.includes('catch-up stopped')));
        assert.equal(state.logs.some(([kind]) => kind === 'success'), false);
        assert.equal(api.listeners(), 0);
    });
}

test('ordinary single-range collection still returns immediately after queue acceptance', async () => {
    const { api, state } = harness();
    assert.equal(await api.runSceneMemoryRange(0, 19), true);
    assert.deepEqual(state.saved, []);
    state.releases[0].resolve(); await flush();
    assert.deepEqual(state.saved, [19]);
});

test('catch-up without the job queue retains sequential direct generation', async () => {
    const { api, state } = harness({ queued: false });
    await api.handleStmbCatchupCommand({ start: 125, end: 178, interval: 20 });
    assert.deepEqual(state.started, [[125, 144], [145, 164], [165, 178]]);
    assert.equal(api.listeners(), 0);
});

test('an already-active queued collection cannot start another catch-up', async () => {
    const { api, state } = harness();
    await api.runSceneMemoryRange(0, 19);
    await api.handleStmbCatchupCommand({ start: 20, end: 39, interval: 20 });
    assert.equal(state.started.length, 1);
    state.releases[0].resolve(); await flush();
});

test('default-profile and preview requirements remain unchanged', async () => {
    const source = section('async function validateStmbCatchupNonInteractive(', 'async function handleSceneMemoryCommand(');
    // Only the two early preflight branches are needed for these rejected runs.
    const prefix = source.slice(0, source.indexOf('  const isManualMode')) + '\n}';
    const validate = vm.runInNewContext(`(${prefix})`, { translate: text => text });
    assert.match(await validate({ moduleSettings: { alwaysUseDefault: false } }, []), /Always use default profile/);
    assert.match(await validate({ moduleSettings: { alwaysUseDefault: true, showMemoryPreviews: true } }, []), /Disable memory previews/);
});

test('completion watcher survives history trimming and cleans up after a long side-job chain', async () => {
    const { api } = harness();
    api.registerStmbJobExecutor('memory', async (job, context) => {
        for (let i = 0; i < 30; i++) context.enqueue({ type: 'sidePrompt', parentJobId: job.id });
    });
    api.registerStmbJobExecutor('sidePrompt', async () => {});
    const job = api.enqueueStmbJob({ type: 'memory' });
    assert.equal(await api.awaitStmbJobCompletion(job), true);
    assert.equal(api.listeners(), 0);
    assert.equal(await api.awaitStmbJobCompletion(null), false);
});
