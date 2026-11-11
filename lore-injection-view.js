// Archive Lore — AGPL-3.0-only. Read-only display; never translate or search on open.
import { isCore, textUnits } from './lore-core.js';
import { linkedTranslation } from './lore-translations.js';

// Positional alignment is deliberately labelled as such, not semantic verification.
// A different line/sentence structure or partial sentence falls back to the source.
export function translatedExcerpt(settings, book, entry, excerpt) {
    const translation=linkedTranslation(settings,book,entry);
    if(!translation || translation.stale)return null;
    const source=String(entry.content).replace(/\r\n/g,'\n').trim();
    const wanted=String(excerpt).replace(/\r\n/g,'\n').trim();
    const target=translation.text.replace(/\r\n/g,'\n').trim();
    if(!wanted)return null;
    if(wanted===source)return {text:target,aligned:false};
    const start=source.indexOf(wanted);
    if(start<0 || source.indexOf(wanted,start+1)>=0)return null;
    const lines=source.split('\n'),translated=target.split('\n');
    if(lines.length!==translated.length)return null;
    const pairs=[];let offset=0;
    for(let i=0;i<lines.length;i++){
        const a=textUnits(lines[i],Number.MAX_SAFE_INTEGER),b=textUnits(translated[i],Number.MAX_SAFE_INTEGER);
        if(a.length!==b.length)return null;
        let cursor=0;
        for(let j=0;j<a.length;j++){
            const at=lines[i].indexOf(a[j],cursor);if(at<0)return null;
            pairs.push({start:offset+at,end:offset+at+a[j].length,text:b[j]});cursor=at+a[j].length;
        }
        offset+=lines[i].length+1;
    }
    const chosen=pairs.filter(p=>p.start>=start && p.end<=start+wanted.length);
    if(!chosen.length || chosen[0].start!==start || chosen.at(-1).end!==start+wanted.length)return null;
    // A cut inside a sentence must never expand to include unselected facts.
    if(pairs.some(p=>p.start<start+wanted.length && p.end>start && !chosen.includes(p)))return null;
    return {text:chosen.map(p=>p.text).join('\n'),aligned:true};
}

export async function injectionSnapshot({key,result,recall,settings,countTokens,time=new Date().toISOString()}) {
    const text=String(result?.text || ''),core=String(result?.core || ''),guidance=String(result?.guidance || '');
    const records=recall?.records || [],rows=[];
    const display=(row,original)=>({original,translation:row?translatedExcerpt(settings,row.book,row.entry,original):null});
    const coreRows=records.filter(row=>isCore(row.entry));
    if(core && coreRows.map(row=>row.entry.content).join('\n\n')===core){
        for(const row of coreRows)rows.push({title:row.entry.comment || '제목 없음',kind:'코어',parts:[display(row,row.entry.content)]});
    }else if(core)rows.push({title:'코어',kind:'코어',parts:[display(null,core)]});
    if(text && recall?.text===text && recall.units?.length){
        const groups=new Map();
        for(const unit of recall.units){if(!groups.has(unit.entryId))groups.set(unit.entryId,[]);groups.get(unit.entryId).push(unit);}
        for(const [id,units] of groups){
            const row=records.find(r=>r.id===id);
            rows.push({title:row?.entry.comment || units[0].title || '제목 없음',kind:'검색 기억',parts:units.slice().sort((a,b)=>a.index-b.index).map(unit=>display(row,unit.text))});
        }
    }else if(text)rows.push({title:'검색 기억',kind:'검색 기억',parts:[display(null,text)]});
    const tokens={};
    for(const [name,value] of Object.entries({core,memory:text,guidance}))tokens[name]=value?await countTokens(value):0;
    tokens.total=tokens.core+tokens.memory+tokens.guidance;
    // Keep the planner's exact output with this turn, never the current settings
    // or dialogue search text. Older snapshots simply have no questions field.
    const questions=recall?.mode==='questions' && recall.text===text && Array.isArray(recall.questions)
        ? recall.questions.filter(q=>typeof q==='string' && q.trim()) : [];
    return {version:1,key,time,text,core,guidance,rows,tokens,questions};
}

// Store only one compact display per chat. Asynchronous token counting must not
// overwrite a newer turn, another chat, or a disabled viewer.
export function createInjectionRecorder({enabled,key,read,write,settings,countTokens,onError=()=>{}}) {
    let epoch=0,staged=null;
    return {
        invalidate(){epoch++;staged=null;},
        stage(result,recall){staged=enabled()?{key:key(),result:structuredClone(result),recall:structuredClone(recall)}:null;},
        commit(dryRun=false){
            if(dryRun || !staged)return;
            const value=staged;staged=null;
            if(value.key===key())return this.capture(value.result,value.recall);
        },
        read(){const value=read();return value?.version===1 && value.key===key()?value:null;},
        async capture(result,recall){
            const attempt=++epoch,current=key();
            if(!enabled() || !current || result?.deferred)return;
            try{
                const snapshot=await injectionSnapshot({key:current,result,recall:structuredClone(recall),settings:settings(),countTokens});
                if(attempt===epoch && current===key() && enabled())await write(snapshot);
            }catch(error){onError(error);}
        },
    };
}

export function createInjectionView(snapshot,doc=globalThis.document) {
    const node=doc.createElement('div');node.className='al-search-tools al-injection-view';
    const add=(parent,tag,text)=>{const el=doc.createElement(tag);el.textContent=text;parent.append(el);return el;};
    add(node,'h3','직전 주입 내용');
    if(!snapshot){add(node,'p','아직 기록된 주입 내용이 없습니다. 주입 내용 보기를 켠 뒤 새 답변을 생성해 주세요.');return node;}
    add(node,'p',`${snapshot.tokens.total.toLocaleString()}토큰 · ${new Date(snapshot.time).toLocaleString()}`);
    add(node,'small',`아카이브 로어 원문 기준 · 코어 ${snapshot.tokens.core} · 검색 기억 ${snapshot.tokens.memory} · 답변 안내 ${snapshot.tokens.guidance}`);
    if(snapshot.questions?.length){
        const block=add(node,'details','');add(block,'summary',`이번 검색 질문 · ${snapshot.questions.length}개`);
        for(const question of snapshot.questions)add(block,'pre',question);
    }
    if(!snapshot.text && !snapshot.core && !snapshot.guidance)add(node,'p','이번에는 아카이브 로어가 주입한 내용이 없습니다.');
    for(const row of snapshot.rows){
        const section=add(node,'section','');add(section,'h4',row.title);add(section,'small',row.kind);
        for(const part of row.parts){
            if(part.translation){
                add(section,'small',part.translation.aligned?'저장된 번역 · 문장 순서 기준':'저장된 번역');
                add(section,'pre',part.translation.text);
                const original=add(section,'details','');add(original,'summary','실제 주입 원문');add(original,'pre',part.original);
            }else add(section,'pre',part.original);
        }
    }
    if(snapshot.guidance){const block=add(node,'details','');add(block,'summary','답변 안내');add(block,'pre',snapshot.guidance);}
    const raw=add(node,'details','');add(raw,'summary','전체 주입 원문');
    for(const [label,value] of [['코어',snapshot.core],['검색 기억',snapshot.text],['답변 안내',snapshot.guidance]])if(value){add(raw,'h4',label);add(raw,'pre',value);}
    return node;
}

export function mountInjectionPreference(root,{settings,save,changed}) {
    const anchor=root?.querySelector('#al-show-scene-buttons')?.closest('label');
    if(!anchor || root.querySelector('#al-show-injection'))return;
    const doc=root.ownerDocument || root,row=doc.createElement('label'),input=doc.createElement('input'),text=doc.createElement('span');
    row.className='checkbox_label';input.type='checkbox';input.id='al-show-injection';
    input.checked=settings.moduleSettings?.archiveLoreShowInjection===true;text.textContent='주입 내용 보기';
    row.append(input,text);anchor.after(row);
    input.onchange=()=>{settings.moduleSettings ||= {};settings.moduleSettings.archiveLoreShowInjection=input.checked;save();changed?.();};
}

export function mountInjectionMenu({root,enabled,open,onError=()=>{}}) {
    if(!root)return;
    root.querySelector('#archive-lore-injection-menu')?.remove();
    if(!enabled)return;
    const node=root.ownerDocument.createElement('div');node.id='archive-lore-injection-menu';
    node.className='list-group-item flex-container flexGap5 interactable';node.tabIndex=0;node.setAttribute('role','button');
    const icon=root.ownerDocument.createElement('i');icon.className='fa-solid fa-file-lines';
    const text=root.ownerDocument.createElement('span');text.textContent='주입 내용 보기';node.append(icon,text);
    const run=()=>Promise.resolve().then(open).catch(onError);
    node.onclick=run;node.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void run();}};
    root.append(node);
}
