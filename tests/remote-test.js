// Phone remote test (v1.2): node remote-test.js (app served on :8765)
// Runs the real remote server (desktop/remote-server.js) in this Node process, the
// app in Chrome with a stand-in for the Mac app's bridge, and the phone page in a
// phone-sized browser window.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRemoteServer } = require('../desktop/remote-server');
const OUT = __dirname + '/shots/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const errors = [];
  const check = (name, ok, extra = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); if (!ok) errors.push(name); };

  // A small library folder on disk, for the picture route.
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'nck-remote-'));
  fs.mkdirSync(path.join(lib, 'media'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'media', 'pic.jpg'), fs.readFileSync(path.join(__dirname, '..', 'remote', 'icon.png')));
  fs.writeFileSync(path.join(lib, 'library.json'), '{"secret":true}');

  let app = null; // the app page, once open
  const server = createRemoteServer({
    root: path.join(__dirname, '..', 'remote'),
    libraryPath: () => lib,
    onCommand: (cmd) => { if (app) app.evaluate((c) => window.NCRemoteBridge._cmd(c), cmd).catch(() => {}); },
    onStatus: (st) => { if (app) app.evaluate((s) => window.NCRemoteBridge._st && window.NCRemoteBridge._st(s), st).catch(() => {}); },
  });

  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.exposeFunction('__rbStatus', () => server.status());
  await ctx.exposeFunction('__rbStart', () => server.start(8790));
  await ctx.exposeFunction('__rbStop', () => server.stop());
  await ctx.exposeFunction('__rbNewCode', () => server.newCode());
  await ctx.exposeFunction('__rbPublish', (kind, json) => server.publish(kind, JSON.parse(json)));
  await ctx.addInitScript(() => {
    window.NCRemoteBridge = {
      status: () => window.__rbStatus(), start: () => window.__rbStart(), stop: () => window.__rbStop(), newCode: () => window.__rbNewCode(),
      publish: (k, d) => window.__rbPublish(k, JSON.stringify(d)),
      onCommand(cb) { this._cmd = cb; }, onStatus(cb) { this._st = cb; },
    };
  });
  app = await ctx.newPage();
  app.on('pageerror', (e) => errors.push('app: ' + e.message));
  app.on('dialog', (d) => d.accept());
  await app.goto('http://localhost:8765/?demo');
  await app.waitForSelector('#build:not(.hidden)');
  await app.evaluate(() => document.documentElement.classList.add('desktop'));

  // Content: a section label, a two-slide song, a second song, a timer.
  await app.evaluate(async () => {
    const d = Store.data;
    d.songs.push({ id: 's1', title: 'This Little Light', lyrics: 'Verse 1\nThis little light of mine\nI’m gonna let it shine\n\nChorus\nLet it shine\nLet it shine\nLet it shine', arrangement: '', background: '' });
    d.songs.push({ id: 's2', title: 'Jesus Loves Me', lyrics: 'Verse 1\nJesus loves me this I know\nFor the Bible tells me so', arrangement: '', background: '' });
    d.playlists.push({ id: 'p1', title: 'Sunday School', date: '2026-11-22', items: [
      { id: 'i0', type: 'label', title: 'Worship' }, { id: 'i1', type: 'song', ref: 's1' }, { id: 'i2', type: 'song', ref: 's2' }, { id: 'i3', type: 'timer', ref: 't-cleanup' }] });
    d.playlists.push({ id: 'p2', title: 'Midweek', date: '2026-11-25', items: [{ id: 'j1', type: 'song', ref: 's2' }] });
    d.settings.lastPlaylist = 'p1';
    await Store.saveNow();
  });
  await app.click('[data-mode=present]');
  await app.waitForSelector('#present-slides .slide-card');

  // Mac: open Phone remote and turn it on
  check('Phone button shows in the Mac app', await app.isVisible('#phone-btn'));
  await app.click('#phone-btn');
  await app.click('#phone-start');
  await app.waitForSelector('.phone-qr svg');
  const st = server.status();
  const code = await app.$eval('.phone-code', (e) => e.textContent);
  check('modal shows the code and QR', code === st.code && /^\d{4}$/.test(code), code + ' ' + st.pairUrl);
  await app.screenshot({ path: OUT + 'remote-1-mac.png' });
  const base = 'http://127.0.0.1:' + st.port;

  // Security basics
  const j = async (p, body) => { const r = await fetch(base + p, { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  check('wrong code refused', (await j('/api/pair', { code: '99999' })).status === 403);
  check('command without token refused', (await j('/api/cmd', { t: 'x', cmd: 'next' })).status === 401);
  check('events without token refused', (await fetch(base + '/api/events?t=x')).status === 401);
  const tok = (await j('/api/pair', { code })).body.token;
  check('right code pairs', !!tok);
  check('picture route serves images', (await fetch(`${base}/lib/media/pic.jpg?t=${tok}`)).status === 200);
  check('picture route needs a token', (await fetch(`${base}/lib/media/pic.jpg?t=nope`)).status === 401);
  check('picture route refuses non-pictures', (await fetch(`${base}/lib/library.json?t=${tok}`)).status === 403);
  check('picture route refuses paths outside the library', [403, 404].includes((await fetch(`${base}/lib/..%2F..%2Fetc%2Fpasswd.jpg?t=${tok}`)).status));

  // Phone: open the QR link
  const phoneCtx = await browser.newContext(Object.assign({}, devices['iPhone 13'], { defaultBrowserType: undefined }));
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', (e) => errors.push('phone: ' + e.message));
  phone.on('dialog', (d) => d.accept());
  await phone.goto(st.pairUrl.replace(/^http:\/\/[^/]+/, base));
  await phone.waitForSelector('#app:not(.hidden)');
  await phone.waitForFunction(() => document.querySelector('#pl-title').textContent === 'Sunday School');
  check('QR link pairs and strips the key from the address', !phone.url().includes('#p='), phone.url());
  await sleep(300);
  check('Mac counts the phone', server.status().phones === 2 && (await app.$eval('#phone-btn', (e) => e.textContent)).includes('1'));
  console.log('  up next:', await phone.$eval('#next-title', (e) => e.textContent), '|', await phone.$eval('#next-sub', (e) => e.textContent));
  await phone.screenshot({ path: OUT + 'remote-2-phone-start.png' });

  // Next from the phone
  const liveOnMac = () => app.evaluate(() => NCApp._P.live && [NCApp._P.live.item, NCApp._P.live.slide]);
  await phone.click('#btn-next');
  await phone.waitForFunction(() => document.querySelector('#live-tag').textContent === 'Live');
  check('Next starts the first song (skipping the label)', JSON.stringify(await liveOnMac()) === '[1,0]');
  check('phone shows the lyrics live', (await phone.$eval('#live-screen .lyr', (e) => e.textContent)).includes('This little light'));
  await phone.click('#btn-next');
  await sleep(400);
  check('Next again goes to slide 2', JSON.stringify(await liveOnMac()) === '[1,1]');
  check('up next is the following song', (await phone.$eval('#next-title', (e) => e.textContent)) === 'Jesus Loves Me');
  await phone.screenshot({ path: OUT + 'remote-3-phone-live.png' });
  await phone.click('[data-cmd=back]');
  await sleep(400);
  check('Back goes back', JSON.stringify(await liveOnMac()) === '[1,0]');

  // Black, Clear
  await phone.click('#btn-black');
  await sleep(400);
  check('Black from the phone', await app.evaluate(() => Output.state.black) && (await phone.$eval('#live-tag', (e) => e.textContent)) === 'Black');
  await phone.click('#btn-black');
  await phone.click('[data-cmd=clear]');
  await sleep(400);
  check('Clear from the phone', (await liveOnMac()) === null && (await phone.$eval('#live-tag', (e) => e.textContent)) === 'Cleared');

  // Playlist tab: tap a slide
  await phone.click('[data-tab=playlist]');
  await phone.click('[data-toggle="2"]');
  await phone.click('.tile[data-item="2"][data-slide="0"]');
  await sleep(500);
  check('tapping a slide puts it on the TV', JSON.stringify(await liveOnMac()) === '[2,0]');
  check('playlist marks done / now', (await phone.$$eval('.item', (els) => els.map((e) => e.className.split(' ')[1] || '-').join(','))) === 'done,now,next');
  check('section label shows', (await phone.$eval('.items .sec', (e) => e.textContent)) === 'Worship');
  await phone.screenshot({ path: OUT + 'remote-4-phone-playlist.png' });

  // Timers tab
  await phone.click('[data-tab=timers]');
  await phone.click('[data-timer=t-cleanup]');
  await sleep(700);
  check('timer starts from the phone', await app.evaluate(() => !!Output.timer && Output.timer.title === 'Cleanup time'));
  await phone.waitForSelector('#timer-strip-2:not(.hidden)');
  await phone.click('#ts2-pause');
  await sleep(400);
  check('pause from the phone', await app.evaluate(() => Output.timer.paused));
  await phone.screenshot({ path: OUT + 'remote-5-phone-timers.png' });
  await phone.click('#timer-strip-2 [data-cmd=timerStop]');
  await sleep(400);
  check('stop from the phone', await app.evaluate(() => !Output.timer));

  // Backgrounds tab (no backgrounds in this library: just "None")
  await phone.click('[data-tab=backgrounds]');
  check('backgrounds tab lists None', (await phone.$$('.bg')).length === 1);

  // Switch playlist
  await phone.click('[data-tab=playlist]');
  await phone.selectOption('#pl-select', 'p2');
  await phone.waitForFunction(() => document.querySelector('#pl-title').textContent === 'Midweek');
  check('switch playlist from the phone', await app.evaluate(() => NCApp._P.playlistId) === 'p2');

  // Mac edits show up on the phone
  await app.evaluate(() => { const p = Store.data.playlists.find((x) => x.id === 'p2'); p.items.push({ id: 'j2', type: 'song', ref: 's1' }); Store.save(); });
  await phone.waitForFunction(() => document.querySelectorAll('.item').length === 2, null, { timeout: 5000 }).catch(() => {});
  check('playlist edits on the Mac reach the phone', (await phone.$$('.item')).length === 2);

  // A second phone with the typed code
  const p2 = await phoneCtx.newPage();
  p2.on('pageerror', (e) => errors.push('phone2: ' + e.message));
  await p2.evaluate(() => 0).catch(() => {});
  await p2.goto(base + '/');
  await p2.evaluate(() => localStorage.removeItem('nckids-remote-token'));
  await p2.reload();
  await p2.waitForSelector('#connect:not(.hidden)');
  await p2.screenshot({ path: OUT + 'remote-6-phone-connect.png' });
  await p2.fill('#code', '0000' === code ? '1111' : '0000');
  await p2.waitForFunction(() => document.querySelector('#connect-msg').textContent.includes('match'));
  check('typed wrong code shows a message', true);
  await p2.fill('#code', code);
  await p2.waitForSelector('#app:not(.hidden)');
  check('typed code pairs a second phone', server.status().phones === 3);

  // New code disconnects phones
  await app.click('#phone-new');
  await phone.waitForSelector('#connect:not(.hidden)', { timeout: 5000 }).catch(() => {});
  check('New code sends phones back to Connect', await phone.isVisible('#connect') && (await phone.$eval('#connect-msg', (e) => e.textContent)).includes('new code'));

  // Turn off
  await app.click('#phone-stop');
  check('Turn off stops the server', !server.status().running && !(await app.$eval('#phone-btn', (e) => e.classList.contains('on'))));

  await browser.close();
  fs.rmSync(lib, { recursive: true, force: true });
  console.log('ERRORS:', errors.length ? errors.join(' ; ') : 'none');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
