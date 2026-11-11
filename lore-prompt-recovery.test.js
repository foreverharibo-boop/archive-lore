import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {bindSavedConnection} from './lore-native-connection.js';

function manager(file, initial) {
    let saved=structuredClone(initial),fail=false;
    const scope={console,Date,structuredClone,btoa,unescape,encodeURIComponent,
        getRequestHeaders:()=>({}),getBuiltInPresetPrompts:()=>({summary:'Shipped summary'}),getDefaultPrompt:()=> 'Shipped summary',
        getBuiltInArcPrompts:()=>({arc_default:'Shipped consolidation',arc_tiny:'Shipped tiny'}),getDefaultArcPrompt:()=> 'Shipped consolidation',
        FILE_NAMES:{PROMPTS_FILE:'prompts.json',ARC_PROMPTS_FILE:'arc.json'},SCHEMA:{CURRENT_VERSION:1},DISPLAY_NAME_DEFAULTS:{summary:'Summary'},DISPLAY_NAME_I18N_KEYS:{},
        translate:s=>s,CONSOLIDATION_REGENERATION_PRESET_KEY:'regen',GROUP_CHAT_CONSOLIDATION_PRESET_KEY:'group',
        isOrdinaryConsolidationPreset:()=>true,isRegenerationOnlyPreset:()=>false,isGroupChatOnlyPreset:()=>false,
        selectConsolidationDefaultPresetKey:()=> 'arc_default',
        fetch:async(_url,options)=>{
            if(options.method==='POST'){
                if(fail)return {ok:false,statusText:'offline'};
                saved=JSON.parse(Buffer.from(JSON.parse(options.body).data,'base64').toString());return {ok:true};
            }
            return {ok:true,text:async()=>JSON.stringify(saved),json:async()=>structuredClone(saved)};
        }};
    let code=fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm,'').replace(/^export\s*\{[\s\S]*?\};/gm,'').replace(/^export /gm,'');
    vm.runInNewContext(code,scope);
    return {scope,saved:()=>saved,fail:()=>{fail=true;}};
}
for(const file of ['./summaryPromptManager.js','./arcAnalysisPromptManager.js']){
    test(`${file}: Korean/emoji names get nonempty distinct IDs; old empty ID editable and deletable`,async()=>{
        const {scope:m,saved}=manager(file,{version:1,overrides:{'':{displayName:'분요약',prompt:'keep'}}});
        await m.upsertPreset('','edited','분요약');assert.equal(saved().overrides[''].prompt,'edited');
        const first=await m.upsertPreset(null,'one','요약');const second=await m.upsertPreset(null,'two','요약');const emoji=await m.upsertPreset(null,'three','💗');
        assert(first);assert(second);assert(emoji);assert.notEqual(first,second);
        await m.removePreset('');assert.equal(Object.hasOwn(saved().overrides,''),false);
        m.clearCache();assert.equal((await m.listPresets()).some(p=>p.key===''),false);
        assert.equal(saved().overrides[first].prompt,'one');
    });
}
test('targeted consolidation restoration keeps custom and other modified builtins',async()=>{
    const {scope:m,saved}=manager('./arcAnalysisPromptManager.js',{version:1,defaultPresetKey:'custom',overrides:{arc_tiny:{prompt:'my tiny'},custom:{prompt:'my custom'}}});
    await m.restoreDefaultPreset();
    assert.equal(saved().overrides.arc_default.prompt,'Shipped consolidation');assert.equal(saved().defaultPresetKey,'arc_default');
    assert.equal(saved().overrides.arc_tiny.prompt,'my tiny');assert.equal(saved().overrides.custom.prompt,'my custom');
});
test('failed restore leaves cached prompt unchanged',async()=>{
    const fixture=manager('./arcAnalysisPromptManager.js',{version:1,overrides:{arc_default:{prompt:'edited'}}});
    await fixture.scope.getPrompt('arc_default');fixture.fail();
    await assert.rejects(fixture.scope.restoreDefaultPreset());
    assert.equal(await fixture.scope.getPrompt('arc_default'),'edited');
});
test('saved connection binding preserves prompts and manual configuration; rejects missing/text profiles',()=>{
    const profile={preset:'my-prompt',connection:{api:'custom',model:'old-model',endpoint:'keep'}};
    const before=structuredClone(profile);const service={getProfile:id=>({id,model:'saved-model'}),validateProfile:()=>({selected:'openai',source:'makersuite'}),sendRequest:()=>{}};
    bindSavedConnection(profile,'saved',[{id:'saved'}],service);
    assert.deepEqual(profile,{...before,archiveLoreConnectionProfileId:'saved'});
    assert.throws(()=>bindSavedConnection(profile,'gone',[],service));assert.equal(profile.archiveLoreConnectionProfileId,'saved');
    service.validateProfile=()=>({selected:'textgenerationwebui'});
    assert.throws(()=>bindSavedConnection(profile,'saved',[{id:'saved'}],service));
    bindSavedConnection(profile,'',[],null);assert.deepEqual(profile.connection,before.connection);
});
// Exercise the actual click delegation with a legacy empty-key Korean preset.
for(const name of ['setupPromptManagerEventHandlers','setupArcPromptManagerEventHandlers'])test(`${name}: delete click reaches legacy empty-key preset`,async()=>{
    const source=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8');const start=source.indexOf(`function ${name}(`);const end=source.indexOf('\n/**',start);
    const listeners={};const deleted=[];const row={dataset:{presetKey:''},style:{},classList:{remove(){}}};
    const dlg={addEventListener:(event,fn)=>{listeners[event]=fn;},querySelector:()=>null,querySelectorAll:()=>[row]};
    const scope={deletePreset:async(_popup,key)=>deleted.push(key),deleteArcPreset:async(_popup,key)=>deleted.push(key)};
    vm.runInNewContext(source.slice(start,end),scope);scope[name]({dlg});
    const action={closest:()=>row,classList:{contains:cls=>cls==='stmb-action-delete'}};
    await listeners.click({target:{closest:()=>action},preventDefault(){},stopPropagation(){}});
    assert.deepEqual(deleted,['']);
});
test('consolidation resolves saved profile binding and passes it through keyword requests',async()=>{
    const source=fs.readFileSync(new URL('./arcanalysis.js',import.meta.url),'utf8');
    const start=source.indexOf('function resolveConnection(');const end=source.indexOf('\nfunction ',start+10);
    const scope={normalizeCompletionSource:s=>s,getCurrentApiInfo:()=>({completionSource:'openai'}),getUIModelSettings:()=>({model:'rp-model',temperature:1})};
    vm.runInNewContext(source.slice(start,end),scope);
    const conn=scope.resolveConnection({connection:{api:'current_st'},archiveLoreConnectionProfileId:'collection'});
    assert.equal(conn.archiveLoreConnectionProfileId,'collection');
    const calls=[];Object.assign(scope,{sendRawCompletionRequest:async body=>{calls.push(body);return{text:'["keyword"]'};},DEFAULT_CONSOLIDATION_KEYWORD_PROMPT:'keywords',translate:s=>s,resolveSummaryPromptPlaceholders:s=>s,getSummaryTierLabel:()=> 'arc',tr:(_key,s)=>s,parseKeywordsResponse:JSON.parse,console});
    const genStart=source.indexOf('export async function generateKeywordsForSummary(');const genEnd=source.indexOf('\n}',genStart)+2;
    vm.runInNewContext(source.slice(genStart,genEnd).replace('export ',''),scope);
    await scope.generateKeywordsForSummary('summary',conn);
    assert.equal(calls[0].archiveLoreConnectionProfileId,'collection');
});
