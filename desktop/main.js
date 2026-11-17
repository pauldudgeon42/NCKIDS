/*
 * NC Kids Presenter — Mac app (Electron main process).
 *
 * The app is the same set of web files as the browser version (index.html, css/, js/).
 * This file adds what a web page can't do on its own:
 *   - keeps the library folder on disk and serves its files to the page (nclib://)
 *   - opens the TV window full screen on the TV automatically
 *   - talks to Planning Center from here, where the browser's CORS rule doesn't apply
 *   - keeps the Planning Center token encrypted with the Mac Keychain (safeStorage)
 *
 * Start it with `npm start`. `npm run smoke` runs the self-check used by GitHub Actions.
 */
const { app, BrowserWindow, protocol, net, ipcMain, dialog, screen, shell, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { pathToFileURL } = require('url');
const { Readable } = require('stream');

const APP_ROOT = path.join(__dirname, '..');
const SMOKE = process.argv.includes('--smoke-test');

if (SMOKE) {
  // Use a throwaway profile and library so the self-check never touches real data.
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nckids-smoke-'));
  app.setPath('userData', path.join(tmp, 'profile'));
  process.env.NC_SMOKE_LIBRARY = path.join(tmp, 'NC Kids Library');
  fs.mkdirSync(process.env.NC_SMOKE_LIBRARY, { recursive: true });
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'nclib', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'ncfile', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ---------- settings kept by the app (not in the library) ----------
const configFile = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch (e) { return {}; }
}
function writeConfig(c) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(c, null, 2));
}
let libraryPath = null;
function loadLibraryPath() {
  const p = SMOKE ? process.env.NC_SMOKE_LIBRARY : readConfig().libraryPath;
  libraryPath = p && fs.existsSync(p) ? p : null;
}

/** A path inside the library, refusing anything that would step outside it. */
function inLibrary(rel) {
  if (!libraryPath) throw new Error('No library folder is open.');
  const full = path.resolve(libraryPath, String(rel || ''));
  if (full !== libraryPath && !full.startsWith(libraryPath + path.sep)) throw new Error('Path outside the library: ' + rel);
  return full;
}

// ---------- serving files ----------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.woff2': 'font/woff2',
};

/** Serve a file from disk, with byte ranges so videos can seek. */
async function serveFile(file, request) {
  let stat;
  try { stat = await fsp.stat(file); } catch (e) { return new Response('Not found', { status: 404 }); }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.get('range');
  const m = range && range.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    let start = m[1] ? Number(m[1]) : stat.size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : stat.size - 1;
    start = Math.max(0, start); end = Math.min(stat.size - 1, end);
    if (start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(body, { status: 206, headers: {
      'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': 'app://local',
    } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: {
    'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': 'app://local',
  } });
}

/** Files picked in an import dialog this session (ncfile:// only serves these). */
const pickedFiles = new Set();

function registerProtocols() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(APP_ROOT, rel);
    if (!file.startsWith(APP_ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    return serveFile(file, request);
  });
  protocol.handle('nclib', (request) => {
    try {
      const url = new URL(request.url);
      return serveFile(inLibrary(decodeURIComponent(url.pathname).replace(/^\/+/, '')), request);
    } catch (e) { return new Response(e.message, { status: 404 }); }
  });
  protocol.handle('ncfile', (request) => {
    const url = new URL(request.url);
    const file = decodeURIComponent(url.searchParams.get('p') || '');
    if (!pickedFiles.has(file)) return new Response('Forbidden', { status: 403 });
    return serveFile(file, request);
  });
}

// ---------- windows ----------
let mainWindow = null;
let tvWindow = null;

function externalDisplay() {
  const primary = screen.getPrimaryDisplay();
  const parentBounds = mainWindow ? mainWindow.getBounds() : primary.bounds;
  const here = screen.getDisplayMatching(parentBounds);
  return screen.getAllDisplays().find((d) => d.id !== here.id) || null;
}

function placeTv(win) {
  const ext = externalDisplay();
  if (!ext) { win.setSize(1280, 720); win.center(); return false; }
  win.setBounds(ext.bounds);
  if (process.platform === 'darwin') win.setSimpleFullScreen(true); else win.setFullScreen(true);
  return true;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: 'NC Kids Presenter',
    backgroundColor: '#F3F4F6',
    show: !SMOKE || process.env.NC_SMOKE_SHOW === '1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === 'nckids_tv') {
      return { action: 'allow', overrideBrowserWindowOptions: {
        title: 'NC Kids — TV', backgroundColor: '#000000', frame: false, autoHideMenuBar: true,
        width: 1280, height: 720, show: !SMOKE || process.env.NC_SMOKE_SHOW === '1',
        webPreferences: { contextIsolation: true, sandbox: true },
      } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-create-window', (win, details) => {
    if (details.frameName !== 'nckids_tv') return;
    tvWindow = win;
    placeTv(win);
    win.on('closed', () => { tvWindow = null; });
  });
  // Links opened by clicking (e.g. Planning Center help) go to the real browser.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  mainWindow.on('closed', () => { mainWindow = null; if (tvWindow) tvWindow.close(); });
  mainWindow.loadURL('app://local/index.html');
  return mainWindow;
}

// When a TV is plugged in while the TV window is open, move it there.
function watchDisplays() {
  screen.on('display-added', () => { if (tvWindow && !tvWindow.isDestroyed()) placeTv(tvWindow); });
  screen.on('display-removed', () => {
    if (tvWindow && !tvWindow.isDestroyed() && !externalDisplay()) {
      if (process.platform === 'darwin') tvWindow.setSimpleFullScreen(false); else tvWindow.setFullScreen(false);
      tvWindow.setSize(1280, 720); tvWindow.center();
    }
  });
}

// ---------- talking to the page ----------
function registerIpc() {
  ipcMain.handle('lib:current', () => libraryPath ? { path: libraryPath, name: path.basename(libraryPath) } : null);
  ipcMain.handle('lib:choose', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the library folder', buttonLabel: 'Use this folder',
      message: 'Pick the folder that holds your NC Kids library, or make a new empty one.',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    libraryPath = r.filePaths[0];
    if (!SMOKE) writeConfig(Object.assign(readConfig(), { libraryPath }));
    return { path: libraryPath, name: path.basename(libraryPath) };
  });

  ipcMain.handle('fs:readText', async (e, rel) => {
    try { return await fsp.readFile(inLibrary(rel), 'utf8'); } catch (err) { if (err.code === 'ENOENT' || err.code === 'EISDIR') return null; throw err; }
  });
  const ensureDir = (file) => fsp.mkdir(path.dirname(file), { recursive: true });
  ipcMain.handle('fs:writeText', async (e, rel, text) => {
    const file = inLibrary(rel); await ensureDir(file);
    // write to a temporary file first so library.json is never left half-written
    const tmp = file + '.tmp-' + process.pid;
    await fsp.writeFile(tmp, text, 'utf8'); await fsp.rename(tmp, file);
    return rel;
  });
  ipcMain.handle('fs:writeBytes', async (e, rel, bytes) => {
    const file = inLibrary(rel); await ensureDir(file);
    await fsp.writeFile(file, Buffer.from(bytes)); return rel;
  });
  ipcMain.handle('fs:copyIn', async (e, src, rel) => {
    const file = inLibrary(rel); await ensureDir(file);
    await fsp.copyFile(src, file); return rel;
  });
  ipcMain.handle('fs:remove', async (e, rel) => { await fsp.rm(inLibrary(rel), { recursive: true, force: true }); return true; });
  ipcMain.handle('fs:list', async (e, rel) => {
    try { return await fsp.readdir(inLibrary(rel)); } catch (err) { return []; }
  });

  // Import from a folder (e.g. a curriculum download): list the files, then let the page read them via ncfile://
  ipcMain.handle('pick:folderFiles', async (e, exts) => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose a folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const root = r.filePaths[0];
    const out = [];
    const walk = async (dir) => {
      for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
        if (ent.name.startsWith('.')) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) await walk(full);
        else if (!exts || exts.includes(path.extname(ent.name).slice(1).toLowerCase())) {
          const st = await fsp.stat(full);
          pickedFiles.add(full);
          out.push({ path: full, name: ent.name, size: st.size, type: MIME[path.extname(ent.name).toLowerCase()] || '' });
        }
      }
    };
    await walk(root);
    return { folder: path.basename(root), files: out };
  });

  // Planning Center (and other web requests the page isn't allowed to make itself)
  const ALLOWED_HOSTS = ['api.planningcenteronline.com'];
  ipcMain.handle('http:request', async (e, url, opts = {}) => {
    const u = new URL(url);
    const host = u.hostname;
    const ok = ALLOWED_HOSTS.includes(host) || (opts.followFrom && /(^|\.)amazonaws\.com$|(^|\.)planningcenteronline\.com$|(^|\.)planningcenterusercontent\.com$/.test(host));
    if (!ok) throw new Error('Not allowed: ' + host);
    const res = await net.fetch(url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body || undefined });
    const out = { status: res.status, ok: res.ok, retryAfter: res.headers.get('retry-after'), contentType: res.headers.get('content-type') || '' };
    if (opts.saveTo) { // download straight into the library (attachments)
      const file = inLibrary(opts.saveTo); await ensureDir(file);
      await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
      out.saved = opts.saveTo;
    } else out.text = await res.text();
    return out;
  });

  // Secrets (the Planning Center token), encrypted with the Mac Keychain
  const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');
  const readSecrets = () => { try { return JSON.parse(fs.readFileSync(secretsFile(), 'utf8')); } catch (e) { return {}; } };
  ipcMain.on('secret:get', (e, key) => {
    const v = readSecrets()[key];
    try { e.returnValue = v ? (safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : v) : null; }
    catch (err) { e.returnValue = null; }
  });
  ipcMain.on('secret:set', (e, key, value) => {
    const all = readSecrets();
    all[key] = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : value;
    fs.mkdirSync(path.dirname(secretsFile()), { recursive: true });
    fs.writeFileSync(secretsFile(), JSON.stringify(all), { mode: 0o600 });
    e.returnValue = true;
  });
  ipcMain.on('secret:remove', (e, key) => {
    const all = readSecrets(); delete all[key];
    fs.writeFileSync(secretsFile(), JSON.stringify(all), { mode: 0o600 });
    e.returnValue = true;
  });

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, smoke: SMOKE }));
  ipcMain.handle('tv:status', () => ({ open: !!tvWindow, onTv: !!externalDisplay() }));
}

function grantPermissions() {
  const allowed = new Set(['media', 'speaker-selection', 'fullscreen', 'window-management', 'clipboard-sanitized-write', 'fileSystem']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
}

// ---------- self-check for GitHub Actions ----------
async function runSmokeTest(win) {
  const errors = [];
  win.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
    const level = event && event.level !== undefined ? event.level : legacyLevel;
    const message = event && event.message !== undefined ? event.message : legacyMessage;
    // fonts.googleapis.com may be unreachable on a build machine; that's not an app error
    if ((level === 'error' || level === 3) && !/fonts\.(googleapis|gstatic)\.com/.test(String(message))) errors.push(String(message));
  });
  const results = {};
  const done = (code) => {
    console.log('SMOKE RESULTS ' + JSON.stringify(Object.assign(results, { errors }), null, 2));
    console.log(code === 0 ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED');
    app.exit(code);
  };
  const timer = setTimeout(() => { results.timeout = true; done(1); }, 60000);
  try {
    await new Promise((r) => win.webContents.once('did-finish-load', r));
    await new Promise((r) => setTimeout(r, 2500));
    const js = (code) => win.webContents.executeJavaScript(code, true);
    Object.assign(results, await js(`(async () => {
      const r = { version: window.NCApp && NCApp.version, desktop: !!window.NCDesktop, libraryOpen: !!(Store.root && Store.root.desktop),
                  folder: Store.folderName, setupHidden: document.getElementById('setup').classList.contains('hidden') };
      await Store.writeFile('media/smoke.txt', 'hello library');
      r.readBack = await Store.readText('media/smoke.txt');
      const url = await Store.url('media/smoke.txt');
      r.served = await (await fetch(url)).text();
      const part = await fetch(url, { headers: { Range: 'bytes=6-12' } });
      r.rangeStatus = part.status; r.rangeText = await part.text();
      await Store.saveNow();
      r.libraryJson = !!(await Store.readText('library.json'));
      await Store.remove('media/smoke.txt');
      r.removed = (await Store.readText('media/smoke.txt')) === null;
      PCO.saveCredentials('APP', 'SECRET'); r.secretRoundTrip = PCO.credentials().secret === 'SECRET'; PCO.forget();
      await Output.open();
      await new Promise((res) => setTimeout(res, 1500));
      r.tvOpen = Output.isOpen();
      r.tvOverlayHidden = Output.win && Output.win.document.body.classList.contains('full');
      Output.close();
      return r;
    })()`));
    const ok = results.desktop && results.libraryOpen && results.readBack === 'hello library' && results.served === 'hello library' &&
      results.rangeStatus === 206 && results.rangeText === 'library' && results.libraryJson && results.removed && results.secretRoundTrip &&
      results.tvOpen && results.setupHidden && errors.length === 0;
    clearTimeout(timer);
    done(ok ? 0 : 1);
  } catch (e) {
    results.exception = String(e && e.stack || e);
    clearTimeout(timer);
    done(1);
  }
}

// ---------- start ----------
app.setName('NC Kids Presenter');
app.whenReady().then(() => {
  loadLibraryPath();
  registerProtocols();
  registerIpc();
  grantPermissions();
  watchDisplays();
  const win = createMainWindow();
  if (SMOKE) runSmokeTest(win);
  app.on('activate', () => { if (!mainWindow) createMainWindow(); });
});
app.on('window-all-closed', () => app.quit());
