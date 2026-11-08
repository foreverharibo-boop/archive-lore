import { ARCHIVE_LORE_TITLE_FORMAT, titleFormatLabel } from '../lore-native-title.js';
// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import Handlebars from 'handlebars';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extra=process.env.CHROMIUM_ARGS_MODULE?(await import(process.env.CHROMIUM_ARGS_MODULE)).default.args:[];
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${process.env.KOREAN_FONT_ROOT ? '<link rel="stylesheet" href="/fonts/400.css">' : ''}<link rel="stylesheet" href="/lore-fork.css"><style>:root{--SmartThemeBlurTintColor:#f8f9fb;--SmartThemeBodyColor:#303740;--SmartThemeBorderColor:#d5dbe3;--mainFontSize:16px}body{background:#edf0f4;color:#303740;font:14px "Noto Sans KR",Arial;margin:12px}#content{background:#f8f9fb;padding:16px;max-width:850px;margin:auto;border-radius:12px}.menu_button{font:inherit;width:min-content;white-space:normal;overflow-wrap:anywhere;background:#edf0f5;color:inherit;padding:9px;border:1px solid #d5dbe3;border-radius:6px;cursor:pointer}.displayNone{display:none!important}.whitespacenowrap{white-space:nowrap!important}.text_pole{font:inherit;max-width:100%;box-sizing:border-box}h2{font-size:18px}</style><div id="content" class="al-fork-surface"></div><script src="/handlebars.js"></script><script type="module">
import {settingsTemplate} from '/templates.js';
import {FEATURE_GROUPS,organizeMemoryBooks,restoreFeatureButtons} from '/lore-fork-layout.js';
import {createConnectionPicker} from '/lore-native-connection.js';
import {createHomeContext} from '/lore-native-home.js';
import {createSearchToolsPanel} from '/lore-native-tools.js';
import {mountSideAutoToggle} from '/lore-native-side-toggle.js';
import {nativePreferences,createNativePreferences,appendOriginalTools,applyNativeTheme} from '/lore-native-preferences.js';
import {mountLazyDetails} from '/lore-native-lazy.js';
window.prefsSettings={moduleSettings:{}};
window.mountPreferences=()=>{
 const host=document.querySelector('#content');host.replaceChildren();applyNativeTheme(host,prefsSettings);
 host.append(createNativePreferences({settings:prefsSettings,books:['공용 기억','캐릭터 기억'],activeBook:'공용 기억',save:patch=>{Object.assign(prefsSettings.moduleSettings,patch);applyNativeTheme(host,prefsSettings);}}));
};
window.mountOriginal=()=>{
 const host=document.querySelector('#content');prefsSettings.moduleSettings.archiveLoreLayout='original';applyNativeTheme(host,prefsSettings);
 host.innerHTML=settingsTemplate({profiles:[{name:'Native Profile',isDefault:true}],selectedProfile:{connection:{api:'Native API',model:'Native Model'},effectivePrompt:'Native prompt'},currentLorebookName:'공용 기억'});
 for(const id of ['stmb-profile-buttons','stmb-extra-function-buttons']){const b=document.createElement('button');b.textContent='Native action';b.onclick=()=>window.originalClicks=(window.originalClicks||0)+1;host.querySelector('#'+id).append(b);}
 window.originalMarkup=[...host.children].map(el=>el.outerHTML).join('');
 const actions={'al-preferences':()=>window.preferenceClicks=(window.preferenceClicks||0)+1,'al-search-tools':()=>window.searchClicks=(window.searchClicks||0)+1};
 appendOriginalTools(host,actions,host);appendOriginalTools(host,actions,host);
};
window.mountLazy=()=>{
 const host=document.querySelector('#content');host.innerHTML='<details id="lazy-prompt"><summary>Prompt</summary><code id="stmb-summary-prompt"></code></details><details id="lazy-scene"><summary>Scene</summary><span data-al-scene-tokens>…</span></details>';
 window.promptReads=0;window.sceneReads=0;window.current=true;
 mountLazyDetails(host,{isCurrent:()=>window.current,loadPrompt:()=>{promptReads++;return new Promise(resolve=>window.finishPrompt=resolve);},loadScene:async()=>{sceneReads++;return {estimatedTokens:1234};}});
};
window.mountTools=()=>{
 document.body.innerHTML='<div id="content" class="al-fork-surface"></div>';const host=document.querySelector('#content');
 const listeners=new Set();window.counts={embedded:104,pending:1};window.reads=0;window.indexes=0;window.toolState={busy:false,status:''};window.chatKey='chat';window.failure=false;
 window.emit=()=>{for(const listener of listeners)listener();};window.listenerCount=()=>listeners.size;
 const search={context:()=>({key:window.chatKey}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},controller:{state:()=>window.toolState,embeddingCounts:async()=>{reads++;if(failure)throw Error('조회 실패');return counts;},index:async()=>{indexes++;toolState.busy=true;emit();await new Promise(r=>window.finishIndex=()=>{counts={embedded:105,pending:0};toolState={busy:false,status:'임베딩 완료 · 160구간'};emit();r();});},cancel(){},restore:async()=>{},jobs:()=>[]}};
 window.toolsPanel=createSearchToolsPanel({search,download(){}});host.append(toolsPanel.node);
 window.sideMarkers={};window.sideSaves=0;window.paintSwitch=()=>{document.querySelector('.al-side-auto-toggle')?.remove();mountSideAutoToggle(host,{markers:sideMarkers,save:()=>sideSaves++});};paintSwitch();
};
import {installSettingsHelp} from '/lore-help.js';
window.collectionSettings={defaultProfile:0,profiles:[{name:'기본 수집',connection:{model:'old'}},{name:'다른 수집',connection:{model:'other'}}]};
const root=document.querySelector('#content');root.innerHTML=settingsTemplate({profiles:[{name:'기본 수집',isDefault:true}],selectedProfile:{connection:{api:'현재 프로필',model:'연결 모델'},effectivePrompt:'Preserve established facts.'},currentLorebookName:'기존 기억',highestMemoryProcessed:2105,hasHighestMemoryProcessed:true});
window.clicks=[];
function populate(){for(const [, ,features] of FEATURE_GROUPS)for(const [id] of features)if(id.startsWith('stmb-')){const b=document.createElement('div');b.id=id;b.textContent=id;b.onclick=()=>clicks.push(id);root.querySelector('#stmb-prompt-manager-buttons').append(b);}}
window.paint=()=>{restoreFeatureButtons(root);root.querySelector('#stmb-prompt-manager-buttons').replaceChildren();populate();const actions=Object.fromEntries(FEATURE_GROUPS.flatMap(g=>g[2]).filter(f=>f[0].startsWith('al-')).map(f=>[f[0],()=>clicks.push(f[0])]));actions['al-context-panel']=()=>createHomeContext({settings:collectionSettings,markers:{highestMemoryProcessed:2105},length:2120,book:'현재 연결된 테스트 로어북 이름',books:['현재 연결된 테스트 로어북 이름'],changeBook:()=>clicks.push('book'),changeProfile:index=>{collectionSettings.defaultProfile=index;paint();},editProfile:()=>clicks.push('edit-profile'),newProfile:()=>clicks.push('new-profile'),connection:createConnectionPicker({settings:collectionSettings,profiles:[{id:'saved',name:'저장된 제미나이'}],service:{getProfile:id=>({id,model:'stored-model'}),validateProfile:()=>({selected:'openai',source:'makersuite'}),sendRequest(){}},save:()=>window.savedConnection=true,compact:true})});actions['al-migrate']=async()=> '이관 완료';organizeMemoryBooks(root,actions,root);};paint();installSettingsHelp({read:()=>true,write:()=>{}});window.ready=true;
</script>`;
const server=http.createServer(async(req,res)=>{try{
    const pathname=new URL(req.url,'http://local').pathname;
    if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
    if(pathname==='/lib.js'){res.setHeader('Content-Type','text/javascript');res.end('export const Handlebars=window.Handlebars;');return;}
    if(pathname.startsWith('/fonts/') && process.env.KOREAN_FONT_ROOT){const relative=pathname.slice(7);if(relative.includes('..'))throw Error('invalid');res.setHeader('Content-Type',relative.endsWith('.css')?'text/css':'font/woff2');res.end(await fs.readFile(process.env.KOREAN_FONT_ROOT+'/'+relative));return;}
    const path=pathname==='/handlebars.js'?'node_modules/handlebars/dist/handlebars.js':pathname.slice(1);
    if(path.includes('..'))throw Error('invalid');res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(root+path));
}catch(e){res.statusCode=404;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,args:extra});
try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const width of [320,390,1000]){
        await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
        assert.equal(await page.locator('.al-home-tabs button').count(),3);
        await page.locator('#al-quick-profile + .al-setting-help').waitFor();
        const profileHeading=await page.locator('.al-profile-heading').boundingBox(),actionsBox=await page.locator('.al-context-actions').boundingBox(),profileSelect=await page.locator('#al-quick-profile').boundingBox();
        assert(actionsBox.y<profileSelect.y,'profile actions must stay next to heading, above select/help');
        assert(profileHeading.y<actionsBox.y+actionsBox.height && profileHeading.y+profileHeading.height>actionsBox.y);

        assert.equal(await page.locator('.al-home-pane:not([hidden]) .al-feature-card').count(),3);
        assert(await page.getByRole('button',{name:'지금 수집',exact:true}).isVisible());
        assert(await page.getByText('다음 수집 #2106–#2119 · 14개').isVisible());
        assert(await page.getByText('현재 연결된 테스트 로어북 이름',{exact:true}).isVisible());
        await page.locator('#al-quick-profile').selectOption('1');
        assert.equal(await page.evaluate(()=>collectionSettings.defaultProfile),1);
        await page.locator('#al-quick-profile').selectOption('0');
        await page.getByRole('button',{name:'저장된 기억',exact:true}).click();
        assert.equal(await page.locator('.al-feature-card').count(),18);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.getByRole('button',{name:'기억 압축',exact:true}).click();
        assert.equal(await page.evaluate(()=>clicks.at(-1)),'stmb-compact-review');
        await page.evaluate(()=>paint());
        assert.equal(await page.locator('#stmb-profile-select').count(),1);
        assert.equal(await page.locator('.al-feature-home').getAttribute('data-tab'),'records');
        assert.equal(await page.locator('#stmb-compact-review').count(),1);
        await page.getByRole('button',{name:'기억 압축',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>clicks.length),2);
        await page.locator('[data-home-tab=settings]').click();
        assert(await page.locator('#al-home-connection').isVisible());
        assert(await page.locator('.al-home-pane[data-home-pane=settings] [data-al-help-toggle]').isVisible());
        await page.locator('#al-home-connection').selectOption('saved');
        assert.equal(await page.evaluate(()=>collectionSettings.profiles[0].archiveLoreConnectionProfileId),'saved');
        assert.equal(await page.evaluate(()=>collectionSettings.profiles[0].connection.model),'old');
        assert(await page.evaluate(()=>savedConnection));
        await page.locator('.al-migration-details summary').click();
        await page.getByRole('button',{name:'기존 기억 가져오기',exact:true}).click();await page.getByRole('status').filter({hasText:'이관 완료'}).waitFor();
        await page.evaluate(()=>document.fonts.ready);
        assert(await page.locator('.al-feature-button').evaluateAll(items=>items.every(el=>el.getBoundingClientRect().right<=el.parentElement.getBoundingClientRect().right)));
        const migration=page.getByRole('button',{name:'기존 기억 가져오기',exact:true});
        assert(await migration.evaluate(el=>el.getBoundingClientRect().width>el.getBoundingClientRect().height*2));
        // Match the host's narrow button default in independent tool and extension surfaces too.
        await page.evaluate(()=>{
            const fixture=document.createElement('div');fixture.id='tool-fixture';
            fixture.innerHTML='<div class="al-search-tools"><div class="al-tool-buttons"><button class="menu_button">백업하고 기억 가져오기</button><button class="menu_button">검색 미리보기</button><button class="menu_button">진단 TXT 다운로드</button></div></div><div class="al-fork-settings"><div class="al-extension-actions"><button class="menu_button">아카이브 로어 열기</button><button class="menu_button">검색·임베딩 설정</button></div></div>';
            document.querySelector('#content').append(fixture);
        });
        assert(await page.locator('#tool-fixture button').evaluateAll(items=>items.every(el=>{
            const r=el.getBoundingClientRect();return r.width>r.height*2 && r.right<=innerWidth;
        })));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.locator('#tool-fixture').evaluate(el=>el.remove());
        await page.locator('[data-home-tab=collect]').click();
        await page.screenshot({path:'/tmp/archive-lore-fork-'+width+'.png',fullPage:true});
    }
    const sideSource=await fs.readFile(root+'templatesSidePrompts.js','utf8');
    const sideMarker='export const sidePromptsTableTemplate = Handlebars.compile(`';
    const sideStart=sideSource.indexOf(sideMarker)+sideMarker.length;
    const sideTemplate=Handlebars.compile(sideSource.slice(sideStart,sideSource.indexOf('`);',sideStart)));
    await page.setViewportSize({width:320,height:900});
    await page.locator('#content').evaluate((el,html)=>{el.innerHTML='<div id="stmb-sp-list">'+html+'</div>';},sideTemplate({items:[{key:'relationship',name:'Relationship Turning Points',enabled:true,badges:['메모리 후','수동']},{key:'memory-assistance',name:'Memory Assistance',special:true,modeOff:true,badges:['Memory Assistance: 사용 안 함']}]}));
    assert(await page.locator('.stmb-sp-action-edit').first().isVisible());
    assert(await page.locator('.stmb-sp-action-delete').isVisible());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert(await page.locator('.stmb-sp-action-delete').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
    await page.locator('.stmb-sp-special-mode + .al-setting-help').waitFor();
    for(const width of [320,390,768])for(const font of [16,22]){
        await page.setViewportSize({width,height:900});await page.locator('#content').evaluate((el,font)=>el.style.fontSize=font+'px',font);
        const select=await page.locator('.stmb-sp-special-mode').boundingBox(),note=await page.locator('.stmb-sp-special-mode + .al-setting-help').boundingBox();
        assert(note.y>=select.y+select.height,'assistance explanation must be below controls');
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    await page.setViewportSize({width:390,height:900});
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:'/tmp/archive-lore-assistance.png',fullPage:true});
    // Render the real native profile template, not a replacement UI.
    Handlebars.registerHelper('eq',(a,b)=>a===b);
    const source=await fs.readFile(root+'profileManager.js','utf8');
    const marker='const profileEditTemplate = Handlebars.compile(`';
    const start=source.indexOf(marker)+marker.length;
    const template=Handlebars.compile(source.slice(start,source.indexOf('`);',start)));
    await page.setContent(template({archiveLoreFork:true,titleFormats:[{value:ARCHIVE_LORE_TITLE_FORMAT,label:titleFormatLabel(ARCHIVE_LORE_TITLE_FORMAT),isSelected:true}],name:'기본 수집',connection:{api:'current_st',model:'hidden-model'},archiveLoreConnections:[{id:'saved',name:'저장된 제미나이',selected:true}]}));
    assert(await page.locator('#al-native-connection').isVisible());
    assert.equal(await page.locator('#al-native-connection').inputValue(),'saved');
    assert.equal(await page.locator('#stmb-profile-title-format-select').inputValue(),ARCHIVE_LORE_TITLE_FORMAT);
    assert.equal(await page.locator('#stmb-profile-title-format-select option:checked').textContent(),titleFormatLabel(ARCHIVE_LORE_TITLE_FORMAT));
    assert.equal(await page.locator('#stmb-profile-model').isVisible(),false);
    await page.locator('.al-legacy-connection summary').click();
    assert(await page.locator('#stmb-profile-model').isVisible());
    await page.setViewportSize({width:390,height:900});
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
    // Reproduce host !important controls overriding only half of a custom palette.
    await page.addStyleTag({content: `
        body.host-light :is(.menu_button,.text_pole,select,.select2-selection) {background:#fff!important;color:#e6e9f4!important;-webkit-text-fill-color:#e6e9f4!important;text-shadow:0 0 3px white!important;}
        body.host-dark :is(.menu_button,.text_pole,select,.select2-selection) {background:#101218!important;color:#222224!important;-webkit-text-fill-color:#222224!important;text-shadow:0 0 3px black!important;}
    `});
    const luminance=rgb=>{
        const values=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
        return values[0]*.2126+values[1]*.7152+values[2]*.0722;
    };
    const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    for(const host of ['host-light','host-dark'])for(const palette of ['rose','lavender','sage','midnight']){
        await page.evaluate(({host,palette})=>{
            document.body.className=host;prefsSettings={moduleSettings:{archiveLorePalette:palette}};mountPreferences();
            const footer=document.createElement('div');footer.className='popup-controls';footer.innerHTML='<button class="menu_button" id="test-close"><span>닫기</span></button><button class="menu_button" disabled>진행 중</button>';
            document.querySelector('#content').append(footer);
            const sample=document.createElement('div');sample.innerHTML='<div class="al-feature-home"><button class="menu_button al-feature-button" id="al-native-collect">지금 수집</button><button class="menu_button al-feature-button" id="test-text-action">설정</button></div><input class="text_pole" value="입력한 텍스트"><textarea class="text_pole">입력한 본문</textarea><span class="select2-selection"><span class="select2-selection__rendered">선택한 프로필</span></span>';document.querySelector('#content').append(sample);
        },{host,palette});
        for(const selector of ['.al-native-preferences button','#test-close','#al-native-collect','#al-layout','input.text_pole','textarea','.select2-selection']){
            const style=await page.locator(selector).evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,fg:s.color,fill:s.webkitTextFillColor,shadow:s.textShadow};});
            assert(contrast(style.bg,style.fg)>=4.5,host+' '+palette+' '+selector+' must remain readable');
            assert.equal(style.fg,style.fill);assert.equal(style.shadow,'none');
        }
        assert.equal(await page.locator('#test-close span').evaluate(el=>getComputedStyle(el).color),await page.locator('#test-close').evaluate(el=>getComputedStyle(el).color));
        const normal=await page.locator('#test-close').evaluate(el=>getComputedStyle(el).backgroundColor);
        await page.locator('#test-close').hover();
        const hovered=await page.locator('#test-close').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}));
        assert.notEqual(hovered.bg,normal);assert(contrast(hovered.bg,hovered.fg)>=4.5);
        await page.locator('#test-close').focus();
        assert.notEqual(await page.locator('#test-close').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
        assert.equal(await page.locator('#test-text-action').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
        assert(await page.locator('.popup-controls button:disabled').isDisabled());
        await page.mouse.move(0,0);
        if(host==='host-light')await page.screenshot({path:'/tmp/archive-lore-palette-'+palette+'.png',fullPage:true});
    }
    // Default and Original still inherit ST, rather than picking up a custom palette.
    for(const layout of ['archive','original']){
        await page.evaluate(layout=>{prefsSettings={moduleSettings:{archiveLoreLayout:layout,archiveLorePalette:layout==='original'?'midnight':'default'}};mountPreferences();},layout);
        assert.equal(await page.locator('#al-layout').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(16, 18, 24)');
    }
    await page.evaluate(()=>{document.body.className='';prefsSettings={moduleSettings:{}};});
    // Persistent destination and palettes, then untouched original template/actions.
    for(const width of [320,1000]){
        await page.setViewportSize({width,height:900});await page.evaluate(()=>mountPreferences());
        await page.locator('#al-book-mode').selectOption('fixed');
        await page.getByRole('button',{name:'적용',exact:true}).click();
        assert(await page.getByText('사용할 로어북을 선택해 주세요.',{exact:true}).isVisible());
        await page.locator('#al-fixed-book').selectOption('공용 기억');
        await page.locator('#al-layout').selectOption('archive');
        for(const palette of ['rose','lavender','sage','midnight','default']){
            await page.locator('#al-palette').selectOption(palette);await page.getByRole('button',{name:'적용',exact:true}).click();
            assert.equal(await page.locator('#content').getAttribute('data-al-palette'),palette);
        }
        await page.locator('#al-palette').selectOption('rose');await page.getByRole('button',{name:'적용',exact:true}).click();
        await page.evaluate(()=>mountPreferences());assert.equal(await page.locator('#al-fixed-book').inputValue(),'공용 기억');
        assert.equal(await page.locator('#al-palette').inputValue(),'rose');
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:'/tmp/archive-lore-preferences-'+width+'.png',fullPage:true});
        await page.evaluate(()=>mountOriginal());
        assert.equal(await page.locator('.al-feature-home').count(),0);assert.equal(await page.locator('.al-original-addons').count(),1);
        assert.equal(await page.locator('#content').getAttribute('data-al-palette'),'default');
        assert(await page.getByRole('heading',{name:'📕 Memory Books',exact:true}).isVisible());
        await page.locator('#stmb-profile-buttons button').click();assert((await page.evaluate(()=>originalClicks))>0);
        await page.locator('#al-preferences').click();assert((await page.evaluate(()=>preferenceClicks))>0);
        assert(await page.evaluate(()=>[...document.querySelector('#content').children].filter(el=>!el.matches('.al-original-addons')).map(el=>el.outerHTML).join('')===originalMarkup));
        await page.screenshot({path:'/tmp/archive-lore-original-'+width+'.png',fullPage:true});
        await page.evaluate(()=>prefsSettings={moduleSettings:{}});
    }
    await page.evaluate(()=>mountLazy());
    assert.deepEqual(await page.evaluate(()=>[promptReads,sceneReads]),[0,0]);
    await page.locator('#lazy-prompt summary').click();await page.waitForFunction(()=>promptReads===1);
    await page.locator('#lazy-prompt summary').click();await page.locator('#lazy-prompt summary').click();assert.equal(await page.evaluate(()=>promptReads),1);
    await page.evaluate(()=>{current=false;finishPrompt('Stale prompt');});
    assert.notEqual(await page.locator('#stmb-summary-prompt').textContent(),'Stale prompt');
    await page.evaluate(()=>current=true);await page.locator('#lazy-scene summary').click();await page.getByText('1234',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>sceneReads),1);
    await page.evaluate(()=>mountTools());
    await page.getByText('104/105 완료 · 남은 임베딩 1개',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>indexes),0,'opening counts must not call embedding');
    await page.getByRole('button',{name:'남은 임베딩 실행',exact:true}).click();
    assert(await page.getByRole('button',{name:'남은 임베딩 실행',exact:true}).isDisabled());
    await page.evaluate(()=>{for(let i=0;i<100;i++)emit();});assert.equal(await page.evaluate(()=>reads),1);
    await page.evaluate(()=>finishIndex());await page.getByText('105/105 완료 · 남은 임베딩 0개',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>reads),2);assert(await page.getByRole('button',{name:'임베딩 완료',exact:true}).isDisabled());
    assert(!await page.locator('[role=status]').innerText());
    const auto=page.locator('#al-side-after-memory-enabled');assert(await auto.isChecked());await auto.uncheck();
    assert.equal(await page.evaluate(()=>sideMarkers.archiveLoreSideAfterMemoryEnabled),false);
    await page.evaluate(()=>{sideMarkers=JSON.parse(JSON.stringify(sideMarkers));paintSwitch();});assert(!await auto.isChecked());
    await auto.check();assert.equal(await page.evaluate(()=>sideSaves),2);
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:'/tmp/archive-lore-embedding-status.png',fullPage:true});
    await page.evaluate(()=>{counts={embedded:0,pending:0};return toolsPanel.refresh();});await page.getByText('0/0 완료 · 남은 임베딩 0개',{exact:true}).waitFor();
    await page.evaluate(()=>{failure=true;return toolsPanel.refresh();});await page.getByText('임베딩 개수를 확인하지 못했습니다.',{exact:true}).waitFor();
    assert(await page.getByText('조회 실패',{exact:true}).isVisible());
    await page.evaluate(()=>{toolsPanel.dispose();emit();});assert.equal(await page.evaluate(()=>listenerCount()),0);
    assert.deepEqual(errors,[]);console.log('Fork home: three tabs, visible migration, host without popup-content class, actions, refresh and mobile/desktop passed.');
}finally{await browser.close();server.close();}
