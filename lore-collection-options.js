// Archive Lore — AGPL-3.0-only. Collection overrides never rewrite saved profiles.
export function collectionOptions(moduleSettings = {}, fork = false) {
    return {
        fixedOrder: fork && moduleSettings.archiveLoreCollectionOrder100 === true,
        skipKeywords: fork && moduleSettings.archiveLoreCollectionNoKeywords === true,
    };
}

export function withoutCollectionKeywords(prompt) {
    return `${prompt}\n\nCOLLECTION KEYWORD OVERRIDE\nDo not generate activation keywords. Ignore earlier keyword-generation instructions and examples. Keep the required JSON structure, but return "keywords": [] for every memory, including every date group. Preserve all requested detail in the memory content.`;
}

export function collectionSchemaWithoutKeywords(schema) {
    const copy = structuredClone(schema);
    const memory = copy.value.properties.memories?.items || copy.value;
    memory.properties.keywords.maxItems = 0;
    memory.properties.keywords.description = 'Return an empty array. Keyword generation is disabled.';
    return copy;
}

export function applyCollectionMemoryOptions(memory, options) {
    if (!options.fixedOrder && !options.skipKeywords) return memory;
    const result = { ...memory };
    if (options.fixedOrder) result.lorebookSettings = { ...memory.lorebookSettings, orderMode: 'manual', orderValue: 100 };
    if (options.skipKeywords) {
        result.suggestedKeys = [];
        result.lorebook = { ...memory.lorebook, key: [], keysecondary: [] };
    }
    if (memory.dateMemories) result.dateMemories = memory.dateMemories.map(item => applyCollectionMemoryOptions(item, options));
    return result;
}

export function applyCollectionEntryOptions(entry, options) {
    if (options.fixedOrder) entry.order = 100;
    if (options.skipKeywords) {
        entry.key = [];
        entry.keysecondary = [];
    }
}

export function mountCollectionPreferences(root, { settings, save, translate = text => text }) {
    const anchor = root?.querySelector('#stmb-allow-scene-overlap')?.closest('label');
    if (!anchor || root.querySelector('#al-collection-options')) return;
    const doc = root.ownerDocument, box = doc.createElement('div');
    box.id = 'al-collection-options';
    box.className = 'world_entry_form_control marginTop10';
    const fields = [
        ['archiveLoreCollectionOrder100', 'al-collection-order-100', 'ArchiveLore_CollectionOrder100', '수집 시 순서를 항상 100으로 고정',
            'ArchiveLore_CollectionOrder100Help', '일반·자동·날짜별 수집에 프로필의 순서 설정보다 우선 적용합니다. 기존 항목의 순서는 바꾸지 않습니다.'],
        ['archiveLoreCollectionNoKeywords', 'al-collection-no-keywords', 'ArchiveLore_CollectionNoKeywords', '수집 시 키워드 생성 안 함',
            'ArchiveLore_CollectionNoKeywordsHelp', '새 수집의 키워드 생성을 요청하지 않고 빈 키워드로 저장합니다. 기존 항목의 키워드는 바꾸지 않습니다.'],
    ];
    for (const [key, id, labelKey, label, helpKey, help] of fields) {
        const row = doc.createElement('label'), input = doc.createElement('input'), text = doc.createElement('span'), hint = doc.createElement('small');
        row.className = 'checkbox_label'; input.type = 'checkbox'; input.id = id;
        input.checked = settings.moduleSettings?.[key] === true;
        text.textContent = translate(label, labelKey);
        hint.textContent = translate(help, helpKey); hint.className = 'opacity50p'; hint.id = `${id}-help`;
        input.setAttribute('aria-describedby', hint.id);
        row.append(input, text); box.append(row, hint);
        input.onchange = () => {
            settings.moduleSettings ||= {};
            settings.moduleSettings[key] = input.checked;
            save();
        };
    }
    anchor.before(box);
}
