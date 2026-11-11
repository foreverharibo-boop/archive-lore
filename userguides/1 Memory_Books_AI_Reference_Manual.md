# Archive Lore 0.5.0 — Memory Books fork

The active browser entry is `archive-lore-fork.js`. It loads the original Memory Books bundle (`index.build.js`) for collection, clips, side prompts, consolidation, compaction, regeneration, profiles, automatic collection, hiding and recovery. The Korean home has three tabs: 기억 수집, 저장된 기억, 설정. Only the active tab is shown. Existing actions retain short explanations, and original profile/detail controls are collapsed under 설정 → 고급 설정 · 원본 메모리북. The original duplicate footer actions are omitted in the fork home; scene clearing is available within the selected-range details. `archive-lore.js` runs as a search/embedding companion, with its former collection scheduler and dashboard disabled. Rebuild native changes with `npm install --ignore-scripts` and `npm run build:fork`.

## Installation and feature groups

Update the Archive Lore extension and reload SillyTavern. Do not enable a separate original Memory Books installation alongside this fork: both use native `STMemoryBooks` settings, commands, events and UI identifiers. Disable that separate extension before enabling this one. Existing Memory Books books and settings remain native; standalone Archive Lore data needs the temporary importer below.

Open **magic wand → Archive Lore** or `/al`:

| Group | Features |
| --- | --- |
| 수집·자동화 | Collect selected scenes, explicit message ranges, catch-up, automatic message/token triggers, pending work |
| 기억 관리 | Consolidation/arcs and higher tiers, individual compaction, saved records, native regeneration, recovery |
| 클립·사이드 기록 | Topical clips, editable side prompts and sets, suggestions; plain clips retain the original text-selection controls |
| 검색·주입 | Independent embedding credentials, dialogue/question/vector retrieval, diagnostics and preview |
| 프롬프트·고급 설정 | Original memory/consolidation prompts, additional context, general settings and profiles |

The native memory UI controls collection and side prompts. Search settings control only retrieval/embedding. The search activation checkbox does not disable native automatic collection; use native automatic settings for that. Selected connection profiles for collection/sides are editable in the native profile editor. Search has a separate profile. Original `/stmb-*` and `/scenememory` commands are retained. `/al-collect` uses native collection, `/al-collect 0-19` supplies an explicit range, and `/al-catchup 0-245 40` invokes native catch-up. `/al-embed` embeds missing/changed chunks; `/al-recall` runs retrieval preview; `/al-stop` cancels native in-flight tasks and search. Preview and diagnostic downloads are also available from the search-tools button.

After a selected book is saved/edited, optional automatic embedding waits for current work/generation to finish and indexes pending chunks. Existing matching cached vectors are reused. The server plugin remains optional and handles Archive Lore retrieval, selection and embedding. **Native Memory Books collection, side prompts and maintenance run in the browser in this version; closing the browser is not supported for those jobs.** Do not assume old standalone server collection controls apply to the new native actions.

## Embedding counts

Opening search tools uses a dedicated, read-only count path instead of the full dashboard. It reads current book entries and checks vector keys; it does not restore jobs, synchronize completed jobs, read collection receipts, copy vectors or call an AI API. The last count for the current chat, selected books and embedding settings appears immediately with a “최근 확인” label while a fresh count runs. The first opening still needs a book/presence lookup. Entry edits, chat edits, settings changes and embedding work invalidate the cached count.

Server counts reflect vectors already present on the server. Browser-only vectors therefore remain pending until indexing is executed; server indexing copies compatible browser vectors before submitting the job so they need not be generated again. Server 0.3.7 checks presence from filenames without loading vector payloads or persisted job history. Update both copies and restart SillyTavern for that optimization. Older plugins without the presence endpoint show an update error instead of silently doing hundreds of vector downloads.

## RP stop behavior

The RP stop button cancels Archive Lore retrieval (question generation, embeddings and AI selection), native in-flight tasks, and queued automatic embedding. A following generation-ended event does not restart the canceled automatic work. Late recall results cannot install prompts after stopping. Server cancellation also uses the client request ID when submission has not yet returned a job ID; update both extension and server plugin and restart SillyTavern to enable this path (server 0.3.6). Chat switching still detaches persistent server jobs rather than canceling them. Completed saved memories are retained. Cancellation aborts outgoing requests; an external provider may already have processed or billed work before receiving the disconnect.


## Temporary standalone-data migration

In each existing chat, use **기존 기억 가져오기** at the top of the Archive Lore home. It is also accessible directly from Extensions → Archive Lore → 기존 기억 가져오기, or `/al-migrate`, even without opening the home. This imports old Archive Lore data, not the separate Archive extension. The importer downloads a backup without embedding credentials, copies each selected book to a separate `· AL` book, writes native memory fields and native side-prompt titles/templates, reads the copies back to verify the writes, and then changes this chat's target/search books. Original books are retained. This chat excludes retained source books from native World Info activation so source and copy cannot inject twice; other chats keep their original bindings. Do not delete them while checking the result. Allocation is saved before writes so a failed retry reuses destinations. Collection checkpoints are calculated only from matching contiguous source receipts. Existing uncollected external lore entries do not invent a collection checkpoint.

Migration snapshots the current branch's materialized content; incompatible source records remain disabled. Old branch/history data stays in the original books and backup. Native regeneration can only recover original dialogue where valid source message ranges exist. Side prompts are converted into native complete-record updates and an explicit after-memory set; they do not auto-run in unrelated chats. The old collection prompt becomes a native preset with the required single-memory JSON response contract.

Embeddings are copied only for identical chunk text with the same provider/model settings; changed chunk text remains pending. No AI reclassification or re-summarization is performed during migration. Converted book entries have no `archiveLore` metadata dependency: the one-time importer can later be removed without a special legacy entry reader. Normal native book loading and the new search/embedding layer remain. Current source books are never overwritten.

## Validation limits

Automated tests cover native units, retrieval/server behavior, source conversion and retry handling. Browser fixtures exercise the real native template, grouped controls, refresh, keyboard and mobile/desktop layout. These are mocked host tests, not an end-to-end installed SillyTavern session or paid RP/API validation.

The following 0.4.x section is retained only to describe old data and server internals. Its standalone collection/dashboard instructions are not the active 0.5.0 UI. The original Memory Books reference below it describes the active native workflows.

---

Fork UI descriptions use polite Korean. Buttons in native fork popups, migration/search tools, and the extension drawer retain horizontal labels; action rows wrap whole buttons on narrow screens. The native popup marker scopes these rules to Archive Lore.

Migration reports each phase (source read, backup, destination allocation/write/verification, vector copy, prompt save, chat binding) and includes the failing phase in errors. Transport errors distinguish timeout from network failure and show the plugin route; they no longer claim that synchronous migration continues on the server. Source books remain preserved. Prompt/token-count dry runs do not set the fork's generation-busy flags. These messages improve diagnosis; they do not guarantee server availability or repair unrelated chat integrity metadata.

### Server 0.3.5: automatic indexing and polling

Update both repository checkouts (extension and `plugins/archive-lore-server`) and restart the ST server, then reload the browser. Automatic indexing ignores server-result refresh notifications and is suspended during migration. An index job does not rewrite a lorebook, so completing one no longer emits book update events that schedule another index. Real native/editor saves still trigger automatic indexing.

Concurrent restores share one request sequence and completed results synchronize once. The active run's polling loop does not also start the background restore timer. `/jobs/get` no longer reads/hashes the whole chat for running jobs or recall results. Completed collect/index results still refresh actual hide flags. Indexing uses a cheap chat-key check per chunk and yields to the server event loop every sixteen chunks; source-content checks before writes remain intact.

The 30-second timeout applies to each ordinary HTTP request, not the total migration or AI job. Migration first checks existing server jobs, downloads a source backup, copies and verifies books and compatible cached vectors, saves native prompts, then changes chat bindings. The downloaded JSON is a backup, not a file the user must upload. There is no overall 30-second migration deadline.

# Legacy standalone runtime (0.4.x; migration reference only)

This repository is an AGPL-3.0-only fork of Aiko Hanasaki's Memory Books. The manifest now loads `archive-lore.js` and `lore-style.css` directly. The upstream `index.js`, bundles, and other features remain as historical fork source; they are not loaded by this runtime. Upstream connection-profile routing, chat message fingerprints, lorebook naming, and the default compaction prompt are reused. Settings, IndexedDB storage, chat metadata, prompt slots, menu IDs, and slash commands use independent Archive Lore namespaces.

## Setup and operation

Install `https://github.com/foreverharibo-boop/archive-lore` as a SillyTavern extension. Requires the host APIs `ConnectionManagerRequestService`, `WORLDINFO_ENTRIES_LOADED`, generation interceptors, and asynchronous token counting (tested against the current release source interfaces). Configure the collection connection profile and a separate embedding key/model in Extensions → Archive Lore. Collection/search profiles must use Chat Completion. Embedding settings are separated from memory-writing/search profiles and their profile-refresh button; no collection profile is used for embedding-only work. Google AI Studio accepts a direct API key and uses `embedContent`. Vertex accepts a separate API key, Google Cloud project ID, and location (default `global`), using `/v1/projects/{project}/locations/{location}/publishers/google/models/gemini-embedding-001:predict`. Global and regional API hosts are selected from the location. Both routes send `x-goog-api-key` without adding the credential to the URL. The model is automatic; existing OpenAI-compatible configurations retain their model/endpoint. Version 0.3.0 incorrectly blocked Vertex wholesale after checking an Express model list. Version 0.3.1 removes that block and independently implements the project-scoped Vertex embedding request contract in Archive Lore. Vertex uses 768 output dimensions and rejects oversized input rather than silently truncating; AI Studio retains its prior dimension behavior to preserve existing vectors. Vertex cache keys include project, location and dimensions. OAuth/service-account authentication is not implemented. Actual key/project/model entitlement requires a live connection test; mocked tests verify request routing and response handling, not paid account support. `임베딩 연결 확인` makes a small real embedding request and displays dimensions on success or provider status/message on failure; credentials are redacted. Browser mode can still encounter CORS. Server mode performs external embedding calls from Node and does not depend on browser CORS. Account entitlement, API restrictions and quota still apply.

Open the magic wand → 아카이브 로어, or use `/al`. The dashboard shows collected message-number ranges, the next range, core/memory/side records, and entry-level embedding completion. Message numbers are zero-based. `기억 수집` resumes at the next contiguous saved range. Choose a custom starting position or explicit range in the collapsed range controls. The default batch contains at most 20 messages and is reduced for long content; no collection source is silently truncated. Oversized single-message/record inputs stop with an error.

If no book is connected, collection creates one and links it to the current character's primary World Info; group chats bind the created book to chat World Info instead. Existing connected books are used without replacement. A different target and the books searched can be selected explicitly. Selecting a storage target also adds it to this chat's search selection; manually choosing an existing target does not replace an existing character primary link.

- `/al-collect`: collect the next range, or `/al-collect 0-19` for an explicit range.
- `/al-catchup 0-245 40`: collect the specified inclusive range sequentially in batches of at most 40 messages.
- `/al-embed`: embed pending or changed content and finish hiding previously committed ranges.
- `/al-recall`: run retrieval preview (does not itself install a prompt).
- `/al-stop`: stop the current operation.

Quick Replies can call these commands. Memory entries and range receipts are saved atomically in the same World Info write before automatic embedding starts. An embedding failure leaves saved memories intact. Repeating collection after such a failure retries pending embedding without recollecting committed ranges. After collection and embedding succeed, committed compatible ranges are automatically hidden through SillyTavern `/hide`. Messages are never deleted.

## Server plugin installation and lifecycle

The browser extension and server plugin share this repository and version but are installed in **two directories**. The server loader reads the root package `main` (`server/index.js`); the browser still reads `manifest.json`. No other extension's server code is imported. Node 20+ and a current SillyTavern Chat Completion backend are required. No extra `npm install` is needed; the plugin uses Node built-ins and SillyTavern's existing sanitize/provider modules.

From the SillyTavern server directory (the usual Termux path is `~/SillyTavern`):

```bash
cd ~/SillyTavern
if [ -d plugins/archive-lore-server/.git ]; then
  git -C plugins/archive-lore-server pull --ff-only
else
  git clone https://github.com/foreverharibo-boop/archive-lore.git plugins/archive-lore-server
fi
node plugins/archive-lore-server/server/enable.mjs
```

The helper backs up `config.yaml` before setting `enableServerPlugins: true`. If using a custom config path, set that option in the actual config instead. Restart the SillyTavern server, update/reload the Archive Lore browser extension, then enable **Extensions → Archive Lore → 서버 → 서버 실행 → 서버에서 실행**. Use **서버 연결 확인**, then **임베딩 연결 확인**. Merely updating the browser extension cannot install a server plugin on the host. Keep both Git checkouts updated together. Existing `enableServerPluginsAutoUpdate` may update the plugin at server startup.

The plugin mounts authenticated, CSRF-protected-by-host POST routes at `/api/plugins/archive-lore-server`. It requires the trusted `request.user` assigned by SillyTavern, and never uses client-supplied user directories. Profile credentials remain in ST's secret store. Before submission the browser resolves the chosen Chat Completion profile, preset, provider and secret ID; the worker invokes ST's own backend through an independent request/socket adapter. The browser does not expose stored provider secrets. Jobs record their inputs without embedding API keys or proxy passwords on disk; in-flight credentials exist in memory. Unsupported Text Completion profiles fail explicitly.

Collection, indexing, both recall modes, maintenance preview and approved maintenance application are persistent server jobs. A durable job ID is returned before processing; closing the browser or changing chats does **not** cancel accepted work. Explicit Stop does cancel it. Only one job per authenticated user runs at a time, protecting shared books. A new job cannot silently overlap another window's job. The chat's **서버 작업 내역** shows completed/failed/interrupted work, and **초안 열기** reopens completed maintenance previews after reconnect. Applying a persisted draft still rechecks original sources, the book snapshot, chat and token. Consumed drafts cannot be applied twice.

The worker reads the current saved chat file and revalidates source fingerprints, writes World Info with a final synchronous compare check, preserves backups before changes, and updates only the appropriate chat's hidden flags. Paths are confined to the authenticated user's directories, including symlink checks. Concurrent external-process writes remain a host filesystem limitation; changed source/book data observed before commit stops the job. Before submission the browser saves the chat; unsaved/mismatching snapshots are rejected. On reconnect it refreshes World Info caches and reconciles saved hidden flags against matching message fingerprints.

Data is stored under the authenticated user's `archive-lore-server/`: `jobs/`, `vectors/`, `diagnostics/`, and `backups/`. It persists across browser closure and browser storage deletion. Local existing vectors migrate lazily to server storage without another provider call. New embedding cache keys are deterministic across HTTPS, LAN HTTP and Node; old local keys remain readable. Job files and backups use restricted permissions. Diagnostic TXT includes both browser injection records and full redacted server work records. It still contains private RP text, not hidden model reasoning.

**Lifecycle limits:** the ST/Termux server must remain running. On server restart, in-flight jobs become **interrupted**, not silently replayed paid API calls; collection/indexing can be restarted using existing receipts/vectors. Automatic collection triggers originate from the browser's completed-RP events; this plugin is not an unattended chat-file watcher. It continues already submitted Archive Lore tasks. It does **not** keep the main RP answer generation or other extensions alive, and does not automatically install a completed old recall result into a new turn. The server initially budgets retrieval by estimated tokens; the browser re-fits selected original units with ST's real tokenizer before prompt installation and rejects results after a chat/source change.

Server runtime interfaces were checked against the official [ST plugin loader](https://github.com/SillyTavern/SillyTavern/blob/release/src/plugin-loader.js), [provider backend](https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/backends/chat-completions.js), [World Info endpoints](https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/worldinfo.js), and [connection profile service](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions/shared.js). Live provider credentials and the user's specific installed ST version still need live verification.

## Large-book dashboard refresh (0.3.2)

Dashboard reads no longer trigger their own refresh notification through server-job restoration. Repeated UI refreshes share one active render and at most one pending refresh; completed views are not invalidated merely because another refresh was requested. The character name and loading status appear before embedding lookups complete; failures are visible in the status field. Chat changes and closed/reopened dialogs reject stale views.

The server vector adapter checks presence via authenticated `/vectors/has`, in batches of at most 64 keys, returning booleans rather than complete vectors. Missing local vectors are checked with at most eight concurrent reads; existing local vectors still migrate without embedding API calls. Older plugins lacking the route fall back to at most eight concurrent single-key requests. Missing vectors are not negatively cached, so newly completed server embeddings become visible. Update both extension and plugin for the batch optimization. This does not rewrite lorebook content or trigger recollection. A zero-target index reports that core/disabled entries are excluded instead of claiming a successful zero-item embedding.

Regression tests include 105 imported entries changed from constant to searchable, a delayed server response longer than the restore refresh interval, 105 overlapping refresh requests, correct pending counts and pagination, no content changes, and provider-free vector status checks.

## Automatic collection, catch-up and hiding

Extensions → Archive Lore → 수집·검색 → 자동 수집·숨기기 offers automatic collection (off initially), trigger type, threshold, and retained-message count. Message mode defaults to 20 (1–1,000); token mode defaults to 6,000 (100–100,000), using the same local character-weighted estimate as collection budgeting. Count both user and character messages; ignore hidden/empty messages when deciding whether to trigger. A completed RP generation schedules collection if the threshold is met. Collection waits until RP generation and other Archive Lore work finish. There is no buffer: the most recent message is eligible. One trigger processes the full snapshot backlog in sequential batches; enabled side categories run in each batch's same AI request.

The chat dashboard's 지난 대화 한꺼번에 수집·로어북 panel accepts start, end and batch size (1–100). `/al-catchup 0-245 40` is the equivalent Quick Reply/chat command. Smaller batches can be used automatically for the existing review budget. Committed exact batches are skipped on retry; contiguous receipts determine the next default collection position. Existing hidden messages are not sent for ordinary collection; regeneration can read hidden original source messages without unhiding them.

Automatic hiding has no separate off switch. `수집 후 남길 메시지` defaults to 10 (0–1,000). Among all successfully collected ranges that still match this chat, keep the newest N covered messages; hide earlier covered messages. Uncollected gaps and newer uncollected dialogue are never hidden. The original text remains in chat storage. Increasing N does not unhide old messages retroactively. Failed saves never advance receipts; failed embeddings do not hide anything in that attempt. Press 기억 수집 or 남은 임베딩 to finish indexing and hiding committed ranges. The extension does not integrate with Chat Top Bar.

## Memory maintenance

Open a stored ordinary memory or arc to use `짧게 다듬기` (compaction) or `다시 만들기` (regeneration). Core and structured side records use their dedicated editors rather than these narrative maintenance operations. Compaction reuses Memory Books' default fidelity-preserving compaction instructions. It may produce a longer draft; estimated before/after token counts are shown, so no guaranteed compression ratio is claimed. Regeneration reads the original chat range, including hidden messages; entries lacking a valid original range cannot be regenerated. Arc regeneration reads its preserved original member records. Inputs beyond the 24,000 estimated-token review limit stop visibly rather than being silently cut.

Select at least two ordinary memories from the same book and press `선택 기억 묶기 · 아크`. Memories become an arc, and arcs become a combined arc. Mixed-tier selection and any further tier above combined arc are rejected. There is no automatic consolidation or tier advancement. Every maintenance operation first produces a read-only editable draft. Applying rechecks the chat, source fingerprints and full book snapshot, writes the accepted draft, then embeds changed content. A changed original/book requires a new draft. If embedding fails after a successful save, the saved record remains and pending embedding can be retried without applying the same draft twice.

Original member entries are retained in the lorebook, with read-only original text visible below the arc. For the compatible branch, retrieval and native World Info scan copies exclude original members while their valid arc is active; stored enable flags are not rewritten. If a parent is disabled/deleted, sources are edited, or its source no longer matches the branch, the invalid parent is excluded and valid originals become eligible again. This propagates through both arc levels. Compaction/regeneration retain the previous narrative text in history. Settings and diagnostics remain independent of the Archive extension.

## English compact memories and relationship dates

The collection and side defaults are English and require saved titles, keywords, metadata and prose in English. Evidence quotes stay in the original dialogue language. New event content is assembled as `[Title]`, one known date/time/location line, then concise narrative paragraphs. Unknown metadata is omitted; fictional dates are not inferred from the real clock. Imported/existing records are not translated retroactively. Custom prompts are preserved; only exact untouched v0.1.0 defaults are migrated to revision 2.

Side categories occupy separate stable lorebook entries, created when supported information first appears. Relationship facts use a short English label such as `Lovers` or `Ex-partners`. Phase (`start`, `breakup`, `reunion`, `other`) and ISO start date are stored separately. Code computes D+ inclusively from the current fictional story date: start day is D+1. Breakup and reunion begin a new phase; previous phases/dates remain in side history. Unknown dates produce an unknown-date marker, never an invented count. Counters refresh on collection or manual date correction, not in the background on every uncollected reply. Date-only progression updates the relationship entry without rewriting other categories. The dashboard's relationship editor can correct the label, phase, start date and current RP date. Date evidence must be an exact quote in the collected range; this checks provenance, not semantic truth.

## Change-based side records

Extensions → Archive Lore → 프롬프트 → 사이드 항목 편집 exposes six editable defaults: relationship definition; promises/agreements/refusals; preferences/habits; confirmed emotions and reasons; relationship changes/turning points; unresolved issues/future plans. Each item has an editable name/prompt, independent enable switch and full-screen editor. Add custom categories up to 24 total; custom settings can be removed without deleting existing records. The shared side instructions remain separately editable. Only enabled categories are supplied and accepted for updates, and they run in the same memory collection request, not separate AI calls. Disabling a category stops collection updates; it does not delete or suppress its already saved records during retrieval. The output is a list of `add`/`update` operations, not a replacement summary. Stable fact IDs constrain updates to existing items in the correct category. Each operation must cite an exact quote and message number from the current collection range. Format and quote validation do not prove semantic accuracy; users can review and edit records.

No-change output leaves side records unchanged, except a newly established story date can advance the relationship counter. Unmentioned facts stay intact. Completion, withdrawal, resolution, cancellation, and changed conditions are recorded rather than silently deleting historical facts. Each changed category retains previous content/facts/source evidence in its `archiveLore.history`. The dashboard exposes that history. Source fingerprints scope newly collected records to compatible chat/branch content; a branch can see the most recent compatible side version. Hidden-message flag changes alone do not invalidate previously collected evidence. Imported ordinary entries with no Archive Lore source metadata remain available to the explicitly selected books.

Collection, side-update, question-generation and selection prompts are editable. Custom prompts survive initialization/update. Import/export files contain prompts and side category templates only, never API keys. Legacy prompt files without sideTemplates preserve the current category configuration. `prompts/archive-lore-defaults.json` is the importable default preset. Response-format requirements are appended by code and are not editable.

## Retrieval and injection

Both modes use the configured independent embedding service and indexed content:

1. **대화로 검색**: code formats recent dialogue → embeds its chunks → vector search → AI selects original text unit IDs.
2. **질문으로 검색**: AI produces up to four questions from recent dialogue → embeds those questions → vector search → AI selects original text unit IDs.

Default recent-message count is 10 (1–200); default final retrieved-memory injection cap is 3,000 tokens (256–32,000). The recent-dialogue review context is limited to roughly 9,000 estimated tokens and each message to 3,000; clipping retains head/tail with an omission marker. These are internal review limits, separate from final injection. The preview notes when dialogue is shortened. Embedding/retrieval chunks are around 1,000 estimated tokens. The default search returns 16 candidate chunks (configurable 1–40). Long candidate sets are reviewed in multiple requests, each with roughly 10,000 tokens of numbered memory units plus the recent dialogue. There is no promise of exactly one selector call for every large candidate set.

Only offered original units can be selected; unknown IDs and AI rewrites cannot become injected memory. Final recalled text, titles and wrappers are counted with the host tokenizer and kept within the configured cap. Entries marked constant (blue-dot/core) are excluded from embeddings and supplied through a separate always-on core prompt, outside the retrieved-memory cap. Disabled entries are excluded. Selected books' native scan copies are suppressed to avoid duplicate insertion; stored keywords/enable flags are not rewritten. The optional keyword setting allows other native keyword matches, while suppressing a second insertion of the selected records. Existing custom character-filter/trigger rules are not independently reproduced for explicit Archive Lore book searches; select only books intended for the current chat.

Vector cache keys include a per-settings namespace, provider, model, endpoint, record ID and exact chunk content. Changing any of these invalidates reuse. In browser mode vectors are stored in this browser's IndexedDB; another browser/device must embed again. Server mode stores vectors under the ST user directory and can reuse them across browsers. The API key is saved in SillyTavern extension settings and is not included in the prompt export. API request text and completion text are recorded in local diagnostics; credential fields and known embedding keys are redacted. Keys are never intentionally exported. Removing browser site data removes the local vector cache. Saved lorebook text is independent of that cache.

Collection stops on invalid JSON, invalid side evidence, changed source dialogue, changed lorebook data, canceled work or switched chats. Before saving, the book is re-read and compared, but the World Info API has no cross-client atomic compare-and-swap; simultaneous external writes remain a host limitation. Retrieval failures abort that answer generation visibly rather than silently reusing a previous turn's prompt. Missing embeddings are reported in the preview and can be resumed with the pending-embedding button.

## Turn diagnostics and translation display

Diagnostics are on by default for this testing build. Each RP generation attempt, retrieval preview, collection and embedding job gets a separate ID, chat key, mode, timestamps and status. Records include settings without credentials, available/excluded records, the original recent messages and the clipped dialogue actually reviewed, question/selection prompts and completion text, embedding input and vector dimensions, cache hits/misses, ranked candidates and scores, accepted/rejected units, budget-dropped units, core/recalled text and installed prompt slots. Native scan suppression and host message/end/stop events are appended to the generation attempt. No hidden model reasoning is requested. Raw numeric embedding arrays are omitted. Installed slots prove what Archive Lore supplied to the host, not the final provider request after every other extension or whether the roleplay model used those facts.

Open the chat dashboard → 도구 → 턴별 진단 기록 → 진단 TXT 다운로드. The filter exports all operations or only a chosen search mode for this chat. Preview and collection are not counted as RP attempts. The UI renders the latest 30 records; TXT includes all stored records without silently pruning older ones. IndexedDB `archive-lore-diagnostics` persists across reloads in the same browser, separate from lorebooks/settings/vector data. These files contain full dialogue and memory text. Site-data deletion removes local diagnostics. Storage failures show a warning and preserve the current page's in-memory copy for immediate export. No automatic upload is performed.

The read-only translation bridge reads `extension_settings['simple-lorebook'].translations[book + U+241F + uid]` from the user's lore-manager extension. It matches the stored source hash to the current original. Stale translations remain visibly marked as previous translations. The dashboard displays translations beneath saved entries and beneath recent injection results. Retrieval translations are explicitly the full selected entry translation; there is no guessed sentence alignment. Translations never replace injection text and do not trigger translation API calls. Reopen or refresh the dashboard after editing translations in lore-manager. No changes to lore-manager are required.

Version 0.4.0 separates the chat dashboard into 기억 / 사이드 / 최근 주입, with a persistent bottom collection action and range/status display. Memory and side rows have separate lists, a shared text filter, 12-row pagination, and an expandable original editor with translations/history. The memory list's 기억 정리 disclosure contains consolidation controls. The header 도구 button opens pending embedding, catch-up/book selection, server jobs and diagnostic exports; it does not change the selected retrieval mode. Search mode remains a setting, with per-mode diagnostics still available inside tools. The header settings button opens the same settings UI as the extension drawer; closing it synchronizes the drawer's values. Settings are grouped into 연결 / 수집·검색 / 프롬프트 / 서버, retaining the active category when switching providers or adding a side item. Local SVG outline icons do not require a particular host icon font. Colors inherit SillyTavern theme variables, including dark themes. The main body scrolls independently while collection stays accessible at the bottom. This UI update does not change server protocol, lorebook data, stored settings keys, embedding behavior or retrieval pipelines; the existing 0.3.2 server plugin remains compatible.

Version 0.4.1 further reduces the character heading to 14px, compact side-setting rows to about 34px, and list/header/footer spacing. Native leading disclosure markers are hidden; a small trailing +/− indicates the closed/open state while native keyboard behavior remains. Record rows retain their trailing chevron. Buttons no longer use the host `menu_button` class; scoped color rules preserve theme-variable colors against late host-theme styling. The search control has one outer border and a transparent, borderless inner input. Browser regression checks include late host `!important` rules, disclosure markers, collapsed side-row height, heading size and collection-button colors.

The settings UI uses compact 12px controls, with separate spacing below prompt editors. Each prompt offers a full-screen editor with explicit save/cancel. Both provider keys are retained when switching; Vertex also preserves the project ID and location.

## Verification

Run `npm run test:archive-lore` and `npm run test:archive-lore:server`. The server lifecycle browser harness is `npm run test:archive-lore:server-browser`; it closes the browser process during a delayed collection, verifies server completion and on-disk records/vectors/hiding, reopens a fresh browser, exercises embedding without a collection profile, both recall modes, and persisted draft application. Server tests cover isolation, confined paths, source/book races, restart status, private credential exclusion, routing authentication, and partial failure recovery. The browser harness is `npm run test:archive-lore:browser` (requires Playwright and an installed Chromium; optional environment variables `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE_PATH`, `CHROMIUM_ARGS_MODULE`, and `KOREAN_FONT_ROOT` support externally installed dependencies). Tests additionally cover message/token triggers without buffers, safe hiding of committed ranges with gaps, custom and disabled side categories, explicit catch-up batches, read-only maintenance previews, stale draft rejection, hidden-source regeneration, two-tier consolidation, source retention/reactivation, and embedding failure after maintenance commit. Tests cover source/branch safety, no-op side updates/history, original-text selection, exact token-budget fitting, independent embedding request construction, atomic save receipts, retry after failed embedding, and both retrieval sequences. A local browser harness with simulated SillyTavern APIs and model replies additionally exercises the manifest entrypoint, collection → embedding → prompt installation, duplicate native scan suppression, disabling, and 320px/390px/1280px layouts, light/dark colors, pinned collection controls, tab filtering and settings-modal synchronization, separate embedding credentials, full-screen prompt save/cancel, 10 simulated RP turns per search mode, malformed-response aborts, diagnostic TXT content/redaction/reload persistence, and existing lore-manager translations. Actual paid model calls and a live user SillyTavern installation still require user testing; this release does not claim model-output quality has been validated.

---

# Active Memory Books technical reference

<!--
Copyright (C) 2024–2026 Aiko Hanasaki
SPDX-License-Identifier: AGPL-3.0-only
-->

# Memory Books: Complete AI Reference Manual

**Product:** SillyTavern Memory Books (STMB)  
**Reference version:** v8.5.0, August 1, 2026  
**Purpose:** A single, dense source of truth for an AI assistant that teaches, explains, and troubleshoots Memory Books.

---

## Table of Contents

- [1. How an AI Assistant Should Use This Manual](#1-how-an-ai-assistant-should-use-this-manual)
- [2. Product Definition and Mental Model](#2-product-definition-and-mental-model)
- [3. Core Vocabulary and Feature Selection](#3-core-vocabulary-and-feature-selection)
- [4. Requirements, Installation, and Initial Verification](#4-requirements-installation-and-initial-verification)
- [5. Opening Memory Books and Understanding the Main Panel](#5-opening-memory-books-and-understanding-the-main-panel)
- [6. Memory Book Storage Modes](#6-memory-book-storage-modes)
- [7. Profiles, Connections, and Generation Routing](#7-profiles-connections-and-generation-routing)
- [8. Scenes, Manual Memories, Automatic Memories, and Catch-Up](#8-scenes-manual-memories-automatic-memories-and-catch-up)
- [9. Token Saving, Hidden Messages, and the Memory Boundary](#9-token-saving-hidden-messages-and-the-memory-boundary)
- [10. Lorebook Activation and Retrieval](#10-lorebook-activation-and-retrieval)
- [11. Real Group Chat Mode](#11-real-group-chat-mode)
- [12. Narrator Mode](#12-narrator-mode)
- [13. Branching Chats](#13-branching-chats)
- [14. Clips](#14-clips)
- [15. Topical Clips](#15-topical-clips)
- [16. Side Prompts](#16-side-prompts)
- [17. Consolidation](#17-consolidation)
- [18. Compaction](#18-compaction)
- [19. Regeneration](#19-regeneration)
- [20. Context for Generation](#20-context-for-generation)
- [21. Prompt Architecture, Built-in Summary Prompts, and Authoring Rules](#21-prompt-architecture-built-in-summary-prompts-and-authoring-rules)
- [22. Summary Prompt Manager and Consolidation Prompt Manager](#22-summary-prompt-manager-and-consolidation-prompt-manager)
- [23. STMB and Other Extensions](#23-stmb-and-other-extensions)
- [24. Lorebook Entry Titles and Character Policy](#24-lorebook-entry-titles-and-character-policy)
- [25. Job Queue and Retry Controls](#25-job-queue-and-retry-controls)
- [26. Visual Feedback and Accessibility](#26-visual-feedback-and-accessibility)
- [27. Settings Map and Current Settings Reference](#27-settings-map-and-current-settings-reference)
- [28. Slash Command Reference](#28-slash-command-reference)
- [29. Troubleshooting by Stage](#29-troubleshooting-by-stage)
- [30. FAQ](#30-faq)
- [31. Compatibility, Migration, and Current Historical Notes](#31-compatibility-migration-and-current-historical-notes)
- [32. Developer and License Notes](#32-developer-and-license-notes)
- [33. Compact Diagnostic Decision Tree](#33-compact-diagnostic-decision-tree)
- [34. Minimum Recommended Teaching Sequence](#34-minimum-recommended-teaching-sequence)
- [35. Final Concept Summary](#35-final-concept-summary)

---

## 1. How an AI Assistant Should Use This Manual

Treat this document as the current operational reference for Memory Books. It replaces the need to load the separate Start Here guide, README, User Guide, Side Prompts guide, How STMB Works guide, and historical changelog as independent knowledge files.

Terms: 

- STMB = SillyTavern=MemoryBooks (this extension)
- ST = SillyTavern (base code that STMB extends)

When answering users:

1. Preserve Memory Books terminology exactly. A **Memory Book** is a SillyTavern lorebook used by STMB; it is not a separate database format.
2. Distinguish current behavior from historical behavior. Do not teach a removed or superseded workflow merely because it appeared in an old changelog.
3. Distinguish **Group Chat Mode** from **Narrator Mode**. They solve different problems.
4. Distinguish memory **generation**, lorebook **storage/configuration**, and later **retrieval by SillyTavern**. Activation/retrieval is part of base ST code. 
5. Do not invent controls, menu labels, provider behavior, or settings not described here.
6. When a screenshot is supplied, identify only visible controls. Give the next immediate action rather than assuming an off-screen control exists.
7. When troubleshooting, identify the first failed stage and test it before recommending prompt rewrites.
8. Prefer a simple working configuration before advanced routing, multiple books, custom prompts, Regex, or Side Prompt automation.
9. Explain that character filters and separate Memory Books improve routing and relevance; they are not a security boundary.
10. State uncertainty when the user’s installed version, SillyTavern version, provider, or custom prompt may differ.

### Current-document notes

Narrator Mode is implemented in v8.5.0.

Several beginner documents said a manual memory was technically required before automatic memories could begin. Current STMB can create the first automatic memory from message 0 when no processed-message baseline exists. A first manual memory is still recommended because it verifies the connection, Memory Book, output format, and desired starting boundary before automation is trusted.

---

## 2. Product Definition and Mental Model

Memory Books is a SillyTavern extension that converts selected or automatically chosen chat ranges into structured memory entries stored in SillyTavern lorebooks.

The basic process is:

```text
Chat messages
    ↓
STMB selects or receives a message range
    ↓
STMB assembles an AI request
    ↓
The model returns a structured memory
    ↓
STMB saves a lorebook entry
    ↓
Old processed chat messages may be hidden from active context
    ↓
SillyTavern later activates relevant lorebook entries
    ↓
The chat model receives those entries as context
```

STMB does not give a model permanent internal memory. It maintains an external reference system (lorebook entries). The chat model “remembers” when SillyTavern includes the relevant lorebook entries in the prompt to the AI.

### The three separate stages

1. **Generation quality** — Did the memory-generation model produce an accurate, useful result?
2. **Storage and configuration** — Was the result saved to the intended Memory Book with appropriate activation settings?
3. **Retrieval and model use** — Did SillyTavern activate and send the entry, and did the chat model use it correctly?

Troubleshoot these stages separately.

### Lorebooks and Memory Books

A **lorebook**, also called **World Info** in parts of SillyTavern, is a collection of entries that SillyTavern can conditionally add to a model request. A lorebook entry normally has:

- a title/comment;
- content;
- activation keywords or another activation mode;
- insertion position and order;
- recursion and budget controls;
- optional character filters and other metadata.

A **Memory Book** is an ordinary SillyTavern lorebook used by STMB. It can be opened, edited, reordered, exported, imported, or deleted with normal lorebook tools. Depending on the features used, it may contain:

- scene Memories;
- Arc, Chapter, Book, Legend, Series, or Epic summaries;
- Clip and Topical Clip entries;
- Side Prompt tracker entries;
- other STMB-managed entries.

### Memory entries are compressed context

A scene Memory is not the original transcript. It is a compressed representation intended to preserve continuity-relevant information such as:

- events and consequences;
- decisions and plans;
- discoveries and reveals;
- relationship or emotional changes;
- individual knowledge, beliefs, or misunderstandings;
- important objects, locations, identities, promises, and constraints.

Hiding processed messages does not delete them. It prevents those messages from being sent to the AI and therefore continuing to consume active chat-history context. 

---

## 3. Core Vocabulary and Feature Selection

| Need | Feature | Meaning |
|---|---|---|
| Summarize one selected or automatic chat range | **Memory** | “Remember what happened in this scene.” |
| Save selected chat wording or one fact | **Clip** | “Save this note.” |
| Gather facts about one subject from saved Memories | **Topical Clip** | “Gather everything my Memories say about this.” |
| Maintain changing information over repeated runs | **Side Prompt** | “Keep this tracker updated.” |
| Combine several lower-tier Memories or summaries | **Consolidation** | “Roll these entries into a higher-level recap.” |
| Shorten one existing STMB-managed entry | **Compaction** | “Trim this entry without losing its facts.” |
| Replace an existing entry using its original sources | **Regeneration** | “Rebuild this entry and review a replacement.” |

### Feature distinctions that users commonly confuse

- **Clip vs Topical Clip:** A Clip starts with text highlighted in the current chat. A Topical Clip starts with existing confirmed STMB Memories.
- **Topical Clip vs Side Prompt:** A Topical Clip is run manually to gather a topic. A Side Prompt can repeatedly maintain a changing tracker.
- **Compaction vs Consolidation:** Compaction rewrites one entry. Consolidation creates a new higher-tier summary from several entries.
- **Memory vs Side Prompt:** Memories are normally sequential scene records. Side Prompts usually update or overwrite one continuing support document.
- **Generation vs retrieval:** Creating an entry does not guarantee that SillyTavern later activates it.

---

## 4. Requirements, Installation, and Initial Verification

### Requirements

- SillyTavern 1.18.0 or later; the latest compatible release is recommended.
- A working AI connection.
- A model capable of following instructions and, for Memory and Consolidation workflows, returning valid JSON.
- Permission to install third-party SillyTavern extensions.
- A Chat Completion preset available in SillyTavern when using a local or Text Completion backend through an OpenAI-compatible Chat Completion endpoint.

### Normal Chat Completion users

OpenAI, Anthropic/Claude, OpenRouter, Gemini/Google, and other Chat Completion connections can normally use the built-in **Current SillyTavern Settings** profile.

### Local and Text Completion users

KoboldCpp, llama.cpp, TextGen, Ollama, and similar backends generally work most reliably when exposed through an OpenAI-compatible Chat Completion endpoint. Even when normal roleplay uses Text Completion, SillyTavern must have a Chat Completion preset available for STMB.

Typical KoboldCpp setup:

- API type: Chat Completion;
- source: Custom OpenAI-compatible;
- endpoint such as `http://localhost:5001/v1` or `http://127.0.0.1:5000/v1`;
- any nonblank custom API key if SillyTavern requires one;
- model ID in the endpoint’s expected format, commonly `koboldcpp/modelname`, without an unnecessary `.gguf` suffix;
- Chat Completion preset imported;
- response length at least 2048 tokens, with 4096 often safer.

Typical llama.cpp setup:

- API type: Chat Completion;
- source: Custom OpenAI-compatible;
- endpoint `http://localhost:8080/v1`, or `http://host.docker.internal:8080/v1` when SillyTavern runs in Docker;
- any nonblank API key if required by SillyTavern;
- the served model ID;
- no prompt post-processing unless the endpoint requires it.

Example server command:

```sh
llama-server -m <model-path> -c <context-size> --port 8080
```

### Optional Chat Top Bar

STMB works without Chat Top Bar / Chat Top Info Bar. Installing it adds the **Memory Books Jobs** queue interface for active, completed, failed, canceled, blocked, and review-needed work.

### Installation

1. Open SillyTavern.
2. Open the main **Extensions** panel.
3. Choose **Install Extension**.
4. Install the official Memory Books repository.
5. Reload SillyTavern if prompted.
6. Open a character chat or group chat.
7. Wait several seconds for STMB controls to initialize.

SillyTavern Extras is not required.

### Confirm that STMB loaded

At least one of these should appear:

- **Memory Books** in the magic-wand Extensions menu beside the chat input;
- scene chevrons **►** and **◄** in expanded message actions.

If neither appears:

1. wait up to ten seconds;
2. refresh the page;
3. verify that the extension is installed and enabled;
4. reopen a character or group chat;
5. inspect the browser console only after the basic checks fail.

---

## 5. Opening Memory Books and Understanding the Main Panel

Open the magic-wand Extensions menu near the chat input, then choose **Memory Books**.

The panel can include:

- Current Scene;
- Memory Status / highest processed message;
- Current Lorebook Configuration;
- Memory Profiles;
- Profile Actions;
- Extra Function Buttons;
- Prompt Managers;
- General Settings;
- Automatic Memories;
- Token Saving;
- Group-character or Narrator controls when relevant.

For a first Memory, only three decisions are required:

1. Which Memory Book will receive the entry?
2. Which profile/connection will generate it?
3. Which chat messages are the scene?

---

## 6. Memory Book Storage Modes

### 6.1 Automatic Mode: chat-bound Memory Book

Automatic Mode is the normal default. STMB uses the lorebook bound to the current chat through SillyTavern.

Use it when:

- one chat has one primary Memory Book;
- minimal configuration is preferred;
- group characters do not need separate Memory Books.

If no lorebook is bound, bind one in SillyTavern or use Auto-Create.

### 6.2 Auto-Create Lorebook Mode

Enable **Auto-create lorebook if none exists** to let STMB create and bind a lorebook when a Memory is first saved.

The default naming template can use:

- `{{char}}` — character or group name;
- `{{user}}` — user name;
- `{{chat}}` — chat ID/name.

STMB adds numeric suffixes when necessary to avoid duplicate names.

Auto-Create and Manual Lorebook Mode are mutually exclusive.

### 6.3 Manual Lorebook Mode

Enable **Manual Lorebook Mode** to choose a Memory Book independently of the lorebook bound to the chat.

Use it when:

- memories must live in a dedicated lorebook;
- multiple chats intentionally share one Memory Book;
- group members need separate books;
- Narrator Mode is used;
- the user understands the resulting activation plan.

The main manual Memory Book selection is stored for the current chat unless a persistent character lock overrides it in a compatible solo chat.

### 6.4 Separate Memory Books are usually clearer

A dedicated Memory Book makes it easier to:

- separate memories from character definitions and setting lore;
- set an independent lorebook budget and order;
- reuse or export memory history;
- inspect STMB-managed entries without unrelated lore;
- diagnose activation.

It is a recommendation, not a requirement.

### 6.5 Character Memory Book locks

A character Memory Book lock is a persistent Manual Mode assignment attached to a character card.

In a solo chat:

- an unlocked manual book belongs to the current chat;
- a locked book follows the character card across compatible Manual Mode chats;
- the manual book cannot be changed until the lock is removed.

In a real group chat:

- an unlocked per-character assignment belongs to the current group chat;
- a locked per-character assignment follows that character card into compatible Manual Mode groups;
- a missing locked book produces a broken-lock state that must be unlocked or repaired.

Use locks only when the same character should intentionally share one continuing Memory Book across stories. They are dangerous for alternate universes or unrelated timelines.

### 6.6 Recommended starting layout

- Solo chat: one chat-bound or auto-created Memory Book.
- Real group chat: one group Memory Book.
- Narrator chat: one omniscient Memory Book plus one unique book per declared character, as required by Narrator Mode.

---

## 7. Profiles, Connections, and Generation Routing

A Memory Books profile controls both generation and the resulting lorebook-entry settings.

### 7.1 Recommended first profile

Use **Current SillyTavern Settings** first. It uses the provider, model, and temperature currently active in SillyTavern.

Do not begin by rewriting prompts or configuring a Full Manual endpoint. First prove that one Memory can be generated and saved.

### 7.2 Why create a saved STMB profile

Create a separate profile when the user needs to:

- use a cheaper or more reliable model for memories;
- use a different provider from roleplay;
- bind a named Custom connection;
- choose a custom summary prompt;
- use different temperature or maximum output behavior;
- change title formatting;
- change activation, insertion, order, or recursion settings;
- use separate group/omniscient and character-focused prompts.

### 7.3 Profile fields

A profile may include:

- display name;
- API/provider;
- model ID;
- temperature;
- Summary Prompt preset;
- optional separate multi-character prompts;
- structured-output behavior;
- optional SillyTavern ChatCompletionService routing;
- optional Chat Completion preset;
- reverse-proxy behavior;
- title format;
- activation mode: Normal, Constant, or Vectorized;
- insertion position, including character, example-message, author’s-note, and Outlet positions;
- Outlet name when applicable;
- automatic or manual order value;
- Prevent Recursion;
- Delay Until Recursion.

### 7.4 Named Custom OpenAI-compatible connections

A Custom OpenAI-compatible profile can:

- use the currently active SillyTavern Custom connection; or
- bind one named Custom connection from SillyTavern’s Connection Manager.

The named connection supplies its saved URL and secret. The model field in the STMB profile remains the model override. If the named connection is deleted or ceases to be a Custom Chat Completion connection, STMB blocks the request rather than silently routing elsewhere.

### 7.5 Structured-output fallback

**Skip structured output and use plain-text completion** prevents STMB from sending a structured-output schema to providers that reject it. The model must still return the valid JSON demanded by the selected Memory or Consolidation prompt.

### 7.6 ChatCompletionService

**Use ST’s ChatCompletionService** uses `ConnectionManagerRequestService` when a profile is selected in SillyTavern’s Connection Manager. That connection profile supplies the provider, credentials, endpoint, proxy, and Chat Completion preset. STMB overrides the model and temperature and retains its response-token limit and structured-output choice. The connection profile’s preset takes precedence over a separate Chat Completion preset selected in STMB. The selected connection profile must use Chat Completion. Failed connection-profile requests are reported without retrying through STMB’s direct request path, which would lose the connection settings.

When no SillyTavern connection profile is selected, the existing ChatCompletionService behavior applies, including STMB’s optional Chat Completion preset. OpenRouter requests on this route inherit SillyTavern’s provider order, quantization filters, fallback controls, and middle-out routing setting. These controls remain in force if ChatCompletionService fails and STMB retries through its fallback request path. If that retry also fails, STMB reports both failures. Unchecking the option keeps STMB’s direct request behavior. Full Manual profiles do not use either service route.

### 7.7 Reverse proxy and Full Manual Configuration

**Use reverse proxy** forwards SillyTavern’s configured reverse-proxy details for supported providers.

**Full Manual Configuration** stores a separate endpoint and key inside the STMB profile. It is an exceptional path. Prefer a provider or Custom connection configured and tested in SillyTavern whenever possible.

### 7.8 Output length

The global STMB maximum response-token setting can override normal Chat Completion output length for Memory Books work. Cut-off JSON is a common reason for failed generation. Increase output length before weakening the schema or prompt.

---

## 8. Scenes, Manual Memories, Automatic Memories, and Catch-Up

### 8.1 What a scene is

A **scene** is the inclusive chat-message range STMB processes into one Memory.

Useful boundaries normally contain one coherent unit:

- an event;
- a conversation;
- an investigation step;
- an emotional or relationship development;
- a location or goal change;
- a connected action sequence.

Very small trivial ranges may produce little value. Very large ranges cost more, are harder to summarize, may exceed context, and often combine unrelated events.

### 8.2 Mark a scene manually

1. Expand the message actions, usually through a three-dot or similar control.
2. Click **►** on the first included message.
3. Click **◄** on the last included message.
4. Open Memory Books and verify the displayed start, end, speakers, message count, and token estimate.

Both boundary messages are included.

Use **Clear Scene** to remove the selection, or choose another start/end marker to replace one boundary.

### 8.3 Create a manual Memory

1. Verify the scene.
2. Verify the effective Memory Book.
3. Verify the selected profile.
4. Click **Create Memory**, or use `/creatememory`.
5. Review confirmation, token warning, participant confirmation, or preview windows when shown.
6. Approve the result.
7. Confirm that a new lorebook entry exists and that Memory Status advanced to the end of the scene.

A valid Memory result normally contains:

- a title;
- content;
- keywords;
- STMB metadata, including source range and chat identity.

### 8.4 Memory previews

When **Show memory previews** is enabled, review and optionally edit:

- title;
- memory content;
- keywords.

Check names, attribution, facts, omitted consequences, and unrelated commentary. Without previews, a valid result is saved automatically.

### 8.5 Automatic Memories

Enable **Auto-create memory summaries** and configure:

- **Auto-Summary Interval** — number of new messages processed per automatic Memory;
- **Auto-Summary Buffer** — newest messages left out so an unfolding scene is not summarized too early.

Example:

```text
Interval: 30
Buffer: 2
```

STMB waits until at least 32 messages exist beyond the processed boundary, then creates a Memory ending two messages before the newest message.

If no processed baseline exists, current STMB treats the baseline as `-1` and can begin at message 0. A manual first Memory remains recommended for setup validation and for choosing a deliberate starting point.

Lower intervals create more focused Memories and more requests. Higher intervals create fewer, larger Memories with a greater risk of combining unrelated material. A practical starting range is approximately 20–40 messages for detailed roleplay and 40–60 for shorter, faster exchanges.

Automatic generation can be postponed when a required Memory Book is not yet assigned.

### 8.6 Processed-message baseline

STMB stores the highest processed message for each chat. It determines:

- where `/nextmemory` starts;
- where automatic Memories start;
- the memory-boundary indicator;
- which messages count as already processed.

Use:

- `/stmb-highest` to display it;
- `/stmb-set-highest <N>` to set it manually;
- `/stmb-set-highest none` to clear it.

Manual changes should be deliberate because they can cause skipped or repeated ranges.

### 8.7 Catch-up for an existing long chat

Use:

```text
/stmb-catchup interval=<chunk size> start=<first message id> end=<last message id>
```

Example:

```text
/stmb-catchup interval=40 start=0 end=245
```

The range is inclusive. Chunks are processed consecutively; the final chunk may be smaller.

Catch-up is intentionally non-interactive. Before running it:

- select and test the intended profile;
- enable **Always use default profile**;
- disable **Show memory previews**;
- ensure the effective Memory Book exists, or permit Auto-Create in Automatic Mode;
- repair all required multi-character book assignments;
- choose a chunk size below the token-warning threshold.

STMB preflights every chunk, processes in order, and stops on the first failure or `/stmb-stop`. Completed earlier chunks remain saved. Resume from the first unfinished message rather than repeating the whole range.

Use catch-up for broad conversion. Manual scene boundaries remain better when literary or event boundaries matter.

---

## 9. Token Saving, Hidden Messages, and the Memory Boundary

### 9.1 Hiding is not deleting

Hidden messages remain in the chat file. They are omitted from active chat context until revealed again.

### 9.2 Auto-hide modes

**Auto-hide messages after adding memory** can be:

- Do not auto-hide;
- Auto-hide all messages up to the last Memory;
- Auto-hide only messages in the last Memory.

**Messages to leave unhidden** preserves a small recent overlap near the boundary.

> **Using the Presence extension:** Presence may later reveal messages hidden by STMB because both extensions modify SillyTavern's shared message visibility state. See [STMB and Other Extensions](#23-stmb-and-other-extensions) for configuration guidance.

### 9.3 Unhide before generation

**Unhide hidden messages for memory generation** reveals a selected range before STMB compiles it. Use this when regenerating or reprocessing ranges that were previously hidden. The selected auto-hide mode determines what is hidden again after a successful save.

### 9.4 Memory-boundary indicator

The indicator uses the highest processed message to show where processed history ends and unprocessed chat begins.

Modes:

- Off;
- Memory boundary divider;
- draggable jump button;
- divider plus jump button.

The jump button scrolls toward the first unprocessed message and remembers its dragged position.

### 9.5 Good learning configuration

A practical initial setup is:

- show the boundary divider and jump button;
- leave two messages unhidden;
- enable temporary unhide for generation;
- use no auto-hide until the user has confirmed that a Memory was saved correctly;
- then switch to hiding all processed messages for the main token-saving benefit.

---

## 10. Lorebook Activation and Retrieval

### 10.1 Keywords

Normal Memories are commonly keyword-triggered. Good keywords are concrete and distinctive:

- character names and aliases;
- named locations or organizations;
- important objects;
- event names;
- identifiers;
- specific discoveries or actions.

Weak keywords such as `important event`, `conversation`, or `secret` are too broad.

The memory content determines what the model learns. Keywords help determine when SillyTavern retrieves it.

### 10.2 Activation modes

- **Normal:** keyword/rule-driven activation.
- **Constant:** always active, subject to applicable budget and entry controls.
- **Vectorized:** uses vector-related retrieval when the user’s setup supports it.

Vectors are optional. STMB works through keywords without the Vectors extension.

### 10.3 Recommended global World Info settings

Common starting recommendations:

- Match Whole Words: off;
- Scan Depth: relatively high, such as 8;
- Max Recursion Steps: approximately 2;
- Context percentage: sized to the user’s total context and competing prompt material.

These are recommendations, not hard requirements.

### 10.4 Delay Until Recursion

If the Memory Book is the only active lorebook/World Info source, leave **Delay Until Recursion** disabled. Otherwise no entry may start the first recursion cycle and the Memory may never activate.

### 10.5 Diagnosing retrieval

When an AI “does not remember”:

1. Verify that the entry exists.
2. Verify that the correct Memory Book is active for the chat.
3. Verify that the entry is enabled.
4. Verify that keywords or activation mode match the current conversation.
5. Verify that the lorebook budget is sufficient.
6. Verify recursion settings.
7. Use a World Info inspection tool or request log to confirm whether the entry was actually sent.
8. If it was sent but ignored, the remaining problem is model behavior or competing context, not STMB storage.

---

## 11. Real Group Chat Mode

### 11.1 Definition

Group Chat Mode applies to a real SillyTavern group containing two or more separate character cards.

```text
SillyTavern Group
├── Alice character card
├── Bob character card
└── Clara character card
```

SillyTavern records which card authored each message, so STMB can preserve speaker attribution and detect participating group members.

No separate Group Chat Mode switch is required. Open a group chat and use STMB normally.

**General Settings → Group Chat** contains two independent controls, both checked by default:

| Setting | Checked | Unchecked |
|---|---|---|
| **character-aware memories** | Enables participant-based memory filters and configured character-specific memory processing. | Uses ordinary single-book processing for new memories, regeneration, and consolidation. No participant confirmation, character filters, character-book copies, linked regeneration, character-based consolidation streams, or automatic group/character prompt routing. |
| **Use separate group side prompts** | Automatic side prompts inherit the group default. | Automatic side prompts inherit the solo default. |

The memory checkbox does not affect the side-prompt checkbox. Side-prompt default routing applies to both after-memory and interval triggers; explicit per-chat set selections or individually enabled prompts still take precedence, and manual runs remain available.

When character-aware memories is off, **Automatically accept detected participants in future**, **Group Character Lorebooks** assignments, **Use separate group and character prompts in group chats**, and its **Group Summary Prompt / Character Summary Prompt** selectors remain visible but grayed out. Their tooltips explain that they are disabled and not applied because the General Settings checkbox is unchecked. When separate group side prompts is off, only the group side-prompt default selector is grayed out for that reason. Saved choices are retained and restored when re-enabled.

These switches do not migrate existing entries or STLO configuration. Existing filters continue to apply until an entry is explicitly regenerated; regeneration with character-aware memories off removes that entry's character filter without rewriting its linked copies. New consolidated entries are unfiltered, while source entries retain their filters. Operations already started, including queued jobs and retries, retain their captured settings. Native group identity, speaker names, and primary Memory Book selection remain intact. Narrator Mode is independent of these native-group controls.

The character-aware behavior described below applies while **character-aware memories** is checked.

### 11.2 Participant detection

A detected participant is normally a character card that authored at least one message inside the selected scene.

STMB does not infer every person physically present from prose. Therefore:

- a silent observer may not be detected;
- a merely mentioned character is not a participant;
- an absent character discussed by the group is not selected;
- the user is not treated as a separate group-character Memory Book target;
- duplicate or unusual speaker identities may need correction.

If automatic participant detection finds no group characters, STMB opens the participant confirmation even when automatic acceptance is enabled. The warning explains that detection failed and requires the user to review which group characters were present before proceeding.

The participant prompt means: **Which group characters should this Memory be associated with?** It does not prove who knew every fact or who was physically present.

### 11.3 One group Memory Book

This is the recommended starting layout.

Use Automatic Mode, Auto-Create, or a main Manual Mode book. Each scene produces one canonical entry in the group Memory Book. When participant names are available, the entry can receive an inclusive SillyTavern character filter.

An inclusive filter for Alice and Bob means the entry can activate when Alice **or** Bob is active. It does not create a synthetic “Alice and Bob” character or a separate subset book.

One group book is best when:

- the cast mostly shares one story;
- one omniscient/group-oriented summary is sufficient;
- minimal setup and fewer duplicate entries are preferred;
- STLO is not needed.

A single group Memory can still preserve asymmetric knowledge:

> Alice found the transmitter and hid it. Bob believed the room was empty.

### 11.4 One group book plus per-character books

The advanced real-group layout uses:

- one canonical group Memory Book;
- one assigned character Memory Book for each group member.

Requirements:

- Manual Lorebook Mode;
- a valid assignment for every required group member.

The canonical group book may also be selected as a character book. STMB stores the canonical group entry and its linked character copy as separate entries in that book. The character copy is filtered to its assigned character and takes precedence over the canonical version on that character’s turn. More than one character may share the same character book; STMB writes one shared copy rather than duplicates.

When a Memory is saved:

1. the canonical version is written to the group book;
2. participant selection is confirmed unless automatic acceptance is enabled;
3. linked copies are written to selected participant books;
4. STMB rolls back partial writes when possible if one required save fails.

Selecting no participants in the real-group participant confirmation applies the Memory to every current group member.

### 11.5 Separate group and character prompts

By default, the same group-oriented Memory is copied to participant books.

A profile can enable **Use separate group and character prompts in group chats**. Then:

- the Group Summary Prompt writes the canonical group version;
- the Character Summary Prompt writes an individualized version for each single-character target book.

Character-focused versions can preserve:

- private knowledge;
- mistaken beliefs;
- personal emotional reactions;
- relationship-specific priorities;
- what mattered to one participant.

This requires additional AI requests. A shared character book receives one shared copy rather than one duplicate per assigned character.

### 11.6 Optional STLO integration

Memory Books decides:

- scene range;
- participants;
- summary content;
- which books receive copies;
- whether individualized prompts are used.

When installed, STLO additionally decides:

- when a lorebook is active;
- which character can activate it;
- priority, position, budget, and ordering.

STLO is not required for a real group chat. STMB injects the speaking native group member’s assigned book into that generation and uses native entry-level character filters. When STLO is available and STMB assigns a separate character book, it also adds the character’s avatar basename to `stlo.characterOverrides` and enables `stlo.onlyWhenSpeaking`, while preserving existing STLO priorities, budgets, and overrides. STMB does not apply a lorebook-wide STLO speaking filter when the character assignment is the canonical group book.

STMB uses merge-only behavior. Clearing or changing an assignment does not automatically remove the old STLO character override. Remove obsolete overrides in STLO manually.

### 11.7 Filters and books are not privacy controls

Separate books and filters improve relevance. They do not guarantee that:

- one character can never receive another character’s information;
- the model never sees the canonical group version;
- previous-memory context is perfectly knowledge-partitioned;
- a character book represents only conscious knowledge.

Use them as context-routing tools, not as security boundaries.

### 11.8 Linked copies are not live-synchronized

Linked entries share metadata that lets STMB recognize the same original event, but later edits are independent.

Editing, deleting, or compacting one copy does not automatically change the others. Regenerating a character copy also changes only that copy. When regenerating the canonical group entry, however, STMB asks whether to regenerate only that entry or regenerate it together with all linked character entries. Each selected entry receives its own generation and approval review, so character-focused prompts remain character-focused.

### 11.9 Adding, removing, or reassigning group members

Adding a character:

- assign a valid book before the next distributed Memory;
- old Memories are not copied retroactively;
- old filters are not rewritten;
- manually provide historical context if needed.

Removing a character:

- existing entries remain;
- old filters and STLO overrides remain;
- linked copies are not deleted automatically.

Changing a character’s book:

- changes future routing;
- does not necessarily remove that character from the old book’s STLO overrides.

### 11.10 Group consolidation

The canonical group book uses the automatic group-chat consolidation analysis prompt, which aims for an omniscient chronology while distinguishing objective events from individual knowledge.

Character books use the consolidation preset selected in the popup. Books may have different numbers of eligible sources. A book without enough material can be skipped with a warning while ready books continue.

A missing scene in a character book is a chronology gap. It does not prove absence, ignorance, or unconsciousness. A shared character book receives one consolidated entry.

---

## 12. Narrator Mode

### 12.1 Definition

Narrator Mode is for a normal one-on-one SillyTavern chat where one Narrator character card writes multiple fictional characters.

```text
Normal SillyTavern Chat
└── Narrator card
    ├── writes Alice
    ├── writes Bob
    └── writes Clara
```

Without Narrator Mode, SillyTavern sees all AI responses as authored by the Narrator card. Narrator Mode supplies a manual cast model so STMB can associate scenes and Memory Books with fictional characters inside the Narrator’s prose.

Narrator Mode is not available inside a real SillyTavern group chat.

### 12.2 Required storage layout

Narrator Mode requires:

- Manual Lorebook Mode;
- one selected **omniscient/canonical Memory Book**;
- one unique Memory Book for every declared cast member.

Rules:

- a cast member cannot use the omniscient book;
- two cast members cannot share the same book;
- every declared member must have an available book;
- retired members retain their identity and reserved book assignment until restored or otherwise removed by the implementation;
- Auto-Create is incompatible because Narrator Mode depends on Manual Lorebook Mode.

Like the advanced real-group layout, Narrator Mode does not require STLO for active-character retrieval. STMB injects the selected cast members’ books into the active lorebook context during generation.

### 12.3 Setup

1. Open the Narrator card’s normal chat.
2. Enable Manual Lorebook Mode.
3. select the main manual book; this is the omniscient Memory Book.
4. Enable **Narrator Mode**.
5. Open **Manage Narrator Cast**.
6. Add each fictional character by name and assign a unique Memory Book.
7. Use **Edit** beside an existing cast member to correct the character name or change that member's assigned Memory Book.
8. Use the floating **Active Cast** drawer to select characters present in the next exchange.

Narrator Mode must be disabled before Manual Lorebook Mode can be disabled.

### 12.4 Active Cast drawer and timeline metadata

The floating Active Cast drawer can be expanded, collapsed, moved, and used to select current cast members.

At generation time, STMB snapshots the active cast and stores it in message metadata:

- the user message receives the active-cast snapshot;
- the Narrator response receives the generation snapshot;
- completed Narrator responses retain that snapshot until their message is finalized, even when generation ends first;
- a continuation merges its cast with existing cast metadata;
- swipe metadata is stored separately for each swipe;
- selecting a swipe can restore the active cast from that timeline point;
- deleting recent messages can restore cast state from the latest remaining tagged Narrator message.

The cast marker records association, not a semantic analysis of prose.
Stopped or failed partial replies are not automatically tagged. If a scene includes one, the legacy-message cast confirmation remains necessary.

### 12.5 Retrieval during normal Narrator generation

When a Narrator generation starts, STMB loads the Memory Books of the active cast and merges their entries into the character-lore collection used for that request, avoiding duplicate world/UID pairs.

Consequences:

- only active-cast books are added by this Narrator workflow;
- the omniscient book still follows its normal Manual Mode activation/configuration;
- per-character STLO filters are not required for Narrator Mode;
- cast selection must be correct before generation if the correct character books are expected in context.

### 12.6 Scene participant detection

For a selected scene, tagged Narrator responses are authoritative. STMB combines the cast IDs stamped on Narrator-authored messages.

If the scene contains untagged legacy Narrator messages, STMB falls back to continuity information from all messages and asks the user to confirm the scene cast. Current active cast members are preselected. An empty selection means no individual cast members were present.

This confirmation is specifically for legacy or incomplete cast metadata; fully tagged scenes do not need it.

### 12.7 Memory distribution

A Narrator scene Memory is written as:

- one canonical omniscient entry in the main Memory Book;
- one linked copy in each selected participant’s unique Memory Book.

Narrator copies do not use native SillyTavern character filters. Instead, STMB stores Narrator participant and owner IDs in entry metadata.

If separate multi-character prompts are disabled, participant books receive copies of the omniscient summary. If enabled, each single-character book can receive a character-focused generation.

### 12.8 Narrator consolidation and regeneration

Narrator ownership and participant metadata are carried through consolidation sources. This lets higher-tier entries retain which character book owns a copy and which cast members participated in the underlying material.

Regeneration uses this metadata to determine whether the replacement prompt target is omniscient/group-oriented or character-focused.

As with real-group copies, linked Narrator entries are not live-synchronized after creation.

### 12.9 Retiring cast members

The cast manager can mark a member retired and later restore them. Retired members:

- are removed from active-cast choices;
- are removed from the active-cast ID set;
- keep stable identity/history metadata;
- retain their book reservation, preventing accidental reuse that would merge identities.

Use retirement for a character who leaves the active cast but whose historical Memory identity must remain intact.

Editing a cast member's character name or Memory Book preserves the member's stable identity and retired state. A corrected name is used wherever that member is displayed and in future Memory output. A new book assignment controls future retrieval and Memory writes; it does not move entries that were already written to the previous book.

---

## 13. Branching Chats

SillyTavern native branches can become different continuities. If a branch and its parent write into the same unlocked Memory Books, contradictory timelines can mix.

**Copy Memory Books when branching** is enabled by default.

### 13.1 What is copied

When STMB recognizes a newly created native branch:

- Automatic Mode copies the active chat-bound Memory Book;
- Manual Mode copies the main manual Memory Book;
- a Manual Mode real group copies each unique unlocked character Memory Book;
- Narrator Mode copies the omniscient book and each declared character book;
- persistent real-character locks are preserved instead of copied because a lock means “continue using this same book.”

All books copied in one branch operation use the same available lineage number:

```text
Group Memories Branch 1
Alice Memories Branch 1
Bob Memories Branch 1
```

Branching from an existing branch retains the original lineage root rather than producing names like `Branch 1 Branch 1`.

### 13.2 Rewritten metadata

Inside the copies, STMB:

- rewrites matching parent chat IDs to the new branch chat ID;
- redirects canonical group/character links when both linked books were copied;
- updates the new branch’s bindings to point to the copies.

It clones existing contents; it does not regenerate Memories.

### 13.3 Failure safety

Do not switch chats while branch copying is in progress.

If copying fails, STMB clears the new branch’s inherited writable bindings and records the failure so the branch cannot silently write into the parent’s originals.

### 13.4 Disabling branch copies

Disable the setting only when the branch is intentionally meant to share the same Memory Books and continuing history as the parent.

---

## 14. Clips

A Clip saves selected chat text directly into a `[STMB Clip]` lorebook entry. It does not call an AI model.

### 14.1 Use Clips for

- a preference;
- a promise or secret;
- a name or alias;
- an item or pet;
- a short relationship fact;
- a line that should be preserved exactly or nearly exactly;
- a quick “note to self” that does not justify a scene Memory.

### 14.2 Workflow

1. Highlight text inside a chat message.
2. Click the floating scissors button.
3. Choose an existing Clip entry or create a new one.
4. Choose always-active or keyword-triggered behavior for a new entry.
5. Review the current entry and updated preview.
6. Rename if needed.
7. Save.

The floating scissors button appears only after chat text is selected and can be disabled in the main panel.

### 14.3 Entry format

Title:

```text
Seraphina Healed Me [STMB Clip]
```

Content:

```markdown
=== Seraphina Healed Me ===

- Seraphina healed the user’s wounds with magic.

=== END Seraphina Healed Me ===
```

One Clip entry has one section. Focused titles support focused activation keywords.

### 14.4 Existing entries

An existing entry can be treated as a Clip entry by adding `[STMB Clip]` to the end of its title. Long Clip entries can be edited manually or compacted.

Clips save only the chosen text. They do not add source attribution automatically.

---

## 15. Topical Clips

A Topical Clip reads confirmed STMB Memory entries, an explicit range of messages from the current chat, or both, and asks an AI to produce a focused “about this topic” entry. Eligible Memory sources can include scene Memories and consolidated summaries; Clip and Side Prompt entries are excluded as sources.

### 15.1 Use Topical Clip when

Information about one subject is spread across several Memories, for example:

- a recurring NPC;
- a relationship history;
- a location or faction;
- an investigation or mystery;
- powers, injuries, promises, preferences, or secrets;
- an important object;
- an unresolved plot thread.

Topical Clip is organized by subject, not by the chronology of every source Memory.

### 15.2 Source restrictions

Topical Clip uses:

- confirmed STMB Memory entries from the selected source book, including eligible consolidated summaries.
- messages from an explicitly selected inclusive `X-Y` range in the current chat. Hidden messages are included only when **Also use hidden messages** is checked.

The **Include saved Memories** and **Include chat messages** controls can be used separately or together. **Also use hidden messages**, directly below **Include chat messages**, controls whether message ranges and Extract selections include hidden messages. It defaults to unchecked and is saved globally, with the same setting available in General Settings directly below **Unhide hidden messages for memory generation**. Topical Clip reads hidden messages without changing their visibility and independently of the unhide-before-memory setting.

When the Topical Clip window opens, **Start message ID** defaults to the selected scene-start, otherwise the highest processed Memory message ID (the value returned by `/stmb-highest`), otherwise `0`. **End message ID** defaults to the selected scene-end, otherwise the current last message ID; it stays blank in an empty chat. Message IDs are zero-based, and the highest processed ID is used directly without adding one. These defaults are set once when the window opens. You can edit them, and changing modes, targets, or Memory Books preserves your edits. Invalid or reversed ranges must be corrected before generating.

It does not use:

- chat messages outside the selected range;
- ordinary Clip entries;
- Side Prompt entries;
- unrelated ordinary lorebook entries.

### 15.3 Create a Topical Clip

1. Open Memory Books.
2. Click **Topical Clip**.
3. Choose the source Memory Book.
4. Enter the topic.
5. Enter activation keywords, or leave them blank to use the topic.
6. Choose a new entry or an existing `[STMB Clip]` update target.
7. Choose saved Memories, chat messages, or both as sources.
8. Optionally select only specific source Memories. For chat messages, enter an exact range or click **Extract…** to search the full current chat and select individual messages, including noncontiguous messages. Check **Also use hidden messages** to include selected hidden messages.
9. Choose the generation profile.
10. Generate the draft.
11. Review and edit it.
12. Save only when correct.

The generated draft is never saved automatically.

**Edit Topical Format** controls the saved entry's outer text. Its default uses the existing `=== title ===` and `=== END title ===` borders. The format must contain `{{CONTENT}}` exactly once; `{{TITLE}}` is optional. For example, `## {{TITLE}}` followed by `{{CONTENT}}` saves a Markdown heading, while `{{CONTENT}}` alone saves the body without borders. The preview shows the result. Reset restores the built-in format. A new preference affects subsequent saves, not existing entries. Ordinary Clip appends preserve the format recorded on an entry; Topical Clip updates use the current preference for that clip type.

The insertion override lets you select a position and order for this save. Selecting **Outlet** requires an **Outlet Name**. An update target or ordinary Clip target that is disabled is hidden by default; **Show disabled clips** reveals it. Saving an update to a disabled Topical Clip enables it.

### Combine existing Topical Clips

In the **Topical Clip** window, click **Combine Clips**. Select a Memory Book, choose at least two Topical Clips (use **Show disabled clips** to include disabled clips), and enter the new clip's title. Only Topical Clips created by STMB appear; ordinary Clips are excluded. The new clip's activation keywords are the union of the selected clips' primary keywords, without duplicates. Secondary keyword conditions are not copied.

Choose a generation profile and click **Generate Draft**. The AI receives each selected clip's title and full content and is asked to consolidate supported facts, remove repetition, and retain unresolved conflicts. Review and edit the draft before saving. Changing the selected sources, title, or Memory Book clears the draft. If a source changes before saving, generate a fresh draft.

**Edit Combine Clips Prompt** changes the AI consolidation instructions. Its template requires `{{SOURCE_CLIPS}}` exactly once and can use `{{TITLE}}`. **Edit Combined Format** independently controls how the saved result is wrapped, using the same `{{CONTENT}}` and optional `{{TITLE}}` placeholders as Topical Format. Both editors offer Reset to Default. The insertion override includes position, Outlet Name when Outlet is chosen, and order.

**Disable original clips after saving** is checked by default. Uncheck it to preserve their current activation states. Saving creates the new enabled Topical Clip and, when checked, disables the originals in the same Memory Book update. The originals are never deleted. The combined clip records its source IDs separately from normal Topical Clip Memory-source history.

When text is highlighted in the chat, the floating control offers **Clip** and **Extract**. Extract opens the same message picker with the highlighted text as its search query. It searches the full history of the current chat, including messages that are not rendered onscreen. An empty search lists all messages. Search matches literal text or speaker names, ignoring case; **Hidden only** restricts matches to hidden messages.

Results appear in batches of 50. Use **Load more** to display more matches, expand a result to read its complete text with highlighted matches, or use **Previous message** and **Next message** to reveal surrounding context. Context messages are not selected automatically and can appear even when they do not match the search or Hidden only filter. Hidden messages are labeled; selected hidden messages are included in the Topical Clip source only when **Also use hidden messages** is checked, without unhiding them in the chat.

Selections are retained across searches and filter changes. The selection count includes messages outside the displayed results. **Select loaded results** selects every displayed result, including any revealed context messages; **Clear selection** removes all selections. Choose **Topical Clip** from standalone Extract or **Use selected messages** when returning to an existing editor. The query supplies the initial topic and keywords, which remain editable.

STMB records source fingerprints when messages enter the picker and checks selected messages before accepting them, generating a draft, and saving it. If a selected source changes, **Refresh results** clears the selection and reloads the results so you can select sources again. Finish or cancel any unfinished message edit before searching. Switching chats closes the picker. Extract does not search other chats.

### 15.4 Updating an existing Topical Clip

After a successful run, STMB records which source Memories were used and, when applicable, the source chat, message range, message IDs, and hashes. A later Memory-based update normally sends only new or changed source Memories together with the existing Clip content. Review the pre-populated message range or enter a different range for each run.

Use **Rebuild from all source memories** when:

- the current entry is incomplete or disorganized;
- the prompt changed;
- older Memories were substantially edited;
- the whole topic should be reconsidered.

### 15.5 Manual source selection and token warnings

Use **Use only selected memories** when the book is large, the topic is limited to one story period, names overlap, or strict evidence control is needed.

STMB estimates request size and warns when the configured token threshold is exceeded. Reduce sources, raise the threshold deliberately, or run once anyway.

### 15.6 Review standard

Check that the draft:

- stays on topic;
- preserves names and relationships;
- includes major relevant facts;
- identifies contradictions rather than silently choosing one version;
- does not invent explanations unsupported by source Memories;
- merges updates without unnecessary duplication.

### 15.7 Prompt placeholders

A custom Topical Clip prompt must include `{{SOURCE_MEMORIES}}` when saved Memories are selected and `{{SOURCE_MESSAGES}}` when chat messages are selected.

Source placeholders:

```text
{{SOURCE_MEMORIES}}
{{SOURCE_MESSAGES}}
```

Supported placeholders include:

```text
{{MODE}}
{{TOPIC}}
{{KEYWORDS}}
{{EXISTING_CLIP}}
{{EXISTING_ENTRY_CONTENT}}
{{SOURCE_MEMORIES}}
{{SOURCE_MESSAGES}}
```

Reset to Default if a custom prompt stops producing useful output.

---

## 16. Side Prompts

A Side Prompt is a named STMB prompt that runs separately from the normal character reply. It usually creates or updates one continuing support entry rather than another sequential scene Memory.

In the **Trackers & Side Prompts** list, the power icon immediately changes the prompt-wide **Enabled** flag: green means enabled and dim means disabled. This control does not add, remove, or otherwise change the prompt's configured triggers.

### 16.1 Appropriate uses

- plot and unresolved-thread trackers;
- relationship state;
- NPC or faction status;
- inventory and resources;
- injuries, statistics, or reputation;
- timelines, dates, deadlines, and travel;
- mystery clues, suspects, and contradictions;
- inventions, research, and projects;
- continuity-risk reports;
- world-state summaries.

Avoid vague “track everything” prompts, duplicate scene summaries, or tasks that must appear inside the next roleplay response.

### 16.2 Output format

Side Prompts normally expect final plain text or Markdown ready to save. They do not require Memory JSON. JSON is allowed only when the user intentionally wants JSON stored as tracker text.

### 16.3 Run sequence

A typical run assembles:

1. Side Prompt instructions;
2. prior saved tracker entry, if any;
3. optional previous Memories;
4. optional Additional Context;
5. selected or since-last scene text;
6. optional Response Format instructions.

The prior entry is existing state to revise, not proof that every old statement should remain. Prompts should explicitly remove stale, resolved, contradicted, or duplicate information.

### 16.4 Manual runs

```text
/sideprompt "Prompt Name"
/sideprompt "Prompt Name" 10-20
/sideprompt "Relationship Tracker" {{npc name}}="Alice" 10-20
```

Names with spaces should be quoted. A supplied range is inclusive.

Manual runs are best for targeted analysis and prompts requiring runtime macro values.

### 16.5 Automatic after-Memory runs

A Side Prompt can enable **Run automatically after memory**.

The chat then uses one of two automatic selection modes:

- individually enabled Side Prompts; or
- one selected Side Prompt Set.

A selected set replaces individually enabled automatic prompts for that chat. It does not add to them.

#### Memory Assistance Side Prompt

**Memory Assistance** is a reserved Side Prompt with five independent modes. It runs after successfully saved Memories regardless of ordinary Side Prompt enablement or the selected Side Prompt Set. It does not run during Memory regeneration.

Memory Assistance compares the raw processed scene with enabled ordinary and Topical Clips in each Memory Book that received the Memory. It sends each reviewed Clip's title/topic, keywords, current content, stable ID, and type to the AI. Disabled Clips are excluded from queries and hidden from pending suggestions without deleting saved reports.

When the job queue is available, each target Memory Book receives a separate **Memory Assistance** job after the Memory is saved. A request, response-validation, report-save, or automatic-application error marks that job **Failed** and exposes the error in the queue. The saved Memory remains **Completed**, and retrying Memory Assistance does not regenerate the Memory.

- **Off** disables Memory Assistance.
- **Update** reviews five or fewer Clips directly; more than five Clips open a selection list. Proposed changes wait for manual approval.
- **Suggest** discovers new Topical Clip topics without reviewing or updating existing Clips.
- **Update and Suggest** first performs one topic-discovery request, then runs the same existing-Clip review workflow as Update.
- **Automatic** reviews every Clip in token-based batches without asking which Clips to review. It directly applies valid ordinary Clip additions, while Topical Clip replacements remain pending for approval in **Memory Assistance Suggestions**.

- In Update and Update and Suggest modes, the larger selection list provides **Query Selected** and **Query All**.
- Query All and Automatic mode use token-based batches rather than forcing every Clip into one oversized request.
- Each ordinary Clip receives at most one exact message excerpt proposed as an addition.
- Topical Clips receive complete replacement drafts.
- The AI response is a simple JSON object mapping each affected Clip UID directly to its suggested excerpt or replacement. An empty object means that no Clips need updating.
- Update results are written to `Memory Assistance (STMB SidePrompt)` and remain unapplied until approved through **Memory Assistance Suggestions**.
- Automatic-mode results record how many ordinary Clip additions were applied and retain Topical Clip replacements and any application failures for manual review.
- Canceling the selection clears older suggestions so they cannot be mistaken for results from the latest scene.

Update and Suggest uses a separate suggestion-only prompt before the existing-Clip review batches. The request contains the processed scene and a lightweight list of existing Topical Clip titles, topics, and keywords. It does not send ordinary Clips or existing Clip bodies during discovery. The AI returns zero to five new topics as JSON objects containing a topic and activation keywords; `{"topics":[]}` is a valid result.

Suggested topics are saved in the Memory Assistance report. In **Memory Assistance Suggestions**, choose **Review Topics** to see them as checked, editable rows. You can uncheck unwanted topics, edit topic names or keywords, or add additional topics. Confirmed topics open the standard Topical Clip draft workflow one at a time. A pending topic is removed only after its Topical Clip is saved; closing the draft leaves it available through **Memory Assistance Suggestions**.

When reviewable suggestions are ready, STMB opens a completion popup for the updated Memory Book. **Dismiss** closes the notice, while **Go to Suggestions** opens **Memory Assistance Suggestions** with that Memory Book already selected. Opening **Memory Assistance Suggestions** from the extension menu selects the current chat's effective Memory Book first (the chat-bound book in Automatic Mode or the resolved manual book in Manual Mode).

The Update and Topic Suggestions prompts and connection-profile override are independently editable, but both structured response contracts are fixed. Memory Assistance cannot be deleted, duplicated, or placed in a Side Prompt Set.

Memory Assistance honors **Use regex (advanced)** and the configured outgoing and incoming scripts. Outgoing scripts run on the complete prompt for all Clip update batches (ordinary, topical, or mixed) and topic suggestions. They also run on Topical Clip generation prompts that include chat messages, whether selected individually or by range. A failing outgoing script stops the request before it is sent. Incoming scripts run on all responses before JSON parsing and validation. Ordinary Clip additions must still match an excerpt from an original scene message, so outgoing or incoming transformations that rewrite those excerpts can cause suggestions to be rejected. Regex scripts must preserve the required JSON response structure.

Run `/memory-assist` to run Memory Assistance independently, without creating a Memory or running other Side Prompts. It follows the selected Memory Assistance mode; when the setting is **Off**, this manual run uses **Update** without changing the saved setting. It targets the current chat's effective Memory Book (chat-bound in Automatic Mode, resolved manual book in Manual Mode). With no arguments, it reviews the current scene between its start and end markers. If there is no complete current scene, it reports an error asking for a message range. Use `/memory-assist X-Y` to review an inclusive message-ID range, for example `/memory-assist 10-30`. It uses the existing Memory Assistance connection override and suggestion approval behavior. When the job queue is enabled, it creates a standalone Memory Assistance job that can be retried independently.

### 16.6 Automatic visible-message intervals

A Side Prompt can enable **Run on visible message interval** and specify a number of visible messages since its checkpoint.

Hidden and system messages do not count.

When a set is active, only rows in that set whose referenced prompt has the appropriate interval trigger are candidates.

### 16.7 Side Prompt Sets

A Side Prompt Set is an ordered run list, not merely a folder. The same template may appear more than once with different macro values.

Example:

1. Relationship Tracker — Alice
2. Relationship Tracker — Bob
3. Plot Tracker
4. Cleanup Report

Rows can store:

- a prompt reference;
- an optional label;
- runtime macro values;
- order;
- duplicate or delete actions.

Rows run top to bottom.

Manual set commands:

```text
/sideprompt-set "Set Name"
/sideprompt-set "Set Name" 10-20
/sideprompt-macroset "Relationship Pass" {{npc_1}}="Alice" {{npc_2}}="Bob" 10-20
```

### 16.8 Default sets and per-chat selection

General Settings can define:

- a default set for solo chats;
- a default set for group chats.

Each chat may:

1. inherit the applicable default;
2. explicitly use individually enabled prompts;
3. choose a named set.

An empty global default means individual mode.

If a selected set is deleted, STMB warns rather than silently substituting another workflow. A missing row prompt or unresolved macro causes that row to be skipped with a warning.

The set selects candidate rows. Each referenced Side Prompt still needs the relevant automatic trigger for after-Memory or interval execution. Manual set commands do not require those trigger checkboxes.

### 16.9 Macros

Side Prompts can use normal SillyTavern macros such as:

```text
{{user}}
{{char}}
```

Non-standard `{{...}}` placeholders are runtime macros. They must be supplied manually or stored in a set row.

Examples:

```text
{{npc name}}
{{faction}}
{{project_name}}
```

A prompt with unresolved runtime macros cannot run automatically. Automatic runs cannot pause to ask for values.

### 16.10 Memory-count macros

STMB registers integer macros for the effective main Memory Book:

| Macro | Count |
|---|---|
| `{{memtier0}}` | scene Memories |
| `{{memtier1}}` | Arcs |
| `{{memtier2}}` | Chapters |
| `{{memtier3}}` | Books |
| `{{memtier4}}` | Legends |
| `{{memtier5}}` | Series |
| `{{memtier6}}` | Epics |
| `{{memclips}}` | Clip entries |
| `{{memside}}` | Side Prompt entries |

The effective main book is the chat-bound book in Automatic Mode or the resolved main manual book in Manual Mode. In a multi-book group or Narrator setup, the counts do not add all character books together.

A count macro provides only a number, not the contents of those entries.

### 16.11 Message ranges

An explicit range uses exactly that inclusive range. Without a range, STMB uses the Side Prompt’s since-last checkpoint/cap behavior.

Use explicit ranges for debugging, targeted cleanup, or rerunning a known section.

### 16.12 Additional Context and previous Memories

A Side Prompt may include up to seven previous scene Memories.

Its Additional Context source can be:

- none;
- **Follow chat**, using the chat’s selected Context Setting;
- one fixed named Context Setting.

These are reference materials. The prompt should not blindly copy them into the tracker.

### 16.13 Lorebook targets

A Side Prompt normally saves to the effective Memory Book. It can instead use:

1. a per-chat target override;
2. a template-level target;
3. the effective Memory Book as fallback.

A valid per-chat override wins.

Use alternate targets for a deliberate shared campaign book or dedicated tracker book. Do not scatter trackers without a retrieval plan.

### 16.14 Side Prompt entry controls

A template can configure:

- title override;
- keywords;
- Normal, Constant, or Vectorized activation;
- insertion position and Outlet name;
- order mode/value;
- Prevent Recursion;
- Delay Until Recursion;
- Ignore Budget.

Title and keyword fields can expand applicable macros. **Ignore Budget** should be used sparingly because multiple always-included trackers can consume large amounts of context.

### 16.15 Connection profile override

A Side Prompt can inherit normal Memory Books connection resolution or bind a specific STMB profile. An override is useful for a cheaper model or one better at structured maintenance. Excessive profile combinations make troubleshooting harder.

### 16.16 Side Prompt regeneration

Compatible saves now store a version-2 snapshot containing:

- Side Prompt template key;
- prior entry content for regeneration;
- whether the entry existed before the run and its exact prior entry state, excluding an older rollback snapshot;
- source chat and inclusive range;
- runtime macro values;
- a fingerprint of the exact entry state written by STMB.

To regenerate, open the lorebook editor and click **Regenerate side prompt**. The replacement uses the saved snapshot with the current template and current profile/context settings.

Regeneration cannot complete when the template was deleted, the source chat/range is unavailable, or the target/source changed during generation. Only the content is replaced; existing title, keywords, and entry settings remain. Legacy version-1 snapshots continue to support regeneration, although they cannot be used by Memory Auto-Rollback.

### 16.17 Writing good Side Prompts

A good Side Prompt defines:

- the exact maintenance job;
- what source material to review;
- whether to revise, replace, merge, or append;
- stale information to remove;
- stable output headings and ordering;
- a strict length limit;
- final-output-only behavior.

Example:

```text
Update the relationship tracker from the supplied scene. Preserve current facts, merge new developments into the existing sections, and remove resolved, contradicted, stale, or duplicate details. Keep each relationship to 1–3 concise bullets. Output only the updated tracker.
```

Useful guards:

```text
Do not append a new section unless there is genuinely new information.
Remove resolved threads and obsolete speculation.
Output only the updated report; no preface or explanation.
Keep the entire output under 300 words.
```

Stable headings reduce drift across repeated updates.

### 16.18 Side Prompt troubleshooting

If a prompt did not run:

- confirm the Memory or interval event actually occurred;
- inspect the chat’s individual/set selection;
- verify the referenced prompt still exists;
- verify the relevant automatic trigger is enabled;
- verify all runtime macros have values;
- check whether `/stmb-stop` or a failed job canceled it.

If it ran twice:

- check manual plus automatic invocation;
- duplicate set rows;
- duplicate prompt copies;
- multiple tabs or chats triggering work.

If the wrong book received it, inspect both per-chat and template-level target scopes.

If output grows indefinitely, add explicit replacement, pruning, item-count, and word-count rules.

---

## 17. Consolidation

Consolidation combines lower-tier STMB Memories or summaries into higher-tier chronological recaps.

### 17.1 Tiers

```text
Scene Memory → Arc → Chapter → Book → Legend → Series → Epic
```

Consolidation works from existing STMB entries, not directly from raw chat.

### 17.2 Purpose

Use it when:

- scene Memories are accumulating;
- older material no longer needs full scene detail;
- a major relationship, plot, or campaign phase has completed;
- token use should be reduced while preserving continuity;
- a cleaner higher-level chronology is needed.

Consolidated entries should emphasize lasting changes, turning points, goals, consequences, relationship shifts, unresolved threads, and stable state.

### 17.3 Manual workflow

1. Open **Consolidate Memories**.
2. Confirm the displayed source Memory Book. Select a different book when the configured manual or chat-bound book is not the intended consolidation source. This selection applies only to the current run and does not change the chat's configured Memory Book.
3. Choose the target tier.
4. Select eligible source entries.
5. Choose the consolidation prompt/profile settings.
6. Decide whether source entries should be disabled after successful consolidation.
7. Run and review the candidates.
8. Approve the desired summaries.

### 17.4 Readiness prompts are not automatic consolidation

**Prompt for consolidation when a tier is ready** watches selected target tiers. When the saved minimum eligible count is reached, STMB presents a yes/later prompt. Choosing Yes opens the consolidation interface. It does not silently consolidate.

### 17.5 Consolidation output schema

Ordinary consolidation expects strict JSON:

```json
{
  "summaries": [
    {
      "title": "Short higher-tier title",
      "summary": "Consolidated chronological recap",
      "keywords": ["keyword1", "keyword2"],
      "member_ids": ["001", "002"]
    }
  ],
  "unassigned_items": [
    {
      "id": "003",
      "reason": "Why this source did not fit"
    }
  ]
}
```

The model may return one or several summaries. `member_ids` assigns each source to a returned summary. Outliers belong in `unassigned_items` rather than being forced into an unrelated recap.

### 17.6 Previous higher-tier summary

A previous summary in the target tier can be supplied as canon context. It is not source material to rewrite. Consolidation prompts must distinguish it from the lower-tier entries being processed.

### 17.7 Previews and failed responses

Consolidation previews can allow editing, accepting, regenerating one candidate from the same sources, or regenerating a pending batch.

Malformed or failed AI responses can be inspected and, where supported, corrected manually before commit.

### 17.8 Source disabling

When enabled, STMB disables source entries after successful consolidation so the higher-tier summary can take over retrieval. This is reversible through lorebook editing.

### 17.9 Good consolidation prompts

They should define:

- the compression target;
- whether to create one recap or the smallest coherent number;
- chronology and grouping logic;
- details that must survive;
- explicit handling of outliers;
- exact JSON structure.

They should preserve major beats, consequences, promises, relationship changes, identifiers, unresolved threads, and retrieval-friendly keywords while removing repeated scene-level detail.

---

## 18. Compaction

Compaction asks an AI to shorten one existing STMB-managed entry and presents the original and draft before replacement.

### 18.1 Eligible entries

- `[STMB Clip]` entries;
- Side Prompt entries;
- STMB Memory entries.

Ordinary non-STMB lorebook entries are not listed.

### 18.2 Workflow

1. Open **Compaction**.
2. Choose a Memory Book.
3. Choose a Compaction Profile.
4. Optionally edit the Compaction Prompt.
5. choose one entry.
6. Compare original and compacted token estimates/content.
7. Edit the draft if needed.
8. Replace, copy the draft, or cancel.

The original is not changed until **Replace with Compacted Version** is selected.

### 18.3 Good uses

- long Clip collections;
- repeated or stale tracker content;
- wordy scene Memories;
- always-active entries consuming too much context.

Compaction is not for adding facts, summarizing raw chat, creating a new Memory, or processing ordinary lorebook entries.

### 18.4 Prompt placeholders

```text
{{ENTRY_CONTENT}}  required current content
{{ENTRY_KIND}}     Clip, SidePrompt, or Memory
{{ENTRY_TITLE}}    entry title
```

The prompt should preserve facts, names, pronouns, macros, wrapper headings, and end markers while removing redundancy and low-value wording.

---

## 19. Regeneration

Regeneration creates a reviewable replacement for an existing entry. It does not create a second numbered entry and never overwrites without approval.

### 19.1 Scene Memory regeneration

- open the source chat;
- open the Memory Book in the lorebook editor;
- click **Regenerate memory**;
- for a canonical group entry with linked character entries, choose whether to regenerate only the clicked entry or all linked entries;
- choose the current profile, prompt, previous-memory count, and Additional Context;
- review title, content, and keywords for every selected entry.

The original scene range and sequence number are retained. Linked entries reuse the same selected regeneration settings but are generated against their own Memory Book context and group/character prompt target. STMB collects all approvals before it starts saving direct regenerations. If all source messages are hidden, reveal them or enable unhide-before-generation.

### 19.2 Consolidation regeneration

A higher-tier summary is regenerated from its exact linked lower-tier sources using the dedicated **Regenerate Consolidation** preset.

The full source set must still exist at the correct tier. A lower-tier source cannot be regenerated while an active parent summary depends on it; delete the parent first when intentionally rebuilding the lower tier.

### 19.3 Side Prompt regeneration

See the Side Prompt snapshot rules in Section 16.16.

### 19.4 Safety checks

Immediately before replacement, STMB verifies that:

- the target entry is unchanged;
- the source chat range is unchanged;
- required consolidation sources are unchanged and available;
- the entry remains eligible.

If any check fails, nothing is overwritten.

Linked group, character, and Narrator copies remain independent.

---

## 20. Context for Generation

Several context sources can appear in an STMB request. They are not interchangeable.

### 20.1 Current scene

The message range being processed now. It is the target material for an ordinary scene Memory.

### 20.2 Previous Memories

Earlier scene Memories from the effective Memory Book, included as read-only continuity context. The user can normally include 0–7.

They should not be summarized again merely because they appear before the current scene.

### 20.3 Additional Context

Selected lorebook entries supplied as stable reference material, such as:

- character or setting rules;
- canonical names and terminology;
- campaign constraints;
- an authoritative timeline;
- location references;
- facts assumed but not repeated in the scene.

Additional Context appears before previous Memories and the scene transcript. It is reference material, not another scene.

### 20.4 Context Settings

A Context Setting is a reusable ordered collection of Additional Context entries.

Workflow:

1. open **Context Settings**;
2. create a named setting;
3. select lorebook entries;
4. order them;
5. choose the setting for the current chat or explicitly choose No Context.

The selection is stored per chat and works with Current SillyTavern Settings as well as saved profiles.

If a referenced book or entry disappears, STMB warns, skips the stale reference, and continues. If the entire Context Setting is deleted, chats referring to it continue without Additional Context until another selection is made.

Context Settings can be duplicated, imported, and exported as `stmb-context-settings.json`.

### 20.5 Prior Side Prompt entry

The current tracker text to revise. It is state, not evidence that all old statements remain valid.

### 20.6 Consolidation sources

Lower-tier entries that are the actual material being grouped and compressed.

### 20.7 Previous higher-tier summary

Canon carried forward during consolidation. It is not a source to rewrite.

### 20.8 Correct ordering by workflow

Ordinary Memory:

```text
Memory prompt
Additional Context
Previous Memories
Current scene transcript
```

Side Prompt:

```text
Side Prompt instructions
Prior entry
Previous Memories
Additional Context
Scene text
Response Format
```

Consolidation:

```text
Consolidation prompt
Previous higher-tier summary
Selected lower-tier source entries
```

Prompts should label target material and reference-only material clearly.

---

## 21. Prompt Architecture, Built-in Summary Prompts, and Authoring Rules

STMB has three main structured generation systems plus several focused auxiliary workflows.

### 21.1 Ordinary Memory generation

STMB expects one JSON object:

```json
{
  "title": "Short scene title",
  "content": "The memory text",
  "keywords": ["keyword1", "keyword2"]
}
```

Rules:

- return only the JSON object;
- use the exact keys `title`, `content`, and `keywords`;
- `keywords` must be a JSON array of strings;
- keep the title short and readable;
- use concrete retrieval terms;
- place any desired Markdown inside the `content` string;
- escape quotation marks correctly.

STMB can repair some fences, trailing commas, think tags, wrappers, or minor malformed output, but prompts should never depend on recovery.

A strong Memory prompt states:

1. the desired memory style and level of compression;
2. continuity-relevant information to preserve;
3. filler, OOC, or unsupported material to omit;
4. the exact JSON schema.

Weak prompts specify style but not structure, ask for analysis instead of a final object, blur previous context with the current scene, or use abstract keywords.

### 21.2 Built-in Summary Prompts and choosing one

These presets are for ordinary Memory generation only. They do not control Consolidation, Side Prompts, Topical Clips, or Compaction. A profile selects one under **Memory Creation Method**. **Summary** is the ordinary fallback/default when a profile does not specify another preset. Built-in means supplied by STMB; it does not mean every preset runs or that all of them are equally suitable for one chat.

There is no universal best prompt, because detail, readability, retrieval quality, and token cost pull in different directions. The practical short answer is:

- **Best starting default for most users: Summary.** It is balanced, general-purpose, and a good first test with a new model.
- **Best for continuity-heavy long-running roleplay: Comprehensive.** It applies the strongest filtering, causality, continuity, and keyword guidance, but asks more of the model and can produce a larger structured Memory.
- **Best when saving context tokens matters most: Minimal.** It is intentionally brief and will lose nuance.
- **Best for separate real-group or Narrator character books: Group and Character.** Use them together through the profile's separate group/character prompt setting; they are targeting prompts, not competing general-purpose styles.

| Built-in prompt | Best used for | Main trade-off |
|---|---|---|
| **Summary** | Most solo chats and first-time setup. Produces detailed chronological narrative prose with important events, interactions, developments, revelations, outcomes, and concrete retrieval keywords. | Preserves more detail than a token-minimal user may need, but is simpler and less demanding than the most structured presets. |
| **Comprehensive** | Long-running, continuity-sensitive stories where causal chains, character dynamics, established facts, key exchanges, unresolved threads, and disciplined keywords all matter. It explicitly filters incidental detail and improves keyword construction. | Has the longest and most demanding instructions. Use a capable instruction-following model and allow enough response tokens. |
| **Summarize** | Users who prefer a highly scannable Markdown record divided into Timeline, Story Beats, Key Interactions, Notable Details, and Outcome. | Bullet-heavy output can read more like reference notes than a natural memory and may repeat facts across headings. |
| **Synopsis** | Scenes where preserving nearly every significant beat, interaction, detail, and outcome matters more than compactness. | Intentionally long and comprehensive; it is one of the least suitable choices when lorebook or context budget is tight. |
| **Sum Up** | A chronological narrative beat record with a visible scene heading and timeline, but less sectional overhead than Summarize or Synopsis. | Provides less explicit separation between events, character dynamics, facts, and continuity state. |
| **Minimal** | High-volume chats, inexpensive archival coverage, or setups where Memories must consume very little context. Produces a brief two-to-five-sentence Memory. | Important motives, emotional shifts, causality, and minor continuity details can be lost. |
| **Northgate** | Creative-writing users who want a coherent third-person, past-tense literary record emphasizing actions, emotional shifts, development, and significant dialogue. This community style is credited to Northgate on the SillyTavern Discord. | Optimizes for readable narrative rather than maximum compression or clearly separated reference categories. Unlike most general presets, its built-in text does not explicitly exclude OOC material, so review it when OOC is common. |
| **Aelemar** | Major plot scenes and emotionally consequential character moments that should remain understandable as a standalone record even if the source scene is unavailable. This community style is credited to Aelemar on the SillyTavern Discord. | Requires at least 300 words and is deliberately detailed, so it is unsuitable for aggressive token saving. Its built-in text also does not explicitly exclude OOC material. |
| **Group** | The shared or omniscient Memory Book in a real group, or the omniscient target in a multi-book workflow. It preserves group decisions and state while keeping actions, emotions, and knowledge attributed to the correct member. | Do not use it as an individual character's Memory; it intentionally focuses on shared group continuity. |
| **Character** | One character-focused Memory Book in a real-group or multi-character workflow. It records what that character did, knew, felt, learned, concealed, misunderstood, or was affected by. | It intentionally omits scene material that is irrelevant to the target character and restricts unsupported private knowledge. |

For a new installation, use **Summary** until generation and retrieval are working reliably. Then change only the prompt and compare several Memories from similar scenes. Prefer **Comprehensive** when omitted causality, continuity state, or weak keywords are the problem; prefer **Minimal** when Memory size is the problem. Changing prompts cannot compensate for a weak model, truncated output, poor scene boundaries, or incorrect retrieval settings.

The exact built-in text may be recreated for the current SillyTavern locale. Recreating built-ins removes local edits to those built-ins but should not delete unrelated custom presets. Duplicate or export a modified built-in before recreating it.

### 21.3 Multi-character prompt targeting

When separate group/character prompts are enabled, STMB marks the request target as:

- `group` for a canonical real-group or omniscient Narrator Memory;
- `character` for one individual character-book version.

The prompt should explicitly use the target perspective without inventing knowledge not supported by the scene and supplied context.

### 21.4 Side Prompt authoring

Side Prompts normally return plain text or Markdown. Write them like maintenance instructions, not Memory prompts.

A strong Side Prompt:

- defines one narrow job;
- explains how to use the previous tracker;
- removes stale state;
- imposes stable headings and length limits;
- returns only the final tracker.

### 21.5 Consolidation authoring

Ordinary consolidation requires the schema in Section 17.5. A strong prompt:

- preserves chronology;
- creates the smallest coherent number of summaries;
- assigns every used source through `member_ids`;
- identifies leftovers through `unassigned_items`;
- preserves major changes and unresolved continuity;
- uses concrete keywords.

The dedicated **Regenerate Consolidation** preset is for one replacement summary and is not selectable as the normal consolidation default.

### 21.6 Topical Clip authoring

The prompt must include `{{SOURCE_MEMORIES}}`, remain focused on the requested topic, distinguish source evidence from inference, merge new material into existing Clip content, and surface contradictions.

### 21.7 Compaction authoring

The prompt must include `{{ENTRY_CONTENT}}` and should shorten without adding unsupported facts. It should preserve structural wrappers and macros needed by the entry.

### 21.8 Prompt-writing checklist

Before finalizing any STMB prompt, answer:

1. What material is the actual analysis target?
2. What material is reference-only?
3. Does this path expect strict JSON or final plain text?
4. What information must survive for later retrieval?
5. What should be omitted, merged, carried forward, or left unassigned?

Return-format correctness comes before style.

---

## 22. Summary Prompt Manager and Consolidation Prompt Manager

In manager tables and browsing lists, click a sortable heading or its sort button once for ascending order, again for descending order, and a third time to restore the list's usual order. The selected sort remains while the view is open, including after list refreshes. Sorting only changes what you see; it does not change the order used to save or process entries. Action columns, dropdowns, chat messages, and explicitly ordered editing lists have no sort control.

### Summary Prompt Manager

Can create, edit, duplicate, delete, import, and export ordinary Memory prompt presets. Assign a preset through a Memory Books profile.

All ordinary Memory presets must preserve the required Memory JSON schema.

See Section 21.2 for the built-in Summary Prompt selection guide and best-use cases.

### Consolidation Prompt Manager

Controls prompts used to group lower-tier entries into higher-tier summaries and selects the normal default consolidation prompt.

The regeneration-only consolidation preset cannot be used for ordinary consolidation.

### Import and localization behavior

Built-in prompts can be recreated in the current app locale. Back up locally modified built-ins before recreating them.

---

## 23. STMB and Other Extensions

SillyTavern extensions run alongside one another and may read or modify the same SillyTavern data. STMB does not override, disable, or establish priority over another extension. When extension behavior overlaps, the final result depends on the settings and timing of every extension involved.

### 23.1 Shared message visibility

Whether a chat message is hidden is part of SillyTavern's shared message state. It is not state owned exclusively by STMB.

STMB's **Token Saving** settings can hide processed messages after a Memory is saved. Another extension can subsequently reveal those messages, and STMB will not prevent it. Similarly, **Unhide hidden messages for memory generation** may reveal messages while STMB processes or regenerates a selected range.

### 23.2 Presence

The Presence extension and STMB can both change the hidden or visible state of chat messages. If Presence reveals messages that STMB hid, STMB's Token Saving setting has not been erased or ignored; a later action by Presence has changed the same SillyTavern message state.

If you use Presence and want messages hidden by STMB to remain hidden, use Presence's own hidden-message locking feature. Presence currently provides the `/presenceLockHiddenMessages` command for this purpose. Run it for the applicable message range and repeat it as that range grows. Consult Presence's documentation for current command behavior.

STMB does not automatically configure or invoke Presence, and its group-chat participant handling is unrelated to Token Saving.

### 23.3 Regex integration

STMB integrates with SillyTavern’s Regex extension at two stages:

1. **Outgoing/User Input:** transform the assembled prompt before it is sent.
2. **Incoming/AI Output:** clean or standardize the raw response before parsing/saving.

Enable **Use regex (advanced)**, then open **Configure regex** and select one or more scripts for each direction.

Important: STMB’s own selection controls execution. A script selected by STMB can run even when that script is disabled in the Regex extension’s normal interface.

If a selected outgoing script throws an error or is unavailable, STMB stops generation before sending the prompt. This applies to memories, Side Prompts, and Memory Assistance. Incoming script errors retain the existing best-effort behavior.

Use Regex only when the transformation is understood. A bad outgoing rule can corrupt required schema instructions; a bad incoming rule can corrupt otherwise valid JSON.

---

## 24. Lorebook Entry Titles and Character Policy

### 24.1 Title placeholders

Profile title formats can use:

- `{{title}}` — AI-generated title;
- `{{scene}}` — source range;
- `{{char}}` — character/group name;
- `{{groupname}}` — the current group's display name; resolves to `Unknown` outside a group chat;
- `{{present}}` — comma-separated characters present in the scene: individual speakers in a group chat, the scene's selected Active Cast in Narrator Mode, or the current character in a regular character chat;
- `{{user}}` — user name;
- `{{messages}}` — scene message count;
- `{{profile}}` — profile name;
- supported date and time placeholders.

### 24.2 Auto-numbering

Supported numbering tokens include forms such as:

```text
[0] [00] (0) {0} #0
#[000] ([000]) {[000]}
```

STMB assigns sequential, zero-padded numbers according to the chosen format.

### 24.3 Printable Unicode

All printable Unicode characters are allowed in titles, including emoji, accented text, CJK, and symbols. Unicode control characters in U+0000–U+001F and U+007F–U+009F are removed.

Lorebook filenames used by Auto-Create are separately sanitized for filesystem-reserved characters and length.

---

## 25. Job Queue and Retry Controls

The optional queue requires Chat Top Bar / Chat Top Info Bar. When the queue is available, regenerating a Memory, consolidation, or Side Prompt creates a regeneration job; the replacement remains in review until you approve it.

The **Memory Books Jobs** drawer can show:

- queued;
- active;
- completed;
- failed;
- canceled;
- blocked;
- Needs Review.

Jobs that process a chat range show the starting and ending message numbers in their queue rows. The drawer can also cancel active work, reopen review jobs, inspect failures, retry work, and dismiss terminal history rows.

Retry scopes:

- **Retry:** rerun one non-Memory job, such as a Side Prompt or consolidation job.
- **Retry All:** rerun/resume the Memory and associated after-Memory Side Prompt work. If the Memory was already saved, STMB can resume from that result rather than duplicate it.
- **Retry Memory:** rerun/resume only the Memory and intentionally skip after-Memory Side Prompts.

Use Retry All to restore the combined workflow; use Retry Memory when tracker work should not run.

Consolidation saves record a checkpoint in extension settings before writing each accepted summary. A summary and its source-disable changes are saved together. Retry checks the live Memory Book for the checkpoint marker before writing, so a confirmed summary is reused instead of duplicated. After a reload, **Consolidation recovery** in the extension menu lists unfinished checkpoints and offers **Resume** and **Review details**. A changed source, edited summary, duplicate marker, or unconfirmed save is marked **Needs Review** and is never replayed automatically; after checking the Memory Book, **Dismiss after review** removes the checkpoint notice without changing the book. This uses ST's settings and lorebook APIs; it does not provide a server transaction.

Checkpoints store the accepted summary draft, generated keywords, source IDs and fingerprints, and save options in ST extension settings so a reload can resume the exact candidate. Keep settings backups as private as the Memory Books themselves.

Without Chat Top Bar, STMB still performs its normal workflows but lacks the queue UI.

### Deferred last-processed progress

The last-processed marker records the highest chat message already covered by a saved Memory. It supplies the boundary used for subsequent Memory ranges and automatic threshold counting; it is not the configured threshold itself. When the source chat is loaded and idle and validation succeeds, STMB updates and verifies the marker automatically.

Pending updates are not limited to switching chats. An update can also be deferred while the current chat is generating a reply, saving, or editing a message, when source-message or marker validation fails, or when the automatic marker save cannot be verified. When the source chat is open and idle, STMB automatically retries pending updates that still pass validation, verifies the saved marker, and clears the resolved records without a popup. Reopening the source chat also triggers this recovery. Conflicts or failed saves still open the recovery popup; STMB does not repeatedly retry a failed recovery during the same visit. Discard keeps the existing marker, so subsequent Memories may cover messages already summarized by the saved Memory.

When a queued Memory finishes after its source chat is no longer open, the Memory is still saved to its Memory Book. STMB records the last-processed marker update in `extension_settings.STMemoryBooks.pendingProgress` instead of fetching and rewriting the inactive character or group chat. Already-queued jobs can finish; new manual and automatic base-memory requests for that chat wait until its pending updates are applied or explicitly discarded. Other chats remain usable.

Clicking the pending-update notification or the main panel's **Pending progress updates (N)** button opens the management popup, including after refreshing or disabling Chat Top Bar. The popup explains what the marker does and why saved Memories remain intact while an update is pending. For another chat, **Reopen chat and update marker** switches to that character or group chat and applies its pending updates using the validated, verified save path in one click. The file must still exist, and STMB checks that the intended chat is loaded before updating it. It does not switch chats without this click. If validation fails after reopening, the records remain available for review in the now-active chat.

For the active chat, **Apply** remains an explicit manual override: it displays **Processing…**, runs `/stmb-set-highest <pending message number>` in the affected chat, and removes the pending records from settings before displaying **Done**. It uses the command's normal manual-marker behavior and range clamping, without comparing message contents or attachments or reading the chat back. **Later**, Escape, or closing the popup preserves the records. **Discard pending update** requires confirmation and leaves saved lorebook memories untouched.

Each pending record contains a chat reference, operation/job identity, target message index, original marker state/revision, chat integrity identifier, and SHA-256 fingerprint of the source message text and identity fields. Attachment fields are not read or fingerprinted. It does not persist conversation text. Appended messages and hide/unhide changes are allowed; edits, deletions, changed identity, manual marker changes, or rollback can make an update unsafe. Those checks apply to automatic marker updates. Explicit Apply uses the slash command even if the original fingerprint or marker revision no longer matches; Later preserves the pending update and Discard removes it. Explicit chat/character rename events remap pending references; missing or unrecognized references remain available for review and discard.

Pending records are saved using ST's settings API and verified by reading settings back, with a shared confirmation limit of 60 seconds by default. A settings failure leaves the update in memory. Use Apply in the affected chat to run the marker command, or Discard pending update to remove the pending record. There is no separate settings-save retry button. There is no browser recovery backup: refreshing before a successful settings save can lose an unpersisted update. If settings cleanup fails after Apply, the pending record remains available; clicking Apply again reruns the command and retries cleanup without generating another Memory. Explicit Apply relies on the command’s normal save behavior; automatic updates still verify the saved marker.

This removes STMB's separate inactive-chat replacement write. ST's normal current-chat save still writes a complete chat, and concurrent settings saves from other tabs/devices are not transactional. The change does not identify the cause of previously reported chat loss or guarantee protection from all core/other-extension save races.

---

## 26. Visual Feedback and Accessibility

STMB provides visual states for scene controls, including inactive, selected, valid range, in-scene, and processing states. Exact colors depend on the SillyTavern theme.

Accessibility support includes:

- keyboard navigation;
- focus indicators;
- ARIA attributes;
- reduced-motion behavior;
- mobile-friendly controls.

When teaching from a screenshot, describe the visible icon and label rather than relying on a specific color.

---

## 27. Settings Map and Current Settings Reference

This section is the settings map. It identifies where each user-facing STMB configuration control is located and what it controls. It also lists the important saved and one-run controls in specialized interfaces. One-time content fields used only to create a particular Clip, Topical Clip, Compaction, or preview are documented in their workflow sections rather than repeated here.

The common starting path is:

**magic-wand Extensions menu beside the chat input → Memory Books**

All paths below begin in the **Memory Books** main panel unless they explicitly say **SillyTavern**. A control may be hidden or disabled when it does not apply to the current chat, provider, profile, or storage mode.

Scopes used below:

- **Global:** applies throughout STMB unless a narrower setting overrides it.
- **Per chat:** stored for the current chat or group.
- **Per character:** follows the character card across compatible chats.
- **Per profile/template/setting:** stored in that reusable object.
- **Per run:** affects only the operation currently being prepared.

### 27.1 Main panel: storage, chat mode, and active profile

| Setting | Location | Scope | What it does |
|---|---|---|---|
| **Enable Manual Lorebook Mode** | **Current Lorebook Configuration** | Global mode; book choice is per chat | Stops using the normal chat-bound lorebook as STMB's automatic target and requires a Memory Book to be selected for the current chat. It cannot be enabled with Auto-Create Lorebook Mode. |
| **Selected manual Memory Book** | **Current Lorebook Configuration → manual lorebook controls**; visible in Manual Mode | Per chat | Chooses the main Memory Book that receives Memories for this chat. In Narrator Mode this is the omniscient book. |
| **Group-character Memory Book assignments** | **Current Lorebook Configuration → group-character rows**; visible in a real group using Manual Mode | Per chat | Assigns a Memory Book to each real-group member. STMB injects the current native speaker’s assigned book; STLO integration is optional. The canonical group book may also be assigned and then stores both group and character-focused entries. |
| **Character Memory Book lock** | Lock icon beside a character's Memory Book assignment | Per character | Keeps that character card assigned to the same Memory Book across compatible Manual Mode chats. Unlock before changing the assignment. |
| **Narrator Mode** | **Current Lorebook Configuration**; normal non-group chats only | Per chat | Uses the selected manual book as an omniscient Memory Book and enables declared fictional cast members with their own unique books. Manual Mode and an omniscient book are required. |
| **Manage Narrator Cast** | Under **Narrator Mode**; also available from the Active Cast drawer | Per chat | Adds, renames, retires, restores, and assigns unique Memory Books to declared Narrator characters. |
| **Auto-create lorebook if none exists** | **Current Lorebook Configuration** | Global | In Automatic Mode, creates and binds a lorebook when the chat has none. It cannot be enabled with Manual Mode. |
| **Lorebook Name Template** | Directly below **Auto-create lorebook if none exists** | Global | Names auto-created books. Supports `{{char}}`, `{{user}}`, and `{{chat}}`. It is used only while Auto-Create Lorebook Mode is enabled. |
| **Memory profile selection** | **Memory Profiles** selector | Per run | Chooses the profile for the next Memory and for the adjacent profile actions. This selection alone does not change the saved default. |
| **Set as Default** | **Memory Profiles → Profile Actions** | Global default | Makes the selected profile the default used by automatic Memories and other workflows unless a confirmation, Side Prompt override, or workflow-specific choice selects another profile. |
| **Memory Title Format** | **Memory Profiles → Memory Title Format**, or **Profile Actions → Edit Profile** | Per profile | Formats new Memory entry titles and optional numbering with the listed title macros. The main-panel control edits the default profile's format; **Edit Profile** changes the selected profile directly. |

### 27.2 General Settings

Open **Settings → General Settings** in the main panel.

| Setting | Scope | What it does |
|---|---|---|
| **Always use default profile (no confirmation prompt)** | Global | Skips the normal pre-generation confirmation window. Required for non-interactive catch-up; independent warnings and enabled previews can still appear. |
| **Automatically accept detected participants in future** | Global | Stops asking for real-group participant confirmation and accepts STMB's detected participant set for later Memories. |
| **Show memory previews** | Global | Opens an editable review before saving generated Memories and applicable Side Prompt output. |
| **Show consolidation previews** | Global | Opens review controls for generated consolidation candidates before they are committed. |
| **Show notifications** | Global | Enables STMB toast notifications. |
| **Show floating Clip button when text is highlighted** | Global | Shows the floating scissors control after selecting chat text. |
| **Memory boundary indicator** | Global | Shows neither control, the processed-boundary divider, the draggable jump button, or both. |
| **Allow scene overlap** | Global | Permits a selected scene range to overlap message IDs already represented by an existing Memory. |
| **Refresh lorebook editor after adding memories** | Global | Refreshes an open lorebook editor after STMB writes entries so the new content appears immediately. |
| **Copy Memory Books when branching** | Global | Gives a native chat branch independent copies of its active unlocked chat-bound or manual Memory Books. Character-locked books remain shared by design. |
| **Auto-rollback after message deletion** | Global | Enables coordinated rollback when deletion or truncation intersects already processed chat material. It is disabled by default. Ordinary message edits and swipes do not trigger it. |
| **Apply auto-rollback to branches/checkpoints** | Global; Auto-rollback option | On the first opening of a branch or checkpoint, rolls back Memories beyond its retained messages. Requires independent copies of every active Memory Book; otherwise it skips the rollback. |
| **Update last message ID processed** | Global; Auto-rollback action | Moves the processed checkpoint to the end of the newest surviving Memory, or clears it when none survives. |
| **Delete last Memory** | Global; Auto-rollback action | Deletes every invalidated Memory selected by the rollback scope and its linked copies. Memory and consolidation deletion is irreversible. |
| **Restore previous Side Prompts** | Global; Auto-rollback action | Restores each unchanged affected Side Prompt to its latest exact saved before-state. Only one rollback level is retained. |
| **Default for solo chats** | Global | Selects the Side Prompt Set inherited by solo chats after a Memory. An empty selection uses individually enabled after-Memory Side Prompts. |
| **Default for group chats** | Global | Selects the Side Prompt Set inherited by real group chats after a Memory. An empty selection uses individually enabled after-Memory Side Prompts. |
| **Max Response Tokens** | Global | Overrides the maximum output length for STMB generation. Increase it when otherwise valid JSON is cut off; `0` leaves the normal provider/SillyTavern behavior available as the fallback. |
| **Token Warning Threshold** | Global | Shows a confirmation warning when the estimated input request exceeds the threshold. It does not change the model's context limit. |
| **Default Previous Memories Count** | Global | Sets the normal default of 0–7 prior Memories supplied as continuity context for a new Memory. A run can override it in **Advanced Memory Options**. |
| **Use regex (advanced)** | Global | Enables STMB's own regex-processing selection. These selections are separate from whether the underlying SillyTavern regex script is generally enabled. |
| **Configure regex… → Outgoing scripts** | Global | Selects scripts STMB runs on material before sending it to the generation provider. |
| **Configure regex… → Incoming scripts** | Global | Selects scripts STMB runs on returned material before parsing and saving it. |

#### Memory Auto-Rollback inside General Settings

**Auto-rollback after message deletion** is a master preference. Its three action checkboxes are independently selectable, enabled by default, and visually disabled while the master switch is off. Existing installations therefore do not begin deleting anything merely by upgrading.

**Apply auto-rollback to branches/checkpoints** is off by default. When enabled, STMB applies the selected actions the first time an eligible branch or checkpoint is opened, including existing child chats. Checkpoints are handled when opened, not when created. STMB uses the child chat's current message count as the first omitted message index, so a Memory ending at the last retained message remains intact while Memories crossing or following that boundary are eligible. Completion is recorded for that child and boundary, and changing settings does not repeat a completed rollback.

When branch/checkpoint rollback deletes a Memory, it also unhides the retained messages in that Memory's source range after the Memory Books save successfully. For example, branching at message 36 with a Memory covering 33–44 deletes that Memory from the copy and unhides messages 33–36. This does not depend on the unhide-before-generation preference. Already completed child rollbacks are not automatically repeated after an upgrade; use `/unhide 33-36` to repair that example in an existing branch.

When ordinary message deletion automatically removes a Memory, STMB also unhides the surviving messages from that Memory's original source range after saving the Memory Books. For example, if a Memory covers messages 31–60 and messages 50–60 are deleted, messages 31–49 are unhidden. For a middle deletion, retained messages after the deleted interval are mapped to their new indices. **Affected only** restores surviving source messages from the removed overlapping Memories; **Full rollback** also restores surviving source messages from the newer Memories it removes. Dependent consolidations do not extend these unhide ranges. This requires **Delete last Memory** and does not depend on the unhide-before-generation preference. Manual lorebook-entry deletion does not trigger this restoration.

Pending ordinary-deletion unhide ranges are saved with the Memory Book changes and retried when that chat is reopened or before its next rollback. STMB checks a fingerprint of the surviving chat prefix before retrying. Appended messages and hide/unhide changes do not block recovery, but changed or shifted source messages do. In that case, STMB warns that manual review is needed and discards the unsafe pending record without unhiding its messages, allowing later rollbacks to proceed. Valid pending records in other Memory Books remain eligible for recovery. If saving the cleanup fails, STMB reports the failure and retains the record for another attempt. Conversation text is not stored in the record. Memories removed before this behavior was added cannot be reconstructed automatically.

Pending unhide ranges are saved in the same Memory Book writes as the deletions. If switching chats or an error interrupts unhiding, reopening the child with branch/checkpoint auto-rollback enabled retries those saved ranges, even though the deleted Memories no longer exist. Retrying may repeat already completed unhide commands; the recovery records are removed only after every range completes in the intended chat.

Branch/checkpoint rollback requires isolated copies of every active Memory Book. When **Copy Memory Books when branching** is disabled or a shared/locked book cannot be isolated, STMB skips rollback and reports the reason to avoid changing the parent chat's data. Copy or rollback failures and canceled consolidation confirmations remain eligible for a later opening.

Auto-rollback reacts only to message deletion or truncation, including the deletion phase of response regeneration. It does not react to an ordinary edit or swipe. STMB tracks the actual message identities in each chat because SillyTavern's deletion event value does not reliably identify a middle deletion.

For a tail deletion, every Memory whose stored source range intersects the removed suffix is affected. For a deletion in the middle of a chat, STMB asks for one of three choices:

- **Full rollback** deletes the affected Memory and every newer Memory.
- **Affected only** deletes only overlapping Memories, preserves newer Memories, and shifts their stored ranges, relevant Side Prompt checkpoints, and the processed checkpoint by the deletion count. This deliberately leaves a permanent gap in Memory coverage.
- **Cancel** makes no Memory Books changes.

Rollback uses exact `STMB_chatId`, source-range, and canonical/link metadata across available Memory Books. A canonical group or Narrator Memory and all discoverable linked copies are one deletion unit. Missing canonical copies, ambiguous legacy entries without enough chat identity, malformed ranges, or incomplete consolidation dependencies stop the entire rollback and produce repair guidance; STMB does not guess ownership.

When **Delete last Memory** is selected, STMB preflights every direct and transitive consolidation parent in each affected Memory Book. One combined confirmation lists the consolidations that must be deleted. Canceling that confirmation cancels checkpoint, Memory, and Side Prompt changes as well. Approval deletes the consolidation ancestors, re-enables each existing direct source that was disabled by a deleted consolidation and clears its `disabledBySummaryId` backlink, then deletes the selected base Memories. Entries disabled independently by the user are not enabled.

Before saving, STMB rechecks complete lorebook fingerprints. Lorebooks are written through their normal serialized write lanes in sorted order, and unchanged pre-write clones are retained for compensating saves if a later book fails. Chat checkpoint metadata is changed only after every lorebook write succeeds. Queued work for the chat is canceled before preflight; active non-queued Memory creation is allowed to finish before rollback proceeds.

Side Prompt rollback uses version-2 regeneration snapshots. Each snapshot records whether the entry existed, its exact prior state without an older rollback snapshot, source chat/range, and a fingerprint of the state STMB wrote. If the rolled-back run created the entry, rollback deletes it. If the current entry no longer matches the saved fingerprint, STMB assumes a user or later run changed it and leaves it alone. Version-1 snapshots still support regeneration but are not safe enough for rollback and are skipped with a warning. A successful restore consumes the snapshot, so that Side Prompt cannot be rolled back a second time until it runs again. If several Memories are rolled back together, only the latest available before-state for each Side Prompt can be restored; information introduced by older rolled-back runs may remain.

#### Token Saving inside General Settings

These controls are lower in the same **General Settings** popup under **Token Saving (Hide/Unhide Messages)**.

| Setting | Scope | What it does |
|---|---|---|
| **Auto-hide messages after adding memory** | Global | Chooses no automatic hiding, all processed messages through the latest Memory, or only the range used by the latest Memory. Hiding is reversible and does not delete messages. |
| **Messages to leave unhidden** | Global | Keeps this many recent messages visible when auto-hiding, preserving overlap near the Memory boundary. `0` hides through the applicable scene end. |
| **Unhide hidden messages for memory generation** | Global | Runs the equivalent of `/unhide X-Y` for the source range before STMB compiles it. The selected auto-hide mode determines what is hidden again after a successful save. |
| **Also use hidden messages** | Global; also available in Topical Clip | Includes hidden messages in Topical Clip ranges and Extract selections without unhiding them. Defaults to unchecked; independent of unhide-before-memory. |

### 27.3 Automatic Memories and consolidation reminders

Open **Settings → Automatic Memories** in the main panel.

| Setting | Scope | What it does |
|---|---|---|
| **Auto-create memory summaries** | Global | Enables automatic `/nextmemory`-style Memory creation. With no processed baseline, current STMB can begin at message 0; a first manual Memory remains recommended for setup validation and a deliberate starting boundary. |
| **Auto-Summary Trigger** | Global | Chooses whether automatic Memory creation is triggered by message count or token count. |
| **Auto-Summary Token Threshold** | Global | Sets the token count that triggers automatic Memory creation when the trigger is **Tokens**. |
| **Auto-Summary Interval** | Global | Sets how many messages make up the normal automatic cadence when the trigger is **Messages**. |
| **Auto-Summary Buffer** | Global | Excludes this many newest messages from an otherwise ready automatic range so generation happens slightly behind the live conversation. |
| **Prompt for consolidation when a tier is ready** | Global | Shows a yes/later prompt when a monitored tier reaches its saved eligible-source minimum. It never silently performs consolidation. |
| **Auto-Consolidation Tiers** | Global | Chooses which target tiers are monitored for readiness prompts. The minimum for each tier is saved in **Consolidate Memories**. |

#### Memory reminder notifications

Automatic-memory reminder controls appear only in **Automatic Memories**. Manual-memory reminder controls appear in both **General Settings** and **Automatic Memories**, backed by the same global preferences. Both reminder toggles default to **off** and operate independently of **Show notifications**.

- **Turn on reminders for automatic memories** applies while **Auto-create memory summaries** is enabled. Its configurable interval X defaults to **10 messages**. The first reminder is due at **Auto-Summary Interval + Auto-Summary Buffer + X** unprocessed messages, with repeats every X additional messages. For example, interval 50, buffer 2, and X = 10 first reminds at 62 unprocessed messages, then 72, 82, and so on if checked at those counts.
- **Turn on reminders to make memories manually** applies while auto-create is disabled. Its configurable interval Y defaults to **50 messages**. It first reminds at Y unprocessed messages, then every Y additional messages. Both preferences remain saved when switching auto-create on or off.

Intervals accept positive whole numbers and count **chat messages**, including both user and assistant messages, using the existing last-processed Memory boundary. Automatic reminders remain message-based even when generation uses a token threshold. Checks run after assistant replies and when memory processing becomes idle; generation, pending progress, and an explicit auto-summary postponement suppress new reminders. A delayed reminder starts its repeat interval from the actual notification count.

Reminder toasts have a close button and stay visible until dismissed. Repeats do not stack while a reminder is visible. Notification checkpoints are saved per chat, so reloading does not immediately repeat a delivered reminder. A changed processed boundary or reminder configuration resets the relevant schedule; deleted messages rebase repeat checkpoints. Changing chats, changing the boundary, or disabling/switching the active reminder mode clears the visible reminder. These reminders do not create memories or change automatic generation thresholds.

### 27.4 Profile editor

Choose a profile under **Memory Profiles**, then open **Profile Actions → Edit Profile**. These settings are **per profile** unless noted otherwise. The built-in **Current SillyTavern Settings** profile intentionally locks fields that SillyTavern controls.

| Setting | What it does |
|---|---|
| **Profile Name** | Names the reusable STMB profile. The built-in profile name is locked. |
| **API/Provider** | Chooses current SillyTavern routing, a supported provider, a Custom OpenAI-compatible connection, or Full Manual Configuration. |
| **Use this connection profile** | For **Custom OpenAI-Compatible API**, uses either the active SillyTavern Custom connection or one named Custom connection. Its saved URL and secret are used while the STMB **Model** remains the model override. |
| **Skip structured output and use plain-text completion** | Stops sending a structured-output schema when a provider rejects it. The selected prompt must still make the model return STMB's required valid JSON. |
| **Use ST's ChatCompletionService** | Uses the selected ST Connection Manager profile with STMB model and temperature overrides. Without a selected connection profile, uses the existing ChatCompletionService route. Unavailable to Full Manual profiles. |
| **Chat Completion Preset** | Optionally applies a SillyTavern Chat Completion preset when no ST Connection Manager profile is selected. Otherwise, the connection profile supplies the preset. |
| **Model** | Supplies the exact model ID for this profile. **Current SillyTavern Settings** instead reads the model active in SillyTavern. |
| **Temperature** | Sets generation randomness for this profile. **Current SillyTavern Settings** instead reads SillyTavern's active temperature. |
| **Use reverse proxy** | Passes SillyTavern's configured reverse-proxy details for supported providers; in Full Manual Configuration the secret field is labeled as a proxy password. |
| **API Endpoint URL / API Key** | Supplies a separate direct endpoint and credential only for **Full Manual Configuration**. Prefer a connection configured and tested in SillyTavern for normal use. |
| **Memory Creation Method** | Selects the Summary Prompt preset used for ordinary Memory generation. Prompt content is managed in **Settings → Summary Prompt Manager**. |
| **Use separate group and character prompts in group chats** | Uses distinct prompt presets for the group Memory Book and character-focused Memory Books. |
| **Group Summary Prompt / Character Summary Prompt** | Selects the two presets used when separate group/character prompting is enabled. |
| **Memory Title Format** | Controls title text, macros, and automatic numbering for Memories produced by this profile. |
| **Activation Mode** | Saves new entries as **Normal** keyword activation, **Constant**, or **Vectorized**. |
| **Insertion Position** | Chooses where a generated entry is inserted relative to Character, Example Messages, Author's Note, or a named Outlet. |
| **Outlet Name** | Names the target Outlet and appears only when **Insertion Position** is **Outlet**. |
| **Insertion Order** | **Auto** derives order from the Memory number; **Manual** uses a fixed value; **Reverse** counts down from a starting value and is intended only for Outlets. |
| **Prevent Recursion** | Prevents the generated entry's content from triggering other lorebook entries during recursive scanning. |
| **Delay Until Recursion** | Prevents the generated entry from activating in the first scan pass. Leave it off when nothing else can begin recursion. |
| **Also include** | Legacy-profile compatibility only. Older profiles may show ordered lorebook references here; current configuration uses per-chat **Context Settings** instead. |

The active SillyTavern provider, model, temperature, connection preset, and reverse proxy are configured in SillyTavern's own connection controls, not in STMB. The **Current SillyTavern Settings** profile reads those live values.

### 27.5 Context Settings

Open **Settings → Context Settings** in the main panel.

| Setting | Scope | What it does |
|---|---|---|
| **Additional Context for this chat** | Per chat | Selects one named Context Setting, explicitly saves **No Context**, or leaves the choice unset so STMB can prompt when migrated context requires a decision. |
| **Context Setting Name** | Per Context Setting | Names a reusable Additional Context collection. |
| **Additional Context entries and order** | Per Context Setting | Selects lorebook entries to send as stable reference material and determines their order. Missing entries are warned about and skipped. |

**New**, **Duplicate**, **Delete**, **Import JSON**, and **Export JSON** manage Context Settings; they do not change generation behavior until a setting is selected by a chat or Side Prompt.

### 27.6 Trackers & Side Prompts

Open **Settings → Trackers & Side Prompts** in the main panel.

| Setting | Location and scope | What it does |
|---|---|---|
| **After-memory side prompt mode for this chat** | Manager main screen; per chat | Uses the matching solo/group default, explicitly uses individually enabled after-Memory prompts, or selects one named Side Prompt Set for this chat. |
| **How many concurrent prompts to run at once** | Manager main screen; global | Limits simultaneous Side Prompt jobs to 1–10. |
| **Side Prompt Set Name** | **New Set** or edit a set; per set | Names a reusable ordered group of Side Prompt runs. |
| **Side Prompt / Row Label / Macro Values** | Side Prompt Set row; per set | Chooses the template for a row, gives the row an optional display/title label, supplies literal or set-level runtime macro values, and uses row order as execution order. |
| **Enabled** | **New** or edit an ordinary Side Prompt; per template | Makes the template eligible when the chat uses individually enabled after-Memory prompts. Trigger settings still determine when it runs. |
| **Run on visible message interval / Interval** | Side Prompt editor; per template | Runs after the configured number of visible messages. Automatic triggers are unavailable when the template requires unresolved runtime macros. |
| **Run automatically after memory** | Side Prompt editor; per template | Runs the template after a successful Memory, subject to the chat's Side Prompt mode or selected set. |
| **Allow manual run via `/sideprompt`** | Side Prompt editor; per template | Allows explicit manual execution. |
| **Prompt / Response Format** | Side Prompt editor; per template | Defines the instruction and optional output structure. Both fields may use supported Side Prompt macros. |
| **Previous memories for context** | Side Prompt editor; per template | Includes 0–7 previous Memory entries before the selected source messages. |
| **Use additional context / Additional Context Source** | Side Prompt editor; per template | Includes Additional Context and either follows the current chat's Context Setting or always uses one fixed named setting. |
| **Lorebook Target** | Side Prompt editor; per template or per chat | Saves output to the normal Memory Book or another chosen lorebook. When changed, STMB asks whether the choice applies only to this chat or to the template going forward. |
| **Lorebook Entry Title Override / Keywords** | Side Prompt editor; per template | Optionally controls the upserted entry title template and comma-separated activation keywords. |
| **Activation Mode / Insertion Position / Outlet Name** | Side Prompt editor; per template | Controls activation and placement for the Side Prompt's lorebook entry. |
| **Insertion Order / Order Value** | Side Prompt editor; per template | Uses automatic Memory-number ordering or a fixed manual order value. |
| **Prevent Recursion / Delay Until Recursion / Ignore Budget** | Side Prompt editor; per template | Applies the corresponding SillyTavern lorebook-entry recursion and budget flags. |
| **Override default memory profile / Connection Profile** | Side Prompt editor; per template | Routes this Side Prompt through a selected STMB profile instead of the current default profile. |
| **Memory Assistance Mode** | Edit **Memory Assistance**; global | **Off** disables it; **Update** proposes changes to existing Clips; **Update and Suggest** also discovers Topical Clip topics; **Automatic** directly applies ordinary Clip additions while leaving Topical Clip replacements for approval. |
| **Update Prompt / Topic Suggestions Prompt** | Edit **Memory Assistance**; per built-in template | Controls its two AI tasks. Their response contracts remain fixed. |
| **Use a connection profile override** | Edit **Memory Assistance**; per built-in template | Uses the selected STMB profile for Memory Assistance instead of the default. |

### 27.7 Prompt managers

| Setting | Location | Scope | What it does |
|---|---|---|---|
| **Summary Prompt name and prompt text** | **Settings → Summary Prompt Manager → New Preset** or edit | Per preset | Defines a reusable ordinary-Memory prompt. A profile uses it only after its **Memory Creation Method** or group/character prompt selection points to that preset. |
| **Default consolidation prompt** | **Settings → Consolidation Prompt Manager → Set Default** | Global | Selects the normal prompt preselected by **Consolidate Memories**. Regeneration-only and group-only presets cannot be selected. |
| **Consolidation Prompt name and prompt text** | **Settings → Consolidation Prompt Manager → New Consolidation Preset** or edit | Per preset | Defines reusable consolidation instructions. The dedicated regeneration and group presets are restricted to those workflows. |

### 27.8 Topical Clip and Compaction defaults

Open **Settings → Topical Clip** or **Settings → Compaction** in the main panel.

| Setting | Location | Scope | What it does |
|---|---|---|---|
| **Generation Profile / Compaction Profile** | **Topical Clip → Generation Profile**, or **Compaction → Compaction Profile** | Global shared default | Selects the STMB profile used for Topical Clip generation and Compaction. Changing it in either interface changes the shared selection used by both workflows. |
| **Topical Clip Prompt** | **Topical Clip → Edit Topical Clip Prompt** | Global | Saves a custom prompt template for Topical Clip generation. **Reset to Default** returns to the current built-in prompt. Required source macros are validated before save or generation. |
| **Topical Format** | **Topical Clip → Edit Topical Format** | Global | Formats newly saved Topical Clips and later updates. Requires `{{CONTENT}}`; `{{TITLE}}` is optional. |
| **Combined Format** | **Combine Clips → Edit Combined Format** | Global | Formats newly saved combined clips and later updates, separately from Topical Format. |
| **Combine Clips Prompt** | **Combine Clips → Edit Combine Clips Prompt** | Global | Defines combination instructions. Requires `{{SOURCE_CLIPS}}`; `{{TITLE}}` is optional. |
| **Compaction Prompt** | **Compaction → Edit Compaction Prompt** | Global | Saves a custom prompt template for shortening existing Memory, Clip, and Side Prompt entries. **Reset to Default** returns to the current built-in prompt. `{{ENTRY_CONTENT}}` is required. |

The Memory Book, topic, keywords, source inclusion, source selection, message range, draft, and entry selected for Compaction are per-run workflow choices, not persistent settings.

### 27.9 Consolidate Memories controls

Open **Consolidate Memories** from the buttons at the bottom of the main panel. This interface mixes saved defaults with one-run choices.

| Setting | Scope | What it does |
|---|---|---|
| **Source Memory Book** | Per run | Shows the Memory Book currently being consolidated and lets you select a different available book. Changing it reloads the eligible-entry list without changing the chat's manual or chat-bound Memory Book configuration. |
| **Target tier** | Per run | Chooses the higher tier to create and therefore the immediately lower eligible source tier. |
| **Consolidation Prompt** | Per run | Selects the prompt for this consolidation; it initially uses the default from the Consolidation Prompt Manager. |
| **Maximum entries per pass** | Per run | Limits how many lower-tier entries are sent in one analysis pass. |
| **Token Budget** | Per run | Sets the approximate input budget used to batch this consolidation. |
| **Number of automatic summary attempts** | Per run | Limits repeated analysis passes used to obtain usable assignments and summaries. |
| **Saved minimum eligible entries** | Global, saved separately for each target tier | Sets when the chosen tier is considered ready. It also controls that tier's automatic readiness prompt. |
| **Activation Mode / Insertion Position / Outlet / Insertion Order / Recursion Settings** | Global consolidation-entry defaults | Controls how newly consolidated entries are saved. These are separate from ordinary Memory profile entry settings. |
| **Disable selected source entries after creating summaries** | Per run | Disables successfully consolidated sources after commit so higher-tier summaries can replace them in retrieval. It does not delete them. |
| **Selected source entries** | Per run | Chooses which eligible lower-tier entries are processed. Unchecked entries are left untouched. |

### 27.10 Related SillyTavern World Info settings

These controls are outside STMB, in SillyTavern's World Info/lorebook settings, but they affect whether saved Memories are retrieved during ordinary chat generation.

| Setting | What it does |
|---|---|
| **Match Whole Words** | Controls keyword boundary matching. Off is a common starting point for flexible Memory keywords. |
| **Scan Depth** | Controls how much recent text is scanned for lorebook activation. A relatively high value such as 8 is a common starting point. |
| **Max Recursion Steps** | Limits recursive World Info activation. Approximately 2 is a common starting point. |
| **Context percentage / lorebook budget** | Limits how much context lorebook entries may occupy. Increase it only in balance with the model's total context and other prompt material. |

These are recommendations, not hard requirements; see Section 10 for retrieval diagnosis.

---

## 28. Slash Command Reference

### Memory commands

```text
/creatememory
```

Create a Memory from the currently marked scene.

```text
/scenememory X-Y
```

Set the inclusive range and create a Memory, for example `/scenememory 10-15`.

```text
/nextmemory
```

Create a Memory from the message after the highest processed boundary through the current eligible end.

```text
/stmb-catchup interval=x start=y end=z
```

Process an existing long chat in consecutive chunks.

### Side Prompt commands

```text
/sideprompt "Name" {{macro}}="value" [X-Y]
/sideprompt-set "Set Name" [X-Y]
/sideprompt-macroset "Set Name" {{macro}}="value" [X-Y]
/sideprompt-on "Name" | all
/sideprompt-off "Name" | all
```

### Processed-boundary commands

```text
/stmb-highest
/stmb-set-highest <N|none>
```

### Emergency stop

```text
/stmb-stop
```

Stops all in-flight STMB generation everywhere, including Side Prompts. Work already committed remains saved.

---

## 29. Troubleshooting by Stage

### 29.1 Extension/UI did not load

Symptoms:

- Memory Books missing from the magic-wand menu;
- chevrons missing;
- no floating Clip button after selection.

Checks:

1. extension installed and enabled;
2. page reloaded;
3. character/group chat open;
4. wait up to ten seconds;
5. expand message actions;
6. inspect console only after those checks.

### 29.2 No scene selected

Both **►** and **◄** are required for a marked scene. Verify Current Scene in the panel.

If the range overlaps an existing Memory, choose another range or enable Allow Scene Overlap.

### 29.3 No valid Memory Book

Automatic Mode:

- bind a lorebook to the chat; or
- enable Auto-Create.

Manual Mode:

- select a main manual book;
- repair a deleted selection;
- unlock a broken character lock before changing it.

Real multi-book group:

- every required member needs a valid assignment;
- the group book may be reused as a character book;
- if STLO is installed, verify its optional activation and ordering rules.

Narrator Mode:

- Manual Mode must be enabled;
- an omniscient book must be selected;
- every declared member needs a unique non-omniscient book.

### 29.4 AI failed to produce a valid Memory

Check in this order:

1. provider/model/profile are valid;
2. response was not truncated;
3. maximum response tokens are sufficient;
4. selected prompt still requires exact JSON;
5. schema was not corrupted by Regex;
6. provider supports the selected structured-output mode;
7. try Skip Structured Output only if the provider rejects schemas;
8. try a more instruction-following model before rewriting the prompt;
9. click **Raw response from AI** in the persistent error notification to inspect the captured provider response and use the manual JSON correction interface when available.

Common causes include code fences, commentary, a missing key, keywords not being an array, refusal text, or cut-off output.

### 29.5 Memory saved but messages disappeared

They were probably auto-hidden. Change Token Saving settings. Hidden messages are not deleted.

### 29.6 Automatic Memories did not run

Check:

- Auto-create memory summaries enabled;
- enough messages beyond the highest processed boundary;
- interval plus buffer requirement met;
- no postpone checkpoint still active;
- valid Memory Book available;
- no other Memory job currently blocking the trigger;
- current chat not switched during work;
- group generation finished before the trigger is expected.

A first manual Memory is recommended but not technically required in the current version.

### 29.7 Memory exists but does not activate

Check:

- correct book active;
- entry enabled;
- relevant keywords;
- activation mode;
- budget;
- recursion and Delay Until Recursion;
- STLO routing if used;
- World Info inspection/logs.

Do not regenerate the Memory until retrieval has been tested.

### 29.8 Entry was sent but ignored

This is model-use behavior. Possible responses:

- make the Memory shorter and more explicit;
- improve insertion position/priority;
- reduce competing context;
- use an OOC reminder;
- choose a model that follows supplied context more reliably.

### 29.9 Side Prompt did not run

See Section 16.18. In particular, a selected set suppresses individually enabled prompts outside that set.

### 29.10 Consolidation did not prompt

Verify:

- readiness prompt enabled;
- target tier selected for monitoring;
- enough eligible source entries exist;
- sources are not already disabled/ineligible;
- the saved minimum count for that tier is met.

### 29.11 Regeneration button disabled

Hover or inspect the stated reason. Common causes:

- entry predates required snapshot metadata;
- source chat/range unavailable;
- source entries missing or wrong tier;
- active parent consolidation blocks a lower source;
- original sequence number cannot be determined;
- Side Prompt template deleted.

### 29.12 Branch did not copy books

Check:

- Copy Memory Books when branching was enabled before branch creation;
- it was a native SillyTavern branch;
- source books existed and could be loaded;
- chat was not switched during copying;
- the branch was not previously marked completed/failed;
- locked books were intentionally preserved rather than copied.

### 29.13 Narrator Mode cast is wrong

Check:

- Active Cast selection before generation;
- whether the message was a continuation that merged cast metadata;
- whether a swipe restored older cast state;
- whether the scene contains legacy untagged messages requiring confirmation;
- whether the declared character was retired;
- whether each character book still exists.

---

## 30. FAQ

### Do I need vectors?

No. Keyword activation is sufficient and is generated automatically. Vectors are optional.

### Should Memories use a separate lorebook?

Usually yes for organization, budgeting, reuse, and diagnosis, but it is not mandatory.

### Does STMB delete messages?

No. It can hide processed messages from active context.

### Can I use STMB entirely manually?

Yes. Mark scenes and create Memories only when desired.

### Can automatic Memories create the first Memory?

Yes in current STMB. With no processed baseline, it begins at message 0 once the interval plus buffer is met. A manual first run is still recommended to verify setup and choose the desired starting boundary.

### Does consolidation run automatically?

No. STMB can prompt when a tier is ready, but the user confirms and reviews the operation.

### Can one real group use one Memory Book?

Yes. It is the recommended starting setup and does not require STLO.

### When are separate real-group character books useful?

When individual continuity, knowledge, speaker-specific retrieval, or character-focused summaries justify the extra setup and AI requests.

### Is Narrator Mode the same as Group Chat Mode?

No. Group Chat Mode reads separate SillyTavern character-card authors. Narrator Mode manually declares fictional characters written by one Narrator card.

### Does Narrator Mode require STLO?

No for its active-cast retrieval path. It does require Manual Lorebook Mode, one omniscient book, and unique per-character books.

### Are linked copies synchronized?

No. They are linked for origin/consolidation metadata, not continuous mirroring.

### Why should Delay Until Recursion usually be off?

If no other lorebook entry starts recursion, a delayed Memory entry may never activate.

### What should a user do after the first successful Memory?

Verify entry retrieval, then enable automatic Memories, choose interval/buffer, enable token hiding, and add Clips or a narrowly defined Side Prompt only when needed. Use Topical Clip and Consolidation after enough Memories exist.

---

## 31. Compatibility, Migration, and Current Historical Notes

This section preserves only history that affects current use.

### Current baseline

- Current documented release: v8.5.0, August 1, 2026.
- SillyTavern requirement: 1.14.0 or later.
- Narrator Mode was added in v8.5.0.
- Branch book copying, Side Prompt regeneration, and character Memory Book locks were added in v8.4.0.
- Multi-character real-group Memory distribution arrived in v8.0.0.
- Additional Context moved from profiles to reusable per-chat Context Settings in v7.0.0; older profile context is migrated.
- Topical Clip was added in v6.10.0.
- Compaction and Clips were added in v6.6.0.
- Side Prompt Sets and per-prompt targets were added in the v6.4–v6.5 period.
- Consolidation became a multi-tier Arc-through-Epic system in v6.0.0; older Arc metadata is migrated.
- Job Queue integration was added in v6.8.0 and remains optional.
- Current profile defaults use Delay Until Recursion disabled unless a user/profile explicitly changes it.

### Existing Memories from older versions

Only entries with the `stmemorybooks` flag and required metadata are recognized as STMB Memories. Use the supplied lorebook converter for older entries that predate current metadata.

### Removed functionality

The old bookmark feature was removed from Memory Books in v4.0.0 and split away from the core extension. Do not teach Memory Books bookmark controls as current behavior.

### Localized built-ins

Built-in prompts can be regenerated according to the active SillyTavern language. Back up customized built-ins before recreation.

### Import behavior

Side Prompt import is additive. Existing prompts are preserved; imported key conflicts are renamed rather than overwriting the existing prompt.

---

## 32. Developer and License Notes

Memory Books uses Bun for bundling/minification.

Progress operations use `PROGRESS_TIMEOUT_MS` in `constants.js`, measured in milliseconds and set to `60_000` (60 seconds) by default. It limits settings save confirmation and read-back together, chat reads, chat metadata saves, and Apply's wait for an idle chat. Edit the constant and rebuild to change it; this is a source configuration, not a settings control.

```sh
bun run build
```

Install the repository’s pre-commit build hook with:

```sh
bun run install-hooks
```

The hook builds before commit, stages build artifacts, and aborts if the build fails.

Memory Books is Copyright © 2024–2026 Aiko Hanasaki and licensed under the GNU Affero General Public License v3.0. Modified versions must preserve applicable notices, identify modifications, and comply with AGPL source-availability requirements.

---

## 33. Compact Diagnostic Decision Tree

```text
User says “Memory Books is not working.”
│
├─ Is the menu/control visible?
│  ├─ No → installation/loading/UI checks.
│  └─ Yes
│
├─ Can a scene be selected?
│  ├─ No → expand message actions; set both chevrons; inspect overlap.
│  └─ Yes
│
├─ Is there a valid effective Memory Book?
│  ├─ No → bind, auto-create, select manual, or repair multi-book bindings.
│  └─ Yes
│
├─ Does generation return valid complete output?
│  ├─ No → profile, provider, output tokens, JSON schema, Regex, model.
│  └─ Yes
│
├─ Does the entry exist in the intended book?
│  ├─ No → save/rollback/permission/job failure.
│  └─ Yes
│
├─ Does SillyTavern activate and send it later?
│  ├─ No → keywords, activation mode, book binding, budget, recursion, STLO.
│  └─ Yes
│
└─ Does the model use the supplied entry?
   ├─ No → model compliance, placement, competing context, entry clarity.
   └─ Yes → workflow is functioning.
```

---

## 34. Minimum Recommended Teaching Sequence

For a new user, teach only this sequence first:

1. Open the magic-wand menu and find Memory Books.
2. Use Automatic Mode with a bound book or enable Auto-Create.
3. Select Current SillyTavern Settings.
4. Expand message actions and mark a short complete scene with **►** and **◄**.
5. Create and preview one Memory.
6. Open the Memory Book and verify the saved entry.
7. Verify that the entry can activate later.
8. Enable automatic Memories and choose interval/buffer.
9. Enable auto-hide only after explaining that hidden messages are not deleted.
10. Introduce Clips, then Side Prompts, then Topical Clip/Consolidation only when the user has a concrete need.

Do not begin with custom prompts, Full Manual endpoints, multiple character books, Regex, or consolidation unless the user’s actual problem requires them.

---

## 35. Final Concept Summary

Memory Books is an external continuity pipeline built on SillyTavern lorebooks:

```text
Select or schedule chat material
→ generate a structured representation
→ save it with retrieval metadata
→ optionally hide processed transcript
→ let SillyTavern retrieve relevant entries later
```

The system works best when:

- scenes are coherent;
- prompts clearly distinguish target from reference context;
- JSON workflows return exact schemas;
- keywords are concrete;
- Memory Books are deliberately assigned and activated;
- long-running trackers prune stale state;
- consolidation reduces old detail without erasing continuity;
- users verify retrieval rather than assuming saved means sent;
- advanced multi-book routing is used only when its precision is worth the complexity.
### Side Prompt version history

Enable **Enable sideprompt versioning** in **Trackers & Side Prompts**, then enable **Save all versions** on each ordinary Side Prompt that should retain history. Both settings default to off. The template setting is retained by editing, duplication, import, and export; Memory Assistance does not support version history.

Each successful run is kept in its target lorebook as `Title-001 (STMB SidePrompt)`, then `002` and later versions. Existing unnumbered output is adopted as `001` when history is first enabled. Older versions are disabled and the newest is enabled. Versions share a sanitized Side Prompt/chat inclusion group; changing a display name updates that group on a later successful save. Streams are separated by template, chat, resolved title override, and target lorebook.

If either setting is disabled, STMB updates the newest output in place and keeps the retained history. Regeneration updates its selected entry rather than appending a version. Rollback uses its existing snapshots and enables the newest surviving version after a successful restoration. Ambiguous legacy output is not changed. Failed, blank, canceled, or rejected runs do not create history.

STMB serializes its participating lorebook writes in one browser tab. SillyTavern's existing concurrent-save limitation still applies to other clients and direct editor saves.

### Archive Lore: focused retrieval and original-sentence selection

This applies to Archive Lore's separate controller (`lore-controller.js`), in both browser and optional server execution. Dialogue search embeds the latest visible user message separately from a bounded recent context. Question search additionally generates focused questions. Candidate selection reserves half its slots for the latest-user search and, in question mode, a quarter for generated-question search; remaining slots use weighted reciprocal ranks. A soft two-chunk-per-entry limit keeps a long record from crowding out other events, with a fallback when too few distinct records are available. The selected recent-message count still governs the dialogue supplied for AI review; the compact context used for vector search is separate.

The selector returns original unit IDs with priority 3 (direct missing fact or essential continuity constraint) or 2 (indispensable supporting context), plus a short reason. Merely similar scenes and facts already supplied in recent dialogue should be omitted. A review batch accepts at most 24 unique valid selections. Priority 3 is fitted before priority 2 across all batches; supporting context alone is not injected if no direct fact survives. An empty selection is valid. Existing custom prompts remain editable, and legacy ordered `ids` responses remain supported. Only exact untouched prior default prompts migrate automatically.

Embedding chunk text and cache keys retain their existing format. Review reconstructs complete original sentences, repairing time/abbreviation/decimal boundaries without re-embedding stored records. A complete sentence spanning cached chunks is offered once. Very long sentences retain the existing bounded subdivision behavior. No source lorebook content is rewritten.

Diagnostics include the latest-user query, bounded context, per-lane ranks, actual offered candidates, per-selection reasons/priorities, batch counts, and budget exclusions. Candidate membership can differ from the first N fused ranks because of reserved lanes and diversity. These changes improve focus but do not guarantee model relevance; validate with actual RP traces. Update both the extension and optional server copy and restart SillyTavern when using server execution. Server 0.3.3 contains this retrieval change.

### Archive Lore: plain embeddings, attribution context and timing (server 0.3.4)

The search selector now offers **일반 임베딩** (plain embeddings) alongside dialogue and question search. It embeds the bounded recent dialogue, ranks stored non-core chunks by cosine similarity (maximum over query chunks), and injects whole source-sentence groups in descending score order within the candidate and token limits. It never calls a question planner or selection model and requires no completion profile, including on the optional server. Query embedding still uses the configured embedding API. Collection remains an AI operation. Missing document embeddings are reported, not silently generated or replaced by lexical/AI search. Existing cached embeddings remain compatible. Similarity alone does not establish relevance; no score threshold beyond positive cosine similarity is imposed.

For swipe/regenerate recall, the last visible assistant answer being replaced is excluded from both vector queries and AI review. The full saved chat remains unchanged and is still used for stale-snapshot validation. Continuation and manual previews retain the existing answer.

AI modes also review adjacent chunks of candidate entries, keeping entries together within the review budget and overlapping up to eight source units across unavoidable large-entry batch boundaries. This can increase review input/batches but does not add a separate verification AI pass. The selector may return `contextIds` (up to eight valid IDs from the same entry) to preserve a fact's owner, referent, conditions or contrasting counterpart. The final budget keeps the original fact with its required sentences as an atomic group, or omits the group. The same rule is applied when the client re-counts server results with its tokenizer. This is a fidelity safeguard, not a guarantee of semantic correctness. User-authored prompts and legacy `ids` replies still work; legacy replies cannot specify dependencies.

Malformed selection JSON/schema is retried once per batch. A valid empty selection is not retried. API/network errors and cancellation are not retried by this mechanism. Diagnostics retain both attempts. Recent recall displays total preparation time and planner, embedding and selector durations; the generation interceptor records elapsed time through prompt installation. Server processing time and client end-to-end time are separate. These durations exclude subsequent RP answer generation. Diagnostic counts and TXT filtering include plain embedding mode. Update both extension and optional server checkout and restart SillyTavern for server changes.


### Archive Lore: saved connections and prompt recovery

In Archive Lore → Settings, **수집·통합·사이드 AI** selects an existing SillyTavern Chat Completion connection profile for the default collection configuration. Its saved model and credentials are used without changing the active RP connection. Side prompts with explicit connection overrides retain their own settings. Existing manual connection settings remain under the advanced section of the profile editor.

In **통합 프롬프트**, **기본 통합 프롬프트 복원** restores only the shipped `arc_default` prompt and selects it as the default after confirmation; other custom and edited presets are preserved. It does not recover deleted custom text. Korean-named summary and consolidation prompts now receive nonempty IDs, and legacy empty-ID entries can be edited or deleted.


### Archive Lore: collection home and English defaults

The home header keeps the destination Memory Book, collection profile, saved AI connection and next message range visible across tabs. **변경** selects another existing book using the current chat-bound/manual mode; it does not move or delete stored entries. Selecting a collection profile makes it the default for subsequent collection. **편집** and **추가** open native profile workflows.

**지금 수집** (also `/al-collect` without arguments) collects from the saved checkpoint + 1 through the current last message. **범위 지정·지난 대화 수집** remains available for explicit ranges and batches. Successful writes advance the chat checkpoint; reprocessing older ranges does not move it backwards. Failed/cancelled collection does not advance it. A cancelled post-save side task does not undo an already saved memory. Existing pending server progress and rollback handling still apply. If an explicit range skips earlier messages, next collection follows its end; it does not automatically fill earlier gaps.

In the fork, built-in summary/consolidation/side prompt instructions are English, with English saved output requested and Korean UI retained. Existing exact, unmodified stock prompts in the current locale are converted. Edited/custom/imported instructions are preserved. The six migrated Archive Lore side categories remain Relationship, Promises & Agreements, Preferences & Habits, Feelings & Reasons, Relationship Turning Points, and Unresolved Issues & Plans.


### Archive Lore event title format

The title format selector includes **아카이브 로어 · [번호] 작중 날짜 · 사건 제목** (`[[000]] {{archiveLoreTitle}}`). Selecting it adds an English title instruction to memory collection without changing the JSON schema: the AI returns the event's established fictional date and a short English title; the extension adds the sequence number. Unknown dates are omitted. Date ranges are allowed when established in the collected scene. This is AI extraction, not a calendar calculation; generated dates should be checked against the source. Existing profiles are not switched automatically. Native `{{date}}` and `{{time}}` still refer to real-world creation time. Existing stored titles are not renamed.

The fork-only “기본 통합 프롬프트 복원” shortcut has been removed from the consolidation prompt manager. Native built-in prompt recreation and JSON import/export remain available.


Archive Lore collection confirmation (including advanced profile changes) displays the explicitly bound SillyTavern connection profile name and its saved model. It no longer labels such a binding as the current RP model. Unavailable bindings are shown as requiring attention, not as an automatic fallback. This change affects the display only; explicit binding requests still use their saved model and fail without falling back to the RP connection. Temperature remains governed by the existing collection/current-ST temperature setting.

### Archive Lore migrated side-record output

The six migrated side templates use readable English records, not the original standalone extension's JSON delta schema. On load, the fork adapts imported templates marked `archiveLoreSetOnly` when they have no custom response format: exact stock JSON instructions and the obsolete migration adapter are removed, and a complete-record response format is installed. Custom category instructions and explicitly customized response formats are retained. Native Memory Books templates are unaffected.

Relationship uses a short label and preserves supported phase dates. Other categories use factual bullets. Unchanged facts are retained without a no-change scene report; categories without established facts use `Not established.` (relationship: `Undefined`). The next run is instructed to render facts from existing JSON records into readable text. Existing lorebook contents are not rewritten on extension update. The output guard rejects JSON/code fences and recognized no-change commentary before saving, without an extra AI retry. This validates format, not factual accuracy. Explicitly customized response formats do not use the plain-record guard.

Hidden messages: ordinary range collection excludes hidden messages unless **General Settings → Token Saving → Unhide hidden messages for memory generation** is enabled. This existing option executes `/unhide X-Y` before collecting; it changes visibility, rather than reading hidden messages invisibly. Subsequent hiding follows the existing automatic-hide configuration.


### Archive Lore: detailed setting explanations

Archive Lore adds Korean, UI-only explanations for the native collection/profile,
automation/hiding/rollback, prompt, side-record, consolidation/compaction/clip,
context, and search/embedding settings. Dynamic side set rows and range inputs are
covered too. The descriptions explain the role, effect and important distinctions;
they never enter generation prompts or alter a setting's value.

- **Location:** Archive Lore home → Settings → **자세한 설명 표시**. The same
  switch is available in the extension drawer and search settings dialog.
- **Default:** on. The preference is saved as
  `STMemoryBooks.moduleSettings.archiveLoreDetailedHelp` and applies to newly opened
  panels. Visible copies of the switch stay synchronized.
- Off hides optional setting/feature guidance only. Errors, progress, warning
  blocks and destructive-action confirmations remain visible. Native guidance
  carrying warning text/tooltips is retained.
- Native controls and their event listeners are preserved. A single child-list
  observer handles newly mounted/rebuilt setting panels; it ignores chat content,
  its own helper nodes and text-only streaming mutations. There are no timers or
  network requests for help.
- `npm run test:fork` checks static native-control guidance coverage; run
  `npm run test:fork:help` with the same Playwright runtime variables as
  `test:fork:browser` for native template/profile and search-dialog checks at
  320px, 390px and desktop widths. These check persistence, synchronized toggles,
  input preservation, warning visibility and duplicate-free dynamic updates.

### Archive Lore: settings persistence and post-save embedding

Native main/general/automatic dialogs now remember their last displayed/handled
control values. Refreshing or closing an old parent submits only edits made in
that dialog, preserving settings saved by a nested profile/settings editor. Live
native change handlers still own validation and saving; an unblurred edit is
flushed before opening another editor. Title controls are treated as a pair.
Custom titles accept the same nonempty formats as the native profile editor,
including `[0]` and `[00]`. Switching the active collection profile retains its own
title format instead of copying the preceding profile's form value.

Number discovery recognizes the rendered native numbering forms (`[000]` →
`001`, `[[000]]` → `[001]`, parentheses, braces and hash prefixes). Full numeric
story dates and times are excluded from fallback number discovery and regeneration
number extraction. A date-only imported title does not advance the counter to the
next year. Existing titles are not renamed; explicit numbering still determines
the next number, or 1 when no numbered memories exist.

**Search/embedding settings → 검색·주입 → 기억 저장·수정 후 자동 임베딩** defaults
on, and explicitly disabling it survives reloads. It requires search to be enabled
and valid embedding credentials (and the server plugin when server mode is on).
A connected book's save/update event schedules indexing after native work and RP
generation finish. Consecutive side-record saves coalesce. Only changed/missing
chunks of active nonconstant entries require embedding calls; constant entries
are already included directly. Failed requests leave saved memories intact and
can be retried with **남은 임베딩**. Enabling the switch alone does not backfill old
missing vectors. After native migration, search follows current native book
bindings instead of unioning an obsolete migration book snapshot.

Validation: `npm run test:fork`; `node tests/archive-lore-settings-save.mjs` uses
real native templates and change/save handlers with a stubbed ST host to test
nested saves, profile switches, custom titles and general/automatic setting
serialization. It uses the same Playwright runtime variables as the layout tests.
These are regression checks, not a live provider/Termux or every-feature parity
certification.


### Archive Lore: mobile controls, side automation and embedding status

The collection-profile heading now keeps **편집 / 추가** beside its title, with
its selector and optional explanation underneath. **현재 수집 프로필의 AI 연결**
is a shortcut for the same connection binding in the selected collection profile;
it is not an additional independent RP connection. Memory Assistance places its
selector/actions above the explanation on narrow screens.

The side manager provides **기억 수집 후 사이드 프롬프트 자동 실행**. This switch
is stored in the current chat's scene metadata and defaults on for existing chats.
Turning it off skips automatic after-memory side work, including retry scheduling,
without deleting records or changing each template's enabled/trigger settings.
Manual and interval-triggered side work remain separate. Already-started memory
jobs use their originating settings snapshot. Version management is independent:
new versions require both global version management and the template's save-all-
versions option; otherwise the latest record is updated.

**검색·주입 확인** shows completed/eligible lorebook entries and remaining entries,
for example **104/105 완료 · 남은 임베딩 1개**. An entry counts as complete only when
all its current chunks have vectors. Constant and disabled entries are excluded.
Opening this panel checks the count but does not itself start embedding. A failed
count check displays an error rather than zero remaining. Count refreshes coalesce
and run when work completes, not once for every chunk. Closing the panel removes
its subscriptions and does not cancel running work.

Server job-status requests (`/jobs/get`) allow 60 seconds and retry transient
network/timeout failures at most twice, after 1 and 2 seconds. This is a status-
request timeout, not a limit on the AI generation job. Retries use the same job ID;
an accepted job remains cancellable if status requests fail. No replacement job
is automatically submitted. Permanent errors are not retried. These changes do
not establish the cause of a particular Termux/server stall.

Validation includes unit tests for partial vector completion, persisted side
switches and skipped after-memory work, retry limits and chat-change protection;
the browser layout fixture checks mobile widths and larger text, profile action
placement, embedding counts and subscription disposal. Live provider and Termux
behavior still requires verification in the user's installation.


### Archive Lore: immediate home, shared destinations and appearance (2026-11-08)

The main wand menu now renders from settings, scene endpoints and saved progress.
It does not await scene compilation/tokenization, preset-file initialization or
manual-group filter reconciliation before displaying. The selected-scene token
estimate is loaded when its section is expanded (after the initial paint when
visible in Original mode). Preset text is loaded when View Prompt is expanded.
Late detail responses are ignored after closing, switching chats/profiles or
replacing the content. Collection still runs its full validation and compilation.

Open **설정 → 로어북 연결·테마** in the Archive Lore home. In Original mode, use
**아카이브 로어 추가 기능 → 로어북 연결·테마**. Choose **화면 구성** to switch screens immediately. Save destination/color changes
with **적용**. These are persistent extension settings, not chat metadata:

- **기존 메모리북 연결 방식** (default): preserves native chat/manual bindings,
  character locks and existing migration/search behavior.
- **채팅 로어북 따라가기**: follows the current chat's ST lorebook binding.
- **캐릭터의 월드 로어북 따라가기**: follows the solo character's primary world
  lorebook. A new chat with that character uses the same book. An absent binding
  or a group chat does not silently fall back to a different book.
- **지정한 월드 로어북 계속 사용**: uses one explicitly selected existing world
  lorebook across chats and characters. No new chat binding is required.

Explicit routes govern native collection, automatic collection, catch-up,
canonical memory lookup, tier counts, side-record defaults, review defaults and
Archive Lore retrieval. Explicit group/narrator member books remain additional
native destinations; side-record per-prompt overrides retain their native meaning.
Missing/unreadable routed books fail validation instead of auto-creating or
silently falling back to a chat book. Applying a route does not overwrite ST's
chat/world bindings. A manual character lock must be released before choosing an
explicit route. Destination changes are blocked during collection/search work.
A shared book shares stored memories; each chat still has its own collection
checkpoint. Existing memories are not moved or merged when changing this setting.

**아카이브 로어** keeps the three-tab home. **오리지널 메모리북** renders the native
Memory Books template, original controls/listeners and original footer buttons;
Archive Lore collection shortcuts, retrieval, migration and preferences are
appended separately. The original template is not run through the custom layout
or help-text transformations. Both layouts use the same settings and data.

Archive Lore palettes: **실리태번 기본**, **로즈**, **라벤더**, **세이지**,
**미드나잇**. Colors are scoped to extension popup surfaces. Original mode uses its own fixed
classic palette and retains the selected Archive Lore palette for later.
Update the extension and reload the page for the rebuilt native bundle. This
change requires no new server-plugin version.

Validation covers persistent/character/chat routing, missing-book rejection,
explicit member destinations, constant-time endpoint previews, original markup
and event preservation, palette persistence, mobile widths and stale lazy-load
results. Browser checks use a host-style fixture; live provider/Termux latency is
not simulated and no fixed opening time is promised.

#### Palette contrast correction

Custom palettes now own complete foreground/background pairs for inputs, native
selects, Select2 controls and action buttons (including Apply and the popup footer
Close button). Scoped overrides handle host styles that force white control
backgrounds with `!important`; inherited text fill and shadows cannot make these
controls white-on-white. Rose, Lavender and Sage use pastel action fills with dark
text. Midnight keeps its dark surface, adds dark input backgrounds with light
text, and uses blue action fills with dark text. Hover and keyboard focus remain
visible; disabled controls retain their disabled state and subdued appearance.
Text-only navigation remains transparent. Default ST continues inheriting the
host theme; Original MemoryBooks preserves upstream styling as documented below.

The browser regression fixture tests all four custom palettes against forced
light and dark host control styles, including footer buttons, input text fill,
hover, focus, disabled state, original/default isolation and at least 4.5:1 normal
text contrast for the tested action and input pairs. Only extension CSS changes
are required for this correction; update the extension and reload the page.


#### Original MemoryBooks screen switching

**화면 구성 → 오리지널 메모리북** now immediately saves the layout and opens a
fresh native Memory Books home, including its original template and footer
controls. This is separate from palette selection and does not need the shared
Apply button. Switching screens does not submit unsaved lorebook destination
choices. Original tools keep their listeners; Archive Lore additions remain in
the appended extra-tools section. Selecting Archive Lore again restores its
three-tab home and remembered palette. Dialog teardown is awaited, and a late
preference callback cannot close an unrelated newly opened home.

`npm run test:fork:layout-switch` exercises the production preference/open/close
functions with real templates and an asynchronous popup fixture: selecting each
layout, native action/footer presence, repeated round trips, close/reopen
persistence and unsaved routing isolation at mobile and desktop widths.


#### Original layout: preserve upstream styling

Original MemoryBooks retains its native template, controls and footer without an
Archive Lore color palette. The previous fork-specific dark gray surface and
orange controls have been removed: they were not the original extension's theme.
The supplied Memory Books 9.4.0 source uses SillyTavern theme variables and mixes
those values for individual panels. Original mode now leaves those values and
styles intact. Its marker class remains for layout/help isolation, while its
palette is `default`; custom color rules target only `.al-fork-surface`.

Archive Lore's four custom palettes and saved palette selection are unchanged.
Browser checks compare the original mode's computed panel, input and footer
colors with the upstream stylesheet under opposing host styles, and verify that
switching layouts restores the remembered Archive Lore palette. This restores
source styling; a user's previous appearance can still depend on their installed
SillyTavern theme or custom CSS.

### Archive Lore: event recall and pre-injection latency (2026-11-08)

- Question search now asks distinct English retrieval questions, matching the
  default archive summary language and preserving event qualifiers such as the
  first occurrence. Exact previous default question/selection prompts migrate
  to revision 4; user-edited prompts remain unchanged.
- AI-assisted search reserves up to a quarter of candidate slots for distinct
  records matching at least two informative query terms. Common names alone
  cannot reserve these slots. Vector searches fill the remaining slots, and the
  selector still decides whether any retrieved text belongs in the next reply.
  Embedding-only mode remains cosine-only. Stored document embeddings and their
  cache keys are unchanged; re-embedding is not required.
- Selector requests retain every offered source sentence, date/title, order and
  unit ID but use short entry aliases and omit repeated book paths and source
  fingerprints. Batches use this smaller representation for their size estimate.
  Original entry IDs and source provenance are restored through validated unit
  IDs, including dependent context during client token fitting. Every candidate
  batch is still reviewed; no speculative early-stop or extra concurrent AI
  requests are introduced. A question plan containing no questions returns core
  context without running vector searches or selection requests.
- Selection defaults ask for original conditions, actual actions and outcomes
  together, distinguish original events from subsequent reports and preserve
  source chronology. This improves available evidence but does not guarantee an
  RP model will follow it or eliminate invented details.
- Read-only recall/maintenance previews no longer reload books or emit book-edit
  notifications on completion. Repeated identical server progress messages do
  not rewrite the full persisted job. Collection and maintenance writes retain
  their synchronization and persistence behavior.
- Diagnostics include compact-selection batch/token counts and a
  `server.result-received` event before synchronization/token fitting. Recall
  timings include `clientStages` for restore, input preparation, submission,
  polling, polling sleeps, synchronization, stale-chat validation and token
  fitting. These distinguish server processing from later client delays; do not
  interpret cross-device timestamps as a precise latency measure when clocks
  are not synchronized.

Update both the extension and the server-plugin checkout, restart SillyTavern,
and refresh the browser. Server plugin version **0.3.8** includes these changes.

#### Memory selection emphasis

Search settings include a collapsible **기억 선별 중점** section with five optional,
independently selectable aspects: 애정·감정 (affection/emotions), 의미·관계 변화
(meaning/relationship changes), 약속·경계 (promises/boundaries), 취향·반응
(preferences/reactions), and 구체적 장면 (concrete scene details). The default is
an empty selection, retaining the existing automatic selector request. Clearing
all choices restores that behavior. These preferences are global search settings,
separate from side-record collection categories.

`selectionFocus` stores allowlisted, deduplicated IDs (`affection`, `meaning`,
`boundaries`, `preferences`, `details`). Empty choices preserve the previous
planner, search ranking, selector request and recalled-record formatting. They
still allow relevant emotional facts; no response guidance is added.

With choices enabled, question mode uses its existing planner call (maximum four
questions): a direct factual question followed by queries for the chosen aspects
of the same request. Dialogue mode adds one context-bound supplementary search;
a single-question plan also receives this fallback. An empty plan stays empty.
Supplementary query embeddings can add latency; no extra AI completion is added.
At most a third of candidate slots are reserved for aspect search; the remaining
slots retain direct-request coverage. Saved documents and embeddings are unchanged.

The original-unit selector keeps custom prompts and essential event context,
attribution, chronology, conditions, refusals and negation. It reports allowlisted
`focusMatches` and prioritizes supported reasons or turning points over repetitive
examples. Cross-batch ordering groups matching events within each fact priority.
No category is mandatory, and relevance to the current request remains primary.

A separate `archive-lore-guidance` prompt directs the RP model to emphasize the
chosen aspects supported by the recalled evidence, preserve character/user agency,
and avoid invented feelings, guessed elapsed years or treating temporary past
agreements as permanent. It is explicitly labeled as instructions, not historical
facts, and never becomes saved memory. The guidance and recalled text share the
existing injection-token cap (core remains separate as before). If no evidence is
selected, no guidance is injected; if guidance would crowd out all facts, it is
omitted. Server results are re-budgeted with the client's tokenizer while retaining
required context. Changing focus/mode during recall rejects stale results.

Plain embedding mode retains its original behavior and disables focus controls
without deleting saved choices. Diagnostics record choices, supplementary queries,
selection matches, separate prompt slots and token totals. The recall preview shows
response guidance separately. All prompt slots are cleared on cancellation/change.

Update both extension and server-plugin checkouts, restart SillyTavern to load
server plugin **0.3.10**, and reload the browser. Selection and final response remain
model-dependent. Offline regression tests verify requests, candidate coverage,
budgeting and injection wiring; they do not measure live provider latency or prove
that an RP model will follow every instruction.

#### Diagnostic export and completed-job memory (server 0.3.12)

Completed jobs retain only small history summaries in RAM. The original input,
result and maintenance draft remain on disk and are loaded when requested;
request-ID replay, draft application and source validation remain intact. On
restart, old jobs are also reduced to summaries instead of retaining every chat
snapshot. Successfully persisted diagnostic snapshots no longer stay in the
diagnostic module's fallback memory map.

The dashboard requests `/logs/list`, which reads only the compact JSON header
before `events` (at most 64 KiB per file). Diagnostic listing/export does not
initialize job history. `/logs/export` filters by the current chat and selected
mode, then streams complete diagnostic files in 64 KiB chunks with HTTP
backpressure. The browser downloads a Blob instead of parsing and re-stringifying
all server events. The legacy `/logs` URL streams the same JSON array for older
clients. Empty chat keys return no logs. Existing diagnostic files are neither
deleted nor truncated. Server dashboard rows show headers; TXT includes events.

Regression coverage includes 80 MiB of diagnostic bodies plus 80 MiB of stored job
inputs processed in a Node child with a 64 MiB heap; exported bytes are verified
by SHA-256. This verifies the bounded history/export paths, not a particular
Android device's overall RAM usage or unrelated extensions. Both the extension
and server-plugin copies need updating; restart SillyTavern and reload the page.

#### Completed-job recovery without a selected chat (server 0.3.11)

The home/recent-chats screen does not restore server jobs. A chat identity requires
both a selected character/group and a chat ID; a leftover ID is insufficient.
Restoration filters returned job summaries to the current chat key. The server
also treats an explicitly empty chat key as an empty list, not all chat histories.
This prevents startup/dashboard refreshes from reopening completed tasks belonging
to an old imported chat and reporting ENOENT while the user is elsewhere.

Completed collection/index history remains readable when its original chat file
is missing (including after rename). The response sets `sourceChatMissing` and
returns no hide flags; the client skips synchronization and repeated recovery for
that job during the session. Stored jobs, lorebooks and chats are not rewritten or
deleted. Other read/parse failures still surface, and new work still requires a
valid source chat. Update both checkouts, restart ST, and reload the browser.
