// End-to-end smoke test: node e2e.js  (expects a server on :8765 serving the app)
const { chromium } = require('playwright');
const M = __dirname + '/media/';
const OUT = __dirname + '/shots/';
(async () => {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push('popup: ' + e.message)));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.type() === 'prompt' ? d.accept('Lesson 1: Noah') : d.accept());
  const choose = async (clickSel, files) => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(clickSel)]);
    await fc.setFiles(files.map((f) => M + f));
  };
  const idle = () => page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 30000 });

  await page.goto('http://localhost:8765/?demo');
  await page.waitForSelector('#build:not(.hidden)');            // empty library → Build/Backgrounds
  await choose('#media-import', ['bg_blue_loop.mp4', 'bg_space.mp4']); await idle();
  await page.waitForSelector('.media-card');
  await page.click('[data-default]');
  console.log('backgrounds:', await page.$$eval('.media-card', (c) => c.length));

  await page.click('[data-tab=videos]');
  await choose('#media-import', ['Lesson_Video.mp4']); await idle();
  console.log('videos:', await page.$$eval('.media-card', (c) => c.length));

  await page.click('[data-tab=lessons]');
  await choose('#lesson-files', ['Slide10.jpg', 'Slide2.jpg', 'Slide1.jpg', 'Slide3.jpg']); await idle();
  console.log('lesson slide order:', await page.$$eval('#lesson-slides .cap', (c) => c.map((x) => x.textContent.trim())));

  await page.click('[data-tab=songs]');
  await choose('#song-import', ['JesusLovesMe.txt']);
  await page.waitForSelector('#song-title');
  await page.click('.seg [data-view=lyrics]');
  console.log('song:', await page.$eval('#song-title', (e) => e.value), '|', await page.$eval('#song-author', (e) => e.value), '|', await page.$eval('#song-ccli', (e) => e.value));
  await page.waitForSelector('#song-order-add [data-add="Chorus"]');
  await page.click('#song-order-add [data-add="Chorus"]'); // order becomes Verse 1, Chorus, Verse 2, Chorus
  console.log('song bg tiles:', await page.$$eval('#song-bg .bg-tile', (t) => t.map((x) => x.textContent.trim())));
  await page.click('#song-bg .bg-tile[title="bg space"]');
  await page.waitForTimeout(600);
  console.log('song slides:', await page.evaluate(() => Songs.buildSlides(Store.data.songs[0], Store.data.settings).length));
  await page.screenshot({ path: OUT + '1-song-editor.png' });
  // line-splitting: 6 short lines -> 3 + 3; a very long line counts as several screen lines
  await page.click('#song-new');
  await page.waitForFunction(() => document.querySelector('#song-title') && document.querySelector('#song-title').value === 'New song');
  await page.fill('#song-lyrics', 'Verse 1\nOne\nTwo\nThree\nFour\nFive\nSix\n\nChorus\nThis is a really long line of lyrics that goes on and on and will never fit across the screen\nShort line\nAnother line\nLast line');
  await page.waitForTimeout(700);
  const split = await page.evaluate(() => Songs.buildSlides(Store.data.songs.find((x) => x.title === 'New song'), Store.data.settings).map((s) => s.text.split('\n').length));
  console.log('lines per slide (6 lines + long-line chorus):', JSON.stringify(split));
  await page.click('#song-del');

  await page.click('[data-tab=settings]');
  await page.screenshot({ path: OUT + '2a-settings-appearance.png' });
  await page.click('[data-sec=ccli]');
  await page.fill('#set-ccli', '999999');
  await page.click('[data-sec=logo]');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#set-logo')]);
  await fc.setFiles(M + 'logo.png');
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '2-settings.png' });

  await page.click('[data-tab=playlists]');
  await page.click('#pl-new');
  for (const t of ['background', 'song', 'lesson', 'video']) {
    await page.click(`#pick-list li[data-type=${t}] [data-add]`);
  }
  console.log('playlist items:', await page.$$eval('#pl-items li', (l) => l.length));
  await page.screenshot({ path: OUT + '3-playlist.png' });
  console.log('theme in build:', await page.evaluate(() => document.documentElement.dataset.theme));

  await page.click('#pl-present');
  console.log('theme in present:', await page.evaluate(() => document.documentElement.dataset.theme));
  await page.waitForSelector('#present:not(.hidden) .slide-card');
  const [tv] = await Promise.all([ctx.waitForEvent('page'), page.click('#tv-btn')]);
  await page.waitForTimeout(500);
  console.log('tv button:', await page.$eval('#tv-btn', (b) => b.textContent));
  await page.bringToFront();
  await page.keyboard.press('ArrowRight'); // background only
  await page.keyboard.press('ArrowRight'); // song slide 1
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '4-present-song.png' });
  await tv.screenshot({ path: OUT + '5-tv-song.png' });
  console.log('tv text:', await tv.$eval('.r-text-inner', (e) => e.textContent.slice(0, 40) + ' | font ' + e.style.fontSize));
  console.log('tv footer:', await tv.$eval('.r-footer', (e) => e.textContent));
  const bgTitle = () => page.evaluate(() => { const b = Output.state.bg; return b ? Store.data.backgrounds.find((x) => x.id === b.id).title : 'none'; });
  console.log('song uses its own bg:', await bgTitle());
  await page.click('#bg-bank .bg-tile[title="bg blue loop"]');
  await page.waitForTimeout(300);
  console.log('after bank click:', await bgTitle(), '| tv bg video src set:', await tv.$$eval('.r-bg video', (v) => v.length));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  console.log('next slide keeps bank bg:', await bgTitle());
  await page.screenshot({ path: OUT + '4b-present-bank.png' });
  await page.keyboard.press('ArrowLeft');
  console.log('sections shown at once:', await page.$$eval('#present-slides .p-section', (s) => s.length), '| all slide cards:', await page.$$eval('#present-slides .slide-card', (c) => c.length));
  await page.keyboard.press('c');
  await page.keyboard.press('ArrowRight'); // after Clear, Next should continue (song slide 3), not restart
  await page.waitForTimeout(200);
  console.log('after clear + next, live card:', await page.$eval('#present-slides .slide-card.live', (c) => c.dataset.item + '/' + c.dataset.slide));
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'); // rest of song → lesson slide 1
  await page.waitForTimeout(800);
  console.log('live item after song:', await page.$eval('.p-item.now .name', (e) => e.textContent));
  await tv.screenshot({ path: OUT + '6-tv-lesson.png' });
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); // → video
  await page.waitForTimeout(1500);
  const vid = await tv.$eval('.r-video video', (v) => ({ paused: v.paused, t: v.currentTime.toFixed(1), muted: v.muted, w: v.videoWidth }));
  console.log('tv video:', JSON.stringify(vid), '| controls visible:', await page.$eval('#video-controls', (e) => !e.classList.contains('hidden')));
  await page.screenshot({ path: OUT + '7-present-video.png' });
  await page.keyboard.press('b');
  console.log('black on:', await tv.$eval('.r-black', (e) => !e.classList.contains('r-hidden')));
  await page.keyboard.press('b');
  await page.keyboard.press('l');
  console.log('logo on:', await tv.$eval('.r-logo', (e) => !e.classList.contains('r-hidden')));
  await page.waitForTimeout(6000); // video ends → back to background
  console.log('after video ended, video layer hidden:', await tv.$eval('.r-video', (e) => e.classList.contains('r-hidden')));

  // reload: data should persist
  await page.reload();
  await page.waitForSelector('#present:not(.hidden)');
  console.log('after reload playlists:', await page.$$eval('#present-playlist option', (o) => o.map((x) => x.textContent)));
  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
