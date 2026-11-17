/*
 * Phone remote: a small private web server on the classroom Wi-Fi.
 *
 * Plain Node (no Electron, no packages), so tests can run it directly.
 * desktop/main.js starts it when someone turns on Phone remote.
 *
 *   GET  /                    the phone page (files in remote/)
 *   POST /api/pair            { code } or { pair } -> { token }. The 4-digit code or the QR link's pairing key.
 *   GET  /api/events?t=TOKEN  live updates (Server-Sent Events): setup, playlist, live
 *   POST /api/cmd             { t, cmd, ... } -> passed to the app (next, back, clear, black, logo, go, bg, ...)
 *   GET  /lib/PATH?t=TOKEN    a picture from the library (backgrounds' thumbnails, lesson slides); ?w=480 makes it smaller
 *
 * Only paired phones get a token. Codes and tokens live in memory, so they change
 * whenever the remote is turned on again or someone clicks "New code".
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/remote.css': ['remote.css', 'text/css; charset=utf-8'],
  '/remote.js': ['remote.js', 'text/javascript; charset=utf-8'],
  '/awake.mp4': ['awake.mp4', 'video/mp4'],
  '/icon.png': ['icon.png', 'image/png'],
};
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_FAILS = 8;          // wrong codes allowed before pairing pauses
const LOCK_MS = 60 * 1000;    // how long it pauses

function createRemoteServer(opts) {
  const { root, libraryPath, thumbnail, onCommand, onStatus, name = 'NC Kids Presenter' } = opts;
  let server = null, port = 0;
  let code = '', pairKey = '';
  const tokens = new Map();           // token -> { phone, since }
  const clients = new Set();          // open event streams: { res, token }
  const latest = {};                  // kind -> JSON text (sent to phones as they connect)
  let fails = 0, lockedUntil = 0;
  const thumbCache = new Map();

  const rand = (n) => crypto.randomBytes(n).toString('base64url');
  function newCode() {
    code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    pairKey = rand(12);
    tokens.clear();
    for (const c of clients) { try { send(c.res, 'unpaired', '{}'); c.res.end(); } catch (e) { /* gone */ } }
    clients.clear();
    fails = 0; lockedUntil = 0;
    changed();
    return status();
  }

  function addresses() {
    const out = [];
    for (const [ifname, list] of Object.entries(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family !== 'IPv4' && a.family !== 4) continue;
        if (a.internal || a.address.startsWith('169.254.')) continue;
        out.push({ ifname, address: a.address });
      }
    }
    // Wi-Fi/Ethernet on a Mac is en0/en1; put those first.
    out.sort((a, b) => (/^en\d/.test(b.ifname) - /^en\d/.test(a.ifname)) || a.ifname.localeCompare(b.ifname));
    return out.map((a) => a.address);
  }

  function status() {
    if (!server) return { running: false };
    const ips = addresses();
    const host = ips[0] || '127.0.0.1';
    const base = `http://${host}:${port}/`;
    return {
      running: true, port, code, url: base, pairUrl: `${base}#p=${pairKey}`,
      otherUrls: ips.slice(1).map((ip) => `http://${ip}:${port}/`),
      noNetwork: !ips.length, phones: tokens.size, watching: clients.size,
    };
  }
  const changed = () => { if (onStatus) onStatus(status()); };

  function send(res, event, json) { res.write(`event: ${event}\ndata: ${json}\n\n`); }
  function publish(kind, data) {
    const json = JSON.stringify(data);
    if (latest[kind] === json) return;
    latest[kind] = json;
    for (const c of clients) { try { send(c.res, kind, json); } catch (e) { /* closed */ } }
  }

  function readBody(req, limit = 64 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0; const parts = [];
      req.on('data', (d) => { size += d.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else parts.push(d); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }
  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  const safeEqual = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const tokenOk = (t) => !!t && tokens.has(String(t));

  async function handle(req, res) {
    const url = new URL(req.url, 'http://phone');
    const p = url.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (req.method === 'GET' && STATIC[p]) {
      const [file, type] = STATIC[p];
      fs.readFile(path.join(root, file), (err, buf) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        res.end(buf);
      });
      return;
    }

    if (req.method === 'POST' && p === '/api/pair') {
      const now = Date.now();
      if (now < lockedUntil) return json(res, 429, { error: 'Too many wrong codes. Wait a minute and try again.' });
      let body;
      try { body = await readBody(req, 2048); } catch (e) { return json(res, 400, { error: 'Bad request' }); }
      const ok = (body.code && safeEqual(String(body.code).trim(), code)) || (body.pair && safeEqual(body.pair, pairKey));
      if (!ok) {
        if (++fails >= MAX_FAILS) { lockedUntil = now + LOCK_MS; fails = 0; }
        return json(res, 403, { error: 'That code doesn’t match. Check the code on the Mac.' });
      }
      fails = 0;
      const token = rand(24);
      tokens.set(token, { phone: String(body.phone || '').slice(0, 60), since: now });
      changed();
      return json(res, 200, { token, name });
    }

    if (req.method === 'GET' && p === '/api/events') {
      const t = url.searchParams.get('t');
      if (!tokenOk(t)) return json(res, 401, { error: 'not paired' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      const c = { res, token: t };
      clients.add(c);
      for (const kind of ['setup', 'playlist', 'live']) if (latest[kind]) send(res, kind, latest[kind]);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* closed */ } }, 15000);
      req.on('close', () => { clearInterval(ping); clients.delete(c); changed(); });
      changed();
      return;
    }

    if (req.method === 'POST' && p === '/api/cmd') {
      let body;
      try { body = await readBody(req); } catch (e) { return json(res, 400, { error: 'Bad request' }); }
      if (!tokenOk(body.t)) return json(res, 401, { error: 'not paired' });
      const cmd = Object.assign({}, body); delete cmd.t;
      if (typeof cmd.cmd !== 'string') return json(res, 400, { error: 'no command' });
      try { onCommand(cmd); } catch (e) { return json(res, 500, { error: e.message }); }
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p.startsWith('/lib/')) {
      if (!tokenOk(url.searchParams.get('t'))) { res.writeHead(401); res.end(); return; }
      const lib = libraryPath();
      if (!lib) { res.writeHead(404); res.end(); return; }
      const rel = decodeURIComponent(p.slice(5));
      const full = path.resolve(lib, rel);
      const type = IMAGE_TYPES[path.extname(full).toLowerCase()];
      if (!type || !full.startsWith(lib + path.sep)) { res.writeHead(403); res.end(); return; }
      const w = Math.min(1920, Math.max(0, Number(url.searchParams.get('w')) || 0));
      try {
        const st = await fs.promises.stat(full);
        if (w && thumbnail) {
          const key = `${full}|${st.mtimeMs}|${w}`;
          let buf = thumbCache.get(key);
          if (!buf) {
            buf = await thumbnail(full, w);
            if (buf) { thumbCache.set(key, buf); if (thumbCache.size > 400) thumbCache.delete(thumbCache.keys().next().value); }
          }
          if (buf) {
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' });
            res.end(buf);
            return;
          }
        }
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=3600' });
        fs.createReadStream(full).pipe(res);
      } catch (e) { res.writeHead(404); res.end(); }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }

  function start(preferred = 8765) {
    if (server) return Promise.resolve(status());
    return new Promise((resolve, reject) => {
      const tryPort = (n, left) => {
        const s = http.createServer((req, res) => handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) { /* sent */ } }));
        s.once('error', (err) => {
          if (err.code === 'EADDRINUSE' && left > 0) tryPort(n + 1, left - 1);
          else reject(err);
        });
        s.listen(n, '0.0.0.0', () => {
          server = s; port = s.address().port;
          newCode();
          resolve(status());
        });
      };
      tryPort(preferred, 10);
    });
  }

  function stop() {
    for (const c of clients) { try { send(c.res, 'stopped', '{}'); c.res.end(); } catch (e) { /* gone */ } }
    clients.clear(); tokens.clear();
    const s = server; server = null;
    if (s) { s.close(); if (s.closeAllConnections) s.closeAllConnections(); }
    changed();
    return status();
  }

  return { start, stop, newCode: () => (server ? newCode() : status()), status, publish };
}

module.exports = { createRemoteServer };
