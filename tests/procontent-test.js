// ProContent import test (v1.3): node procontent-test.js (app served on :8765)
// The Mac app catches ProContent downloads (desktop/procontent.js, checked by the
// GitHub self-check). This test plays the part of the Mac app and sends the page
// the same messages, to check what the page does with them.
const { chromium } = require('playwright');
const OUT = __dirname + '/shots/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const errors = [];
  const check = (name, ok, extra = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); if (!ok) errors.push(name); };
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addInitScript(() => {
    window.__pc = { opened: 0, done: [], signedOut: 0 };
    window.NCProContentBridge = {
      open: async () => { window.__pc.opened++; return true; },
      signOut: async () => { window.__pc.signedOut++; return true; },
      done: (id) => window.__pc.done.push(id),
      onDownload(cb) { window.__pc.send = cb; },
    };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:8765/?demo');
  await page.waitForSelector('#build:not(.hidden)');
  await page.evaluate(() => document.documentElement.classList.add('desktop'));

  await page.click('[data-tab=backgrounds]');
  check('ProContent button in Backgrounds', await page.isVisible('#pc-open'));
  await page.click('#pc-open');
  check('button opens the ProContent window', (await page.evaluate(() => window.__pc.opened)) === 1);

  const send = (m) => page.evaluate((x) => window.__pc.send(x), m);
  const M = 'http://localhost:8765/tests/media/';
  await send({ id: 'd1', state: 'started', name: 'Sunrise Pack.zip', total: 1000 });
  check('download start shows a message', (await page.textContent('#toasts, .toast, body')).includes('Downloading “Sunrise Pack.zip”'));
  await send({ id: 'd1', state: 'unpacking', name: 'Sunrise Pack.zip' });
  await send({ id: 'd1', state: 'ready', name: 'Sunrise Pack.zip', files: [
    { path: '/x/Sunrise Blue.mp4', name: 'Sunrise Blue.mp4', size: 1, url: M + 'bg_blue_loop.mp4' },
    { path: '/x/Sunrise Space.mp4', name: 'Sunrise Space.mp4', size: 1, url: M + 'bg_space.mp4' },
    { path: '/x/Sunrise Still.jpg', name: 'Sunrise Still.jpg', size: 1, url: M + 'Slide1.jpg' },
  ] });
  await page.waitForFunction(() => window.__pc.done.includes('d1'), null, { timeout: 15000 });
  const bgs = await page.evaluate(() => Store.data.backgrounds.map((b) => `${b.title}:${b.type}:${b.source}:${!!b.thumb}`).sort().join(', '));
  check('pack imported as backgrounds marked ProContent', bgs === 'Sunrise Blue:video:procontent:true, Sunrise Space:video:procontent:true, Sunrise Still:image:procontent:true', bgs);
  check('holding folder released', (await page.evaluate(() => window.__pc.done.join())) === 'd1');
  await page.waitForSelector('.media-card .badge.source');
  check('grid shows the ProContent tag', (await page.$$('.media-card .badge.source')).length === 3);
  await page.fill('#media-search', 'procontent');
  await page.dispatchEvent('#media-search', 'input');
  check('searching "procontent" finds them', (await page.$$('.media-card')).length === 3);
  await page.fill('#media-search', '');
  await page.dispatchEvent('#media-search', 'input');
  await page.screenshot({ path: OUT + 'procontent-1-backgrounds.png' });

  // A single loop while presenting: shows up in the live background bank.
  await page.click('[data-mode=present]');
  await send({ id: 'd2', state: 'ready', name: 'Ocean Loop.mp4', files: [{ path: '/x/Ocean Loop.mp4', name: 'Ocean Loop.mp4', size: 1, url: M + 'bg_blue_loop.mp4' }] });
  await page.waitForFunction(() => window.__pc.done.includes('d2'), null, { timeout: 15000 });
  await sleep(300);
  check('single loop added and appears in the live bank', (await page.$$eval('#bg-bank .bg-name', (e) => e.map((x) => x.textContent))).includes('Ocean Loop'));

  // A file that isn't a video: reported, holding folder still released.
  await send({ id: 'd3', state: 'ready', name: 'Broken.mov', files: [{ path: '/x/Broken.mov', name: 'Broken.mov', size: 1, url: M + 'JesusLovesMe.txt' }] });
  await page.waitForFunction(() => window.__pc.done.includes('d3'), null, { timeout: 15000 });
  await sleep(300);
  check('unplayable file reported, not added', !(await page.evaluate(() => Store.data.backgrounds.some((b) => b.title === 'Broken'))));
  await send({ id: 'd4', state: 'failed', name: 'Big Pack.zip', message: 'The download was cancelled.' });
  await send({ state: 'elsewhere', name: 'Sermon Slides.psd', path: '/Users/x/Downloads/Sermon Slides.psd' });
  check('other messages show', (await page.textContent('body')).includes('Downloads folder'));

  // Settings section
  await page.click('[data-mode=build]');
  await page.click('[data-tab=settings]');
  await page.click('[data-sec=procontent]');
  check('Settings → ProContent counts downloads', (await page.textContent('#set-main')).includes('4 backgrounds came from ProContent'));
  await page.screenshot({ path: OUT + 'procontent-2-settings.png' });
  await page.click('#pc-signout');
  await sleep(200);
  check('sign out', (await page.evaluate(() => window.__pc.signedOut)) === 1);

  await browser.close();
  console.log('ERRORS:', errors.length ? errors.join(' ; ') : 'none');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
