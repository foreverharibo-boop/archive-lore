// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/lore-fork.css"><style>:root{--SmartThemeBlurTintColor:#24242b;--SmartThemeBodyColor:#eee;--SmartThemeBorderColor:#555}body{background:#24242b;color:#eee;margin:12px;font:14px sans-serif}main{max-width:600px;margin:auto}</style><main></main>
<script type="module">
import {createLoreUI} from '/lore-ui.js';import {normalizeSettings} from '/lore-core.js';import {installSettingsHelp} from '/lore-help.js';
window.settings=normalizeSettings(JSON.parse(localStorage.getItem('settings')||'{}'));window.errors=[];
const ui=createLoreUI({settings:()=>settings,saveSettings:patch=>{settings=normalizeSettings({...settings,...patch});localStorage.setItem('settings',JSON.stringify(settings));},profiles:()=>[],error:e=>errors.push(e.message),retrievalOnly:true});
ui.mountSettings(document.querySelector('main'));
installSettingsHelp({read:()=>true,write:()=>{}});window.ready=true;
</script>`;
const server=http.createServer(async(req,res)=>{try{
    const pathname=new URL(req.url,'http://local').pathname;
    if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
    if(!/^\/[\w.-]+$/.test(pathname))throw Error('path');
    res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(root+pathname.slice(1)));
}catch(e){res.statusCode=404;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined});
try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const open=async()=>{await page.waitForFunction(()=>window.ready);await page.locator('[data-settings-tab="collection"]').click();await page.locator('[data-selection-focus] summary').click();};
    await page.goto('http://127.0.0.1:'+server.address().port);await open();
    const generous=page.locator('[name="generousRecall"]');assert.equal(await generous.isChecked(),false);
    await generous.check();assert.equal(await page.evaluate(()=>settings.generousRecall),true);
    const choices=page.locator('[name^="selectionFocus."]');assert.equal(await choices.count(),5);assert.equal(await page.locator('[name^="selectionFocus."]:checked').count(),0);
    const labels=['affection','meaning','boundaries','preferences','details'];
    for(const label of labels)await page.locator('[name="selectionFocus.'+label+'"]').check();
    assert.equal(await page.evaluate(()=>settings.selectionFocus.length),5);
    await page.reload();await open();assert.equal(await page.locator('[name^="selectionFocus."]:checked').count(),5);
    assert.equal(await generous.isChecked(),true);assert(await generous.isEnabled());
    for(const label of labels.slice(2))await page.locator('[name="selectionFocus.'+label+'"]').uncheck();
    await page.locator('[name="mode"]').selectOption('embedding');
    assert(await generous.isDisabled());
    for(const choice of await choices.all())assert(await choice.isDisabled());
    assert((await page.locator('[data-selection-focus-status]').textContent()).includes('적용되지'));
    await page.reload();await open();assert.equal(await page.locator('[name^="selectionFocus."]:checked').count(),2);
    await page.locator('[name="mode"]').selectOption('questions');
    assert(await generous.isEnabled());assert(await generous.isChecked());
    for(const choice of await choices.all())assert(await choice.isEnabled());
    assert.deepEqual(await page.evaluate(()=>settings.selectionFocus),['affection','meaning']);
    for(const width of [320,390,1000]){
        await page.setViewportSize({width,height:1000});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        assert.equal(await choices.evaluateAll(items=>items.filter(e=>!e.hasAttribute('aria-describedby')).length),0);
        assert(await generous.getAttribute('aria-describedby'));
        await page.screenshot({path:'/tmp/archive-lore-selection-focus-'+width+'.png',fullPage:true});
    }
    for(const label of labels.slice(0,2))await page.locator('[name="selectionFocus.'+label+'"]').uncheck();
    await generous.uncheck();
    await page.reload();await open();assert.deepEqual(await page.evaluate(()=>settings.selectionFocus),[]);
    assert.equal(await page.evaluate(()=>settings.generousRecall),false);
    assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.errors),[]);
    console.log('Selection focus: five choices, multi-select persistence, clearing, embedding bypass, help and mobile/desktop layout passed.');
}finally{await browser.close();server.close();}
