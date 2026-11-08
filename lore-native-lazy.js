// Archive Lore — AGPL-3.0-only. Opening a menu must not tokenize chat or load prompts.
export function scenePreview(markers, chat) {
    const start=markers?.sceneStart,end=markers?.sceneEnd;
    if(!Number.isInteger(start) || !Number.isInteger(end) || start<0 || end<start || !chat[start] || !chat[end])return null;
    const excerpt=m=>String(m.mes || '').slice(0,100)+(String(m.mes || '').length>100?'...':'');
    return {sceneStart:start,sceneEnd:end,startSpeaker:chat[start].name || 'Unknown',endSpeaker:chat[end].name || 'Unknown',startExcerpt:excerpt(chat[start]),endExcerpt:excerpt(chat[end]),messageCount:end-start+1,estimatedTokens:'…'};
}
export function mountLazyDetails(root, {loadPrompt,loadScene,isCurrent,hiddenSceneWarning}) {
    const prompt=root.querySelector('#stmb-summary-prompt');
    const tokens=root.querySelector('[data-al-scene-tokens]');
    function mount(node,load,render) {
        if(!node)return;
        const detail=node.closest('details');let running=false,done=false;
        const run=async()=>{
            if(done || running || !isCurrent() || (detail && !detail.open))return;
            running=true;node.textContent='확인 중…';
            try{const value=await load();if(isCurrent() && node.isConnected){render(value);done=true;}}
            catch(e){if(isCurrent() && node.isConnected)node.textContent='불러오기 실패 · 다시 펼치면 재시도합니다.';}
            finally{running=false;}
        };
        if(detail)detail.addEventListener('toggle',run);
        // Visible native scene stats load after the first paint, never before opening.
        if(!detail || detail.open)requestAnimationFrame(()=>requestAnimationFrame(()=>void run()));
    }
    mount(prompt,loadPrompt,value=>{prompt.textContent=value;});
    mount(tokens,loadScene,value=>{
        tokens.textContent=value?.estimatedTokens ?? '—';
        const box=tokens.closest('.stmb-box');
        if(value?.hasMostlyHiddenMessages && hiddenSceneWarning && box && !box.querySelector('.warning')){
            const warning=document.createElement('small');warning.className='warning';warning.textContent='⚠️ '+hiddenSceneWarning;box.append(warning);
        }
    });
}
