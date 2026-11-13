// Archive Lore © 2026 foreverharibo-boop — AGPL-3.0-only
import {fitInjection,estimateTokens} from './lore-core.js';
import {normalizeSelectionFocus,responseFocusGuidance} from './lore-selection-focus.js';

export async function fitFocusedInjection(units,config,countTokens=estimateTokens) {
    const focus=config.mode==='embedding'?[]:normalizeSelectionFocus(config.selectionFocus);
    const guidance=responseFocusGuidance(focus),budget=config.injectionTokens;
    const guidanceTokens=await countTokens(guidance);
    let fitted=await fitInjection(units,Math.max(0,budget-guidanceTokens),countTokens);
    // Count the combined text as well as the separate prompt slots. Some host
    // tokenizers charge differently around boundaries; never exceed the cap.
    while(fitted.units.length){
        const total=Math.max(fitted.tokens+guidanceTokens,await countTokens(fitted.text+'\n\n'+guidance));
        if(total<=budget)return {...fitted,guidance,guidanceTokens,memoryTokens:fitted.tokens,tokens:total};
        const reduced=await fitInjection(fitted.units,Math.max(0,fitted.tokens-(total-budget)-1),countTokens);
        if(reduced.units.length>=fitted.units.length)break;
        fitted=reduced;
    }
    // Never inject guidance alone, or sacrifice every fact to instruction text.
    const facts=await fitInjection(units,budget,countTokens);
    return {...facts,guidance:'',guidanceTokens:0,memoryTokens:facts.tokens,guidanceOmitted:facts.units.length?'budget':'no-memory'};
}
