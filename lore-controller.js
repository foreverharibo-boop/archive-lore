// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import { NS, SIDE_PROMPT, normalizeSettings, sourceRange, matchesRange, validReceipts, nextStart,
    entryAvailable, isCore, entryId, embeddingChunks, estimateTokens, recentDialogue, parseJson,
    parseCollection, rankChunks, reviewUnits, selectedUnits, fitInjection, materializeEntry,
    sideRecords, parseSideChanges, applySideChanges } from './lore-core.js';
import { digest, embeddingKey, makeId } from './lore-api.js';

const COLLECTION_SCHEMA = `Return ONLY JSON: {"entries":[{"title":"short title","content":"self-contained memory","keywords":["keyword"],"supersedes":null}],"sideChanges":[{"op":"add or update","category":"relationship|agreements|preferences|emotions|turningPoints|plans","id":"existing fact id for update","text":"updated fact","evidence":{"message":0,"quote":"exact dialogue substring"}}]}. For nothing new return empty arrays. Only use message numbers in the supplied dialogue.`;

export function createLoreController(host) {
    let active = null, status = '준비됨', lastRecall = null;
    const notify = value => { status = value; host.changed?.(); };
    const settings = () => normalizeSettings(host.settings());
    const assertCurrent = (snapshot, signal) => {
        signal?.throwIfAborted();
        if (host.context().key !== snapshot.key) throw new Error('채팅방이 바뀌어서 작업을 멈췄어.');
    };
    async function job(label, callback) {
        if (active) throw new Error('진행 중인 작업을 마치거나 중지해 줘.');
        const abort = new AbortController(); active = abort; notify(label);
        try { return await callback(abort.signal); }
        catch (error) { notify(abort.signal.aborted ? '작업 중지됨 · 저장한 기억은 유지돼' : error.message); throw error; }
        finally { active = null; host.changed?.(); }
    }
    async function records(snapshot = host.context()) {
        const result = [];
        for (const book of host.books()) {
            const data = await host.loadBook(book);
            for (const raw of Object.values(data.entries || {})) {
                const entry = materializeEntry(raw, snapshot.messages);
                if (entryAvailable(entry, snapshot.messages)) result.push({ id: entryId(book, entry.uid), book, entry });
            }
        }
        return result;
    }
    async function chunksFor(record, config) {
        const chunks = embeddingChunks(record.entry);
        return Promise.all(chunks.map(async chunk => ({ ...chunk, id: record.id, book: record.book,
            title: record.entry.comment || '기억', source: record.entry[NS]?.source,
            cacheKey: await embeddingKey(config, record.id, chunk.text) })));
    }
    async function indexRecords(snapshot, signal, config, force = false) {
        const rows = (await records(snapshot)).filter(r => !isCore(r.entry));
        let complete = 0, total = 0;
        const chunks = [];
        for (const row of rows) chunks.push(...await chunksFor(row, config));
        total = chunks.length;
        for (const chunk of chunks) {
            assertCurrent(snapshot, signal);
            const cached = !force && await host.store.get(chunk.cacheKey);
            if (!cached) {
                notify(`임베딩 ${complete + 1}/${total}`);
                const vector = await host.embed(config, chunk.text, false, signal);
                assertCurrent(snapshot, signal);
                await host.store.put(chunk.cacheKey, vector);
            }
            complete++;
        }
        return { complete, total };
    }
    async function collect(options = {}) {
        return job('수집 준비 중', async signal => {
            const config = settings(), snapshot = structuredClone(host.context());
            if (!snapshot.key || !snapshot.messages.length) throw new Error('대화가 있는 채팅방에서 열어 줘.');
            const book = await host.ensureBook(); assertCurrent(snapshot, signal);
            let data = await host.loadBook(book);
            const receipts = validReceipts(data, snapshot.messages);
            let start = options.start === undefined ? nextStart(receipts, host.initialStart()) : Number(options.start);
            const end = options.end === undefined ? snapshot.messages.length - 1 : Number(options.end);
            if (start > end && start === snapshot.messages.length) {
                await indexRecords(snapshot, signal, config); notify('새 대화 없음 · 임베딩 확인 완료'); return;
            }
            sourceRange(snapshot.messages, start, end);
            let saved = 0;
            while (start <= end) {
                assertCurrent(snapshot, signal);
                let stop = Math.min(end, start + config.batchSize - 1);
                while (stop > start && estimateTokens(JSON.stringify(snapshot.messages.slice(start, stop + 1).map(m => m.mes))) > 12000) stop--;
                const source = sourceRange(snapshot.messages, start, stop);
                const receiptId = await digest(JSON.stringify([book, source]));
                data = await host.loadBook(book);
                if ((data[NS]?.receipts || []).some(r => r.id === receiptId)) { start = stop + 1; continue; }
                const before = JSON.stringify(data);
                const available = Object.values(data.entries || {}).map(e => materializeEntry(e, snapshot.messages)).filter(e => entryAvailable(e, snapshot.messages));
                const facts = sideRecords(available);
                const existing = available.filter(e => !e[NS]?.sideCategory).slice(-24).map(e => ({ uid: e.uid, title: e.comment, content: e.content }));
                const dialogue = snapshot.messages.slice(start, stop + 1).map((m, i) => ({ message: start + i, name: m.name, text: m.mes, hidden: m.is_system })).filter(m => !m.hidden);
                const payload = { dialogue, existing, sideRecords: facts };
                if (estimateTokens(JSON.stringify(payload)) > 24000) throw new Error('이 수집 범위와 기존 기록이 검토 한도를 넘었어. 범위를 줄이거나 긴 기록을 정리해 줘.');
                notify(`기억 수집 #${start}–#${stop}`);
                const system = config.prompts.collect + '\n\n' + (config.sideEnabled === false ? 'Return no sideChanges.' : (config.sidePrompt || SIDE_PROMPT)) + '\n\n' + COLLECTION_SCHEMA;
                const response = dialogue.length ? await host.ask(config.profile, system, payload, signal, 6000)
                    : '{"entries":[],"sideChanges":[]}';
                const memories = parseCollection(response, existing);
                const changes = config.sideEnabled === false ? [] : parseSideChanges(response, facts, snapshot.messages, source);
                assertCurrent(snapshot, signal);
                if (!matchesRange(source, host.context().messages)) throw new Error('수집 중 대화가 수정됐어. 저장하지 않았어.');
                const fresh = await host.loadBook(book);
                if (JSON.stringify(fresh) !== before) throw new Error('수집 중 로어북이 변경됐어. 다시 수집해 줘.');
                const staged = structuredClone(data);
                for (const memory of memories) {
                    if (Object.values(staged.entries).some(e => e.content === memory.content)) continue;
                    const entry = host.newEntry(staged);
                    Object.assign(entry, { comment: memory.title, content: memory.content, key: memory.keywords, constant: false, vectorized: false });
                    entry[NS] = { source, collectedAt: new Date().toISOString(), supersedes: memory.supersedes };
                    saved++;
                }
                // Work on the version visible in this branch, while retaining every former version.
                const sideEntries = available.filter(e => e[NS]?.sideCategory).map(e => {
                    const raw = staged.entries[e.uid];
                    const version = structuredClone(e);
                    if (raw.content !== e.content) version[NS].history = [...(raw[NS].history || []),
                        { content: raw.content, facts: raw[NS].facts, source: raw[NS].source }];
                    return version;
                });
                const updatedSides = applySideChanges(sideEntries, changes, source, () => host.newEntry(staged), makeId);
                for (const entry of updatedSides) staged.entries[entry.uid] = entry;
                staged[NS] = { ...staged[NS], receipts: [...(staged[NS]?.receipts || []), { id: receiptId, source, created: new Date().toISOString() }] };
                // The receipt and entries are saved together. Failed writes never advance the cursor.
                await host.saveBook(book, staged);
                assertCurrent(snapshot, signal);
                notify(`#${start}–#${stop} 저장 완료`); start = stop + 1;
            }
            notify('기억 저장 완료 · 자동 임베딩 중');
            await indexRecords(snapshot, signal, config);
            notify(`수집 완료 · 새 기억 ${saved}개`);
        });
    }
    async function recall() {
        return job('필요한 기억 찾는 중', async signal => {
            const snapshot = structuredClone(host.context()), config = settings();
            const rows = await records(snapshot);
            const core = rows.filter(r => isCore(r.entry)).map(r => r.entry.content).join('\n\n');
            const recent = recentDialogue(snapshot.messages, config.recentCount);
            if (!recent.text) return { text: '', core, selected: new Set(), books: host.books() };
            let questions = [recent.text];
            if (config.mode === 'questions') {
                notify('최근 대화에서 검색 질문 만드는 중');
                const raw = parseJson(await host.ask(config.searchProfile || config.profile,
                    config.prompts.questions + '\nReturn ONLY JSON: {"questions":["question"]}.', { dialogue: recent.text }, signal, 1200));
                if (!Array.isArray(raw.questions) || raw.questions.length > 4 || raw.questions.some(q => typeof q !== 'string' || q.length > 2000))
                    throw new Error('검색 질문 형식이 올바르지 않아.');
                questions = raw.questions.filter(q => q.trim());
            }
            const chunks = []; let pending = 0;
            for (const row of rows.filter(r => !isCore(r.entry))) for (const chunk of await chunksFor(row, config)) {
                const vector = await host.store.get(chunk.cacheKey);
                if (vector) chunks.push({ ...chunk, vector }); else pending++;
            }
            let fitted = { text: '', units: [], tokens: 0 }, candidateTotal = 0;
            if (chunks.length && questions.length) {
                const queryVectors = [];
                for (const question of questions) for (const chunk of embeddingChunks({ content: question }, 1000))
                    queryVectors.push(await host.embed(config, chunk.text, true, signal));
                const candidates = rankChunks(chunks, queryVectors, config.candidateCount); candidateTotal = candidates.length;
                const offered = reviewUnits(candidates), selected = [];
                let batch = [], cost = 0;
                const review = async () => {
                    if (!batch.length) return;
                    notify('검색된 기억에서 필요한 원문 고르는 중');
                    const response = await host.ask(config.searchProfile || config.profile,
                        config.prompts.select + '\nReturn ONLY JSON: {"ids":["u0"]}.',
                        { dialogue: recent.text, questions, memories: batch }, signal, 3000);
                    selected.push(...selectedUnits(response, batch)); batch = []; cost = 0;
                };
                for (const unit of offered) {
                    const size = estimateTokens(JSON.stringify(unit));
                    if (batch.length && cost + size > 10000) await review();
                    batch.push(unit); cost += size;
                }
                await review();
                // Restore retrieval priority even when the model returns IDs in arbitrary order.
                const selectedIds = new Set(selected.map(u => u.id));
                fitted = await fitInjection(offered.filter(u => selectedIds.has(u.id)), config.injectionTokens, host.countTokens);
            }
            assertCurrent(snapshot, signal);
            if (JSON.stringify(snapshot.messages) !== JSON.stringify(host.context().messages)) throw new Error('검색 중 대화가 바뀌었어. 다시 시도해 줘.');
            lastRecall = { ...fitted, questions: config.mode === 'questions' ? questions : [], pending,
                candidateTotal, shortened: recent.shortened, mode: config.mode, time: new Date().toISOString() };
            notify(`회상 완료 · ${fitted.tokens}토큰${pending ? ` · 미임베딩 ${pending}구간` : ''}`);
            return { ...fitted, core, selected: new Set(fitted.units.map(u => u.entryId)), books: host.books() };
        });
    }
    return {
        collect, recall, cancel: () => active?.abort(), clearRecall: () => { lastRecall = null; },
        index: (force = false) => job('임베딩 확인 중', async signal => {
            const result = await indexRecords(structuredClone(host.context()), signal, settings(), force);
            notify(`임베딩 완료 · ${result.complete}구간`); return result;
        }),
        state: () => ({ busy: !!active, status, lastRecall }),
        async dashboard() {
            const snapshot = structuredClone(host.context()), config = settings();
            if (!snapshot.key) return { records: [], ranges: [], next: 0, embedded: 0, pending: 0 };
            const rows = await records(snapshot); let embedded = 0, pending = 0;
            for (const row of rows.filter(r => !isCore(r.entry))) {
                let complete = true;
                for (const chunk of await chunksFor(row, config)) if (!await host.store.get(chunk.cacheKey)) complete = false;
                if (complete) embedded++; else pending++;
            }
            const book = host.target();
            const data = book ? await host.loadBook(book) : null;
            const ranges = validReceipts(data, snapshot.messages).map(r => r.source);
            return { records: rows, ranges, next: nextStart(validReceipts(data, snapshot.messages), host.initialStart()), embedded, pending };
        },
    };
}
