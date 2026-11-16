// Planning Center import test with a fake Planning Center API: node pco-test.js (server on :8765)
const { chromium } = require('playwright');
const OUT = __dirname + '/shots/';
const LYRICS_1 = `VERSE 1
Grace alone which God supplies
Strength unknown He will provide
Christ in us our cornerstone
We will go forth in grace alone

CHORUS
Grace alone which God supplies
Strength unknown He will provide

VERSE 2
Second verse line one
Second verse line two

BRIDGE
Bridge line`;
const api = {
  '': { data: { type: 'Organization', id: '1', attributes: { name: 'North Coast Family Fellowship' } } },
  songs1: { data: [
    { id: '19298822', attributes: { title: 'Grace Alone', author: 'Dustin Kensrue', copyright: '2013 Dead Bird Theology', ccli_number: 7004659 } },
    { id: '25156302', attributes: { title: 'I Speak Jesus', author: 'Abby Benton, Carlene Prince', copyright: '2019 Here Be Lions', ccli_number: 7136201 } },
  ], links: { next: 'https://api.planningcenteronline.com/services/v2/songs?page2' }, meta: { total_count: 4 } },
  songs2: { data: [
    { id: '3', attributes: { title: 'No Lyrics Song', author: '', copyright: '', ccli_number: null } },
    { id: '4', attributes: { title: 'Hidden Song', author: '', hidden: true } },
  ], links: {}, meta: { total_count: 4 } },
  arr19298822: { data: [
    { id: 'a0', attributes: { name: 'Chord chart only', lyrics: '', sequence: [] } },
    { id: 'a1', attributes: { name: 'The Modern Post', lyrics: LYRICS_1, sequence: ['Verse 1', 'Chorus 1', 'Verse 2', 'Chorus', 'Bridge', 'Instrumental', 'Chorus'] } },
    { id: 'a2', attributes: { name: 'Kids Short', lyrics: LYRICS_1, sequence: ['Verse 1', 'Chorus'] } },
  ], links: {} },
  arr25156302: { data: [{ id: 'b1', attributes: { name: 'Default Arrangement', lyrics: 'Verse 1\nYour name is a light\nThe shadows know\n\nChorus\nI speak Jesus\nCCLI Song # 7136201', sequence: [] } }], links: {} },
  arr3: { data: [{ id: 'c1', attributes: { name: 'Default', lyrics: null, sequence: [] } }], links: {} },
};
(async () => {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const calls = [];
  await ctx.route('https://api.planningcenteronline.com/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    calls.push(u.pathname + u.search.slice(0, 20) + ' auth=' + !!req.headers()['authorization']);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,accept', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.headers()['authorization'] !== 'Basic ' + Buffer.from('APPID:SECRET').toString('base64')) return route.fulfill({ status: 401, headers, body: '{}' });
    let key = u.pathname.replace('/services/v2', '').replace(/^\//, '');
    if (key === 'songs') key = u.search.includes('page2') ? 'songs2' : 'songs1';
    const m = key.match(/^songs\/(\w+)\/arrangements/); if (m) key = 'arr' + m[1];
    return route.fulfill({ status: api[key] ? 200 : 404, headers, body: JSON.stringify(api[key] || {}) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:8765/?demo');
  await page.waitForSelector('#build:not(.hidden)');
  await page.click('[data-tab=settings]');
  await page.click('[data-sec=pco]');
  await page.fill('#pco-app', 'APPID'); await page.fill('#pco-secret', 'WRONG');
  await page.click('#pco-save'); await page.waitForTimeout(400);
  console.log('wrong secret:', await page.$eval('#pco-test', (e) => e.textContent));
  await page.fill('#pco-secret', 'SECRET');
  await page.click('#pco-save'); await page.waitForTimeout(400);
  console.log('right secret:', await page.$eval('#pco-test', (e) => e.textContent));

  await page.click('[data-tab=songs]');
  await page.click('#song-pco');
  await page.waitForSelector('#pco-list li[data-pco]');
  console.log('status:', await page.$eval('#pco-status', (e) => e.textContent), '| rows:', await page.$$eval('#pco-list li[data-pco]', (l) => l.length));
  await page.fill('#pco-search', 'grace');
  console.log('search "grace":', await page.$$eval('#pco-list li[data-pco] strong', (l) => l.map((x) => x.textContent)));
  await page.click('#pco-list li[data-pco="19298822"] .name');
  await page.waitForSelector('#pco-import-one');
  console.log('arrangements offered:', await page.$$eval('#pco-arr option', (o) => o.map((x) => x.textContent)));
  console.log('order shown:', await page.$eval('#pco-detail p:nth-of-type(2)', (e) => e.textContent));
  await page.screenshot({ path: OUT + 'pco-1-browser.png' });
  await page.click('#pco-import-one');
  await page.waitForTimeout(200);
  await page.fill('#pco-search', '');
  await page.check('[data-check="25156302"]'); await page.check('[data-check="3"]');
  await page.click('#pco-import-checked');
  await page.waitForFunction(() => /Imported \d/.test(document.querySelector('#pco-status').textContent));
  console.log('bulk:', await page.$eval('#pco-status', (e) => e.textContent));
  console.log('badges:', await page.$$eval('#pco-list li[data-pco]', (l) => l.map((x) => x.querySelector('strong').textContent + (x.querySelector('.lib-badge') ? ' [in library]' : ''))));
  await page.click('#pco-close');
  await page.waitForTimeout(300);
  const songs = await page.evaluate(() => Store.data.songs.map((s) => ({ t: s.title, arr: s.arrangement, ccli: s.ccli, lyricsEnd: s.lyrics.slice(-20), slides: Songs.buildSlides(s, Store.data.settings).map((x) => x.label).join(' | ') })));
  console.log('library songs:', JSON.stringify(songs, null, 1));
  await page.click('#song-list li:has-text("Grace Alone")');
  await page.waitForSelector('#song-pco-update');
  console.log('editor tag:', await page.$eval('.pco-tag', (e) => e.textContent + ' | ' + e.title));
  await page.evaluate(() => { Store.data.songs.find((s) => s.title === 'Grace Alone').background = 'none'; });
  await page.click('#song-pco-update');
  await page.waitForTimeout(500);
  console.log('after update, background kept:', await page.evaluate(() => Store.data.songs.find((s) => s.title === 'Grace Alone').background), '| songs:', await page.evaluate(() => Store.data.songs.length));
  await page.screenshot({ path: OUT + 'pco-2-editor.png' });
  console.log('API calls:', calls.length, '| ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
