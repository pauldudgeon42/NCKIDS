// Planning Center plan import test (v1.1) against a fake Planning Center. node plan-import-test.js (server on :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const M = __dirname + '/media/';
const OUT = __dirname + '/shots/';
const API = 'https://api.planningcenteronline.com/services/v2';
const item = (id, type, title, extra = {}) => Object.assign({ id, type: 'Item', attributes: { item_type: type, title }, relationships: {}, links: { self: `${API}/service_types/77/plans/900/items/${id}` } }, extra);
const att = (id, filename, type) => ({ id, type: 'Attachment', attributes: { filename, content_type: type, file_size: 1000, updated_at: '2026-11-10T00:00:00Z' }, links: { self: `${API}/attachments/${id}` } });
const DATA = {
  '/service_types': { data: [{ id: '10', attributes: { name: 'Sunday AM' } }, { id: '77', attributes: { name: 'NCKids Sunday Morning' } }], links: {} },
  '/service_types/77/plans?filter=future': { data: [{ id: '900', attributes: { title: 'Noah and the Ark', dates: 'November 22, 2026', sort_date: '2026-11-22T17:00:00Z', items_count: 7 } }] },
  '/service_types/77/plans?filter=past': { data: [{ id: '899', attributes: { title: 'Creation', dates: 'November 15, 2026', sort_date: '2026-11-15T17:00:00Z', items_count: 5 } }] },
  '/service_types/77/plans/900/items': {
    data: [
      item('1', 'header', 'Worship'),
      item('2', 'song', 'Grace Alone', { attributes: { item_type: 'song', title: 'Grace Alone', custom_arrangement_sequence_full: ['Chorus', 'Verse 1', 'Chorus'] },
        relationships: { song: { data: { type: 'Song', id: '501' } }, arrangement: { data: { type: 'Arrangement', id: 'a1' } } } }),
      item('3', 'header', 'Lesson'),
      item('4', 'item', 'Noah slides'),
      item('5', 'item', 'Noah handout PDF'),
      item('6', 'media', 'Memory verse video'),
      item('7', 'item', 'Bonus game'),
    ],
    included: [{ type: 'Song', id: '501', attributes: { title: 'Grace Alone', author: 'Dustin Kensrue', copyright: '2013 Dead Bird Theology', ccli_number: 7004659 } }],
    links: {},
  },
  '/service_types/77/plans/900/items/4/attachments': { data: [att('f2', 'Slide2.jpg', 'image/jpeg'), att('f10', 'Slide10.jpg', 'image/jpeg'), att('f1', 'Slide1.jpg', 'image/jpeg')], links: {} },
  '/service_types/77/plans/900/items/5/attachments': { data: [att('p1', 'Lesson4.pdf', 'application/pdf')], links: {} },
  '/service_types/77/plans/900/items/6/attachments': { data: [att('v1', 'Memory_Verse.mp4', 'video/mp4')], links: {} },
  '/service_types/77/plans/900/items/7/attachments': { data: [att('x1', 'Game.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')], links: {} },
  '/songs/501/arrangements': { data: [{ id: 'a1', attributes: { name: 'Kids', lyrics: 'VERSE 1\nGrace alone which God supplies\nStrength unknown He will provide\n\nCHORUS\nGrace alone', sequence: ['Verse 1', 'Chorus'] } }], links: {} },
};
const FILES = { f1: 'Slide1.jpg', f2: 'Slide2.jpg', f10: 'Slide10.jpg', p1: 'Lesson4.pdf', v1: 'Lesson_Video.mp4' };
(async () => {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const calls = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,accept,content-type', 'access-control-allow-methods': 'GET,POST' };
  await ctx.route('https://api.planningcenteronline.com/**', (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const p = u.pathname.replace('/services/v2', '');
    calls.push(req.method() + ' ' + p);
    const open = p.match(/^\/attachments\/(\w+)\/open$/);
    if (open && req.method() === 'POST') return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ data: { attributes: { attachment_url: 'https://files.example.test/' + open[1] } } }) });
    const filter = u.searchParams.get('filter');
    const key = filter ? `${p}?filter=${filter}` : p;
    const body = DATA[key] || (p === '' || p === '/' ? { data: { attributes: { name: 'North Coast' } } } : { data: [], links: {} });
    return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify(body) });
  });
  await ctx.route('https://files.example.test/**', (route) => {
    const id = route.request().url().split('/').pop();
    return route.fulfill({ status: 200, headers: cors, body: fs.readFileSync(M + FILES[id]) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => { if (d.type() === 'alert') console.log('alert:', d.message().replace(/\n+/g, ' | ')); d.accept(); });
  await page.goto('http://localhost:8765/?demo');
  await page.waitForSelector('#build:not(.hidden)');
  await page.evaluate(() => PCO.saveCredentials('APP', 'SECRET'));
  await page.click('[data-tab=playlists]');
  await page.click('#pl-import');
  await page.waitForSelector('#plan-list [data-plan]');
  console.log('service type picked:', await page.$eval('#plan-st', (s) => s.selectedOptions[0].textContent));
  console.log('plans:', await page.$$eval('#plan-list li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
  await page.click('[data-plan="900"]');
  await page.waitForSelector('.plan-items li');
  console.log('preview:', await page.$$eval('.plan-items li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim())));
  await page.screenshot({ path: OUT + 'plan-1-preview.png' });
  console.log('button:', await page.$eval('#plan-go', (b) => b.textContent));
  await page.click('#plan-go');
  await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('show'), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const pl = await page.evaluate(() => { const p = Store.data.playlists[0]; return { title: p.title, date: p.date, items: p.items.map((i) => i.type + ':' + (i.type === 'label' ? i.title : (i.type === 'song' ? Store.data.songs.find((s) => s.id === i.ref).title + (i.arrangement ? ' [' + i.arrangement + ']' : '') : (i.type === 'lesson' ? Store.data.lessons.find((s) => s.id === i.ref).slides.map((x) => x.name).join('+') : Store.data.videos.find((s) => s.id === i.ref).title)))) }; });
  console.log('playlist:', JSON.stringify(pl, null, 1));
  console.log('song slides with plan order:', await page.evaluate(async () => { const it = Store.data.playlists[0].items.find((i) => i.type === 'song'); const s = Object.assign({}, Store.data.songs.find((x) => x.id === it.ref), { arrangement: it.arrangement }); return Songs.buildSlides(s, Store.data.settings).map((x) => x.label).join(' > '); }));
  await page.screenshot({ path: OUT + 'plan-2-playlist.png' });
  // present: labels shown as dividers and skipped by Next
  await page.click('#pl-present');
  await page.waitForSelector('#present-slides .slide-card');
  console.log('present dividers:', await page.$$eval('.p-divider', (d) => d.map((x) => x.textContent).join(', ')), '| left labels:', await page.$$eval('.p-label', (d) => d.map((x) => x.textContent).join(', ')));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  console.log('first Next goes to:', await page.$eval('.p-item.now .name', (e) => e.textContent));
  await page.screenshot({ path: OUT + 'plan-3-present.png' });
  // importing again updates instead of duplicating
  const before = await page.evaluate(() => [Store.data.lessons.length, Store.data.videos.length, Store.data.songs.length, Store.data.playlists.length].join('/'));
  await page.click('[data-mode=build]');
  await page.click('#pl-pco-update');
  await page.waitForSelector('#plan-go:not([disabled])');
  console.log('update button:', await page.$eval('#plan-go', (b) => b.textContent));
  await page.click('#plan-go');
  await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('show'), null, { timeout: 60000 });
  const after = await page.evaluate(() => [Store.data.lessons.length, Store.data.videos.length, Store.data.songs.length, Store.data.playlists.length].join('/'));
  console.log('lessons/videos/songs/playlists before', before, 'after update', after);
  console.log('downloads:', calls.filter((c) => c.endsWith('/open')).length, '| ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
