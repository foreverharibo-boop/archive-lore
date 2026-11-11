// Archive Lore — AGPL-3.0-only. UI-only guidance; never changes generation settings.
import { helpFor } from './lore-help-catalog.js';

const SURFACE='.al-fork-surface,.al-search-tools,.al-fork-settings,.al-settings,.al-settings-dialog,.al-help-surface';
const CONTROL='input:not([type=hidden]):not([type=file]),select,textarea';
const MARKER='[id^="stmb-"],[data-memory-reminder],#al-native-connection';
const OWN='[data-al-help],.al-help-switch';
const SAFE_NOTE='[data-i18n],.al-feature-card>small,.al-home-intro,.stmb-help-drawer,.al-native-connection>small,label:has(#al-native-connection)>small';

/** One observer for newly mounted setting panels. No polling, network or chat scans. */
export function installSettingsHelp({document:doc=globalThis.document,read,write}) {
    let enabled=read()!==false,serial=0,queued=false,stopped=false;
    const pending=new Set(),attached=new WeakMap();
    function sync() {
        doc.documentElement.classList.toggle('al-detailed-help-off',!enabled);
        for(const input of doc.querySelectorAll('[data-al-help-toggle]'))input.checked=enabled;
    }
    function toggleAt(host) {
        if(!host || host.querySelector(':scope > .al-help-switch'))return;
        const box=doc.createElement('div');box.className='al-help-switch';
        const label=doc.createElement('label'),input=doc.createElement('input'),text=doc.createElement('span');
        input.type='checkbox';input.dataset.alHelpToggle='';input.checked=enabled;
        text.textContent='자세한 설명 표시';label.append(input,text);
        const note=doc.createElement('small');note.textContent='각 설정의 역할과 차이를 표시합니다. 꺼도 오류·진행 상태·삭제 경고는 유지됩니다.';
        input.addEventListener('change',event=>{event.stopPropagation();enabled=input.checked;write(enabled);sync();});
        box.append(label,note);host.prepend(box);
    }
    function annotate(root) {
        if(!root.isConnected || stopped || root.closest('.al-original-memorybooks'))return;
        for(const host of root.querySelectorAll('.al-home-pane[data-home-pane="settings"],.al-fork-settings .inline-drawer-content,.al-settings'))toggleAt(host);
        if(root.matches('.al-settings'))toggleAt(root);
        if(root.matches('.al-fork-settings'))toggleAt(root.querySelector('.inline-drawer-content'));
        for(const control of root.querySelectorAll(CONTROL)) {
            if(control.closest(OWN))continue;
            const text=helpFor(control);if(!text)continue;
            if(attached.get(control)?.isConnected)continue;
            // Labels retain their native controls/listeners; helper text is not a clickable label action.
            const label=control.closest('label');
            if(label && root.contains(label))label.classList.add('al-help-label');
            const note=doc.createElement('span');note.dataset.alHelp='';note.className='al-setting-help';
            note.id=`al-setting-help-${++serial}`;note.textContent=text;
            note.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
            const group=control.type==='radio' && control.name ? label?.parentElement : null;
            const peers=group ? [...group.querySelectorAll('input[type=radio]')].filter(peer=>peer.name===control.name && helpFor(peer)===text) : [control];
            if(group && peers.length>1){group.classList.add('al-help-radio-group');group.append(note);}
            else if(label && root.contains(label) && ['checkbox','radio'].includes(control.type))label.append(note);
            else control.after(note);
            for(const peer of peers.length?peers:[control]) {
                const ids=(peer.getAttribute('aria-describedby') || '').split(/\s+/).filter(id=>id && !id.startsWith('al-setting-help-'));
                peer.setAttribute('aria-describedby',[...ids,note.id].join(' '));attached.set(peer,note);
            }
        }
        // Only unmistakable explanatory text is optional. Statuses, warnings and confirmations stay.
        for(const note of root.querySelectorAll(SAFE_NOTE)) {
            const key=note.getAttribute('data-i18n') || '';
            if(note.closest('[role=status],[role=alert],.warning,.al-help-switch') || /warn|error|delete|confirm/i.test(key))continue;
            if(note.hasAttribute('data-i18n') && !/(?:Desc|Help|Hint|Explanation)(?:;|$)/.test(key))continue;
            if(note.querySelector('input,select,textarea,button'))continue;
            note.classList.add('al-optional-help');
            const field=note.closest('label,.world_entry_form_control,.al-native-connection');
            if(field?.querySelectorAll('[data-al-help]').length===1)note.classList.add('al-help-replaced');
        }
    }
    function schedule(root) {
        if(!root || stopped)return;
        pending.add(root);
        if(queued)return;queued=true;
        queueMicrotask(()=>{queued=false;const roots=[...pending];pending.clear();for(const root of roots)annotate(root);});
    }
    function discover(node) {
        if(node.nodeType!==1 || node.closest('#chat,.al-original-memorybooks') || node.closest(OWN))return;
        const existing=node.closest(SURFACE);
        if(existing){schedule(existing);return;}
        for(const root of node.querySelectorAll(SURFACE))schedule(root);
        const marker=node.matches(MARKER)?node:node.querySelector(MARKER);
        const popup=marker?.closest('dialog,.popup');
        if(popup){popup.classList.add('al-help-surface');schedule(popup);}
    }
    const Observer=doc.defaultView.MutationObserver;
    const observer=new Observer(records=>{
        for(const record of records)for(const node of record.addedNodes)discover(node);
    });
    observer.observe(doc.body,{childList:true,subtree:true});
    for(const root of doc.querySelectorAll(SURFACE))schedule(root);
    for(const popup of doc.querySelectorAll('dialog,.popup'))discover(popup);
    sync();
    return {refresh:discover,dispose(){stopped=true;observer.disconnect();pending.clear();}};
}
