// Song editor test (v0.5): slides view split/merge/edit, song order chips, per-song look, paste cleanup.
// node song-editor-test.js  (server on :8765)
const { chromium } = require('playwright');
const OUT = __dirname + '/shots/';
const LYRICS = 'Verse 1\nJesus loves me this I know\nFor the Bible tells me so\nLittle ones to Him belong\nThey are weak but He is strong\n\nChorus\nYes Jesus loves me\nThe Bible tells me so';
const PASTE = 'VERSE 2:\nG        D/F#      Em7   C\n[G]Jesus loves me [D]He who died\nHeaven\'s gate to open wide (x2)\n(Instrumental)\nCCLI Song # 1234567\n© 2020 Someone';
(async () => {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const song = () => page.evaluate(() => Store.data.songs[0]);
  const lay = () => page.evaluate(() => Songs.layout(Store.data.songs[0], Store.data.settings).map((s) => s.label + ':' + s.slides.map((x) => x.length).join('+')).join(' | '));
  await page.goto('http://localhost:8765/?demo');
  await page.waitForSelector('#build:not(.hidden)');
  await page.click('[data-tab=songs]');
  await page.click('#song-new');
  await page.waitForSelector('#song-lyrics');
  console.log('new song opens in:', await page.$eval('.seg .on', (b) => b.textContent));
  await page.fill('#song-lyrics', LYRICS);
  // paste a messy chord chart at the end
  await page.$eval('#song-lyrics', (ta, raw) => {
    ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length;
    ta.value += '\n\n'; ta.selectionStart = ta.selectionEnd = ta.value.length;
    const dt = new DataTransfer(); dt.setData('text/plain', raw);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PASTE);
  await page.waitForTimeout(200);
  console.log('cleanup note:', await page.$eval('.cleanup-text', (e) => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log('pasted part became:', JSON.stringify((await song()).lyrics.split('\n\n').pop()));
  await page.screenshot({ path: OUT + 'song-1-lyrics-cleanup.png' });

  await page.click('.seg [data-view=slides]');
  await page.waitForSelector('.se-slide');
  console.log('layout (auto):', await lay());
  // split Verse 1 between line 2 and 3
  await page.hover('[data-split="0:0:2"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'song-2-split-hover.png' });
  await page.click('[data-split="0:0:2"]');
  console.log('after split:', await lay(), '| mode:', (await song()).slideMode);
  await page.click('[data-merge="0:1"]');
  console.log('after merge:', await lay());
  // edit a line in place
  await page.click('[data-line="1:0:0"]');
  await page.keyboard.press('End');
  await page.keyboard.type(', yes!');
  await page.keyboard.press('Enter');
  console.log('edited chorus line:', (await song()).lyrics.split('\n').find((l) => l.startsWith('Yes Jesus')));

  // song order chips
  console.log('order chips:', await page.$$eval('.o-chip', (c) => c.map((x) => x.textContent.trim()).join(' > ')));
  await page.click('[data-add="Chorus"]');
  await page.click('.o-chip [data-remove="0"]');
  console.log('order after add Chorus + remove first:', (await song()).arrangement);
  await page.click('#order-reset');
  console.log('order reset:', JSON.stringify((await song()).arrangement));

  // per-song look
  console.log('uses defaults at start:', await page.$eval('#look-default', (c) => c.checked));
  await page.click('#look-size [data-size=larger]');
  await page.selectOption('#look-pos', 'lower');
  const st = await page.evaluate(() => Songs.effectiveStyle(Store.data.songs[0], Store.data.settings));
  console.log('after larger + lower third: defaults box =', await page.$eval('#look-default', (c) => c.checked), '| maxFontSize', st.maxFontSize, '| position', st.position);
  await page.screenshot({ path: OUT + 'song-3-own-look.png' });
  await page.check('#look-default');
  const back = await song();
  console.log('ticked defaults again → style:', JSON.stringify(back.style), 'background:', JSON.stringify(back.background));
  await page.click('#song-auto');
  console.log('let the app split again → mode:', (await song()).slideMode, '|', await lay());

  // lower third reaches the TV renderer
  await page.click('#look-size [data-size=normal]');
  await page.selectOption('#look-pos', 'lower');
  const pos = await page.evaluate(() => {
    const host = document.createElement('div'); host.style.cssText = 'width:480px;height:270px;position:fixed;left:-2000px'; document.body.appendChild(host);
    const r = new Renderer(host, { staticOnly: true }); const sl = Songs.buildSlides(Store.data.songs[0], Store.data.settings)[0];
    r.setText(sl.text, sl.style); return host.querySelector('.r-text-inner').style.top;
  });
  console.log('TV text top with lower third:', pos);
  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
