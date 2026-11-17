/*
 * NC Kids Remote: the page a phone opens to control NC Kids Presenter on the Mac.
 * Served by the Mac app (desktop/remote-server.js). Live updates arrive as
 * Server-Sent Events; buttons send commands with a POST.
 */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (sec) => { sec = Math.max(0, Math.round(sec || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
  const TOKEN_KEY = 'nckids-remote-token';

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* private mode */ }
  let es = null;
  const st = { setup: null, playlist: null, live: null };
  const open = new Set();        // playlist items opened to show their slides
  let lastLiveItem = null;
  let tab = 'remote';

  // ---------- pictures from the library ----------
  const img = (path, w) => path ? `/lib/${path.split('/').map(encodeURIComponent).join('/')}?t=${encodeURIComponent(token)}&w=${w}` : '';

  /** Draw one slide into a 16:9 box. */
  function screenHtml(d, w, extra = '') {
    if (!d) return `<div class="center"><span class="note">Nothing here</span></div>${extra}`;
    const bg = d.bg ? `<img class="bgimg" src="${img(d.bg, w)}" alt="" loading="lazy">` : '';
    if (d.k === 'text') return `${bg}<div class="lyr">${esc(d.text)}</div>${extra}`;
    if (d.k === 'image') return `<img class="fit" src="${img(d.img, w)}" alt="" loading="lazy">${extra}`;
    if (d.k === 'video') return `${d.img ? `<img class="fill" src="${img(d.img, w)}" alt="" loading="lazy">` : ''}<span class="play">Video ${esc(d.l || '')}</span>${extra}`;
    if (d.k === 'timer') return `<div class="center"><span class="t1">${esc(d.title)}</span><span class="t2">${fmt(d.sec)}</span></div>${extra}`;
    if (d.k === 'background') return `${bg}${extra}`;
    return extra;
  }
  const slideAt = (pos) => {
    if (!pos || !st.playlist) return null;
    const it = st.playlist.items[pos.item];
    return it && it.slides ? it.slides[pos.slide] || null : null;
  };
  const itemAt = (pos) => (pos && st.playlist ? st.playlist.items[pos.item] : null);

  // ---------- talking to the Mac ----------
  async function send(cmd, extra) {
    if (!token) return;
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* ignore */ } }
    try {
      const r = await fetch('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ t: token, cmd }, extra || {})) });
      if (r.status === 401) unpaired('The code on the Mac changed. Enter the new code.');
    } catch (e) { offline(true); }
  }

  function offline(on, msg) {
    $('#offline').classList.toggle('hidden', !on);
    $('#conn').classList.toggle('off', !!on);
    if (on) $('#offline').textContent = msg || 'Can’t reach the Mac. Check that NC Kids Presenter is open and this phone is on the same Wi-Fi. Trying again…';
  }

  let retry = null;
  function connect() {
    if (es) es.close();
    clearTimeout(retry);
    es = new EventSource('/api/events?t=' + encodeURIComponent(token));
    es.onopen = () => { offline(false); send('hello'); };
    es.onerror = async () => {
      if (es.readyState === EventSource.CONNECTING) { offline(true); return; } // the browser retries by itself
      // Closed: either the Mac forgot this phone (new code) or it isn't reachable.
      try {
        const r = await fetch('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token, cmd: 'hello' }) });
        if (r.status === 401) return unpaired('The code on the Mac changed. Enter the new code.');
      } catch (e) { /* unreachable */ }
      offline(true);
      retry = setTimeout(connect, 3000);
    };
    for (const kind of ['setup', 'playlist', 'live']) {
      es.addEventListener(kind, (e) => { st[kind] = JSON.parse(e.data); render(kind); });
    }
    es.addEventListener('unpaired', () => unpaired('The Mac made a new code. Enter it to connect again.'));
    es.addEventListener('stopped', () => { offline(true, 'The phone remote was turned off on the Mac.'); });
  }

  function unpaired(msg) {
    if (es) { es.close(); es = null; }
    clearTimeout(retry);
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    showConnect(msg);
  }

  async function pair(body) {
    const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ phone: navigator.userAgent.slice(0, 60) }, body)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not connect.');
    token = j.token;
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ }
    showApp();
  }

  function showConnect(msg) {
    $('#app').classList.add('hidden');
    $('#connect').classList.remove('hidden');
    $('#connect-msg').textContent = msg || '';
    $('#connect-msg').className = 'msg';
    $('#code').value = '';
  }
  function showApp() {
    $('#connect').classList.add('hidden');
    $('#app').classList.remove('hidden');
    connect();
  }

  // ---------- drawing ----------
  function render(kind) {
    if (kind === 'setup') renderSetup();
    if (kind === 'playlist' || kind === 'setup') renderPlaylistPicker();
    renderLive();
    renderItems(kind === 'playlist');
    renderBackgrounds();
    renderTimers();
  }

  function renderSetup() {
    const s = st.setup;
    if (!s) return;
    const root = document.documentElement;
    root.dataset.theme = s.theme === 'light' ? 'light' : 'dark';
    ['--accent', '--accent-ink', '--accent-soft', '--accent-ring', '--accent-text'].forEach((k, i) => { if (s.accent && s.accent[i]) root.style.setProperty(k, s.accent[i]); });
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = s.theme === 'light' ? '#F6F7F9' : '#121418';
    $('#btn-logo').classList.toggle('hidden', !s.logo);
    $('.row4').style.gridTemplateColumns = s.logo ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)';
  }

  function renderPlaylistPicker() {
    const pl = st.playlist, s = st.setup;
    $('#pl-title').textContent = pl ? pl.title : 'No playlist';
    $('#pl-date').textContent = pl ? pl.date || '' : '';
    const sel = $('#pl-select');
    const lists = (s && s.playlists) || [];
    sel.innerHTML = lists.map((p) => `<option value="${esc(p.id)}" ${pl && p.id === pl.id ? 'selected' : ''}>${esc(p.title)}${p.date ? ' · ' + esc(p.date) : ''}</option>`).join('') || '<option>No playlists yet</option>';
  }

  let liveKey = '', nextKey = '';
  function renderLive() {
    const L = st.live;
    if (!L) return;
    $('#tvoff').classList.toggle('hidden', !!L.tv.open);
    $('#btn-black').classList.toggle('on', L.tv.black);
    $('#btn-logo').classList.toggle('on', L.tv.logo);

    // What's on the TV
    const d = slideAt(L.live);
    let tag = 'Cleared', tagLive = false, html;
    if (L.tv.black) { tag = 'Black'; html = '<div class="center"><span class="note">Black screen</span></div>'; }
    else if (L.tv.logo) { tag = 'Logo'; html = '<div class="center"><span class="note">Showing the logo</span></div>'; }
    else if (d) { tag = 'Live'; tagLive = true; html = screenHtml(d, 640); }
    else if (L.timer) { tag = 'Timer'; tagLive = true; html = `<div class="center"><span class="t1">${esc(L.timer.title)}</span><span class="t2" id="live-t">${L.timer.done ? 'Done' : fmt(L.timer.remaining)}</span></div>`; }
    else html = L.bankThumb ? `<img class="bgimg" src="${img(L.bankThumb, 640)}" alt="">` : '';
    const key = JSON.stringify([tag, d, L.timer && !d && L.timer.title, L.bankThumb]);
    if (key !== liveKey) { liveKey = key; $('#live-screen').innerHTML = html; }
    else if (L.timer && !d && $('#live-t')) $('#live-t').textContent = L.timer.done ? 'Done' : fmt(L.timer.remaining);
    const t = $('#live-tag'); t.textContent = tag; t.classList.toggle('live', tagLive);

    // Up next
    const nd = slideAt(L.next), ni = itemAt(L.next);
    const nk = JSON.stringify([nd, ni && ni.title]);
    if (nk !== nextKey) {
      nextKey = nk;
      $('#next-screen').innerHTML = screenHtml(nd, 360);
      $('#next-title').textContent = ni ? ni.title : 'End of the playlist';
      $('#next-sub').textContent = ni ? (L.live && L.next.item === L.live.item ? nd.l || 'Next slide' : `${ni.typeName}${nd && nd.l ? ' · ' + nd.l : ''}`) : '';
    }
    $('#next-card').disabled = !L.next;
    $('#btn-next').disabled = !L.next && !L.live;

    // Timer and video controls
    const tm = L.timer;
    for (const [strip, name, time, pause, bar] of [['#timer-strip', '#ts-name', '#ts-time', '#ts-pause', '#ts-bar'], ['#timer-strip-2', '#ts2-name', '#ts2-time', '#ts2-pause', null]]) {
      $(strip).classList.toggle('hidden', !tm);
      if (!tm) continue;
      $(name).textContent = tm.title;
      $(time).textContent = tm.done ? 'Done' : fmt(tm.remaining) + (tm.paused ? ' (paused)' : ' left');
      $(pause).textContent = tm.paused ? 'Resume' : 'Pause';
      $(pause).disabled = tm.done;
      if (bar) $(bar).style.width = tm.total ? (100 * (1 - tm.remaining / tm.total)) + '%' : '100%';
    }
    const v = L.video;
    $('#video-strip').classList.toggle('hidden', !v);
    if (v) {
      $('#vs-time').textContent = `${fmt(v.cur)} / ${fmt(v.dur)}`;
      $('#vs-bar').style.width = v.dur ? (100 * v.cur / v.dur) + '%' : '0';
      $('#vs-play').textContent = v.paused ? 'Play' : 'Pause';
    }
  }

  function itemState(i) {
    const L = st.live;
    const cur = L && (L.live || L.last);
    if (!cur) return i === firstItem() ? 'next' : '';
    if (i < cur.item) return 'done';
    if (i === cur.item) return L.live ? 'now' : 'done';
    if (L.next && i === L.next.item) return 'next';
    return '';
  }
  const firstItem = () => { const it = st.playlist && st.playlist.items.find((x) => x.slides && x.slides.length); return it ? it.i : -1; };

  let itemsKey = '';
  function renderItems(force) {
    const pl = st.playlist, L = st.live;
    const ol = $('#pl-items');
    if (!pl) { ol.innerHTML = '<li class="muted">No playlist yet. Make one on the Mac in Build → Playlists.</li>'; itemsKey = ''; return; }
    const liveItem = L && L.live ? L.live.item : null;
    if (liveItem !== null && liveItem !== lastLiveItem) open.add(liveItem);
    lastLiveItem = liveItem;
    const key = JSON.stringify([pl.id, L && L.live, L && L.last, L && L.next, [...open]]);
    if (!force && key === itemsKey) return;
    itemsKey = key;
    const keepScroll = $('#tab-playlist').scrollTop;
    ol.innerHTML = pl.items.map((it) => {
      if (it.type === 'label') return `<li class="sec">${esc(it.title)}</li>`;
      const s = itemState(it.i), isOpen = open.has(it.i);
      const sub = it.typeName + (s === 'now' ? ' · on the TV now' : s === 'next' ? ' · up next' : '') + ` · ${it.slides.length} slide${it.slides.length === 1 ? '' : 's'}`;
      const tiles = isOpen ? `<div class="islides">${it.slides.map((d, j) => {
        const live = L && L.live && L.live.item === it.i && L.live.slide === j;
        return `<button class="tile ${live ? 'live' : ''}" data-item="${it.i}" data-slide="${j}"><div class="scr">${screenHtml(d, 360)}</div><span class="cap">${j + 1}${d.l ? ' · ' + esc(d.l) : ''}${live ? ' · on the TV' : ''}</span></button>`;
      }).join('') || '<p class="muted small">No slides.</p>'}</div>` : '';
      return `<li class="item ${s} ${isOpen ? 'open' : ''}">
        <button class="ihead" data-toggle="${it.i}"><span class="num">${s === 'done' ? '✓' : it.n}</span>
          <span class="ititle"><b>${esc(it.title)}</b><span>${esc(sub)}</span></span><span class="chev">›</span></button>${tiles}</li>`;
    }).join('') || '<li class="muted">This playlist is empty.</li>';
    $('#tab-playlist').scrollTop = keepScroll;
  }

  let bgKey = '';
  function renderBackgrounds() {
    const s = st.setup, L = st.live;
    if (!s) return;
    const sel = L ? L.bank : null;
    $('#bg-reset').classList.toggle('hidden', !(L && L.bankOverride));
    const key = JSON.stringify([s.backgrounds, sel]);
    if (key === bgKey) return;
    bgKey = key;
    const tiles = [{ id: 'none', title: 'None (black)', thumb: null }].concat(s.backgrounds);
    $('#bg-grid').innerHTML = tiles.map((b) => `<button class="bg ${b.id === sel ? 'sel' : ''}" data-bg="${esc(b.id)}">
      <div class="scr">${b.thumb ? `<img class="fill" src="${img(b.thumb, 360)}" alt="" loading="lazy">` : ''}</div><span class="cap">${esc(b.title)}</span></button>`).join('') +
      (s.backgrounds.length ? '' : '<p class="muted small">No backgrounds yet. Import some on the Mac in Build → Backgrounds.</p>');
  }

  let timersKey = '';
  function renderTimers() {
    const s = st.setup, L = st.live;
    if (!s) return;
    const running = L && L.timer ? L.timer.title : null;
    const key = JSON.stringify([s.timers, running]);
    if (key === timersKey) return;
    timersKey = key;
    $('#timer-list').innerHTML = s.timers.map((t) => `<button class="btn ${running === t.title ? 'on' : ''}" data-timer="${esc(t.id)}">${esc(t.title)}<span>${fmt(t.seconds)}</span></button>`).join('') ||
      '<p class="muted small">No timers yet. Add them on the Mac in Build → Settings → Timers.</p>';
  }

  // ---------- keep the screen on while the remote is open ----------
  let lock = null;
  async function stayAwake() {
    if (document.visibilityState !== 'visible') return;
    try {
      if ('wakeLock' in navigator) { lock = await navigator.wakeLock.request('screen'); return; }
    } catch (e) { /* not allowed here (needs https); use the video instead */ }
    try { await $('#awake').play(); } catch (e) { /* needs a tap first */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { stayAwake(); if (token && (!es || es.readyState === 2)) connect(); }
  });

  // ---------- buttons ----------
  document.addEventListener('click', (e) => {
    if (!lock) stayAwake();
    const c = e.target.closest('[data-cmd]');
    if (c && !c.disabled) { send(c.dataset.cmd); return; }
    const tb = e.target.closest('[data-tab]');
    if (tb) {
      tab = tb.dataset.tab;
      $$('.tabs button').forEach((b) => b.classList.toggle('on', b === tb));
      for (const name of ['remote', 'playlist', 'backgrounds', 'timers']) $('#tab-' + name).classList.toggle('hidden', name !== tab);
      if (tab === 'playlist' && st.live && st.live.live) {
        const li = $(`.tile.live`);
        if (li) li.scrollIntoView({ block: 'center' });
      }
      return;
    }
    const tog = e.target.closest('[data-toggle]');
    if (tog) { const i = Number(tog.dataset.toggle); if (open.has(i)) open.delete(i); else open.add(i); renderItems(true); return; }
    const tile = e.target.closest('[data-slide]');
    if (tile) { send('go', { item: Number(tile.dataset.item), slide: Number(tile.dataset.slide) }); return; }
    const bg = e.target.closest('[data-bg]');
    if (bg) { send('bg', { id: bg.dataset.bg }); return; }
    const tm = e.target.closest('[data-timer]');
    if (tm) { send('timer', { id: tm.dataset.timer }); }
  });
  $('#pl-select').addEventListener('change', (e) => {
    const cur = st.live && st.live.live;
    if (cur && !confirm('Switch playlists? The TV keeps showing what’s on it until you press Next.')) { renderPlaylistPicker(); return; }
    open.clear();
    send('playlist', { id: e.target.value });
  });
  $('#custom-timer').addEventListener('submit', (e) => {
    e.preventDefault();
    const min = Number(String($('#ct-min').value).replace(',', '.'));
    if (!(min > 0)) { $('#ct-min').focus(); return; }
    send('timerCustom', { minutes: min, title: $('#ct-name').value });
    $('#ct-min').value = ''; $('#ct-name').value = '';
    $('#ct-min').blur(); $('#ct-name').blur();
  });
  $('#code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (e.target.value.length === 4) $('#connect-form').requestSubmit();
  });
  $('#connect-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#code').value;
    if (code.length !== 4) { $('#connect-msg').textContent = 'Enter the 4-digit code from the Mac.'; return; }
    $('#connect-go').disabled = true;
    $('#connect-msg').className = 'msg ok'; $('#connect-msg').textContent = 'Connecting…';
    try { await pair({ code }); stayAwake(); }
    catch (err) { $('#connect-msg').className = 'msg'; $('#connect-msg').textContent = err.message; $('#code').value = ''; $('#code').focus(); }
    finally { $('#connect-go').disabled = false; }
  });

  // ---------- start ----------
  (async function start() {
    const m = location.hash.match(/[#&]p=([\w-]+)/);
    if (m) {
      history.replaceState(null, '', location.pathname); // don't leave the pairing key in the address bar
      try { await pair({ pair: m[1] }); return; }
      catch (err) { showConnect(err.message === 'That code doesn’t match. Check the code on the Mac.' ? 'That QR code is old. Scan the one on the Mac now, or enter the code.' : err.message); return; }
    }
    if (token) showApp(); else showConnect();
  })();
})();
