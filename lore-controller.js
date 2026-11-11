// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
import { NS, normalizeSettings, sourceRange, matchesRange, validReceipts, nextStart,
    entryAvailable, isCore, entryId, embeddingChunks, estimateTokens, recentDialogue, parseJson, rankChunks,
    parseCollection, reviewUnits, selectedUnits, fitInjection, materializeEntry,
    sideRecords, parseSideChanges, applySideChanges, sideSnapshot, parseStoryDate, currentStoryDate } from './lore-core.js';
import { enabledSides, sideInstructions } from './lore-side-config.js';
import { automaticReady, collectedHideRanges } from './lore-automation.js';
import { consolidationView, maintenanceRequest, maintenanceResult } from './lore-maintenance.js';
import { digest, embeddingKey, makeId } from './lore-api.js';
import { retrievalFocus, rankFocusedChunks, chooseCandidates, recallMessages, reviewCandidates, reviewBatches } from './lore-retrieval.js';
import { withAbort } from './lore-cancellation.js';

const COLLECTION_SCHEMA = `Return ONLY JSON:
{"entries":[{"title":"short English title","date":"story date/range or empty","time":"story time or empty","location":"place or empty","content":"English narrative paragraphs only, no title/metadata headings","keywords":["English keyword"],"supersedes":null}],
"sideChanges":[{"op":"add or update","category":"one enabled side category ID","id":"existing fact ID for update","text":"English fact (relationship: short label only)","evidence":{"message":0,"quote":"exact original substring"},"relationship":{"kind":"start|breakup|reunion|other","since":"YYYY-MM-DD or null"},"dateEvidence":{"message":0,"quote":"exact dating/event evidence"}}],
"storyDate":{"date":"YYYY-MM-DD","evidence":{"message":0,"quote":"exact current-story-date evidence"}}}
Omit relationship and dateEvidence on non-relationship facts. Use actual JSON null for unknown dates. storyDate is null unless new dialogue establishes the current fictional date. For nothing new use empty arrays. Use only supplied message numbers and exact original-language quotes for evidence. User-visible saved text must be English; never translate evidence quotes.`;

export function createLoreController(host) {
    let draft = null;
    let countCache=null,countRead=null,countRevision=0;
    const invalidateEmbeddingCounts=()=>{countRevision++;countCache=null;};
    const countKey=()=>{
        const c=host.context(),s=settings();
        return JSON.stringify([c.key,c.messages.length,host.books(),s.serverEnabled,s.cacheNamespace,s.embeddingProvider,s.embeddingModel,s.embeddingUrl,s.embeddingVertexProjectId,s.embeddingVertexRegion]);
    };
    let active = null, status = '준비됨', lastRecall = null, trace = null, timings = null;
    const log = (stage, data) => trace?.event(stage, data);
    const askTracked = async (profile, system, data, signal, tokens, phase = 'selectionMs') => {
        const started = Date.now();
        await log('ai.request', { profile, system, data, maxOutputTokens:tokens });
        try { const response = await withAbort(() => host.ask(profile, system, data, signal, tokens), signal);
            await log('ai.response', { response, elapsedMs:Date.now()-started });signal.throwIfAborted();return response;
        } catch (error) { await log('ai.error', { message:error.message,details:error.details, elapsedMs:Date.now()-started });throw error; }
        finally { if(timings)timings[phase] += Date.now()-started; }
    };
    const embedTracked = async (config, text, query, signal) => {
        const started=Date.now();await log('embedding.request', { provider:config.embeddingProvider, model:config.embeddingModel, query, text });
        try { const vector=await withAbort(() => host.embed(config,text,query,signal), signal);await log('embedding.response', { query, dimensions:vector.length, elapsedMs:Date.now()-started });signal.throwIfAborted();return vector; }
        catch(error) { await log('embedding.error',{message:error.message,details:error.details});throw error; }
        finally { if(timings)timings.embeddingMs += Date.now()-started; }
    };
    const notify = value => { status = value; host.changed?.(); };
    const settings = () => normalizeSettings(host.settings());
    const assertCurrent = (snapshot, signal) => {
        signal?.throwIfAborted();
        if ((host.contextKey?.() ?? host.context().key) !== snapshot.key) throw new Error('채팅방이 바뀌어서 작업을 멈췄어.');
    };
    async function job(label, callback, kind = 'operation', externalTrace = null) {
        if (active) throw new Error('진행 중인 작업을 마치거나 중지해 줘.');
        const abort = new AbortController(); active = abort;
        invalidateEmbeddingCounts();
        const context=host.context(), config=settings();
        trace=externalTrace || host.diagnostics?.begin({kind,chatKey:context.key,chatName:context.name,mode:config.mode,messageCount:context.messages.length});
        notify(label);
        try {
            await log('settings', {mode:config.mode,recentCount:config.recentCount,injectionTokens:config.injectionTokens,candidateCount:config.candidateCount,profile:config.profile,searchProfile:config.searchProfile,embeddingProvider:config.embeddingProvider,embeddingModel:config.embeddingModel,books:host.books(),profiles:host.profileInfo?.(),autoCollect:config.autoCollect,autoMode:config.autoMode,autoMessages:config.autoMessages,autoTokens:config.autoTokens,keepMessages:config.keepMessages,enabledSides:enabledSides(config).map(s=>s.id)});
            abort.signal.throwIfAborted();
            const result=await callback(abort.signal);abort.signal.throwIfAborted();await trace?.finish('success');abort.signal.throwIfAborted();return result;
        } catch (error) { await trace?.finish(abort.signal.aborted?'canceled':'error',{message:error.message});notify(abort.signal.aborted ? '작업 중지됨 · 저장한 기억은 유지돼' : error.message); throw error; }
        finally { active = null;trace=null;timings=null;invalidateEmbeddingCounts();host.changed?.(); }
    }
    async function records(snapshot = host.context()) {
        const result = [];
        for (const book of host.books()) {
            const data = await host.loadBook(book), availability=[];
            for (const raw of consolidationView(Object.values(data.entries || {}), snapshot.messages)) {
                const entry = materializeEntry(raw, snapshot.messages);
                if (trace) availability.push({uid:entry.uid,title:entry.comment,available:entryAvailable(entry,snapshot.messages),core:isCore(entry),disabled:!!entry.disable,source:entry[NS]?.source});
                if (entryAvailable(entry, snapshot.messages)) result.push({ id: entryId(book, entry.uid), book, entry });
            }
            if (trace) await log('record.availability',{book,entries:availability});
        }
        return result;
    }
    async function chunksFor(record, config) {
        const chunks = embeddingChunks(record.entry);
        return Promise.all(chunks.map(async chunk => ({ ...chunk, id: record.id, book: record.book,
            title: [record.entry.comment || 'Memory', ...['date','time','location'].map(key => record.entry[NS]?.[key]).filter(Boolean)].join(' | '), source: record.entry[NS]?.source,
            cacheKey: await embeddingKey(config, record.id, chunk.text) })));
    }
    async function indexRecords(snapshot, signal, config, force = false) {
        const rows = (await records(snapshot)).filter(r => !isCore(r.entry));
        let complete = 0, total = 0;
        const chunks = [];
        for (const row of rows) chunks.push(...await chunksFor(row, config));
        total = chunks.length;
        for (const chunk of chunks) {
            // Cached work can otherwise monopolize the server's microtask queue.
            if(complete%16===0)await host.yieldControl?.();
            assertCurrent(snapshot, signal);
            const cached = !force && await host.store.get(chunk.cacheKey);
            await log('embedding.cache', {entryId:chunk.id,chunk:chunk.index,hit:!!cached,force});
            if (!cached) {
                notify(`임베딩 ${complete + 1}/${total}`);
                const vector = await embedTracked(config, chunk.text, false, signal);
                assertCurrent(snapshot, signal);
                await host.store.put(chunk.cacheKey, vector);
            }
            complete++;
        }
        return { complete, total };
    }
    async function hideCollected(snapshot,signal,config,book) {
        if(!host.hideRange || !host.books().includes(book))return;
        assertCurrent(snapshot,signal);
        const data=await host.loadBook(book),messages=host.context().messages;
        const ranges=collectedHideRanges(validReceipts(data,messages),messages,config.keepMessages);
        for(const range of ranges){assertCurrent(snapshot,signal);await host.hideRange(range,snapshot.key);await log('collection.hidden',range);}
    }
    async function maybeAutoCollect() {
        const config=settings();if(!config.enabled || active || !config.autoCollect || host.generating?.())return false;
        const key=host.context().key;const view=await controllerDashboard();
        if(key!==host.context().key||host.generating?.()||active)return false;
        if(automaticReady(config,host.context().messages,view.next)){await collect();return true;}return false;
    }
    async function collect(options = {}) {
        return job('수집 준비 중', async signal => {
            const config = settings(), snapshot = structuredClone(host.context());
            if (!snapshot.key || !snapshot.messages.length) throw new Error('대화가 있는 채팅방에서 열어 줘.');
            const book = await host.ensureBook(); assertCurrent(snapshot, signal);
            let data = await host.loadBook(book);
            const receipts = validReceipts(data, snapshot.messages);
            let start = options.start === undefined ? nextStart(receipts, host.initialStart()) : Number(options.start);
            const batchSize=options.batchSize===undefined?config.batchSize:Number(options.batchSize);
            if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw Error('분할 개수는 1~100 사이로 입력해 줘.');
            const categories=Object.fromEntries(enabledSides(config).map(r=>[r.id,r.title]));
            const end = options.end === undefined ? snapshot.messages.length - 1 : Number(options.end);
            if (start > end && start === snapshot.messages.length) {
                await indexRecords(snapshot, signal, config);await hideCollected(snapshot,signal,config,book); notify('새 대화 없음 · 임베딩 확인 완료'); return;
            }
            sourceRange(snapshot.messages, start, end);
            let saved = 0;
            while (start <= end) {
                assertCurrent(snapshot, signal);
                let stop = Math.min(end, start + batchSize - 1);
                while (stop > start && estimateTokens(JSON.stringify(snapshot.messages.slice(start, stop + 1).map(m => m.mes))) > 12000) stop--;
                const source = sourceRange(snapshot.messages, start, stop);
                const receiptId = await digest(JSON.stringify([book, source]));
                data = await host.loadBook(book);
                if ((data[NS]?.receipts || []).some(r => r.id === receiptId || JSON.stringify(r.source)===JSON.stringify(source))) { start = stop + 1; continue; }
                const before = JSON.stringify(data);
                const available = consolidationView(Object.values(data.entries || {}),snapshot.messages).map(e => materializeEntry(e, snapshot.messages)).filter(e => entryAvailable(e, snapshot.messages));
                const facts = sideRecords(available).filter(f=>Object.hasOwn(categories,f.category));
                const existing = available.filter(e => !e[NS]?.sideCategory).slice(-24).map(e => ({ uid: e.uid, title: e.comment, content: e.content }));
                const dialogue = snapshot.messages.slice(start, stop + 1).map((m, i) => ({ message: start + i, name: m.name, text: m.mes, hidden: m.is_system })).filter(m => !m.hidden);
                const knownStoryDate = currentStoryDate(data, snapshot.messages);
                const payload = { dialogue, existing, sideRecords: facts, currentStoryDate: knownStoryDate };
                if (estimateTokens(JSON.stringify(payload)) > 24000) throw new Error('이 수집 범위와 기존 기록이 검토 한도를 넘었어. 범위를 줄이거나 긴 기록을 정리해 줘.');
                notify(`기억 수집 #${start}–#${stop}`);
                const system = config.prompts.collect + '\n\n' + sideInstructions(config) + '\n\n' + COLLECTION_SCHEMA;
                const response = dialogue.length ? await askTracked(config.profile, system, payload, signal, 6000)
                    : '{"entries":[],"sideChanges":[]}';
                const memories = parseCollection(response, existing);
                const clock = config.sideEnabled === false ? null : parseStoryDate(response, snapshot.messages, source);
                const changes = config.sideEnabled === false ? [] : parseSideChanges(response, facts, snapshot.messages, source,categories);
                assertCurrent(snapshot, signal);
                if (!matchesRange(source, host.context().messages)) throw new Error('수집 중 대화가 수정됐어. 저장하지 않았어.');
                const fresh = await host.loadBook(book);
                if (JSON.stringify(fresh) !== before) throw new Error('수집 중 로어북이 변경됐어. 다시 수집해 줘.');
                const staged = structuredClone(data);
                for (const memory of memories) {
                    if (Object.values(staged.entries).some(e => e.content === memory.content)) continue;
                    const entry = host.newEntry(staged);
                    Object.assign(entry, { comment: memory.title, content: memory.content, key: memory.keywords, constant: false, vectorized: false });
                    entry[NS] = { source, collectedAt: new Date().toISOString(), supersedes: memory.supersedes, date: memory.date, time: memory.time, location: memory.location };
                    saved++;
                }
                // Work on the version visible in this branch, while retaining every former version.
                const sideEntries = available.filter(e => e[NS]?.sideCategory).map(e => {
                    const raw = staged.entries[e.uid];
                    const version = structuredClone(e);
                    if (raw.content !== e.content) version[NS].history = [...(raw[NS].history || []),
                        sideSnapshot(raw)];
                    return version;
                });
                const updatedSides = applySideChanges(sideEntries, changes, source, () => host.newEntry(staged), makeId, config.sideEnabled === false ? undefined : clock?.date || knownStoryDate,categories);
                for (const entry of updatedSides) staged.entries[entry.uid] = entry;
                staged[NS] = { ...staged[NS], storyDates: [...(staged[NS]?.storyDates || []), ...(clock ? [clock] : [])], receipts: [...(staged[NS]?.receipts || []), { id: receiptId, source, created: new Date().toISOString() }] };
                // The receipt and entries are saved together. Failed writes never advance the cursor.
                assertCurrent(snapshot,signal);
                if(!matchesRange(source,host.context().messages))throw Error('저장 직전에 대화가 바뀌었어. 다시 수집해 줘.');
                await host.saveBook(book, staged);
                await log('collection.saved', {book,source,memories,sideChanges:changes,storyDate:clock,updatedSides});
                assertCurrent(snapshot, signal);
                notify(`#${start}–#${stop} 저장 완료`); start = stop + 1;
            }
            notify('기억 저장 완료 · 자동 임베딩 중');
            await indexRecords(snapshot, signal, config);
            await hideCollected(snapshot,signal,config,book);
            notify(`수집 완료 · 새 기억 ${saved}개`);
        }, 'collection');
    }
    async function prepareMaintenance({kind,ids}) {
        draft=null;
        return job('기억 정리 초안 만드는 중',async signal=>{
            const snapshot=structuredClone(host.context()),config=settings();
            if(!snapshot.key)throw Error('채팅방에서 열어 줘.');
            const wanted=[...new Set(ids || [])], rows=(await records(snapshot)).filter(r=>wanted.includes(r.id));
            if(!wanted.length || rows.length!==wanted.length || new Set(rows.map(r=>r.book)).size!==1)throw Error('같은 로어북의 현재 기억을 선택해 줘.');
            const book=rows[0].book,data=await host.loadBook(book),before=JSON.stringify(data);
            assertCurrent(snapshot,signal);
            const visible=new Map(consolidationView(Object.values(data.entries || {}),snapshot.messages).map(e=>[String(e.uid),e]));
            const entries=rows.map(r=>visible.get(String(r.entry.uid)));
            if(entries.some(e=>!e || !entryAvailable(e,snapshot.messages)))throw Error('선택한 원본이 바뀌었어. 다시 선택해 줘.');
            const request=maintenanceRequest(kind,entries,snapshot.messages,config,data);
            const result=maintenanceResult(await askTracked(config.profile,request.system,request.data,signal,6000));
            assertCurrent(snapshot,signal);
            if(JSON.stringify(await host.loadBook(book))!==before || (request.source&&!matchesRange(request.source,host.context().messages)))throw Error('초안을 만드는 동안 원본이 바뀌었어. 다시 만들어 줘.');
            const token=makeId();
            draft={token,kind,book,before,snapshot,entries,request,result};
            await log('maintenance.preview',{kind,ids,result});
            notify('초안 준비됨 · 확인 후 적용해 줘');
            return {token,kind,...result,beforeTokens:estimateTokens(entries.map(e=>e.content).join('\n')),afterTokens:estimateTokens(result.content),originals:entries.map(e=>({title:e.comment,content:e.content}))};
        },'maintenance-preview');
    }
    async function applyMaintenance({token,title,content}) {
        return job('기억 정리 적용 중',async signal=>{
            const pending=draft;if(!pending || pending.token!==token)throw Error('초안이 만료됐어. 다시 만들어 줘.');
            const {snapshot,book,before,entries,request,kind}=pending;
            assertCurrent(snapshot,signal);
            if(!host.books().includes(book))throw Error('검색 대상 로어북이 바뀌었어.');
            const result=maintenanceResult(JSON.stringify({title,content}));
            const data=await host.loadBook(book);
            if(JSON.stringify(data)!==before || (request.source&&!matchesRange(request.source,host.context().messages)))throw Error('초안 이후 원본이 바뀌었어. 다시 만들어 줘.');
            const entry=kind==='merge'?host.newEntry(data):data.entries[entries[0].uid];
            const previous=kind==='merge'?null:{content:entry.content,title:entry.comment,source:entry[NS]?.source};
            entry.comment=result.title;entry.content=result.content;
            entry[NS]={...entry[NS],source:request.source,tier:request.tier,updatedAt:new Date().toISOString(),
                ...(kind==='merge'?{members:entries.map(e=>({uid:String(e.uid),title:e.comment,content:e.content})),collectedAt:new Date().toISOString()}:{}),
                history:[...(entry[NS]?.history || []),...(previous?[previous]:[])]};
            assertCurrent(snapshot,signal);
            await host.saveBook(book,data);draft=null;lastRecall=null;
            await log('maintenance.applied',{kind,book,entry});
            assertCurrent(snapshot,signal);await indexRecords(snapshot,signal,settings());
            notify('기억 정리 적용 완료');
        },'maintenance-apply');
    }
    async function recall(options = {}) {
        return job('필요한 기억 찾는 중', async signal => {
            lastRecall=null;
            const started=Date.now();timings={questionMs:0,embeddingMs:0,selectionMs:0};
            const snapshot = structuredClone(host.context()), config = settings();
            const rows = await records(snapshot);
            const core = rows.filter(r => isCore(r.entry)).map(r => r.entry.content).join('\n\n');
            const messages=recallMessages(snapshot.messages,options.generationType);
            const recent = recentDialogue(messages, config.recentCount);
            const focus = retrievalFocus(messages, config.recentCount);
            await log('dialogue.context', {requested:config.recentCount,generationType:options.generationType,excludedTail:snapshot.messages.length-messages.length, recent, sourceMessages:messages.map((m,index)=>({index,name:m.name,is_user:m.is_user,is_system:m.is_system,text:m.mes})).filter(m=>!m.is_system&&String(m.text||'').trim()).slice(-config.recentCount)});
            await log('core.records',{records:rows.filter(r=>isCore(r.entry)),text:core});
            if (!recent.text) { lastRecall={text:'',core,units:[],questions:[],pending:0,candidateTotal:0,tokens:0,mode:config.mode,records:rows.filter(r=>isCore(r.entry))};await log('retrieval.empty',{reason:'no dialogue'});return { text: '', core, selected: new Set(), books: host.books() }; }
            let questions = [];
            if (config.mode === 'questions') {
                notify('최근 대화에서 검색 질문 만드는 중');
                const raw = parseJson(await askTracked(config.searchProfile || config.profile,
                    config.prompts.questions + '\nReturn ONLY JSON: {"questions":["question"]}.', { latestUser:focus.latestUser, dialogue: recent.text }, signal, 1200, 'questionMs'));
                if (!Array.isArray(raw.questions) || raw.questions.length > 4 || raw.questions.some(q => typeof q !== 'string' || q.length > 2000))
                    throw new Error('검색 질문 형식이 올바르지 않아.');
                questions = raw.questions.filter(q => q.trim());
            }
            await log('search.queries',{mode:config.mode,queries:config.mode==='questions'?questions:config.mode==='embedding'?[recent.text]:[focus.latestUser,focus.context],latestUser:focus.latestUser,context:focus.context,policy:config.mode==='embedding'?'cosine-similarity':(config.mode==='questions'?'question-reserved-v2':'latest-user-reserved-v1')});
            const chunks = [], cacheStatus=[]; let pending = 0;
            for (const row of rows.filter(r => !isCore(r.entry))) for (const chunk of await chunksFor(row, config)) {
                const vector = await host.store.get(chunk.cacheKey);
                cacheStatus.push({entryId:chunk.id,chunk:chunk.index,hit:!!vector,text:chunk.text,dimensions:vector?.length});
                if (vector) chunks.push({ ...chunk, vector }); else pending++;
            }
            await log('retrieval.cache',{chunks:cacheStatus});
            let fitted = { text: '', units: [], tokens: 0 }, candidateTotal = 0;
            if (chunks.length && focus.latestUser) {
                const queryCache = new Map();
                const vectors = async texts => {
                    const result = [];
                    for (const text of texts) for (const chunk of embeddingChunks({content:text},1000)) {
                        if (!queryCache.has(chunk.text)) queryCache.set(chunk.text,await embedTracked(config,chunk.text,true,signal));
                        result.push(queryCache.get(chunk.text));
                    }
                    return result;
                };
                const plain=config.mode==='embedding';
                const lanes = plain ? {context:await vectors([recent.text])} : {focus:await vectors([focus.latestUser]),questions:await vectors(questions),context:await vectors([focus.context])};
                const ranked=plain ? rankChunks(chunks,lanes.context,chunks.length) : rankFocusedChunks(chunks,lanes);
                const candidates=plain ? ranked.slice(0,config.candidateCount) : chooseCandidates(ranked,config.candidateCount,config.mode); candidateTotal = candidates.length;
                const candidateKeys=new Set(candidates.map(c=>JSON.stringify([c.id,c.index])));
                await log('search.ranking',{indexedChunks:chunks.length,missingChunks:pending,queryDimensions:[...queryCache.values()].map(v=>v.length),policy:plain?'cosine-similarity':(config.mode==='questions'?'question-reserved-v2':'latest-user-reserved-v1'),ranked:ranked.map(({vector,cacheKey,...item},index)=>({...item,rank:index+1,offered:candidateKeys.has(JSON.stringify([item.id,item.index]))})),notRanked:chunks.filter(c=>!ranked.some(r=>r.id===c.id&&r.index===c.index)).map(c=>({entryId:c.id,chunk:c.index,reason:'non-positive similarity or incompatible vector dimensions'}))});
                if (plain) {
                    // Whole original chunks, in similarity order. No planner, selector or lexical fallback.
                    const groups=candidates.map(c=>{
                        const units=reviewUnits([c]);
                        return units.length ? {...units[0],selectionFormat:'embedding',reason:'cosine similarity',score:c.score,requiredContext:units.slice(1)} : null;
                    }).filter(Boolean);
                    fitted=await fitInjection(groups,config.injectionTokens,host.countTokens);
                    await log('injection.budget',{policy:'embedding-chunks',limit:config.injectionTokens,tokens:fitted.tokens,kept:fitted.units,dropped:groups.filter(u=>!fitted.units.some(k=>k.entryId===u.entryId&&k.index===u.index))});
                } else {
                    const offered = reviewUnits(reviewCandidates(candidates,chunks)), selected = [];
                    const batches = reviewBatches(offered);
                    for (const [index,batch] of batches.entries()) {
                        notify('검색된 기억에서 필요한 원문 고르는 중');
                        let response, accepted;
                        for (let attempt=0;attempt<2;attempt++) {
                            response = await askTracked(config.searchProfile || config.profile,
                                config.prompts.select + '\nReturn ONLY JSON: {"selections":[{"id":"u0","priority":3,"reason":"specific missing fact needed now","contextIds":[]}]}. Use priority 3 for direct facts, 2 for indispensable supporting context. Omit everything else. At most 24 selections in usefulness order. For no needed facts return {"selections":[]}. For each fact include contextIds (up to 8 IDs from the same entry) for sentences required to identify the owner, speaker, referent, conditions, negation, or a contrasting counterpart. Read nearby sentences before selecting. If two people have similar objects, include the distinguishing facts for each relevant owner; never assume their properties match. Before responding check that your excerpts do not change attribution or omit a qualification. Omit a fact if the supplied context cannot disambiguate it. These dependent sentences are retained together or omitted together; do not invent connective text.',
                                { latestUser:focus.latestUser, dialogue: recent.text, questions, memories: batch,
                                    batch:index+1,batchCount:batches.length,maxSelections:24,injectionBudgetTokens:config.injectionTokens }, signal, 3000);
                            try { accepted=selectedUnits(response,batch);break; }
                            catch(error) {
                                signal.throwIfAborted();
                                await log('selection.invalid',{batch:index+1,attempt:attempt+1,message:error.message,response});
                                if(attempt===1)throw error;
                                notify('선별 응답 형식 다시 확인 중');
                            }
                        }
                        await log('selection.validated',{batch:index+1,batchCount:batches.length,maxSelections:24,offered:batch,rawResponse:response,accepted,rejectedOrUnselected:batch.filter(u=>!accepted.some(a=>a.id===u.id))});
                        selected.push(...accepted);
                    }
                    // Direct answers precede supporting context; keep the AI's order within each priority.
                    const beforeBudget=selected.sort((a,b)=>b.priority-a.priority);
                    fitted = await fitInjection(beforeBudget, config.injectionTokens, host.countTokens);
                    await log('injection.budget',{policy:'selection-priority-v1',limit:config.injectionTokens,tokens:fitted.tokens,kept:fitted.units,dropped:beforeBudget.filter(u=>!fitted.units.some(k=>k.id===u.id))});
                }
            }
            assertCurrent(snapshot, signal);
            if (JSON.stringify(snapshot.messages) !== JSON.stringify(host.context().messages)) throw new Error('검색 중 대화가 바뀌었어. 다시 시도해 줘.');
            timings.totalMs=Date.now()-started;timings.otherMs=Math.max(0,timings.totalMs-timings.questionMs-timings.embeddingMs-timings.selectionMs);
            await log('recall.timing',timings);
            assertCurrent(snapshot, signal);
            lastRecall = { ...fitted, timings:{...timings}, questions: config.mode === 'questions' ? questions : [], pending,
                candidateTotal, core, records:rows.filter(r=>isCore(r.entry)||fitted.units.some(u=>u.entryId===r.id)),shortened: recent.shortened, mode: config.mode, time: new Date().toISOString() };
            await log('injection.prepared',{core,recalled:fitted.text,tokens:fitted.tokens,selected:fitted.units,pending,candidateTotal});
            notify(`회상 완료 · ${(timings.totalMs/1000).toFixed(1)}초 · ${fitted.tokens}토큰${pending ? ` · 미임베딩 ${pending}구간` : ''}`);
            return { ...fitted, core, selected: new Set(fitted.units.map(u => u.entryId)), books: host.books() };
        }, options.kind || 'preview', options.trace);
    }
    return {
        prepareMaintenance, applyMaintenance, discardDraft:()=>{draft=null;},
        exportDraft:()=>structuredClone(draft), restoreDraft:value=>{if(active)throw Error('작업 중에는 초안을 복원할 수 없어.');draft=structuredClone(value);},
        markInjected:elapsedMs=>{if(lastRecall){lastRecall.timings={...lastRecall.timings,injectionMs:elapsedMs};host.changed?.();}},
        collect, recall, cancel: () => active?.abort(), clearRecall: () => { lastRecall = null; },
        index: (force = false) => job('임베딩 확인 중', async signal => {
            const snapshot=structuredClone(host.context()),config=settings();
            const result = await indexRecords(snapshot, signal, config, force);
            if(host.target())await hideCollected(snapshot,signal,config,host.target());
            notify(result.total?`임베딩 완료 · ${result.complete}구간`:'임베딩 대상 없음 · 코어·비활성 항목은 제외돼'); return result;
        }, 'index'),
        state: () => ({ busy: !!active, status, lastRecall }),
        dashboard:controllerDashboard,
        embeddingCounts,
        cachedEmbeddingCounts:()=>countCache?.key===countKey()?{...countCache.value}:null,
        invalidateEmbeddingCounts,
        prepareEmbedding:signal=>readEmbeddingCounts(true,signal),
        maybeAutoCollect,
    };
    async function readEmbeddingCounts(migrate=false,signal) {
        // Only the current book entries and vector presence are needed here.
        // Count-only callers do not clone the chat, restore jobs, read receipts or copy vectors.
        const snapshot=host.context(),config=settings();
        if(!snapshot.key)return {embedded:0,pending:0};
        const rows=await records(snapshot);signal?.throwIfAborted();
        const groups=await Promise.all(rows.filter(r=>!isCore(r.entry)).map(row=>chunksFor(row,config)));
        const keys=groups.flatMap(group=>group.map(chunk=>chunk.cacheKey));
        signal?.throwIfAborted();
        const presence=!migrate&&host.store.peekMany?host.store.peekMany.bind(host.store):host.store.hasMany?.bind(host.store);
        const present=presence?await presence(keys,{signal}):await Promise.all(keys.map(async key=>!!await host.store.get(key)));
        signal?.throwIfAborted();let offset=0,embedded=0,pending=0;
        for(const group of groups){const complete=group.length>0&&present.slice(offset,offset+group.length).every(Boolean);offset+=group.length;if(complete)embedded++;else pending++;}
        return {embedded,pending};
    }
    async function embeddingCounts() {
        const key=countKey(),revision=countRevision;
        if(countRead?.key===key&&countRead.revision===revision)return countRead.promise;
        const task={key,revision,promise:null};
        task.promise=readEmbeddingCounts().then(value=>{
            if(countRevision!==revision||countKey()!==key)throw new DOMException('기억이 변경되어 개수를 다시 확인합니다.','AbortError');
            countCache={key,value};return {...value};
        }).finally(()=>{if(countRead===task)countRead=null;});
        countRead=task;return task.promise;
    }
    async function controllerDashboard() {
            const snapshot = structuredClone(host.context()), config = settings();
            if (!snapshot.key) return { records: [], ranges: [], next: 0, embedded: 0, pending: 0 };
            const rows = await records(snapshot); let embedded = 0, pending = 0;
            const groups=await Promise.all(rows.filter(r=>!isCore(r.entry)).map(row=>chunksFor(row,config)));
            const keys=groups.flatMap(chunks=>chunks.map(chunk=>chunk.cacheKey));
            const present=host.store.hasMany?await host.store.hasMany(keys):await Promise.all(keys.map(async key=>!!await host.store.get(key)));
            let offset=0;
            for(const group of groups){const complete=group.length>0&&present.slice(offset,offset+group.length).every(Boolean);offset+=group.length;if(complete)embedded++;else pending++;}
            const book = host.target();
            const data = book ? await host.loadBook(book) : null;
            const ranges = validReceipts(data, snapshot.messages).map(r => r.source);
            return { records: rows, ranges, next: nextStart(validReceipts(data, snapshot.messages), host.initialStart()), embedded, pending };
    }
}
