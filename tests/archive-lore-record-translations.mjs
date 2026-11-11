// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { linkedTranslation, managerSourceHash } from '../lore-translations.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await fs.readFile(new URL('../archive-lore-fork.js', import.meta.url), 'utf8');
const openRecords = source.slice(source.indexOf('async function openRecords(){'), source.indexOf('\nasync function openTools(){'));
assert(openRecords.includes('linkedTranslation(extension_settings,name,entry)'));
const settings = { 'simple-lorebook': {
    translations: {
        'A␟1': { language: 'Korean', text: '두 사람은 부산에 도착했다.\n<script>번역은 텍스트로만 표시</script>', sourceHash: managerSourceHash('They arrived in Busan.') },
        'A␟2': { language: 'Korean', text: '이전 날짜의 번역', sourceHash: managerSourceHash('Old source') },
        'A␟3': { language: 'English', text: 'Wrong selected language', sourceHash: managerSourceHash('Third source') },
        'B␟1': { language: 'Korean', text: '다른 로어북의 번역', sourceHash: managerSourceHash('Other book') },
    },
    entryLanguagePairs: { 'A␟3': { translationLanguage: 'Korean' } },
} };
const books = {
    A: { entries: {
        1: { uid: 1, comment: '부산 도착', content: 'They arrived in Busan.' },
        2: { uid: 2, comment: '날짜 변경', content: 'New source' },
        3: { uid: 3, comment: '번역 언어 변경', content: 'Third source' },
    } },
    B: { entries: { 1: { uid: 1, comment: '다른 책', content: 'Other book', disable: true } } },
    C: { entries: { 1: { uid: 1, comment: '번역 없는 책', content: 'Untranslated' } } },
};
const bridge = `${managerSourceHash.toString()}\n${linkedTranslation.toString()}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    for (const width of [320, 1000]) {
        await page.setViewportSize({ width, height: 850 });
        await page.setContent('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px/1.6 Arial,sans-serif;background:#f8f9fb;color:#303740;margin:14px}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:12px 0}strong{font-size:13px}</style>');
        await page.addStyleTag({content: await fs.readFile(new URL('../lore-fork.css', import.meta.url), 'utf8')});
        await page.evaluate(async ({ settings, books, bridge, openRecords }) => {
            const before = JSON.stringify({ settings, books });
            const search = () => ({ books: () => Object.keys(books), loadBook: async name => books[name] });
            const themedPopup = content => ({ show: async () => document.body.append(content) });
            const run = new Function('extension_settings', 'search', 'themedPopup', `${bridge}\n${openRecords}\nreturn openRecords();`);
            await run(settings, search, themedPopup);
            if (JSON.stringify({ settings, books }) !== before) throw Error('Reading translations mutated data');
            window.reopen = async text => {
                settings['simple-lorebook'].translations['A␟1'].text = text;
                document.body.replaceChildren(); await run(settings, search, themedPopup);
            };
        }, { settings, books, bridge, openRecords });
        await page.locator('details').evaluateAll(items => items.forEach(el => el.open = true));
        assert.equal(await page.locator('details').count(), 5);
        assert.equal(await page.locator('summary').first().evaluate(el=>getComputedStyle(el).textAlign),'right');
        assert.deepEqual(await page.locator('details > summary').allTextContents(), ['부산 도착','날짜 변경','번역 언어 변경','다른 책','번역 없는 책']);
        assert.equal(await page.locator('.al-manager-translation').count(), 3);
        assert.equal(await page.locator('details').nth(0).locator(':scope > pre').textContent(), 'They arrived in Busan.');
        assert.equal(await page.locator('details').nth(0).locator('.al-manager-translation pre').textContent(), settings['simple-lorebook'].translations['A␟1'].text);
        assert.match(await page.locator('details').nth(1).innerText(), /원문 변경됨 \(이전 번역\)/);
        assert.equal(await page.locator('details').nth(2).locator('.al-manager-translation').count(), 0);
        assert.equal(await page.locator('details').nth(3).locator('.al-manager-translation pre').textContent(), '다른 로어북의 번역');
        assert.equal(await page.locator('details').nth(4).locator('.al-manager-translation').count(), 0);
        assert.equal(await page.locator('script').count(), 0);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: `/tmp/archive-record-translations-${width}.png`, fullPage: true });
        await page.evaluate(() => window.reopen('다시 열면 최신 저장된 번역'));
        assert.equal(await page.locator('.al-manager-translation pre').first().textContent(), '다시 열면 최신 저장된 번역');
    }
    assert.deepEqual(errors, []);
    console.log('Saved-records translations: exact book/UID, language selection, stale labels, safe text, read-only data and mobile/desktop passed.');
} finally { await browser.close(); }
