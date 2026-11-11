// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const source = read('./addlore.js');
function extract(name, async = false) {
    const start = source.indexOf(`${async ? 'async ' : ''}function ${name}(`);
    assert(start >= 0);
    return source.slice(start, source.indexOf('\n}\n', start) + 2);
}
function harness() {
    const messages = Array.from({length:30}, (_,i)=>({mes:`message ${i}`,is_system:false}));
    const state = { ctx:{chat:messages}, calls:[], warnings:[], fail:false, noop:false };
    const scope = { getContext:()=>state.ctx, MODULE_NAME:'test', console:{warn(){}},
        toastr:{warning:(...args)=>state.warnings.push(args)},
        hideChatMessageRange:async(start,end,unhide)=>{
            state.calls.push({start,end,unhide});
            if(state.fail) throw Error('save failed');
            if(!state.noop) for(let i=start;i<=end;i++)state.ctx.chat[i].is_system=!unhide;
        },
    };
    vm.createContext(scope);
    vm.runInContext(read('./lore-auto-hide.js').replace(/^import .*;\n/gm,'').replace('export async function','async function'),scope);
    vm.runInContext(['parseSceneRange','getAutoHideMode','getAutoHideRanges'].map(n=>extract(n)).join('\n')+'\n'+extract('applySavedMemoryAutoHide',true),scope);
    return {state,scope,messages};
}

test('save through message 19 with keep 8 hides 0-11 and leaves newer uncollected messages visible',async()=>{
    const {scope,state,messages}=harness();
    assert.equal(await scope.applySavedMemoryAutoHide({metadata:{sceneRange:'10-19'}},{autoHideMode:'all',unhiddenEntriesCount:8}),true);
    assert(messages.slice(0,12).every(m=>m.is_system));
    assert(messages.slice(12).every(m=>!m.is_system));
    assert.equal(state.calls.length,1);
    await scope.applySavedMemoryAutoHide({metadata:{sceneRange:'10-19'}},{autoHideMode:'all',unhiddenEntriesCount:8});
    assert.equal(state.calls.length,1);
});
test('result cards receive actual newly hidden counts and separate failure/off outcomes',async()=>{
    const {scope,state,messages}=harness();let receipt;
    const memory={metadata:{sceneRange:'10-19'}},settings={autoHideMode:'all',unhiddenEntriesCount:8};
    const report=value=>receipt=value;
    await scope.applySavedMemoryAutoHide(memory,settings,messages,report);
    assert.equal(receipt.status,'done');assert.equal(receipt.changed,12);assert.equal(receipt.keep,8);
    await scope.applySavedMemoryAutoHide(memory,settings,messages,report);assert.equal(receipt.changed,0);
    messages[0].is_system=false;state.fail=true;
    assert.equal(await scope.applySavedMemoryAutoHide(memory,settings,messages,report),false);assert.equal(receipt.status,'failed');
    await scope.applySavedMemoryAutoHide(memory,{autoHideMode:'none'},messages,report);assert.equal(receipt.status,'off');
});

test('last-only mode, none, zero keep and a scene shorter than keep respect their boundaries',async()=>{
    for(const [mode,keep,start,end] of [['last',8,10,11],['all',0,0,19],['none',0,null,null],['last',20,null,null]]){
        const {scope,state}=harness();
        await scope.applySavedMemoryAutoHide({metadata:{sceneRange:'10-19'}},{autoHideMode:mode,unhiddenEntriesCount:keep});
        assert.equal(state.calls.length,start===null?0:1);
        if(start!==null){assert.equal(state.calls[0].start,start);assert.equal(state.calls[0].end,end);}
    }
});

test('changed chat, native save failure and silent no-op are reported without treating memory storage as failed',async()=>{
    for(const failure of ['chat','save','noop','range']){
        const {scope,state,messages}=harness();
        if(failure==='chat') state.ctx={chat:[{mes:'other chat'}]};
        if(failure==='save') state.fail=true;
        if(failure==='noop') state.noop=true;
        assert.equal(await scope.applySavedMemoryAutoHide({metadata:{sceneRange:failure==='range'?'bad':'0-19'}},{autoHideMode:'all',unhiddenEntriesCount:8},messages),false);
        assert.equal(state.warnings.length,1);
        if(failure==='chat') assert.equal(state.calls.length,0);
    }
});

test('a save failure after flags change immediately retries once and successful saves are not repeated', async () => {
    const {scope,state,messages}=harness();
    let saves=0;
    scope.hideChatMessageRange=async(start,end)=>{
        saves++;
        for(let i=start;i<=end;i++)messages[i].is_system=true;
        if(saves===1) throw Error('save failed after flags changed');
    };
    const memory={metadata:{sceneRange:'0-19'}};
    const settings={autoHideMode:'all',unhiddenEntriesCount:8};
    assert.equal(await scope.applySavedMemoryAutoHide(memory,settings),true);
    assert.equal(saves,2);
    assert.equal(state.warnings.length,0);
    assert(messages.slice(12).every(m=>!m.is_system));
    await scope.applySavedMemoryAutoHide(memory,settings);
    assert.equal(saves,2);
});

test('two failed saves warn and remain retryable despite all target flags already being hidden', async () => {
    const {scope,state,messages}=harness();
    let saves=0;
    scope.hideChatMessageRange=async(start,end)=>{
        saves++;
        for(let i=start;i<=end;i++)messages[i].is_system=true;
        if(saves<=2) throw Error('save failed');
    };
    const memory={metadata:{sceneRange:'0-19'}};
    const settings={autoHideMode:'all',unhiddenEntriesCount:8};
    assert.equal(await scope.applySavedMemoryAutoHide(memory,settings),false);
    assert.equal(saves,2);
    assert.equal(state.warnings.length,1);
    assert.equal(await scope.applySavedMemoryAutoHide(memory,settings),true);
    assert.equal(saves,3);
    await scope.applySavedMemoryAutoHide(memory,settings);
    assert.equal(saves,3);
});

test('immediate retry also recovers failures before hiding and silent no-ops', async () => {
    for(const silent of [false,true]) {
        const {scope,messages}=harness();
        let calls=0;
        scope.hideChatMessageRange=async(start,end)=>{
            calls++;
            if(calls===1) {
                if(silent) return;
                throw Error('hide failed');
            }
            for(let i=start;i<=end;i++)messages[i].is_system=true;
        };
        assert.equal(await scope.applyAutoHideRanges([{start:0,end:11}],messages),12);
        assert.equal(calls,2);
    }
});

test('a chat switch during a failed save prevents the immediate retry from hiding the new chat', async () => {
    const {scope,state,messages}=harness();
    const other=[{is_system:false}];
    let calls=0;
    scope.hideChatMessageRange=async()=>{
        calls++;
        state.ctx={chat:other};
        throw Error('save failed');
    };
    await assert.rejects(scope.applyAutoHideRanges([{start:0,end:11}],messages));
    assert.equal(calls,1);
    assert.equal(other[0].is_system,false);
});

test('successful memory generation retries missing auto-hide on saved-job resume before post-save work',()=>{
    const index=read('./index.js');
    const start=index.indexOf('if (payload.resumeSavedMemory === true)');
    const resume=index.slice(start,index.indexOf('jobContext.setState("generating"',start));
    assert(resume.indexOf('await applyQueuedMemoryAutoHide(')>=0);
    assert(resume.indexOf('await applyQueuedMemoryAutoHide(')<resume.indexOf('await completeQueuedMemoryPostSave('));
});


test('settings action applies an existing saved range in both modes without creating a memory', async () => {
    const index=read('./index.js');
    const start=index.indexOf("    const hideButton = e.target.closest('#stmb-apply-auto-hide-now');");
    const end=index.indexOf('\n    const settings = initializeSettings();',start);
    const action=index.slice(start,end);
    for(const mode of ['all','last']) {
        const {scope,state,messages}=harness();
        const settings={moduleSettings:{}};
        Object.assign(scope,{chat:messages,isMemoryProcessing:()=>false,initializeSettings:()=>settings,
            getSceneMarkers:()=>({highestMemoryProcessed:19}),getCurrentCanonicalLorebookName:()=> 'book',
            getCurrentChatId:()=> 'chat',saveSettingsDebounced(){},
            loadWorldInfo:async()=>({entries:{0:{STMB_start:10,STMB_end:19,STMB_chatId:'chat'}}}),
            identifyMemoryEntries:data=>Object.values(data.entries).map(entry=>({entry})),
            getRangeFromMemoryEntry:entry=>({start:entry.STMB_start,end:entry.STMB_end}),
        });
        scope.toastr.success=()=>{};
        vm.runInContext('async function applyNow(e,popupElement){'+action+'}',scope);
        const button={disabled:false};
        const popup={querySelector:selector=>({value:selector.includes('auto-hide-mode')?mode:'8'})};
        await scope.applyNow({target:{closest:()=>button},preventDefault(){}},popup);
        assert.equal(state.warnings.length,0);
        assert.equal(state.calls.length,1);
        assert.equal(state.calls[0].start,mode==='all'?0:10);
        assert.equal(state.calls[0].end,11);
        assert.equal(button.disabled,false);
        assert.equal(settings.moduleSettings.unhiddenEntriesCount,8);
        assert(messages.slice(12).every(m=>!m.is_system));
    }
});
