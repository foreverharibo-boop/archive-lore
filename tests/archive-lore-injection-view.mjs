// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(import.meta.dirname,'..');
const server=http.createServer(async(req,res)=>{
    try{
        if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/lore-fork.css"><style>body{font:14px/1.5 Arial;background:#f8f1f6;color:#493c47;margin:12px}button{font:inherit}main{max-width:650px;margin:auto}#extensionsMenu{padding:8px 0}.list-group-item{cursor:pointer}small{opacity:.75}</style><main><label><input id="al-show-scene-buttons" type="checkbox">수집 구간 버튼</label><div id="extensionsMenu"></div><div id="view"></div></main>');return;}
        const name=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!name.startsWith(root+path.sep))throw Error('path');
        res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(name));
    }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined});
try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const width of [320,390,1000]){
        await page.setViewportSize({width,height:850});await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(async()=>{
            const {createInjectionView,mountInjectionPreference,mountInjectionMenu,injectionSnapshot}=await import('/lore-injection-view.js');
            const {managerSourceHash}=await import('/lore-translations.js');
            const {formatInjection}=await import('/lore-core.js');
            const entry={uid:1,comment:'2026-07-15 부산',content:'He arrived. He sat down.\nShe smiled.'};
            const units=[{entryId:'a',index:1,title:entry.comment,text:'He sat down.'},{entryId:'b',index:0,title:'약속',text:'<img src=x onerror=alert(1)>Never leave without a message.'}];
            const result={text:formatInjection(units),core:'Character facts.',guidance:'Keep the character consistent.'};
            const settings={'simple-lorebook':{translations:{'Book␟1':{sourceHash:managerSourceHash(entry.content),text:'그가 도착했다. 그가 소파에 앉았다.\n그녀가 웃었다.'}}}};
            const snapshot=await injectionSnapshot({key:'A',result,recall:{...result,units,records:[{id:'a',book:'Book',entry}]},settings,countTokens:s=>Math.ceil(s.length/3),time:'2026-11-11T20:00:00Z'});
            const preferences={moduleSettings:{}};window.opens=0;window.saves=0;
            const open=()=>{window.opens++;document.querySelector('#view').replaceChildren(createInjectionView(snapshot));};
            const refresh=()=>mountInjectionMenu({root:document.querySelector('#extensionsMenu'),enabled:preferences.moduleSettings.archiveLoreShowInjection,open});
            mountInjectionPreference(document,{settings:preferences,save:()=>window.saves++,changed:refresh});refresh();
            window.empty=()=>document.querySelector('#view').replaceChildren(createInjectionView(null));
            window.blank=()=>document.querySelector('#view').replaceChildren(createInjectionView({...snapshot,rows:[],core:'',text:'',guidance:'',tokens:{total:0,core:0,memory:0,guidance:0}}));
        });
        assert.equal(await page.locator('#archive-lore-injection-menu').count(),0);
        await page.locator('#al-show-injection').check();assert.equal(await page.locator('#archive-lore-injection-menu').count(),1);
        await page.locator('#archive-lore-injection-menu').focus();await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(()=>window.opens),1);
        assert.match(await page.locator('#view').innerText(),/그가 소파에 앉았다/);
        assert.doesNotMatch(await page.locator('#view').innerText(),/그녀가 웃었다/);
        assert.match(await page.locator('#view').innerText(),/문장 순서 기준/);
        assert.equal(await page.locator('#view img').count(),0);
        await page.getByText('실제 주입 원문',{exact:true}).click();assert.match(await page.locator('#view').innerText(),/He sat down\./);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:`/tmp/al-injection-${width}.png`,fullPage:true});
        await page.locator('#al-show-injection').uncheck();assert.equal(await page.locator('#archive-lore-injection-menu').count(),0);
        assert.equal(await page.evaluate(()=>window.saves),2);
        await page.evaluate(()=>window.empty());assert.match(await page.locator('#view').innerText(),/아직 기록된/);
        await page.evaluate(()=>window.blank());assert.match(await page.locator('#view').innerText(),/이번에는.*없습니다/);
    }
    assert.deepEqual(errors,[]);console.log('Injection viewer: mobile/desktop, toggle/menu, keyboard, translation excerpts, source disclosure, empty states and safe text passed.');
}finally{await browser.close();server.close();}
