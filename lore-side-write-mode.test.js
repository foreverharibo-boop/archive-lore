// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { sideWriteMode, appendSideRecord, SIDE_APPEND_RULES, NO_SIDE_CHANGES, sideWriteModeControl } from './lore-side-write-mode.js';
import { validatePlainSideRecord } from './lore-native-side.js';

const source = fs.readFileSync(new URL('./sidePrompts.js', import.meta.url), 'utf8');
const extract = (name) => {
    const start = source.indexOf(`async function ${name}(`);
    return source.slice(start, source.indexOf('\n}\n', start) + 2);
};

test('append preserves prior bytes and only appends the new output; unchanged and echoed records are not duplicated', () => {
    const prior = '  Original wording.\n- Prior promise.  \n';
    assert.equal(appendSideRecord(prior, 'New fact.'), prior + '\n\nNew fact.');
    assert.equal(appendSideRecord(prior, NO_SIDE_CHANGES), prior);
    assert.equal(appendSideRecord(prior, prior), prior);
    assert.equal(appendSideRecord(prior, prior + '\nNew fact.'), prior + '\n\nNew fact.');
    assert.equal(appendSideRecord('', 'First fact.'), 'First fact.');
    assert.throws(() => appendSideRecord(prior, '  '), /저장하지 않았습니다/);
});

test('unset and invalid modes preserve previous update behavior', () => {
    for (const settings of [undefined, {}, {sideWriteMode:'unknown'}, {sideWriteMode:'update'}]) assert.equal(sideWriteMode(settings), 'update');
    assert.equal(sideWriteMode({sideWriteMode:'append'}), 'append');
    assert.match(sideWriteModeControl('stmb-sp-edit', {sideWriteMode:'append'}), /value="append" selected/);
    assert.match(sideWriteModeControl('stmb-sp-new'), /value="update" selected/);
});

test('all callers through the real LLM path receive combined append text, but update and old job snapshots remain unchanged', async () => {
    let output = 'Later event.';
    const requests = [];
    const scope = { appendSideRecord, NO_SIDE_CHANGES, validatePlainSideRecord,
        normalizeCompletionSource:x=>x, extension_settings:{}, oai_settings:{}, MODULE_NAME:'test',
        console:{debug(){},warn(){}}, assertProviderDidNotTruncate(){},
        requestCompletion:async args => { requests.push(args); return { text:output, full:{} }; },
    };
    vm.runInNewContext(extract('runLLM'), scope);
    const conn = {api:'openai', sideWriteMode:'append', sidePriorContent:'Earlier fact.', archiveLorePlainRecord:true};
    assert.equal(await scope.runLLM('scene', conn), 'Earlier fact.\n\nLater event.');
    assert.equal(await scope.runLLM('scene', {api:'openai', sideWriteMode:'update'}), 'Later event.');
    assert.equal(await scope.runLLM('scene', {api:'openai'}), 'Later event.');
    assert.equal(requests[0].sidePriorContent, undefined);
    output = NO_SIDE_CHANGES;
    assert.equal(await scope.runLLM('scene', conn), 'Earlier fact.');
    output = '';
    await assert.rejects(scope.runLLM('scene', conn), /저장하지 않았습니다/);
});
