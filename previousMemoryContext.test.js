import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const popupSource = readFileSync(new URL('./confirmationPopup.js', import.meta.url), 'utf8');
const start = popupSource.indexOf('export async function fetchPreviousSummaries(');
const fetchSource = popupSource.slice(start, popupSource.indexOf('\n}\n', start) + 2).replace('export ', '');
const indexSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const collectionSource = indexSource.slice(indexSource.indexOf('    // Fetch previous memories if requested'),
    indexSource.indexOf('    // Show working toast with actual memory count after fetching'));

function harness({ name = 'book', data = { entries: {} }, entries = [], fail = false, count = 3 } = {}) {
    const state = { warnings: [], loads: 0 };
    const scope = vm.createContext({
        getEffectiveLorebookName: async () => name,
        loadWorldInfo: async () => { state.loads++; if (fail) throw Error('offline'); return data; },
        identifyMemoryEntries: () => entries,
        settings: {}, chat_metadata: {}, summaryCount: count,
        translate: (text, key) => key,
        __st_t_tag: (strings, ...values) => strings.reduce((out, s, i) => out + s + (values[i] ?? ''), ''),
        toastr: { warning: message => state.warnings.push(message) },
        console: { log() {} },
    });
    vm.runInContext(fetchSource + '\nasync function collectContext() { let memoryFetchResult;\n' + collectionSource
        + '\nreturn { previousMemories, memoryFetchResult }; }', scope);
    return { state, scope };
}

test('first collection with an empty readable lorebook continues without a warning', async () => {
    const { state, scope } = harness();
    const result = await scope.collectContext();
    assert.equal(result.previousMemories.length, 0);
    assert.equal(result.memoryFetchResult.actualCount, 0);
    assert.equal(result.memoryFetchResult.readFailed, undefined);
    assert.deepEqual(state.warnings, []);
});

test('missing name, missing lorebook, and rejected read retain a distinct failure warning', async () => {
    for (const options of [{ name: '' }, { data: null }, { fail: true }]) {
        const { state, scope } = harness(options);
        const result = await scope.collectContext();
        assert.equal(result.previousMemories.length, 0);
        assert.equal(result.memoryFetchResult.readFailed, true);
        assert.deepEqual(state.warnings, ['STMemoryBooks_Error_FailedToLoadSelectedLorebook']);
    }
});

test('disabled previous context neither reads the lorebook nor warns', async () => {
    const { state, scope } = harness({ count: 0, fail: true });
    await scope.collectContext();
    await scope.fetchPreviousSummaries(0, {}, {});
    assert.equal(state.loads, 0);
    assert.deepEqual(state.warnings, []);
});

test('existing context keeps its latest records and partial-availability warning', async () => {
    const entries = [1, 2, 3, 4].map(number => ({ number, title: `Memory ${number}`, content: `Text ${number}`, keywords: [] }));
    const full = harness({ entries, count: 3 });
    const result = await full.scope.collectContext();
    assert.deepEqual(Array.from(result.previousMemories, entry => entry.number), [2, 3, 4]);
    assert.deepEqual(full.state.warnings, []);
    const partial = harness({ entries: entries.slice(0, 1), count: 3 });
    assert.equal((await partial.scope.collectContext()).previousMemories[0].content, 'Text 1');
    assert.deepEqual(partial.state.warnings, ['Only 1 of 3 requested memories available']);
});
