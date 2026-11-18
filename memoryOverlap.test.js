// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const addSource = fs.readFileSync(new URL('./addlore.js', import.meta.url), 'utf8');
function extract(text, name) {
    const start = text.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.notEqual(start, -1);
    return text.slice(start, text.indexOf('\n}', start) + 2);
}
const memory = (chatId, start = 0, end = 7) => ({
    stmemorybooks: true, comment: '001 - Sociology Project Pairing',
    STMB_chatId: chatId, STMB_start: start, STMB_end: end,
});
function harness(entries) {
    const errors = [];
    const settings = {moduleSettings: {allowSceneOverlap: false}};
    let reachedSettings = false;
    const scope = {
        isMemoryEntry: entry => entry.stmemorybooks === true,
        extractNumberFromTitle: () => 1,
        archiveDateCollection: null, isProcessingMemory: false,
        getStmbChatKey: () => 'new-chat', guardPendingProgress: () => false,
        getCurrentMemoryBooksContext: () => ({chatId: 'new-chat', isGroupChat: false}),
        captureMemoryOriginSnapshot: context => ({sceneContext: structuredClone(context)}),
        characters: [{}], this_chid: 0, initializeSettings: () => settings,
        getSceneData: async () => ({sceneStart: 0, sceneEnd: 46}),
        validateLorebook: async () => ({valid: true, data: {entries}}),
        validateMultiCharacterLorebookBindingsForMemory: async () => ({valid: true}),
        showAndGetMemorySettings: async () => { reachedSettings = true; return null; },
        refreshCollectionStatus() {}, getMemoryReminderController: () => ({check() {}}),
        toastr: {error: message => errors.push(message)}, console,
        __st_t_tag: (strings, ...values) => String.raw({raw: strings}, ...values),
    };
    vm.createContext(scope);
    for (const name of ['identifyMemoryEntries', 'getRangeFromMemoryEntry']) {
        vm.runInContext(extract(addSource, name), scope);
    }
    for (const name of ['findOverlappingMemoryInLorebook', 'initiateMemoryCreation']) {
        vm.runInContext(extract(source, name), scope);
    }
    return {scope, settings, errors, reachedSettings: () => reachedSettings};
}

test('screenshot reproduction: old chat 0–7 does not block new chat 0–46', async () => {
    const h = harness({1: memory('old-chat')});
    await h.scope.initiateMemoryCreation();
    assert.equal(h.reachedSettings(), true);
    assert.deepEqual(h.errors, []);
});
test('same chat overlap still stops collection before settings or generation', async () => {
    const h = harness({1: memory('new-chat')});
    await h.scope.initiateMemoryCreation();
    assert.equal(h.reachedSettings(), false);
    assert.match(h.errors[0], /Sociology Project Pairing.*0-7/);
    assert.equal(h.scope.isProcessingMemory, false);
});
test('overlap opt-in still allows recollection in the same chat', async () => {
    const h = harness({1: memory('new-chat')});
    h.settings.moduleSettings.allowSceneOverlap = true;
    await h.scope.initiateMemoryCreation();
    assert.equal(h.reachedSettings(), true);
    assert.deepEqual(h.errors, []);
});
test('legacy memories without a usable source chat do not block new chats', async () => {
    const h = harness({1: memory(undefined), 2: memory(''), 3: memory('unknown')});
    await h.scope.initiateMemoryCreation();
    assert.equal(h.reachedSettings(), true);
    assert.deepEqual(h.errors, []);
});
test('queued checks use supplied source chat despite a different active chat', () => {
    const h = harness({});
    const book = {entries: {1: memory('old-chat'), 2: memory('new-chat', 20, 30)}};
    const before = structuredClone(book);
    const check = h.scope.findOverlappingMemoryInLorebook;
    assert.equal(check(book, {sceneStart: 0, sceneEnd: 7}, 'old-chat').start, 0);
    assert.equal(check(book, {sceneStart: 0, sceneEnd: 7}, 'new-chat'), null);
    assert.deepEqual(book, before);
});
test('same-chat inclusive boundaries conflict; adjacent ranges and foreign entries do not', () => {
    const {scope} = harness({});
    const book = {entries: {1: memory('foreign', 0, 100), 2: memory('chat', 10, 19)}};
    for (const [start, end, overlaps] of [[0,9,false],[0,10,true],[10,19,true],[19,20,true],[20,30,false]]) {
        assert.equal(Boolean(scope.findOverlappingMemoryInLorebook(book, {sceneStart:start,sceneEnd:end}, 'chat')), overlaps);
    }
});
test('missing source ID never guesses ownership, even if legacy IDs match', () => {
    const {scope} = harness({});
    for (const chatId of [undefined, null, '', 'unknown']) {
        assert.equal(scope.findOverlappingMemoryInLorebook({entries:{1:memory(chatId)}}, {sceneStart:0,sceneEnd:46}, chatId), null);
    }
});
