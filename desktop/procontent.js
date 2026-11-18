/*
 * ProContent window: Renewed Vision's own ProContent website inside the Mac app,
 * with a small toolbar (Back, Forward, Home, Reload) above it. Sign-in is saved in
 * its own browser session ("persist:procontent"), separate from the rest of the app.
 *
 * Downloads from that window are caught here instead of going to the Downloads folder:
 *   - a video or picture is saved to a holding folder, then handed to the page,
 *     which imports it into Backgrounds (the same way as "Import backgrounds")
 *   - a .zip pack is unpacked first, keeping only its videos and pictures
 *   - anything else (PDFs, Photoshop files…) goes to the Mac's Downloads folder as usual
 *
 * No ProContent API is used: this is the public website, signed in with the church's account.
 */
'use strict';
const { BaseWindow, WebContentsView, session, ipcMain, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { extractMedia } = require('./unzip');

const PARTITION = 'persist:procontent';
// "Browse Media" on the ProContent website
const HOME = 'https://procontent.renewedvision.com/search';
const KEEP_DAYS = 180;
const isLoginPage = (url) => { try { return /^\/(login|sign-?in|signin|auth)/i.test(new URL(url).pathname); } catch (e) { return false; } };

/*
 * Fills in the saved email and password on a ProContent sign-in page and presses
 * Sign In. Runs in an isolated world: the page's own scripts can't see these values,
 * only the form fields they end up in (the same as typing them).
 */
const FILL_SCRIPT = (email, password) => `(async (email, password) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => el && el.offsetParent !== null && !el.disabled && !el.readOnly;
  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  for (let t = 0; t < 40; t++) {
    const pw = [...document.querySelectorAll('input[type=password]')].find(visible);
    const em = [...document.querySelectorAll('input[type=email], input[autocomplete=username], input[autocomplete=email], input[name*=email i], input[id*=email i], input[name*=user i]')].find(visible);
    if (pw || em) {
      if (em && em.value !== email) setVal(em, email);
      if (pw) setVal(pw, password);
      const remember = [...document.querySelectorAll('input[type=checkbox]')].find((c) => visible(c) && /remember|keep me|stay signed/i.test(((c.closest('label') || c.parentElement || {}).textContent) || ''));
      if (remember && !remember.checked) remember.click();
      await sleep(200);
      const form = (pw || em).form;
      const btn = (form && form.querySelector('button[type=submit], input[type=submit]')) ||
        [...document.querySelectorAll('button, input[type=submit]')].find((b) => visible(b) && /^(sign in|log in|login|continue|next|submit)$/i.test((b.textContent || b.value || '').trim()));
      if (btn) btn.click(); else if (form) form.requestSubmit();
      return pw ? 'submitted' : 'email';
    }
    await sleep(300);
  }
  return 'none';
})(${JSON.stringify(email)}, ${JSON.stringify(password)})`;

/* Is the page showing a "Sign In" link (so nobody is signed in)? */
const SIGNED_OUT_SCRIPT = `(async () => {
  for (let t = 0; t < 8; t++) {
    const link = [...document.querySelectorAll('a[href*="/login"], a[href*="sign-in"], button')].find((a) => a.offsetParent !== null && /^(sign in|log in)$/i.test(a.textContent.trim()));
    if (link) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
})()`;
const MEDIA_EXT = ['.mp4', '.m4v', '.mov', '.webm', '.jpg', '.jpeg', '.png'];
const BAR = 48;

function setupProContent({ getMainWindow, hasLibrary, allowFile, getSecret, show = true, home = HOME, siteDomain = 'renewedvision.com' }) {
  // Only ProContent's own pages get the saved sign-in (the self-check uses a stand-in site).
  const onSite = (url) => { try { const h = new URL(url).hostname; return h === siteDomain || h.endsWith('.' + siteDomain); } catch (e) { return false; } };
  let win = null, bar = null, site = null;
  let signIn = { tries: 0, submitted: false, note: '' };
  const savedLogin = () => {
    const email = getSecret && getSecret('procontent.email'), password = getSecret && getSecret('procontent.password');
    return email && password ? { email, password } : null;
  };
  const holding = () => path.join(app.getPath('userData'), 'ProContent downloads');
  const active = new Map(); // id -> { name, received, total }

  const tellPage = (msg) => { const m = getMainWindow(); if (m && !m.isDestroyed()) m.webContents.send('pc:download', msg); };
  function barState() {
    if (!bar || !site || site.webContents.isDestroyed()) return;
    const h = site.webContents.navigationHistory;
    let host = '';
    try { host = new URL(site.webContents.getURL()).host; } catch (e) { /* blank */ }
    const dl = [...active.values()];
    bar.webContents.send('pc:bar', {
      canBack: h.canGoBack(), canForward: h.canGoForward(), loading: site.webContents.isLoading(), host, note: signIn.note,
      downloads: dl.map((d) => ({ name: d.name, pct: d.total ? Math.round((100 * d.received) / d.total) : null, unpacking: !!d.unpacking })),
    });
    const total = dl.reduce((a, d) => a + (d.total || 0), 0), got = dl.reduce((a, d) => a + d.received, 0);
    if (win) win.setProgressBar(dl.length ? (total ? got / total : 2) : -1);
  }

  function layout() {
    if (!win) return;
    const { width, height } = win.getContentBounds();
    bar.setBounds({ x: 0, y: 0, width, height: BAR });
    site.setBounds({ x: 0, y: BAR, width, height: Math.max(0, height - BAR) });
  }

  function open() {
    if (win) { win.show(); win.focus(); return; }
    win = new BaseWindow({ width: 1280, height: 860, minWidth: 800, minHeight: 500, title: 'ProContent — NC Kids Presenter', show });
    bar = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'procontent-bar-preload.js'), contextIsolation: true, sandbox: true } });
    site = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    win.contentView.addChildView(site);
    win.contentView.addChildView(bar);
    layout();
    win.on('resize', layout);
    const wc = site.webContents;
    // Sign-in pop-ups (e.g. "Sign in with Google") stay in the ProContent session.
    wc.setWindowOpenHandler(({ url }) => {
      if (!/^https:/i.test(url)) return { action: 'deny' };
      return { action: 'allow', overrideBrowserWindowOptions: { width: 560, height: 760, title: 'ProContent', webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true } } };
    });
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) wc.on(ev, barState);
    signIn = { tries: 0, submitted: false, note: '' };
    wc.on('did-finish-load', () => afterLoad(wc));
    wc.on('did-navigate-in-page', () => afterLoad(wc));
    wc.on('did-navigate', () => keepSignedInSoon());
    wc.on('page-title-updated', (e, title) => win && win.setTitle(`${title} — ProContent`));
    // Keyboard shortcuts like a browser.
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown' || !input.meta) return;
      if (input.key === '[') { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); e.preventDefault(); }
      else if (input.key === ']') { if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); e.preventDefault(); }
      else if (input.key.toLowerCase() === 'r') { wc.reload(); e.preventDefault(); }
      else if (input.key.toLowerCase() === 'w') { win.close(); e.preventDefault(); }
    });
    bar.webContents.loadURL('app://local/desktop/procontent-bar.html');
    bar.webContents.on('did-finish-load', barState);
    wc.loadURL(home);
    win.on('close', () => keepSignedIn());
    win.on('closed', () => {
      try { bar.webContents.close(); site.webContents.close(); } catch (e) { /* already gone */ }
      win = bar = site = null;
    });
  }

  // ----- staying signed in -----
  // Websites often keep a sign-in in "session" cookies, which a browser forgets when it quits.
  // Make ProContent's cookies last KEEP_DAYS so the sign-in survives quitting the app.
  async function keepSignedIn() {
    try {
      const until = Date.now() / 1000 + KEEP_DAYS * 86400;
      for (const c of await ses.cookies.get({})) {
        const domain = String(c.domain || '').replace(/^\./, '');
        if (!(domain === siteDomain || domain.endsWith('.' + siteDomain))) continue;
        if (!c.session && c.expirationDate && c.expirationDate > until - 86400) continue;
        await ses.cookies.set({
          url: `${c.secure ? 'https' : 'http'}://${domain}${c.path || '/'}`, name: c.name, value: c.value,
          domain: c.hostOnly ? undefined : c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
          sameSite: c.sameSite, expirationDate: Math.max(until, c.expirationDate || 0),
        }).catch(() => {});
      }
      await ses.cookies.flushStore();
    } catch (e) { /* not important enough to bother anyone */ }
  }
  let keepTimer = null;
  const keepSignedInSoon = () => { clearTimeout(keepTimer); keepTimer = setTimeout(keepSignedIn, 2500); };

  // ----- saved sign-in -----
  async function afterLoad(wc) {
    const url = wc.getURL();
    if (!onSite(url)) return;
    const login = savedLogin();
    if (isLoginPage(url)) {
      if (!login) return;
      if (signIn.submitted && signIn.tries >= 2) {
        signIn.note = 'The saved sign-in didn’t work. Check it in Settings → ProContent.';
        barState();
        return;
      }
      signIn.tries++;
      try {
        const r = await wc.executeJavaScriptInIsolatedWorld(1999, [{ code: FILL_SCRIPT(login.email, login.password) }]);
        if (r === 'submitted') { signIn.submitted = true; signIn.note = 'Signing in with the saved sign-in…'; barState(); }
      } catch (e) { /* page went away */ }
      return;
    }
    if (signIn.submitted) {
      // Signed in: back to Browse Media, and keep the sign-in.
      signIn = { tries: 0, submitted: false, note: '' };
      barState();
      keepSignedInSoon();
      if (url.replace(/[?#].*$/, '').replace(/\/$/, '') !== home.replace(/\/$/, '')) wc.loadURL(home);
      return;
    }
    // Not signed in but a sign-in is saved: go and sign in (once per window).
    if (login && signIn.tries === 0) {
      try {
        const out = await wc.executeJavaScriptInIsolatedWorld(1999, [{ code: SIGNED_OUT_SCRIPT }]);
        if (out && !wc.isDestroyed() && signIn.tries === 0) wc.loadURL(new URL('/login', url).href);
      } catch (e) { /* page went away */ }
    }
  }

  ipcMain.on('pc:nav', (e, what) => {
    if (!site || !bar || e.sender !== bar.webContents) return;
    const wc = site.webContents;
    if (what === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (what === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    if (what === 'home') wc.loadURL(home);
    if (what === 'reload') wc.reload();
    if (what === 'close') win.close();
  });

  // ----- downloads -----
  const ses = session.fromPartition(PARTITION);
  ses.on('will-download', (event, item) => {
    const name = item.getFilename() || 'download';
    const ext = path.extname(name).toLowerCase();
    if (ext !== '.zip' && !MEDIA_EXT.includes(ext)) {
      // Not a background: save it in Downloads like a normal browser would.
      const dest = uniquePath(app.getPath('downloads'), name);
      item.setSavePath(dest);
      item.once('done', (e, state) => { if (state === 'completed') tellPage({ state: 'elsewhere', name, path: dest }); });
      return;
    }
    if (!hasLibrary()) { item.cancel(); tellPage({ state: 'failed', name, message: 'Open the library folder first (Build → Settings → Library folder).' }); return; }
    const id = crypto.randomUUID();
    const dir = path.join(holding(), id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name.replace(/[/:\\]/g, '_'));
    item.setSavePath(dest);
    const d = { name, received: 0, total: item.getTotalBytes() };
    active.set(id, d);
    tellPage({ id, state: 'started', name, total: d.total });
    barState();
    let last = 0;
    item.on('updated', () => {
      d.received = item.getReceivedBytes(); d.total = item.getTotalBytes();
      const now = Date.now();
      if (now - last > 400) { last = now; tellPage({ id, state: 'progress', name, received: d.received, total: d.total }); barState(); }
    });
    item.once('done', async (e, state) => {
      if (state !== 'completed') {
        active.delete(id); barState();
        fs.rmSync(dir, { recursive: true, force: true });
        tellPage({ id, state: 'failed', name, message: state === 'cancelled' ? 'The download was cancelled.' : 'The download didn’t finish. Try again.' });
        return;
      }
      try {
        let files;
        if (ext === '.zip') {
          d.unpacking = true; barState();
          tellPage({ id, state: 'unpacking', name });
          files = await extractMedia(dest, path.join(dir, 'unpacked'), MEDIA_EXT);
          fs.rmSync(dest, { force: true });
          if (!files.length) throw new Error('This pack has no videos or pictures in it.');
        } else {
          files = [{ path: dest, name, size: fs.statSync(dest).size }];
        }
        files.forEach((f) => allowFile(f.path));
        tellPage({ id, state: 'ready', name, files: files.map((f) => ({ path: f.path, name: f.name, size: f.size, url: 'ncfile://picked/?p=' + encodeURIComponent(f.path) })) });
      } catch (err) {
        fs.rmSync(dir, { recursive: true, force: true });
        tellPage({ id, state: 'failed', name, message: err.message });
      } finally {
        active.delete(id); barState();
      }
    });
  });

  // The page imported (or gave up on) a download: clear its holding folder.
  ipcMain.on('pc:done', (e, id) => {
    if (typeof id === 'string' && /^[\w-]+$/.test(id)) fs.rm(path.join(holding(), id), { recursive: true, force: true }, () => {});
  });
  ipcMain.handle('pc:open', () => { open(); return true; });
  ipcMain.handle('pc:signOut', async () => {
    signIn = { tries: 99, submitted: false, note: '' }; // don't sign straight back in
    await ses.clearStorageData();
    if (site) site.webContents.loadURL(home);
    return true;
  });
  ipcMain.on('pc:openDownloads', (e, file) => { if (typeof file === 'string') shell.showItemInFolder(file); });

  // Leftovers from last time (e.g. the app quit mid-import).
  fs.rm(holding(), { recursive: true, force: true }, () => {});

  app.on('before-quit', () => { keepSignedIn(); });

  return { open, keepSignedIn, get site() { return site; }, get window() { return win; } };
}

function uniquePath(dir, name) {
  const ext = path.extname(name), stem = path.basename(name, ext);
  let p = path.join(dir, name), n = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${stem} (${n++})${ext}`);
  return p;
}

module.exports = { setupProContent, PARTITION };
