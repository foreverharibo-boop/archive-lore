// Archive Lore — AGPL-3.0-only.
export function englishPrompt(text) {
    return text + '\n\nWrite titles, summaries, narrative content and keywords in English regardless of the interface or dialogue language. Preserve proper names and exact evidence quotations. Keep the required JSON keys and schema unchanged.';
}
// Only exact stock texts may change automatically. Preserve edited and imported prompts.
export function migrateUneditedDefaults(data,localized,english) {
    const next=structuredClone(data);let changed=false;
    for(const [key,prompt] of Object.entries(localized)){
        const entry=next.overrides?.[key];
        if(entry?.prompt===prompt && english[key] && entry.prompt!==english[key]){
            entry.prompt=english[key];changed=true;
        }
    }
    return changed?next:null;
}
export function migrateUneditedSideDefaults(data,localized,english) {
    const next=structuredClone(data);let changed=false;
    for(const [key,stock] of Object.entries(localized)){
        const entry=next.prompts?.[key],target=english[key];
        if(!entry || !target)continue;
        for(const field of ['prompt','responseFormat']){
            if(entry[field]===stock[field] && typeof target[field]==='string' && entry[field]!==target[field]){entry[field]=target[field];changed=true;}
        }
        if(entry.settings?.suggestionsPrompt===stock.settings?.suggestionsPrompt && target.settings?.suggestionsPrompt && entry.settings.suggestionsPrompt!==target.settings.suggestionsPrompt){entry.settings.suggestionsPrompt=target.settings.suggestionsPrompt;changed=true;}
    }
    return changed?next:null;
}
