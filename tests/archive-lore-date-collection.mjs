// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const fork=await fs.readFile(root+'archive-lore-fork.js','utf8');
const rangeFunction=fork.slice(fork.indexOf('async function openRange('),fork.indexOf('\nasync function openRecords('));
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/lore-fork.css"><style>
body{font:15px sans-serif;margin:12px;background:#faf8fc;color:#302a38}section{max-width:760px;margin:auto}.menu_button{font:inherit;padding:8px;white-space:normal}.text_pole{font:inherit}dialog{box-sizing:border-box;width:calc(100% - 20px);max-width:760px;padding:12px;max-height:90vh;overflow:auto} .al-search-tools label{display:grid;gap:4px;margin:8px 0}.al-range-actions{display:flex;flex-wrap:wrap;gap:6px} [hidden]{display:none!important}</style><script type="module">
import {createDateCollectionEditor} from '/lore-date-collection-ui.js';
import {dateCollectionSource} from '/lore-date-collection.js';
window.messages=[{mes:'날짜 미상인 시작'},{mes:'Date: November 12, 2028'},{mes:'Same evening'},{mes:'### 2028-11-13'},{mes:'Next morning'}];
const context={chat:messages,chatMetadata:{}};window.calls=[];
const getContext=()=>context,nextCollectionRange=()=>({start:0,end:4});
const native={collectionKey:()=> 'chat',collectRange:async()=>true,catchup:async()=>{},refresh:async()=>{},collectDates:async request=>{calls.push(request.ranges);window.request=request;request.onProgress({phase:'generating',total:request.ranges.length});return new Promise((resolve,reject)=>{window.complete=()=>resolve({saved:request.ranges.length});window.fail=()=>reject(Error('test save failed'));});}};
function themedPopup(node){const dialog=document.createElement('dialog');dialog.append(node);document.body.append(dialog);return{show:()=>dialog.showModal()};}
${rangeFunction}
await openRange();window.ready=true;
</script>`;
const server=http.createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname;
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
 if(path.includes('..'))throw Error('invalid path');
 res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(root+path.slice(1)));
}catch(e){res.statusCode=404;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [320,390,1000]){
  await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
  await page.getByRole('button',{name:'날짜별 수집',exact:true}).click();
  assert.equal(await page.locator('.al-date-row').count(),3);
  assert.equal(await page.locator('input[type=date]').nth(1).inputValue(),'2028-11-12');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await page.evaluate(()=>{const d=document.querySelector('dialog');return d.scrollWidth<=d.clientWidth+1;}));
  await page.getByRole('button',{name:'구간 추가',exact:true}).click();assert.equal(await page.locator('.al-date-row').count(),4);
  await page.getByRole('button',{name:'앞 구간에 합치기'}).nth(1).click();assert.equal(await page.locator('.al-date-row').count(),3);
  const run=page.getByRole('button',{name:'이 구간으로 날짜별 수집'});
  await run.click();assert(await run.isDisabled());assert(await page.getByRole('button',{name:'한 번에 수집',exact:true}).isDisabled());
  await page.evaluate(()=>complete());await page.getByRole('status').filter({hasText:'날짜별 수집 완료'}).waitFor();
  assert.equal(await page.evaluate(()=>calls.length),1);
  if(width===390 && process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
 }
 await page.reload();await page.waitForFunction(()=>window.ready);await page.getByRole('button',{name:'날짜별 수집',exact:true}).click();
 await page.evaluate(()=>messages[0].mes='Changed after preview');await page.getByRole('button',{name:'이 구간으로 날짜별 수집'}).click();
 await page.getByRole('status').filter({hasText:'메시지가 변경되었습니다'}).waitFor();assert.equal(await page.evaluate(()=>calls.length),0);
 assert.deepEqual(errors,[]);console.log('Date collection UI passed at 320/390/1000px; edits, run lock and stale-preview checks passed.');
}finally{await browser.close();server.close();}
