// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extra=process.env.CHROMIUM_ARGS_MODULE?(await import(process.env.CHROMIUM_ARGS_MODULE)).default.args:[];
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${process.env.KOREAN_FONT_ROOT ? '<link rel="stylesheet" href="/fonts/400.css">' : ''}<link rel="stylesheet" href="/lore-fork.css"><style>:root{--SmartThemeBlurTintColor:#f8f9fb;--SmartThemeBodyColor:#303740;--SmartThemeBorderColor:#d5dbe3;--mainFontSize:16px}body{background:#edf0f4;color:#303740;font:14px "Noto Sans KR",Arial;margin:12px}.popup-content{background:#f8f9fb;padding:16px;max-width:850px;margin:auto;border-radius:12px}.menu_button{background:#edf0f5;color:inherit;padding:9px;border:1px solid #d5dbe3;border-radius:6px;cursor:pointer}.text_pole{max-width:100%;box-sizing:border-box}h2{font-size:18px}</style><div class="popup-content" id="content"></div><script src="/handlebars.js"></script><script type="module">
import {settingsTemplate} from '/templates.js';
import {FEATURE_GROUPS,organizeMemoryBooks,restoreFeatureButtons} from '/lore-fork-layout.js';
const root=document.querySelector('#content');root.innerHTML=settingsTemplate({profiles:[{name:'기본 수집',isDefault:true}],selectedProfile:{connection:{api:'현재 프로필',model:'연결 모델'},effectivePrompt:'Preserve established facts.'},currentLorebookName:'기존 기억',highestMemoryProcessed:2105,hasHighestMemoryProcessed:true});
window.clicks=[];
function populate(){for(const [, ,features] of FEATURE_GROUPS)for(const [id] of features)if(id.startsWith('stmb-')){const b=document.createElement('div');b.id=id;b.textContent=id;b.onclick=()=>clicks.push(id);root.querySelector('#stmb-prompt-manager-buttons').append(b);}}
window.paint=()=>{restoreFeatureButtons(root);root.querySelector('#stmb-prompt-manager-buttons').replaceChildren();populate();const actions=Object.fromEntries(FEATURE_GROUPS.flatMap(g=>g[2]).filter(f=>f[0].startsWith('al-')).map(f=>[f[0],()=>clicks.push(f[0])]));actions['al-migrate']=async()=> '이관 완료';organizeMemoryBooks(root,actions);};paint();window.ready=true;
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
    for(const width of [390,1000]){
        await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
        assert.equal(await page.locator('.al-feature-group').count(),5);
        assert.equal(await page.locator('.al-feature-card').count(),17);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.getByRole('button',{name:'기억 압축',exact:true}).click();
        assert.equal(await page.evaluate(()=>clicks.at(-1)),'stmb-compact-review');
        await page.evaluate(()=>paint());
        assert.equal(await page.locator('#stmb-compact-review').count(),1);
        await page.getByRole('button',{name:'기억 압축',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>clicks.length),2);
        await page.locator('.al-migration-panel summary').click();await page.getByRole('button',{name:'백업 후 새 형식으로 이관'}).click();await page.getByRole('status').filter({hasText:'이관 완료'}).waitFor();
        await page.evaluate(()=>document.fonts.ready);
        assert(await page.locator('.al-feature-button').evaluateAll(items=>items.every(el=>el.getBoundingClientRect().right<=el.parentElement.getBoundingClientRect().right)));
        await page.screenshot({path:'/tmp/archive-lore-fork-'+width+'.png',fullPage:true});
    }
    assert.deepEqual(errors,[]);console.log('Fork layout: mobile/desktop, real native template, actions, keyboard, refresh and migration status passed.');
}finally{await browser.close();server.close();}
