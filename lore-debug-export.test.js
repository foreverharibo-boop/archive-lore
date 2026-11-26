// Archive Lore — AGPL-3.0-only
// Exercise the production UI functions and click cases with browser API stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./lore-ui.js',import.meta.url),'utf8');
function fixture(){
    const body=source.slice(source.indexOf('    async function loadDebugLog('),source.indexOf('    function openSettings('));
    const download=source.match(/^const download = .*$/m)[0];
    const cases=source.match(/                case 'debug-refresh':[\s\S]*?(?=                case 'server-check')/)[0];
    const box={value:'old',isConnected:true,scrollTop:5,focus(){},select(){},setSelectionRange(start,end){this.selection=[start,end];}};
    const buttons=[{disabled:false},{disabled:false}],status={textContent:''},copied=[],saved=[],timers=[];
    const state={key:'a',preview:async()=> '한글 💗\nnew log',copy:async text=>copied.push(text),legacy:()=>false,calls:0};
    const container={querySelector:s=>s==='[data-debug-log]'?box:status,querySelectorAll:()=>buttons};
    let blob;
    const sandbox={api:{context:()=>({key:state.key}),diagnostics:{preview:key=>{state.calls++;return state.preview(key);}}},
        navigator:{clipboard:{writeText:text=>state.copy(text)}},document:{activeElement:null,execCommand:()=>state.legacy(),createElement:()=>({click(){saved.push({name:this.download,blob});}})},
        URL:{createObjectURL:value=>{blob=value;return 'blob:fixture';},revokeObjectURL(){}},Blob,Date,setTimeout:cb=>timers.push(cb),container};
    vm.createContext(sandbox);vm.runInContext(download+'\n'+body+'\nasync function click(action){switch(action){'+cases+'}}',sandbox);
    return {box,buttons,status,state,copied,saved,timers,load:()=>sandbox.loadDebugLog(container),click:action=>sandbox.click(action)};
}
test('copy and TXT click cases refresh and export identical complete UTF-8 text',async()=>{
    const f=fixture(),text='한글 원문 💗\n'.repeat(6000)+'원문 끝';f.state.preview=async()=>text;
    await f.click('debug-copy');await f.click('debug-download');
    assert.equal(f.state.calls,2);assert.equal(f.copied[0],text);assert.equal(f.box.value,text);assert.equal(f.saved.length,1);
    assert.equal(await f.saved[0].blob.text(),text);assert.equal(f.saved[0].blob.type,'text/plain;charset=utf-8');
    assert.match(f.saved[0].name,/^archive-lore-debug-\d{4}-\d{2}-\d{2}T[\d-]+Z\.txt$/);assert.equal(f.timers.length,1);
});
test('failed or empty reloads disable both export actions and never export previous text',async()=>{
    for(const action of ['debug-copy','debug-download'])for(const fail of [true,false]){
        const f=fixture();f.state.preview=async()=>{if(fail)throw Error('offline');return '';};
        await f.click(action);assert.equal(f.box.value,'');assert(f.buttons.every(b=>b.disabled));assert.equal(f.saved.length,0);assert.equal(f.copied.length,0);
        if(fail)assert.match(f.status.textContent,/offline/);
    }
});
test('overlapping refresh cancels an older export even when the newer log succeeds first',async()=>{
    for(const action of ['debug-copy','debug-download']){
        const f=fixture(),pending=[];f.state.preview=()=>new Promise(resolve=>pending.push(resolve));
        const exportPromise=f.click(action);assert(f.buttons.every(b=>b.disabled));const refreshPromise=f.load();
        pending[1]('newer log');await refreshPromise;pending[0]('stale log');await exportPromise;
        assert.equal(f.box.value,'newer log');assert.equal(f.saved.length,0);assert.equal(f.copied.length,0);assert(f.buttons.every(b=>!b.disabled));
    }
});
test('chat switch or removed panel during loading cancels copy and download',async()=>{
    for(const action of ['debug-copy','debug-download'])for(const disconnected of [true,false]){
        const f=fixture();let resolve;f.state.preview=()=>new Promise(r=>resolve=r);const promise=f.click(action);
        if(disconnected)f.box.isConnected=false;else f.state.key='other-chat';resolve('wrong context');await promise;
        assert.equal(f.saved.length,0);assert.equal(f.copied.length,0);assert(f.buttons.every(b=>b.disabled));
    }
});
test('clipboard denial falls back to legacy copy or selects the entire log for manual copy',async()=>{
    for(const success of [true,false]){
        const f=fixture();let attempted=false;f.state.copy=async()=>{throw Error('denied');};f.state.legacy=()=>{attempted=true;return success;};
        await f.click('debug-copy');assert(attempted);assert.deepEqual(f.box.selection,[0,f.box.value.length]);
        assert.match(f.status.textContent,success?/복사했어/:/길게 눌러/);
    }
});
test('Blob preview response is supported and repeated downloads use fresh records',async()=>{
    const f=fixture();let serial=0;f.state.preview=async()=>new Blob(['기록 '+(++serial)]);
    await f.click('debug-download');await f.click('debug-download');
    assert.equal(await f.saved[0].blob.text(),'기록 1');assert.equal(await f.saved[1].blob.text(),'기록 2');
});
