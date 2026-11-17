// Countdown timer test (v0.6): node timer-test.js (server on :8765)
const { chromium } = require('playwright');
const OUT = __dirname + '/shots/';
(async () => {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push('tv: ' + e.message)));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:8765/?demo');
  await page.waitForSelector('#build:not(.hidden)');
  console.log('standard timers:', await page.evaluate(() => Store.data.timers.map((t) => t.title + ' ' + t.seconds / 60 + 'm').join(', ')));

  // a playlist: short "Class starts soon" timer, then a song
  await page.evaluate(() => {
    const d = Store.data;
    d.timers.find((t) => t.id === 't-start').seconds = 2;
    d.songs.push({ id: 's1', title: 'Jesus Loves Me', lyrics: 'Verse 1\nJesus loves me this I know\nFor the Bible tells me so', arrangement: '', background: '' });
    d.playlists.push({ id: 'p1', title: 'Sunday School', date: '2026-11-22', items: [{ id: 'i1', type: 'timer', ref: 't-start' }, { id: 'i2', type: 'song', ref: 's1' }] });
    d.settings.lastPlaylist = 'p1';
    Store.save();
  });
  await page.click('[data-tab=settings]');
  await page.click('[data-sec=timers]');
  await page.screenshot({ path: OUT + 'timer-1-settings.png' });

  await page.click('[data-mode=present]');
  await page.waitForSelector('#present-slides .slide-card');
  const [tv] = await Promise.all([ctx.waitForEvent('page'), page.click('#tv-btn')]);
  await page.bringToFront();
  console.log('timer chips:', await page.$$eval('#timer-bank .timer-chip', (c) => c.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));

  // one-click canned timer
  await page.click('[data-timer=t-cleanup]');
  await page.waitForTimeout(1300);
  const tvTimer = () => tv.$eval('.r-timer', (e) => ({ hidden: e.classList.contains('r-hidden'), label: e.querySelector('.r-timer-label').textContent, digits: e.querySelector('.r-timer-digits').textContent, cls: e.className }));
  console.log('TV after Cleanup click:', JSON.stringify(await tvTimer()));
  console.log('controls:', await page.$eval('#tc-time', (e) => e.textContent), '| chip on:', await page.$eval('.timer-chip.on .t-name', (e) => e.textContent));
  await page.screenshot({ path: OUT + 'timer-2-present.png' });
  await tv.screenshot({ path: OUT + 'timer-3-tv.png' });
  await page.click('#tc-pause');
  await page.waitForTimeout(1200);
  const p1 = await page.evaluate(() => Output.timer.remaining.toFixed(1));
  await page.waitForTimeout(800);
  console.log('paused holds steady:', p1 === await page.evaluate(() => Output.timer.remaining.toFixed(1)), '| tv class paused:', (await tvTimer()).cls.includes('paused'));
  await page.click('#tc-pause');
  await page.click('#tc-add');
  console.log('after +1 min:', await page.$eval('#tc-time', (e) => e.textContent));

  // custom 3-second timer runs to the end
  await page.click('#timer-custom-btn');
  await page.fill('#timer-custom-name', 'Snack time');
  await page.fill('#timer-custom-min', '0.05');
  await page.click('#timer-custom-go');
  await page.waitForTimeout(1500);
  console.log('custom running:', JSON.stringify(await tvTimer()));
  await page.waitForTimeout(2600);
  console.log('custom at zero:', JSON.stringify(await tvTimer()), '| controls:', await page.$eval('#tc-time', (e) => e.textContent));
  await tv.screenshot({ path: OUT + 'timer-4-done.png' });
  await page.keyboard.press('c');
  console.log('after Clear: timer hidden', (await tvTimer()).hidden, '| controls hidden', await page.$eval('#timer-controls', (e) => e.classList.contains('hidden')));

  // playlist timer moves on by itself
  await page.click('#present-items .p-item[data-i="0"]');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  console.log('playlist timer live:', await page.$eval('.p-item.now .name', (e) => e.textContent), '|', (await tvTimer()).digits);
  await page.waitForTimeout(5200);
  console.log('after zero + 3 s, live item:', await page.$eval('.p-item.now .name', (e) => e.textContent), '| tv text:', await tv.$eval('.r-text-inner', (e) => e.textContent.slice(0, 26)));
  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
