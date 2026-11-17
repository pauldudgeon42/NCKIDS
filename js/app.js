/*
 * app.js — the control screen.
 *
 *   Present mode: pick today's playlist, click a slide (or press → / Space) to put it on the TV.
 *   Build mode:   manage playlists, songs, lessons, videos, backgrounds and settings.
 *
 * Data lives in Store.data (see store.js). Call Store.save() after changing it.
 */
(function () {
  const APP_VERSION = '0.6.0';

  // ---------- small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = () => Store.data;
  const S = () => Store.data.settings;
  const byId = (collection, id) => D()[collection].find((x) => x.id === id) || null;
  const COLLECTION = { song: 'songs', lesson: 'lessons', video: 'videos', background: 'backgrounds', timer: 'timers' };
  // Simple line icons (no emoji). icon('song') returns an inline SVG.
  const ICONS = {
    song: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    lesson: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
    background: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  };
  function icon(name, size = 16) {
    return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }
  const TYPE_NAME = { song: 'Song', lesson: 'Lesson', video: 'Video', background: 'Background', timer: 'Timer' };

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function prettyDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  let toastTimer;
  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, kind === 'error' ? 7000 : 3000);
  }
  function busy(msg) {
    const b = $('#busy');
    if (msg) { b.querySelector('span').textContent = msg; b.classList.add('show'); } else b.classList.remove('show');
  }
  function reportProblems(problems) {
    if (problems.length) alert('Some files were skipped:\n\n' + problems.join('\n'));
  }

  /** Open the file chooser. Must be called from a click. */
  function pickFiles({ accept = '', multiple = true } = {}) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept; input.multiple = multiple;
      input.onchange = () => resolve(Array.from(input.files || []));
      input.click();
    });
  }
  async function pickFolderFiles(filter) {
    try {
      const dir = await window.showDirectoryPicker({ id: 'nckids-import', mode: 'read' });
      return await Media.filesFromFolder(dir, filter);
    } catch (e) { return null; } // cancelled
  }

  /** Let files be dragged in from Finder. */
  function dropZone(el, handler) {
    el.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); el.classList.add('drop-hover'); }
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
    el.addEventListener('drop', (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault(); el.classList.remove('drop-hover');
      handler(Array.from(e.dataTransfer.files));
    });
  }

  /** Drag-to-reorder for a list of elements with data-index. */
  function sortable(listEl, onMove) {
    let from = null;
    listEl.addEventListener('dragstart', (e) => {
      const li = e.target.closest('[data-index]');
      if (!li || !listEl.contains(li)) return;
      from = Number(li.dataset.index);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/nc-sort', String(from));
      li.classList.add('dragging');
    });
    listEl.addEventListener('dragend', () => { from = null; $$('.dragging, .drop-before', listEl).forEach((x) => x.classList.remove('dragging', 'drop-before')); });
    listEl.addEventListener('dragover', (e) => {
      if (from === null) return;
      e.preventDefault();
      $$('.drop-before', listEl).forEach((x) => x.classList.remove('drop-before'));
      const li = e.target.closest('[data-index]');
      if (li) li.classList.add('drop-before');
    });
    listEl.addEventListener('drop', (e) => {
      if (from === null) return;
      e.preventDefault();
      const li = e.target.closest('[data-index]');
      let to = li ? Number(li.dataset.index) : listEl.querySelectorAll('[data-index]').length;
      if (to > from) to--;
      if (to !== from) onMove(from, to);
      from = null;
    });
  }
  function move(arr, from, to) { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); }

  // ---------- backgrounds & slides ----------
  async function resolveBg(bgId) {
    if (!bgId || bgId === 'none') return null;
    const b = byId('backgrounds', bgId);
    if (!b) return null;
    return { id: b.id, type: b.type, url: await Store.url(b.path), thumb: await Store.url(b.thumb) };
  }
  function songBgId(item, song) {
    return (item && item.background) || (song && song.background) || S().defaultBackground || null;
  }
  function refOf(item) { return byId(COLLECTION[item.type], item.ref); }
  function itemTitle(item) { const r = refOf(item); return r ? r.title : '(missing — was deleted)'; }

  /** Slides for one playlist item, with file URLs ready to show. */
  async function slidesFor(item) {
    const ref = refOf(item);
    if (!ref) return [];
    if (item.type === 'song') {
      const bg = await resolveBg(songBgId(item, ref));
      const ownBg = !!((item && item.background) || ref.background); // chose its own, rather than "Default"
      return Songs.buildSlides(ref, S()).map((s) => Object.assign(s, { bg, ownBg }));
    }
    if (item.type === 'lesson') {
      const out = [];
      for (let i = 0; i < ref.slides.length; i++) {
        out.push({ kind: 'image', url: await Store.url(ref.slides[i].path), label: `Slide ${i + 1}` });
      }
      return out;
    }
    if (item.type === 'video') {
      return [{ kind: 'video', url: await Store.url(ref.path), thumb: await Store.url(ref.thumb), label: fmtTime(ref.duration), title: ref.title }];
    }
    if (item.type === 'timer') {
      return [{ kind: 'timer', label: fmtTime(ref.seconds), title: ref.title, timerId: ref.id, seconds: ref.seconds,
        message: ref.message, chime: ref.chime !== false, autoNext: !!ref.autoNext, fromPlaylist: true }];
    }
    if (item.type === 'background') {
      return [{ kind: 'background', bg: await resolveBg(ref.id), ownBg: true, label: 'Background only' }];
    }
    return [];
  }

  /** Draw a slide thumbnail into `host` (already in the page). */
  function drawThumb(host, slide, bgOverride) {
    const r = new Renderer(host, { staticOnly: true, muted: true });
    r.setFade(0);
    const bg = bgOverride !== undefined ? bgOverride : slide.bg;
    if (bg) r.setBackground(bg);
    if (slide.kind === 'text') { r.setText(slide.text, slide.style || S()); r.setFooter(slide.footer || ''); }
    else if (slide.kind === 'image') r.setImage(slide.url);
    else if (slide.kind === 'video') r.setVideoPoster(slide.thumb);
    else if (slide.kind === 'timer') r.setTimer({ title: slide.title, remaining: slide.seconds }, S());
    return r;
  }

  /**
   * Clickable thumbnails of every background. `selected` is a background id,
   * 'none' (black) or '' (the default background, only when withDefault is set).
   */
  function bgTiles(el, selected, onPick, { withDefault = false } = {}) {
    const def = byId('backgrounds', S().defaultBackground);
    const tiles = [];
    if (withDefault) tiles.push({ id: '', title: 'Default' + (def ? ' (' + def.title + ')' : ''), thumb: def && def.thumb, tag: 'Default' });
    tiles.push({ id: 'none', title: 'None (black)', thumb: null });
    for (const b of sortedBy(D().backgrounds)) tiles.push({ id: b.id, title: b.title, thumb: b.thumb });
    el.innerHTML = tiles.map((t) => `
      <button type="button" class="bg-tile ${t.id === selected ? 'selected' : ''}" data-bg-id="${esc(t.id)}" title="${esc(t.title)}">
        <span class="bg-img">${t.thumb ? `<img data-path="${esc(t.thumb)}" alt="">` : ''}${t.tag ? `<span class="bg-tag">${t.tag}</span>` : ''}</span>
        <span class="bg-name">${esc(t.title)}</span>
      </button>`).join('') +
      (D().backgrounds.length ? '' : '<p class="hint bg-empty">No backgrounds yet. Import some in Build → Backgrounds.</p>');
    $$('img[data-path]', el).forEach(async (img) => { img.src = await Store.url(img.dataset.path); });
    el.onclick = (e) => {
      const b = e.target.closest('[data-bg-id]');
      if (!b) return;
      $$('.bg-tile', el).forEach((x) => x.classList.toggle('selected', x === b));
      onPick(b.dataset.bgId);
    };
  }

  function slideCard(slide, index) {
    const card = document.createElement('button');
    card.className = 'slide-card';
    card.dataset.slide = index;
    card.innerHTML = `<div class="thumb"></div><div class="cap"><span class="num">${index + 1}</span>${esc(slide.label || '')}</div>`;
    return card;
  }

  // =====================================================================
  //  PRESENT MODE
  // =====================================================================
  // The middle column shows EVERY item in the playlist, one after another, so the
  // operator can scroll through the whole service. Clicking an item on the left
  // jumps to it (and "cues" it, so Next starts there).
  const P = {
    playlistId: null,
    cued: null,        // item clicked on the left; Next starts it if it isn't live
    live: null,        // { item, slide } currently on the TV
    last: null,        // the last thing that was live (after Clear or a finished video), so Next carries on from there
    cache: new Map(),  // item.id -> slides
    liveBgId: null,    // background picked from the bank while presenting (null = none picked)
    liveBgItem: -1,    // which playlist item was live when it was picked
  };

  /**
   * The background to show behind a slide. A background picked from the bank
   * replaces the default for every song, but a song that has its own background
   * still switches to it (until the bank is used again during that song).
   * Returns undefined for lesson/video slides, which leave the background alone.
   */
  async function effectiveBg(slide, itemIndex) {
    if (slide.bg === undefined) return undefined;
    if (P.liveBgId === null) return slide.bg;
    if (slide.ownBg && itemIndex !== P.liveBgItem) return slide.bg;
    return resolveBg(P.liveBgId);
  }

  // ----- timers -----
  function renderTimerBank() {
    const running = Output.timer;
    $('#timer-bank').innerHTML = (D().timers || []).map((t) => `
      <button class="timer-chip ${running && running.timerId === t.id ? 'on' : ''}" data-timer="${esc(t.id)}" title="Start ${esc(t.title)} on the TV">
        <span class="t-name">${esc(t.title)}</span><span class="t-time">${fmtTime(t.seconds)}</span></button>`).join('') +
      `<button class="timer-chip custom" id="timer-custom-btn"><span class="t-name">Custom</span><span class="t-time">${icon('plus', 14)}</span></button>`;
  }
  function startTimer(t, fromPlaylist) {
    if (!fromPlaylist) {
      if (P.live) P.last = P.live;
      P.live = null;
      $('#video-controls').classList.add('hidden');
      markLive();
    }
    Output.show({ kind: 'timer', title: t.title, timerId: t.id, seconds: t.seconds, message: t.message || 'Time’s up!', chime: t.chime !== false, autoNext: !!t.autoNext, fromPlaylist: !!fromPlaylist });
    updateLiveButtons();
  }
  function onTimerTick(t) {
    const box = $('#timer-controls');
    box.classList.toggle('hidden', !t);
    $$('#timer-bank .timer-chip').forEach((c) => c.classList.toggle('on', !!t && c.dataset.timer === t.timerId));
    if (!t) return;
    $('#tc-name').textContent = t.title;
    $('#tc-time').textContent = t.done ? 'Done' : fmtTime(Math.ceil(t.remaining)) + (t.paused ? ' (paused)' : ' left');
    $('#tc-bar').style.width = t.total ? (100 * (1 - t.remaining / t.total)) + '%' : '100%';
    $('#tc-pause').textContent = t.paused ? 'Resume' : 'Pause';
    $('#tc-pause').disabled = !!t.done;
  }
  function bindTimers() {
    $('#timer-bank').addEventListener('click', (e) => {
      if (e.target.closest('#timer-custom-btn')) { $('#timer-custom').classList.toggle('hidden'); $('#timer-custom-min').focus(); return; }
      const b = e.target.closest('[data-timer]');
      if (b) { const t = byId('timers', b.dataset.timer); if (t) startTimer(t, false); }
    });
    $('#timer-custom-go').addEventListener('click', () => {
      const min = Number($('#timer-custom-min').value);
      if (!(min > 0)) { toast('Enter how many minutes.'); return; }
      startTimer({ id: 'custom', title: $('#timer-custom-name').value.trim() || 'Timer', seconds: Math.round(min * 60), message: 'Time’s up!', chime: true }, false);
      $('#timer-custom').classList.add('hidden');
    });
    $('#tc-pause').addEventListener('click', () => Output.pauseTimer());
    $('#tc-add').addEventListener('click', () => Output.addTime(60));
    $('#tc-restart').addEventListener('click', () => Output.restartTimer());
    $('#tc-stop').addEventListener('click', () => clearLive());
    Output.onTimerTick = onTimerTick;
    Output.onTimerEnd = (t) => {
      // A timer in the playlist set to move on: show the end message for a moment, then go to the next item.
      if (t.fromPlaylist && t.autoNext && P.live) setTimeout(() => { if (Output.timer === t) step(1); }, 3000);
    };
  }

  function renderBank() {
    bgTiles($('#bg-bank'), currentBankId(), pickLiveBg);
    $('#bank-reset').classList.toggle('hidden', P.liveBgId === null);
  }
  function currentBankId() {
    if (P.liveBgId !== null) return P.liveBgId;
    return Output.state.bg ? Output.state.bg.id : 'none';
  }
  function markBank() {
    const id = currentBankId();
    $$('#bg-bank .bg-tile').forEach((t) => t.classList.toggle('selected', t.dataset.bgId === id));
    $('#bank-reset').classList.toggle('hidden', P.liveBgId === null);
  }
  async function pickLiveBg(id) {
    P.liveBgId = id;
    P.liveBgItem = P.live ? P.live.item : (P.cued === null ? -1 : P.cued);
    Output.setBackground(await resolveBg(id));
    markBank();
    renderPresentSlides();
  }
  async function resetLiveBg() {
    P.liveBgId = null;
    const pl = currentPlaylist();
    if (P.live && pl && pl.items[P.live.item]) {
      const s = (await itemSlides(pl.items[P.live.item]))[P.live.slide];
      if (s && s.bg !== undefined) Output.setBackground(s.bg);
    }
    markBank();
    renderPresentSlides();
  }

  function currentPlaylist() { return byId('playlists', P.playlistId); }

  async function itemSlides(item) {
    if (!P.cache.has(item.id)) P.cache.set(item.id, await slidesFor(item));
    return P.cache.get(item.id);
  }
  function invalidateSlides() { P.cache.clear(); }

  function renderPresent() {
    const sel = $('#present-playlist');
    const lists = sortedPlaylists();
    if (!P.playlistId || !byId('playlists', P.playlistId)) P.playlistId = S().lastPlaylist && byId('playlists', S().lastPlaylist) ? S().lastPlaylist : (lists[0] && lists[0].id);
    sel.innerHTML = lists.length
      ? lists.map((p) => `<option value="${p.id}" ${p.id === P.playlistId ? 'selected' : ''}>${esc(p.title)}</option>`).join('')
      : '<option>No playlists yet</option>';
    $('#present-empty').classList.toggle('hidden', lists.length > 0);
    renderPresentItems();
    renderPresentSlides();
    renderBank();
    renderTimerBank();
  }

  /** done / now / next, from what is live on the TV */
  function itemState(i) {
    const cur = P.live || P.last;
    if (!cur) return i === 0 ? 'next' : '';
    if (i < cur.item) return 'done';
    if (i === cur.item) return P.live ? 'now' : 'done';
    if (i === cur.item + 1) return 'next';
    return '';
  }

  function renderPresentItems() {
    const pl = currentPlaylist();
    const ol = $('#present-items');
    $('#present-date').textContent = pl && pl.date ? prettyDate(pl.date) : '';
    if (!pl) { ol.innerHTML = ''; return; }
    ol.innerHTML = pl.items.map((it, i) => {
      const st = itemState(i);
      const sub = TYPE_NAME[it.type] + (st === 'now' ? ' · on the TV now' : st === 'next' ? ' · up next' : '');
      return `<li class="p-item ${st} ${P.cued === i ? 'cued' : ''}" data-i="${i}">
        <span class="badge-n">${st === 'done' ? icon('check', 15) : i + 1}</span>
        <span class="txt"><span class="name">${esc(itemTitle(it))}</span><span class="sub">${sub}</span></span>
      </li>`;
    }).join('') || '<li class="muted pad">This playlist is empty. Add things to it in Build → Playlists.</li>';
  }

  let slidesRenderToken = 0;
  let thumbObserver = null;
  /** Every item's slides, top to bottom. Thumbnails are drawn as they scroll into view. */
  async function renderPresentSlides() {
    const token = ++slidesRenderToken;
    const pl = currentPlaylist();
    const wrap = $('#present-slides');
    if (!pl || !pl.items.length) {
      wrap.innerHTML = pl ? '<p class="muted pad">This playlist is empty. Add songs, lessons and videos in Build → Playlists.</p>' : '';
      return;
    }
    const all = [];
    for (let i = 0; i < pl.items.length; i++) {
      const slides = await itemSlides(pl.items[i]);
      const bgs = [];
      for (const s of slides) bgs.push(await effectiveBg(s, i));
      all.push({ slides, bgs });
    }
    if (token !== slidesRenderToken) return;
    const keepScroll = wrap.scrollTop;
    if (thumbObserver) thumbObserver.disconnect();
    const pending = new Map();
    thumbObserver = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const draw = pending.get(en.target);
        if (draw) { draw(); pending.delete(en.target); }
        thumbObserver.unobserve(en.target);
      }
    }, { root: wrap, rootMargin: '600px 0px' });
    wrap.innerHTML = '';
    pl.items.forEach((it, i) => {
      const { slides, bgs } = all[i];
      const sec = document.createElement('section');
      sec.className = 'p-section';
      sec.id = 'sec-' + i;
      sec.innerHTML = `<div class="p-sec-head"><span class="num">${i + 1}</span><h2>${esc(itemTitle(it))}</h2>
        <span class="type-pill t-${it.type}">${icon(it.type, 14)} ${TYPE_NAME[it.type]}</span>
        <span class="count">${slides.length} slide${slides.length === 1 ? '' : 's'}</span></div>
        <div class="slide-grid"></div>`;
      const grid = sec.querySelector('.slide-grid');
      if (!slides.length) grid.innerHTML = '<p class="muted">No slides. Songs need lyrics, and lessons need slide pictures.</p>';
      slides.forEach((s, j) => {
        const card = slideCard(s, j);
        card.dataset.item = i;
        if (P.live && P.live.item === i && P.live.slide === j) card.classList.add('live');
        grid.appendChild(card);
        const th = card.querySelector('.thumb');
        pending.set(th, () => drawThumb(th, s, bgs[j]));
        thumbObserver.observe(th);
      });
      wrap.appendChild(sec);
    });
    wrap.style.scrollBehavior = 'auto';
    wrap.scrollTop = keepScroll;
    wrap.style.scrollBehavior = '';
  }

  function scrollToItem(i) {
    const sec = $('#sec-' + i);
    if (sec) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function markLive() {
    $$('#present-slides .slide-card').forEach((c) => c.classList.toggle('live',
      !!P.live && Number(c.dataset.item) === P.live.item && Number(c.dataset.slide) === P.live.slide));
    renderPresentItems();
    if (!P.live) return;
    // Keep what's live in view: a new item scrolls to its heading, later slides just stay visible.
    if (P.live.slide === 0) scrollToItem(P.live.item);
    else {
      const lc = $('#present-slides .slide-card.live');
      if (lc) lc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  async function goLive(itemIndex, slideIndex) {
    const pl = currentPlaylist();
    if (!pl) return;
    const item = pl.items[itemIndex];
    if (!item) return;
    const slides = await itemSlides(item);
    const slide = slides[slideIndex];
    if (!slide) return;
    P.live = { item: itemIndex, slide: slideIndex, kind: slide.kind };
    P.last = null;
    P.cued = null;
    const bg = await effectiveBg(slide, itemIndex);
    Output.show(bg === slide.bg ? slide : Object.assign({}, slide, { bg }));
    markBank();
    $('#video-controls').classList.toggle('hidden', slide.kind !== 'video');
    updateLiveButtons();
    markLive();
  }

  async function firstWithSlides(from, dir) {
    const pl = currentPlaylist();
    for (let i = from; i >= 0 && i < pl.items.length; i += dir) {
      const s = await itemSlides(pl.items[i]);
      if (s.length) return { i, count: s.length };
    }
    return null;
  }

  async function step(dir) {
    const pl = currentPlaylist();
    if (!pl || !pl.items.length) return;
    // Nothing live yet, or an item was clicked on the left: Next starts that item.
    const cur = P.live || P.last;
    if (dir > 0 && (!cur || (P.cued !== null && P.cued !== cur.item))) {
      const f = await firstWithSlides(P.cued === null ? 0 : P.cued, 1);
      if (f) await goLive(f.i, 0);
      return;
    }
    if (!cur) return;
    const { item, slide } = cur;
    const slides = await itemSlides(pl.items[item]);
    if (dir > 0 && slide + 1 < slides.length) return goLive(item, slide + 1);
    if (dir < 0 && slide > 0) return goLive(item, slide - 1);
    const f = await firstWithSlides(item + dir, dir);
    if (f) return goLive(f.i, dir > 0 ? 0 : f.count - 1);
  }

  function updateLiveButtons() {
    $('#btn-black').classList.toggle('on', Output.state.black);
    $('#btn-logo').classList.toggle('on', Output.state.logo);
  }

  function clearLive() {
    Output.clear();
    if (P.live) P.last = P.live;
    P.live = null;
    $('#video-controls').classList.add('hidden');
    markLive();
    updateLiveButtons();
  }

  function onKey(e) {
    if (mode !== 'present') return;
    const tag = (e.target && e.target.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && e.target.id !== 'present-playlist') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); step(1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); step(-1); }
    else if (k === 'b' || k === 'B' || k === '.') { e.preventDefault(); Output.toggleBlack(); updateLiveButtons(); }
    else if (k === 'c' || k === 'C' || k === 'Escape') { e.preventDefault(); clearLive(); }
    else if (k === 'l' || k === 'L') { e.preventDefault(); toggleLogo(); }
    else if (k === 'p' || k === 'P') { e.preventDefault(); Output.playPause(); }
  }

  function toggleLogo() {
    if (!S().logo) { toast('Add a logo picture in Build → Settings first.'); return; }
    Output.toggleLogo(); updateLiveButtons();
  }

  function bindPresent() {
    $('#present-playlist').addEventListener('change', (e) => {
      P.playlistId = e.target.value; P.cued = null; P.live = null; P.last = null;
      S().lastPlaylist = P.playlistId; Store.save();
      $('#present-slides').scrollTop = 0;
      renderPresentItems(); renderPresentSlides();
    });
    $('#present-items').addEventListener('click', (e) => {
      const li = e.target.closest('.p-item');
      if (!li) return;
      const i = Number(li.dataset.i);
      P.cued = P.live && P.live.item === i ? null : i;
      renderPresentItems();
      scrollToItem(i);
    });
    $('#present-items').addEventListener('dblclick', (e) => {
      const li = e.target.closest('.p-item');
      if (li) goLive(Number(li.dataset.i), 0);
    });
    $('#present-slides').addEventListener('click', (e) => {
      const card = e.target.closest('.slide-card');
      if (card) goLive(Number(card.dataset.item), Number(card.dataset.slide));
    });
    $('#btn-black').addEventListener('click', () => { Output.toggleBlack(); updateLiveButtons(); });
    $('#btn-clear').addEventListener('click', clearLive);
    $('#btn-logo').addEventListener('click', toggleLogo);
    $('#btn-next').addEventListener('click', () => step(1));
    $('#bank-reset').addEventListener('click', resetLiveBg);
    // Don't leave buttons focused in Present mode, so Space/Enter from a clicker
    // always means "next slide" rather than "press that button again".
    document.addEventListener('click', (e) => {
      const b = mode === 'present' && e.target.closest && e.target.closest('#present button');
      if (b) b.blur();
    });
    $('#btn-prev').addEventListener('click', () => step(-1));
    $('#vc-play').addEventListener('click', () => Output.playPause());
    $('#vc-restart').addEventListener('click', () => Output.restartVideo());
    $('#vc-back').addEventListener('click', () => Output.seekBy(-10));
    $('#vc-fwd').addEventListener('click', () => Output.seekBy(10));
    $('#present-goto-build').addEventListener('click', () => { setMode('build'); setBuildTab('playlists'); });

    Output.onVideoTime = (cur, dur, paused) => {
      $('#vc-time').textContent = `${fmtTime(cur)} / ${fmtTime(dur)}  ·  ${fmtTime(dur - cur)} left`;
      $('#vc-bar').style.width = dur ? (100 * cur / dur) + '%' : '0';
      $('#vc-play').textContent = paused ? 'Play' : 'Pause';
    };
    Output.onVideoEnded = () => {
      if (P.live) P.last = P.live;
      P.live = null;
      $('#video-controls').classList.add('hidden');
      markLive();
    };
    Output.onVideoError = () => toast('This video could not play. Try converting it to MP4.', 'error');
    bindTimers();
    Output.onKey = onKey;
    document.addEventListener('keydown', onKey);
  }

  // =====================================================================
  //  BUILD MODE
  // =====================================================================
  let buildTab = 'playlists';
  const B = { playlist: null, song: null, lesson: null, search: '', pickerFilter: 'all', setSection: 'appearance' };

  function sortedPlaylists() {
    return D().playlists.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
  }
  function sortedBy(arr) { return arr.slice().sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })); }

  function setBuildTab(tab) {
    buildTab = tab;
    $$('#build-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    renderBuild();
  }

  function renderBuild() {
    const body = $('#build-body');
    body.innerHTML = '';
    body.className = 'build-body tab-' + buildTab;
    ({ playlists: buildPlaylists, songs: buildSongs, lessons: buildLessons, videos: buildVideos, backgrounds: buildBackgrounds, settings: buildSettings })[buildTab](body);
  }

  function bgOptions(selected, { allowDefault = true, defaultLabel = null } = {}) {
    const def = byId('backgrounds', S().defaultBackground);
    let html = '';
    if (allowDefault) html += `<option value="" ${!selected ? 'selected' : ''}>${defaultLabel || 'Default' + (def ? ' (' + esc(def.title) + ')' : ' (none set)')}</option>`;
    html += `<option value="none" ${selected === 'none' ? 'selected' : ''}>No background (black)</option>`;
    html += sortedBy(D().backgrounds).map((b) => `<option value="${b.id}" ${selected === b.id ? 'selected' : ''}>${esc(b.title)}</option>`).join('');
    return html;
  }

  /** Remove a library item everywhere it is used. */
  async function deleteThing(type, id) {
    const coll = COLLECTION[type];
    const thing = byId(coll, id);
    if (!thing) return;
    const used = D().playlists.filter((p) => p.items.some((it) => it.type === type && it.ref === id));
    let msg = `Delete "${thing.title}"?`;
    if (used.length) msg += `\n\nIt will also be removed from ${used.length} playlist${used.length > 1 ? 's' : ''}: ${used.map((p) => p.title).join(', ')}.`;
    if (!confirm(msg)) return false;
    D()[coll] = D()[coll].filter((x) => x.id !== id);
    for (const p of D().playlists) p.items = p.items.filter((it) => !(it.type === type && it.ref === id));
    if (type === 'background') {
      if (S().defaultBackground === id) S().defaultBackground = null;
      for (const s of D().songs) if (s.background === id) s.background = '';
      for (const p of D().playlists) for (const it of p.items) if (it.background === id) it.background = '';
    }
    // remove files
    if (thing.path) await Store.remove(thing.path);
    if (thing.thumb && type !== 'lesson') await Store.remove(thing.thumb);
    if (type === 'lesson') await Store.remove(`media/lessons/${id}`);
    Store.save();
    invalidateSlides();
    return true;
  }

  // ---------- Playlists ----------
  function buildPlaylists(body) {
    const lists = sortedPlaylists();
    if (!B.playlist || !byId('playlists', B.playlist)) B.playlist = lists[0] ? lists[0].id : null;
    const pl = byId('playlists', B.playlist);
    body.innerHTML = `
      <section class="col card col-list">
        <div class="col-head"><h2>Playlists</h2><button class="btn primary" id="pl-new">+ New</button></div>
        <ul class="list" id="pl-list">${lists.map((p) => `
          <li class="${p.id === B.playlist ? 'selected' : ''}" data-id="${p.id}">
            <strong>${esc(p.title)}</strong><small>${esc(prettyDate(p.date))} · ${p.items.length} item${p.items.length === 1 ? '' : 's'}</small>
          </li>`).join('') || '<li class="muted">No playlists yet. Click “+ New”.</li>'}</ul>
      </section>
      <section class="col card col-main">
        ${pl ? `
        <div class="col-head">
          <input class="title-input" id="pl-title" value="${esc(pl.title)}" aria-label="Playlist name">
          <input type="date" id="pl-date" value="${esc(pl.date || '')}">
        </div>
        <div class="row gap">
          <button class="btn primary" id="pl-present">${icon('play', 14)} Present this playlist</button>
          <button class="btn" id="pl-dup">Duplicate</button>
          <button class="btn danger" id="pl-del">Delete</button>
        </div>
        <p class="hint">Drag items to reorder. Add things from the list on the right.</p>
        <ol class="pl-items" id="pl-items">${pl.items.map((it, i) => `
          <li draggable="true" data-index="${i}">
            <span class="grip">${icon('grip', 18)}</span>
            <span class="icon t-${it.type}">${icon(it.type)}</span>
            <span class="name">${esc(itemTitle(it))}<small>${TYPE_NAME[it.type]}</small></span>
            ${it.type === 'song' ? `<label class="bg-pick">Background <select data-bg="${i}">${bgOptions(it.background || '', { defaultLabel: 'Song’s own' })}</select></label>` : ''}
            <button class="icon-btn" data-up="${i}" title="Move up" aria-label="Move up">${icon('up')}</button>
            <button class="icon-btn" data-down="${i}" title="Move down" aria-label="Move down">${icon('down')}</button>
            <button class="icon-btn danger" data-remove="${i}" title="Remove from playlist" aria-label="Remove from playlist">${icon('x')}</button>
          </li>`).join('') || '<li class="empty-drop">Empty. Drag songs, lessons, videos or backgrounds here →</li>'}</ol>` : '<p class="muted pad">Create a playlist for each Sunday or lesson.</p>'}
      </section>
      <section class="col card col-picker">
        <div class="col-head"><h2>Add to playlist</h2></div>
        <input type="search" id="pick-search" placeholder="Search everything…" value="${esc(B.search)}">
        <div class="chips" id="pick-filter">${['all', 'song', 'lesson', 'video', 'background', 'timer'].map((f) =>
          `<button class="chip ${B.pickerFilter === f ? 'active' : ''}" data-f="${f}">${f === 'all' ? 'All' : TYPE_NAME[f] + 's'}</button>`).join('')}</div>
        <ul class="list pick-list" id="pick-list"></ul>
      </section>`;

    const renderPicker = () => {
      const q = B.search.trim().toLowerCase();
      const rows = [];
      for (const type of ['song', 'lesson', 'video', 'background', 'timer']) {
        if (B.pickerFilter !== 'all' && B.pickerFilter !== type) continue;
        for (const x of sortedBy(D()[COLLECTION[type]])) {
          if (q && !(x.title.toLowerCase().includes(q) || (type === 'song' && (x.lyrics || '').toLowerCase().includes(q)))) continue;
          rows.push(`<li draggable="true" data-type="${type}" data-ref="${x.id}">
            <span class="icon t-${type}">${icon(type)}</span><span class="name">${esc(x.title)}<small>${TYPE_NAME[type]}</small></span>
            <button class="icon-btn add" data-add title="Add to playlist" aria-label="Add to playlist" ${pl ? '' : 'disabled'}>${icon('plus', 18)}</button></li>`);
        }
      }
      $('#pick-list').innerHTML = rows.join('') || '<li class="muted">Nothing found. Add songs, lessons, videos and backgrounds in their tabs.</li>';
    };
    renderPicker();

    $('#pl-new').onclick = () => {
      const p = { id: Media.id(), title: 'Sunday School', date: nextSunday(), items: [] };
      D().playlists.push(p); B.playlist = p.id; Store.save(); renderBuild();
      setTimeout(() => { const t = $('#pl-title'); if (t) { t.focus(); t.select(); } }, 0);
    };
    $('#pl-list').onclick = (e) => { const li = e.target.closest('li[data-id]'); if (li) { B.playlist = li.dataset.id; renderBuild(); } };
    $('#pick-search').oninput = (e) => { B.search = e.target.value; renderPicker(); };
    $('#pick-filter').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { B.pickerFilter = b.dataset.f; $$('#pick-filter .chip').forEach((c) => c.classList.toggle('active', c === b)); renderPicker(); } };
    if (!pl) return;

    const addItem = (type, ref, at) => {
      const item = { id: Media.id(), type, ref };
      if (at === undefined) pl.items.push(item); else pl.items.splice(at, 0, item);
      Store.save(); invalidateSlides(); renderBuild();
    };
    $('#pick-list').onclick = (e) => {
      const li = e.target.closest('li[data-ref]');
      if (li && e.target.closest('[data-add]')) addItem(li.dataset.type, li.dataset.ref);
    };
    $('#pick-list').ondblclick = (e) => { const li = e.target.closest('li[data-ref]'); if (li) addItem(li.dataset.type, li.dataset.ref); };
    $('#pick-list').addEventListener('dragstart', (e) => {
      const li = e.target.closest('li[data-ref]');
      if (li) e.dataTransfer.setData('text/nc-ref', JSON.stringify({ type: li.dataset.type, ref: li.dataset.ref }));
    });
    const itemsEl = $('#pl-items');
    itemsEl.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/nc-ref')) { e.preventDefault(); itemsEl.classList.add('drop-hover'); } });
    itemsEl.addEventListener('dragleave', () => itemsEl.classList.remove('drop-hover'));
    itemsEl.addEventListener('drop', (e) => {
      const raw = e.dataTransfer.getData('text/nc-ref');
      if (!raw) return;
      e.preventDefault();
      const { type, ref } = JSON.parse(raw);
      const li = e.target.closest('[data-index]');
      addItem(type, ref, li ? Number(li.dataset.index) : undefined);
    });
    sortable(itemsEl, (from, to) => { move(pl.items, from, to); Store.save(); invalidateSlides(); renderBuild(); });
    itemsEl.onclick = (e) => {
      const t = e.target.closest('button') || e.target;
      if (t.dataset.remove !== undefined) { pl.items.splice(Number(t.dataset.remove), 1); }
      else if (t.dataset.up !== undefined) { const i = Number(t.dataset.up); if (i > 0) move(pl.items, i, i - 1); }
      else if (t.dataset.down !== undefined) { const i = Number(t.dataset.down); if (i < pl.items.length - 1) move(pl.items, i, i + 1); }
      else return;
      Store.save(); invalidateSlides(); renderBuild();
    };
    itemsEl.onchange = (e) => {
      if (e.target.dataset.bg !== undefined) { pl.items[Number(e.target.dataset.bg)].background = e.target.value; Store.save(); invalidateSlides(); }
    };
    $('#pl-title').oninput = (e) => { pl.title = e.target.value || 'Untitled playlist'; Store.save(); };
    $('#pl-title').onchange = () => renderBuild();
    $('#pl-date').onchange = (e) => { pl.date = e.target.value; Store.save(); renderBuild(); };
    $('#pl-present').onclick = () => { P.playlistId = pl.id; P.cued = null; P.live = null; P.last = null; S().lastPlaylist = pl.id; Store.save(); setMode('present'); };
    $('#pl-dup').onclick = () => {
      const copy = { id: Media.id(), title: pl.title + ' (copy)', date: nextSunday(), items: pl.items.map((it) => Object.assign({}, it, { id: Media.id() })) };
      D().playlists.push(copy); B.playlist = copy.id; Store.save(); renderBuild();
    };
    $('#pl-del').onclick = () => {
      if (!confirm(`Delete the playlist "${pl.title}"? (The songs, lessons and videos stay in the library.)`)) return;
      D().playlists = D().playlists.filter((p) => p.id !== pl.id); B.playlist = null; Store.save(); renderBuild();
    };
  }

  function nextSunday() {
    const d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    return d.toISOString().slice(0, 10);
  }

  // ---------- Songs ----------
  // Middle: the song as slides (split / merge / edit words) or as lyrics text.
  // Right: song order chips and "Look for this song" (per-song style).
  function buildSongs(body) {
    const songs = sortedBy(D().songs);
    if (B.song && !byId('songs', B.song)) B.song = null;
    if (!B.song && songs[0]) B.song = songs[0].id;
    const song = byId('songs', B.song);
    if (song && B.songViewFor !== song.id) { B.songView = (song.lyrics || '').trim() ? 'slides' : 'lyrics'; B.songViewFor = song.id; }
    body.innerHTML = `
      <section class="col card col-list">
        <div class="col-head"><h2>Songs</h2><button class="btn primary small" id="song-new">${icon('plus', 14)} New song</button></div>
        <div class="row gap">
          <button class="btn small" style="flex:1" id="song-import" title="Lyrics files downloaded from CCLI SongSelect (.txt)">Import .txt</button>
          <button class="btn small" style="flex:1" id="song-pco" title="Bring in songs and their SongSelect lyrics from Planning Center">${icon('download', 14)} Planning Center</button>
        </div>
        <label class="search-field">${icon('search')}<input type="search" id="song-search" placeholder="Search titles and lyrics" aria-label="Search songs"></label>
        <ul class="list" id="song-list"></ul>
      </section>
      <section class="col card col-main song-editor">
        ${song ? `
        <div class="col-head">
          <input class="title-input" id="song-title" value="${esc(song.title)}" aria-label="Song title">
          ${song.pco ? `<span class="pco-tag" title="${song.pco.arrangementName ? 'Arrangement: ' + esc(song.pco.arrangementName) : ''}">From Planning Center</span>
          <button class="btn small" id="song-pco-update" title="Replace the lyrics and order with the latest from Planning Center. The look and background stay.">${icon('refresh', 14)} Update</button>` : ''}
          <div class="seg" role="tablist" aria-label="Edit as">
            <button role="tab" data-view="slides" class="${B.songView === 'slides' ? 'on' : ''}" aria-selected="${B.songView === 'slides'}">Slides</button>
            <button role="tab" data-view="lyrics" class="${B.songView === 'lyrics' ? 'on' : ''}" aria-selected="${B.songView === 'lyrics'}">Lyrics</button>
          </div>
        </div>
        <div id="song-view" class="song-view"></div>` : '<p class="muted pad">Add your first song with “New song”, or import lyrics from CCLI SongSelect or Planning Center.</p>'}
      </section>
      ${song ? `
      <section class="col card col-side">
        <div class="side-block">
          <h3>Song order</h3>
          <div class="order-chips" id="song-order"></div>
          <div class="order-add" id="song-order-add"></div>
        </div>
        <div class="divider"></div>
        <div class="side-block" id="song-look"></div>
        <div class="spacer"></div>
        <div><button class="btn danger small" id="song-del">Delete song</button></div>
      </section>` : ''}`;

    const renderList = () => {
      const q = ($('#song-search').value || '').toLowerCase();
      $('#song-list').innerHTML = songs.filter((s) => !q || s.title.toLowerCase().includes(q) || (s.lyrics || '').toLowerCase().includes(q))
        .map((s) => `<li class="${s.id === B.song ? 'selected' : ''}" data-id="${s.id}"><strong>${esc(s.title)}${s.pco ? ' <span class="pco-dot" title="From Planning Center">PCO</span>' : ''}</strong><small>${esc(s.author || '')}</small></li>`).join('')
        || '<li class="muted">No songs yet.</li>';
    };
    renderList();
    $('#song-search').oninput = renderList;
    $('#song-pco').onclick = () => openPcoBrowser();
    $('#song-list').onclick = (e) => { const li = e.target.closest('li[data-id]'); if (li) { B.song = li.dataset.id; renderBuild(); } };
    $('#song-new').onclick = () => {
      const s = { id: Media.id(), title: 'New song', author: '', copyright: '', ccli: '', lyrics: '', arrangement: '', background: '', added: Date.now() };
      D().songs.push(s); B.song = s.id; Store.save(); renderBuild();
      setTimeout(() => { $('#song-title').focus(); $('#song-title').select(); }, 0);
    };
    $('#song-import').onclick = async () => {
      const files = await pickFiles({ accept: '.txt,text/plain' });
      if (!files.length) return;
      let last;
      for (const f of files) {
        const parsed = Songs.parseSongFile(await f.text(), Media.baseName(f.name));
        last = Object.assign({ id: Media.id(), arrangement: '', background: '', added: Date.now() }, parsed);
        D().songs.push(last);
      }
      Store.save(); B.song = last.id; renderBuild();
      toast(`Imported ${files.length} song${files.length > 1 ? 's' : ''}.`);
    };
    if (!song) return;

    const changed = () => { Store.save(); invalidateSlides(); };
    const view = $('#song-view');

    // ----- Slides view -----
    const renderSlidesView = async () => {
      const lay = Songs.layout(song, S());
      if (!lay.length) {
        view.innerHTML = '<p class="muted pad">No lyrics yet. Switch to <b>Lyrics</b> and paste them in.</p>';
        return;
      }
      const st = Songs.effectiveStyle(song, S());
      const bg = await resolveBg(songBgId(null, song));
      const img = bg ? (bg.type === 'video' ? bg.thumb : bg.url) : null;
      const cardStyle = img ? `background-image:url('${img}')` : 'background:#000';
      const textStyle = `font-family:'${esc(st.font)}', 'Avenir Next', sans-serif; color:${esc(st.textColor || '#fff')}; font-size:${Math.max(11, Math.round(st.maxFontSize * 0.15))}px;${st.uppercase ? ' text-transform:uppercase;' : ''}`;
      view.innerHTML = `
        <p class="hint">Hover between two lines: <b>Split here</b> starts a new slide, and <b>Merge</b> joins two slides back together. Click any words to edit them.</p>
        ${song.slideMode === 'manual' ? `<div class="manual-note">Slide breaks in this song are set by hand. <button class="link-btn" id="song-auto">Let the app split them again</button></div>` : ''}
        ${lay.map((sec, si) => `
          <section class="se-sec">
            <div class="se-head"><span class="sec-dot k-${Songs.sectionKind(sec.key)}"></span><strong>${esc(sec.label)}</strong>
              <span class="muted small">${sec.slides.length} slide${sec.slides.length === 1 ? '' : 's'}</span></div>
            <div class="se-row">${sec.slides.map((sl, j) => `
              ${j > 0 ? `<button class="se-merge" data-merge="${si}:${j}" title="Join these two slides">Merge</button>` : ''}
              <div class="se-slide ${st.position === 'lower' ? 'lower' : ''}" style="${cardStyle}">
                <div class="se-text" style="${textStyle}">${sl.map((ln, k) => `
                  ${k > 0 ? `<button class="se-split" data-split="${si}:${j}:${k}" aria-label="Start a new slide here"><span>Split here</span></button>` : ''}
                  <span class="se-line" contenteditable="plaintext-only" spellcheck="true" data-line="${si}:${j}:${k}">${esc(ln)}</span>`).join('')}
                </div>
              </div>`).join('')}
            </div>
          </section>`).join('')}`;

      const commit = (fn) => {
        const fresh = Songs.layout(song, S());
        fn(fresh);
        song.lyrics = Songs.serialize(fresh);
        song.slideMode = 'manual';
        changed();
        renderSlidesView();
      };
      view.onclick = (e) => {
        const sp = e.target.closest('[data-split]');
        if (sp) {
          const [si, j, k] = sp.dataset.split.split(':').map(Number);
          return commit((l) => { const sl = l[si].slides[j]; l[si].slides.splice(j, 1, sl.slice(0, k), sl.slice(k)); });
        }
        const mg = e.target.closest('[data-merge]');
        if (mg) {
          const [si, j] = mg.dataset.merge.split(':').map(Number);
          return commit((l) => { const s = l[si].slides; s.splice(j - 1, 2, s[j - 1].concat(s[j])); });
        }
        if (e.target.id === 'song-auto') {
          song.slideMode = 'auto'; changed(); renderSlidesView(); renderLook();
        }
      };
      $$('.se-line', view).forEach((el) => {
        const original = el.textContent;
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } if (e.key === 'Escape') { el.textContent = original; el.blur(); } });
        el.addEventListener('blur', () => {
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          if (text === original) return;
          const [si, j, k] = el.dataset.line.split(':').map(Number);
          commit((l) => {
            const sl = l[si].slides[j];
            if (text) sl[k] = text; else sl.splice(k, 1);
          });
        });
      });
    };

    // ----- Lyrics view -----
    const renderLyricsView = () => {
      view.innerHTML = `
        <div class="form-grid">
          <label>Author(s)<input id="song-author" value="${esc(song.author)}"></label>
          <label>Copyright<input id="song-copyright" value="${esc(song.copyright)}"></label>
          <label>CCLI Song #<input id="song-ccli" value="${esc(song.ccli)}"></label>
        </div>
        <div id="song-cleanup"></div>
        <label class="block lyrics-block">
          <span class="row" style="justify-content:space-between">Lyrics <button type="button" class="link-btn" id="song-tidy">Tidy up these lyrics</button></span>
          <span class="hint">Paste from anywhere: chords, CCLI lines and notes are tidied up for you. Put <b>Verse 1</b>, <b>Chorus</b> or <b>Bridge</b> on its own line before each part. A blank line starts a new slide.</span>
          <textarea id="song-lyrics" spellcheck="true" placeholder="Verse 1&#10;Jesus loves me, this I know&#10;For the Bible tells me so&#10;&#10;Chorus&#10;Yes, Jesus loves me…">${esc(song.lyrics)}</textarea>
        </label>`;
      const bindField = (sel, key, rerenderList) => {
        $(sel).oninput = (e) => { song[key] = e.target.value; changed(); };
        if (rerenderList) $(sel).onchange = renderList;
      };
      bindField('#song-author', 'author', true);
      bindField('#song-copyright', 'copyright');
      bindField('#song-ccli', 'ccli');
      const ta = $('#song-lyrics');
      ta.oninput = () => { song.lyrics = ta.value; changed(); renderOrder(); };
      const showCleanup = (report, undo) => {
        const what = Songs.describeCleanup(report);
        const long = report.longLines.slice(0, 3);
        if (!what && !long.length) { $('#song-cleanup').innerHTML = ''; return; }
        $('#song-cleanup').innerHTML = `<div class="cleanup" role="status">${icon('check', 18)}
          <div class="cleanup-text">${what ? `<strong>Tidied up the lyrics</strong><span>${esc(what)}</span>` : ''}
          ${long.length ? `<span class="warn"><b>${report.longLines.length} line${report.longLines.length === 1 ? ' is' : 's are'}</b> too long for one line on the TV and will wrap: ${long.map((l) => '“' + esc(l) + '”').join(', ')}</span>` : ''}</div>
          ${what && undo ? '<button class="link-btn" id="cleanup-undo">Undo</button>' : ''}</div>`;
        if (what && undo) $('#cleanup-undo').onclick = () => { undo(); $('#song-cleanup').innerHTML = ''; };
      };
      ta.addEventListener('paste', (e) => {
        const raw = e.clipboardData && e.clipboardData.getData('text/plain');
        if (!raw) return;
        const res = Songs.cleanLyrics(raw, Songs.effectiveStyle(song, S()));
        if (!res.changed && !res.report.longLines.length) return;
        e.preventDefault();
        const before = ta.value, start = ta.selectionStart, end = ta.selectionEnd;
        ta.value = before.slice(0, start) + res.text + before.slice(end);
        ta.selectionStart = ta.selectionEnd = start + res.text.length;
        song.lyrics = ta.value; changed(); renderOrder();
        showCleanup(res.report, () => { ta.value = before.slice(0, start) + raw + before.slice(end); song.lyrics = ta.value; changed(); renderOrder(); });
      });
      $('#song-tidy').onclick = () => {
        const before = song.lyrics;
        const res = Songs.cleanLyrics(before, Songs.effectiveStyle(song, S()));
        if (!res.changed && !res.report.longLines.length) { toast('These lyrics already look tidy.'); return; }
        ta.value = song.lyrics = res.text; changed(); renderOrder();
        showCleanup(res.report, () => { ta.value = song.lyrics = before; changed(); renderOrder(); });
      };
    };

    const renderView = () => {
      $$('.seg [data-view]').forEach((b) => { b.classList.toggle('on', b.dataset.view === B.songView); b.setAttribute('aria-selected', b.dataset.view === B.songView); });
      if (B.songView === 'slides') renderSlidesView(); else renderLyricsView();
    };
    $('.song-editor .seg').onclick = (e) => {
      const b = e.target.closest('[data-view]');
      if (b && b.dataset.view !== B.songView) { B.songView = b.dataset.view; renderView(); }
    };

    // ----- Song order chips -----
    const renderOrder = () => {
      const sections = Songs.layout(song, S());
      const keys = Songs.parseArrangement(song.arrangement, sections);
      const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
      const labels = keys.map((k) => byKey[k] && byKey[k].label).filter(Boolean);
      const setOrder = (list) => { song.arrangement = list.join(', '); changed(); renderOrder(); };
      const el = $('#song-order');
      el.innerHTML = labels.map((l, i) => `<span class="o-chip k-${Songs.sectionKind(keys[i])}" draggable="true" data-index="${i}">
          <span class="grip">${icon('grip', 12)}</span>${esc(l)}<button class="o-x" data-remove="${i}" aria-label="Remove ${esc(l)}">${icon('x', 12)}</button></span>`).join('')
        || '<span class="muted small">Add lyrics to build the order.</span>';
      const seen = new Set();
      $('#song-order-add').innerHTML = sections.length ? '<span class="muted small">Add:</span>' + sections.filter((s) => !seen.has(s.label) && seen.add(s.label))
        .map((s) => `<button class="o-add k-${Songs.sectionKind(s.key)}" data-add="${esc(s.label)}">+ ${esc(s.label)}</button>`).join('') +
        (song.arrangement ? '<button class="link-btn small" id="order-reset">Use the order written</button>' : '') : '';
      el.onclick = (e) => {
        const x = e.target.closest('[data-remove]');
        if (x) { const list = labels.slice(); list.splice(Number(x.dataset.remove), 1); setOrder(list); }
      };
      $('#song-order-add').onclick = (e) => {
        const a = e.target.closest('[data-add]');
        if (a) setOrder(labels.concat(a.dataset.add));
        if (e.target.id === 'order-reset') { song.arrangement = ''; changed(); renderOrder(); }
      };
      if (!el._sortable) { el._sortable = true; sortable(el, (from, to) => { const list = Songs.parseArrangement(song.arrangement, Songs.layout(song, S())).map((k) => Songs.layout(song, S()).find((s) => s.key === k).label); move(list, from, to); setOrder(list); }); }
    };

    // ----- Look for this song -----
    const renderLook = () => {
      const st = Songs.effectiveStyle(song, S());
      const useDef = Songs.usesDefaults(song);
      const def = S();
      const box = $('#song-look');
      box.innerHTML = `
        <h3>Look for this song</h3>
        <label class="check defaults-box ${useDef ? 'on' : ''}"><input type="checkbox" id="look-default" ${useDef ? 'checked' : ''}> Use Settings defaults</label>
        <p class="hint" style="margin:0">${useDef ? 'Change anything below to give this song its own look.' : 'This song has its own look. Tick the box to go back to the defaults.'}</p>
        <div class="look-controls ${useDef ? 'dim' : ''}">
          <div class="form-grid two">
            <label>Lines per slide<select id="look-lines">${[1, 2, 3, 4, 5, 6, 8].map((n) => `<option value="${n}" ${n === Number(st.linesPerSlide) ? 'selected' : ''}>${n}${n === Number(def.linesPerSlide) ? ' (default)' : ''}</option>`).join('')}</select></label>
            <label>Text position<select id="look-pos">${[['center', 'Centered'], ['lower', 'Lower third']].map(([v, n]) => `<option value="${v}" ${st.position === v ? 'selected' : ''}>${n}${v === (def.textPosition || 'center') ? ' (default)' : ''}</option>`).join('')}</select></label>
          </div>
          ${song.slideMode === 'manual' ? '<p class="hint" style="margin:-4px 0 0">Lines per slide only applies when the app splits the slides. This song’s breaks are set by hand.</p>' : ''}
          <div class="block-label">Text size
            <div class="seg full" id="look-size">${['smaller', 'normal', 'larger'].map((v) => `<button data-size="${v}" class="${st.size === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
          </div>
          <label class="check"><input type="checkbox" id="look-caps" ${st.uppercase ? 'checked' : ''}> ALL CAPITALS</label>
          <div class="block-label">Background<div class="bg-tiles small" id="song-bg"></div></div>
        </div>`;
      const own = (key, val) => {
        song.style = Object.assign({}, song.style || {}, { [key]: val });
        changed(); renderLook(); if (B.songView === 'slides') renderSlidesView(); renderOrder();
      };
      $('#look-default').onchange = (e) => {
        if (e.target.checked) { song.style = null; song.background = ''; }
        else song.style = { linesPerSlide: Number(def.linesPerSlide) || 4, size: 'normal', position: def.textPosition || 'center', uppercase: !!def.uppercase };
        changed(); renderLook(); if (B.songView === 'slides') renderSlidesView(); renderOrder();
      };
      $('#look-lines').onchange = (e) => own('linesPerSlide', Number(e.target.value));
      $('#look-pos').onchange = (e) => own('position', e.target.value);
      $('#look-caps').onchange = (e) => own('uppercase', e.target.checked);
      $('#look-size').onclick = (e) => { const b = e.target.closest('[data-size]'); if (b) own('size', b.dataset.size); };
      bgTiles($('#song-bg'), song.background || '', (id) => {
        song.background = id; changed(); renderLook(); if (B.songView === 'slides') renderSlidesView();
      }, { withDefault: true });
    };

    $('#song-title').oninput = (e) => { song.title = e.target.value || 'Untitled song'; changed(); };
    $('#song-title').onchange = renderList;
    $('#song-del').onclick = async () => { if (await deleteThing('song', song.id)) { B.song = null; renderBuild(); } };
    if (song.pco) $('#song-pco-update').onclick = async () => {
      if (song.slideMode === 'manual' && !confirm('This song’s slides were arranged by hand. Updating replaces the lyrics with the ones from Planning Center, so your slide changes will be lost. Its look and background stay.\n\nUpdate anyway?')) return;
      busy('Getting the latest from Planning Center…');
      try {
        const arrs = await PCO.arrangements(song.pco.songId);
        const arr = arrs.find((a) => a.id === song.pco.arrangementId && a.lyrics) || arrs.find((a) => a.lyrics);
        if (!arr) throw new Error('That song has no lyrics in Planning Center any more.');
        const list = await PCO.songs();
        const meta = list.find((x) => x.id === song.pco.songId) || { id: song.pco.songId, title: song.title, author: song.author, copyright: song.copyright, ccli: song.ccli };
        saveFromPco(meta, arr);
        busy(); renderBuild(); toast('Updated from Planning Center.');
      } catch (e) { busy(); toast(e.message, 'error'); }
    };

    renderView();
    renderOrder();
    renderLook();
  }

  // ---------- Planning Center import ----------
  /** Add (or refresh) a song from Planning Center. Keeps the background if it already exists. */
  function saveFromPco(pcoSong, arr) {
    const data = PCO.toSong(pcoSong, arr);
    data.slideMode = 'auto'; // fresh lyrics: let the app split them
    let song = D().songs.find((s) => s.pco && s.pco.songId === pcoSong.id);
    if (song) Object.assign(song, data);
    else {
      song = Object.assign({ id: Media.id(), background: '', added: Date.now() }, data);
      D().songs.push(song);
    }
    Store.save(); invalidateSlides();
    B.song = song.id;
    return song;
  }

  async function openPcoBrowser() {
    if (!PCO.isConfigured()) {
      if (confirm('Planning Center isn’t connected yet. Open Settings to add the access token?')) { setBuildTab('settings'); setTimeout(() => { const el = $('#pco-app'); if (el) el.scrollIntoView({ block: 'center' }); }, 50); }
      return;
    }
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card pco-card">
      <div class="col-head"><h2>Import songs from Planning Center</h2><button class="btn" id="pco-close">Close</button></div>
      <div class="pco-body">
        <div class="pco-left">
          <input type="search" id="pco-search" placeholder="Search by title, author or CCLI #" disabled>
          <ul class="list pco-list" id="pco-list"><li class="muted">Loading songs from Planning Center…</li></ul>
        </div>
        <div class="pco-right" id="pco-detail"><p class="muted pad">Click a song to see its lyrics, or tick several and import them all at once.</p></div>
      </div>
      <div class="row gap pco-foot"><span id="pco-status" class="muted"></span><span class="spacer"></span>
        <button class="btn primary" id="pco-import-checked" disabled>Import ticked songs</button></div>
    </div>`;
    m.classList.add('show');
    m.onclick = null;
    let imported = false;
    const close = () => { m.classList.remove('show'); m.innerHTML = ''; if (imported && buildTab === 'songs') renderBuild(); };
    $('#pco-close').onclick = close;
    const status = (msg, kind = '') => { const el = $('#pco-status'); if (el) { el.textContent = msg; el.className = kind === 'error' ? 'error-text' : 'muted'; } };
    const checked = new Set();
    let all = [];
    const inLibrary = (ps) => D().songs.find((s) => (s.pco && s.pco.songId === ps.id));

    const renderList = () => {
      const q = ($('#pco-search').value || '').trim().toLowerCase();
      const rows = all.filter((x) => !x.hidden && (!q || x.title.toLowerCase().includes(q) || x.author.toLowerCase().includes(q) || x.ccli === q));
      $('#pco-list').innerHTML = rows.slice(0, 300).map((x) => `
        <li data-pco="${esc(x.id)}" class="${B.pcoSel === x.id ? 'selected' : ''}">
          <div class="row gap"><input type="checkbox" data-check="${esc(x.id)}" ${checked.has(x.id) ? 'checked' : ''} aria-label="Select ${esc(x.title)}">
            <span class="name"><strong>${esc(x.title)}</strong><small>${esc(x.author)}</small></span>
            ${inLibrary(x) ? '<span class="lib-badge">In library</span>' : ''}</div>
        </li>`).join('') + (rows.length > 300 ? `<li class="muted">…and ${rows.length - 300} more. Type to narrow it down.</li>` : '') || '<li class="muted">No songs match.</li>';
    };
    const updateCount = () => {
      const b = $('#pco-import-checked');
      b.disabled = !checked.size;
      b.textContent = checked.size ? `Import ${checked.size} ticked song${checked.size > 1 ? 's' : ''}` : 'Import ticked songs';
    };

    const showDetail = async (ps) => {
      B.pcoSel = ps.id;
      $$('#pco-list li[data-pco]').forEach((li) => li.classList.toggle('selected', li.dataset.pco === ps.id));
      const box = $('#pco-detail');
      box.innerHTML = `<p class="muted pad">Loading “${esc(ps.title)}”…</p>`;
      let arrs;
      try { arrs = await PCO.arrangements(ps.id); } catch (e) { box.innerHTML = `<p class="error-text pad">${esc(e.message)}</p>`; return; }
      if (B.pcoSel !== ps.id) return;
      const withLyrics = arrs.filter((a) => a.lyrics);
      const existing = inLibrary(ps);
      if (!withLyrics.length) { box.innerHTML = `<h3>${esc(ps.title)}</h3><p class="muted">This song has no lyrics in Planning Center. (Lyrics come from SongSelect into an arrangement’s Lyrics box.)</p>`; return; }
      let pick = (existing && withLyrics.find((a) => a.id === existing.pco.arrangementId)) || withLyrics[0];
      const draw = () => {
        const sections = Songs.parseSections(pick.lyrics);
        box.innerHTML = `
          <h3>${esc(ps.title)}</h3>
          <p class="muted small">${esc(ps.author)}${ps.ccli ? ' · CCLI # ' + esc(ps.ccli) : ''}</p>
          ${withLyrics.length > 1 ? `<label class="block-label">Arrangement<select id="pco-arr">${withLyrics.map((a) => `<option value="${esc(a.id)}" ${a.id === pick.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : `<p class="small muted">Arrangement: ${esc(pick.name)}</p>`}
          <p class="small"><b>Order:</b> ${pick.sequence.length ? esc(pick.sequence.join(' → ')) : '<span class="muted">as written</span>'}</p>
          <p class="small muted">${sections.length} part${sections.length === 1 ? '' : 's'} found: ${esc(sections.map((x) => x.label).join(', '))}</p>
          <pre class="lyrics-preview">${esc(pick.lyrics)}</pre>
          <button class="btn primary" id="pco-import-one">${existing ? 'Update the song in the library' : 'Import this song'}</button>`;
        const sel = $('#pco-arr');
        if (sel) sel.onchange = () => { pick = withLyrics.find((a) => a.id === sel.value); draw(); };
        $('#pco-import-one').onclick = () => {
          const song = saveFromPco(ps, pick);
          imported = true;
          status(`${existing ? 'Updated' : 'Imported'} “${song.title}”.`);
          renderList(); draw();
        };
      };
      draw();
    };

    $('#pco-list').onclick = (e) => {
      const cb = e.target.closest('[data-check]');
      if (cb) { if (cb.checked) checked.add(cb.dataset.check); else checked.delete(cb.dataset.check); updateCount(); return; }
      const li = e.target.closest('li[data-pco]');
      if (li) showDetail(all.find((x) => x.id === li.dataset.pco));
    };
    $('#pco-import-checked').onclick = async () => {
      const ids = Array.from(checked);
      const done = [], skipped = [];
      $('#pco-import-checked').disabled = true;
      for (let i = 0; i < ids.length; i++) {
        const ps = all.find((x) => x.id === ids[i]);
        status(`Importing ${i + 1} of ${ids.length}: ${ps.title}…`);
        try {
          const arr = (await PCO.arrangements(ps.id)).find((a) => a.lyrics);
          if (!arr) { skipped.push(ps.title + ' (no lyrics)'); continue; }
          const existing = inLibrary(ps);
          saveFromPco(ps, existing ? (await PCO.arrangements(ps.id)).find((a) => a.id === existing.pco.arrangementId && a.lyrics) || arr : arr);
          done.push(ps.title);
          checked.delete(ps.id);
        } catch (e) { skipped.push(ps.title + ' (' + e.message + ')'); }
      }
      imported = imported || done.length > 0;
      status(`Imported ${done.length} song${done.length === 1 ? '' : 's'}.` + (skipped.length ? ` Skipped ${skipped.length}: ${skipped.join('; ')}` : ''), skipped.length ? 'error' : '');
      renderList(); updateCount();
    };

    try {
      all = await PCO.songs(false, (n, total) => status(`Loading songs… ${n}${total ? ' of ' + total : ''}`));
      status(`${all.filter((x) => !x.hidden).length} songs in Planning Center.`);
      $('#pco-search').disabled = false;
      $('#pco-search').oninput = renderList;
      $('#pco-search').focus();
      renderList();
    } catch (e) {
      $('#pco-list').innerHTML = `<li class="error-text">${esc(e.message)}</li>`;
      status('');
    }
  }

  // ---------- Lessons (slide images) ----------
  function buildLessons(body) {
    const lessons = sortedBy(D().lessons);
    if (B.lesson && !byId('lessons', B.lesson)) B.lesson = null;
    if (!B.lesson && lessons[0]) B.lesson = lessons[0].id;
    const lesson = byId('lessons', B.lesson);
    body.innerHTML = `
      <section class="col card col-list">
        <div class="col-head"><h2>Lessons</h2></div>
        <p class="hint">A lesson is a set of slide pictures (the JPEGs in your curriculum download).</p>
        <div class="row gap wrap">
          <button class="btn primary" id="lesson-files">+ From pictures…</button>
          <button class="btn" id="lesson-folder">+ From a folder…</button>
        </div>
        <ul class="list" id="lesson-list">${lessons.map((l) => `<li class="${l.id === B.lesson ? 'selected' : ''}" data-id="${l.id}"><strong>${esc(l.title)}</strong><small>${l.slides.length} slides</small></li>`).join('') || '<li class="muted">No lessons yet.</li>'}</ul>
      </section>
      <section class="col card col-wide" id="lesson-main">
        ${lesson ? `
        <div class="col-head"><input class="title-input" id="lesson-title" value="${esc(lesson.title)}" aria-label="Lesson name"></div>
        <div class="row gap">
          <button class="btn" id="lesson-add">+ Add more pictures</button>
          <button class="btn danger" id="lesson-del">Delete lesson</button>
        </div>
        <p class="hint">Drag slides to reorder. You can also drop pictures from Finder onto this area.</p>
        <div class="slide-grid editable" id="lesson-slides">${lesson.slides.map((s, i) => `
          <div class="slide-card" draggable="true" data-index="${i}"><div class="thumb"><img loading="lazy" data-path="${esc(s.path)}"></div>
          <div class="cap"><span class="num">${i + 1}</span>${esc(s.name || '')}<button class="icon-btn danger" data-del="${i}" title="Remove slide" aria-label="Remove slide">${icon('x')}</button></div></div>`).join('')}</div>` :
        '<p class="muted pad">Import a lesson’s slide pictures to get started. Tip: choose “From a folder” and pick the lesson’s JPEG folder from the curriculum download.</p>'}
      </section>`;

    const newLesson = async (files, suggestedTitle) => {
      const imgs = (files || []).filter(Media.isImage);
      if (!imgs.length) { if (files && files.length) toast('No pictures found (JPEG or PNG).', 'error'); return; }
      const title = prompt('Name for this lesson:', suggestedTitle || Media.baseName(imgs[0].name));
      if (title === null) return;
      busy('Copying slides…');
      try {
        const l = await Media.importLesson(imgs, title || 'New lesson', busy);
        B.lesson = l.id; toast(`Added “${l.title}” with ${l.slides.length} slides.`);
      } catch (e) { toast('Import failed: ' + e.message, 'error'); }
      busy(); renderBuild();
    };
    $('#lesson-files').onclick = async () => newLesson(await pickFiles({ accept: 'image/*' }));
    $('#lesson-folder').onclick = async () => {
      let folderName = '';
      try {
        const dir = await window.showDirectoryPicker({ id: 'nckids-import', mode: 'read' });
        folderName = dir.name;
        busy('Reading folder…');
        const files = await Media.filesFromFolder(dir, Media.isImage);
        busy();
        newLesson(files, folderName);
      } catch (e) { busy(); }
    };
    $('#lesson-list').onclick = (e) => { const li = e.target.closest('li[data-id]'); if (li) { B.lesson = li.dataset.id; renderBuild(); } };
    dropZone($('#lesson-main'), async (files) => {
      if (!lesson) return newLesson(files);
      busy('Copying slides…');
      const n = await Media.addLessonSlides(lesson, files, busy);
      busy(); invalidateSlides(); renderBuild(); toast(`Added ${n} slide${n === 1 ? '' : 's'}.`);
    });
    if (!lesson) return;

    $$('#lesson-slides img[data-path]').forEach(async (img) => { img.src = await Store.url(img.dataset.path); });
    $('#lesson-title').oninput = (e) => { lesson.title = e.target.value || 'Untitled lesson'; Store.save(); };
    $('#lesson-title').onchange = () => renderBuild();
    $('#lesson-add').onclick = async () => {
      const files = await pickFiles({ accept: 'image/*' });
      if (!files.length) return;
      busy('Copying slides…');
      const n = await Media.addLessonSlides(lesson, files, busy);
      busy(); invalidateSlides(); renderBuild(); toast(`Added ${n} slide${n === 1 ? '' : 's'}.`);
    };
    $('#lesson-del').onclick = async () => { if (await deleteThing('lesson', lesson.id)) { B.lesson = null; renderBuild(); } };
    const grid = $('#lesson-slides');
    sortable(grid, (from, to) => { move(lesson.slides, from, to); lesson.thumb = lesson.slides[0] && lesson.slides[0].path; Store.save(); invalidateSlides(); renderBuild(); });
    grid.onclick = async (e) => {
      const d = (e.target.closest('[data-del]') || {}).dataset?.del;
      if (d === undefined) return;
      const [removed] = lesson.slides.splice(Number(d), 1);
      await Store.remove(removed.path);
      lesson.thumb = lesson.slides[0] && lesson.slides[0].path;
      Store.save(); invalidateSlides(); renderBuild();
    };
  }

  // ---------- Videos & Backgrounds (media grids) ----------
  function mediaGrid(body, { type, title, hint, importLabel, accept, importer, extraButtons }) {
    const coll = COLLECTION[type];
    const items = sortedBy(D()[coll]);
    body.innerHTML = `
      <section class="col card col-full" id="media-main">
        <div class="col-head"><h2>${title}</h2>
          <div class="row gap"><input type="search" id="media-search" placeholder="Search…"><button class="btn primary" id="media-import">${importLabel}</button><button class="btn" id="media-import-folder">+ From a folder…</button></div>
        </div>
        <p class="hint">${hint}</p>
        <div class="media-grid" id="media-grid"></div>
      </section>`;
    const render = () => {
      const q = ($('#media-search').value || '').toLowerCase();
      const grid = $('#media-grid');
      grid.innerHTML = items.filter((x) => !q || x.title.toLowerCase().includes(q)).map((x) => `
        <div class="media-card" data-id="${x.id}">
          <div class="media-thumb"><img data-path="${esc(x.thumb || '')}" alt=""><span class="badge">${x.type === 'image' ? 'Still' : (x.duration ? fmtTime(x.duration) : 'Motion')}</span>
            ${type === 'background' && S().defaultBackground === x.id ? '<span class="badge default">Default</span>' : ''}</div>
          <input class="media-title" value="${esc(x.title)}" data-title="${x.id}">
          <div class="row gap">${extraButtons ? extraButtons(x) : ''}<button class="icon-btn danger" data-del="${x.id}" title="Delete" aria-label="Delete">${icon('x')}</button></div>
        </div>`).join('') || '<p class="muted pad">Nothing here yet. Use the import button, or drag files from Finder onto this page.</p>';
      $$('img[data-path]', grid).forEach(async (img) => { if (img.dataset.path) img.src = await Store.url(img.dataset.path); });
    };
    render();
    $('#media-search').oninput = render;
    const runImport = async (files) => {
      if (!files || !files.length) return;
      busy('Importing…');
      try {
        const { added, problems } = await importer(files, busy);
        busy(); renderBuild();
        if (added.length) toast(`Added ${added.length} file${added.length > 1 ? 's' : ''}.`);
        reportProblems(problems);
      } catch (e) { busy(); toast('Import failed: ' + e.message, 'error'); }
    };
    $('#media-import').onclick = async () => runImport(await pickFiles({ accept }));
    $('#media-import-folder').onclick = async () => runImport(await pickFolderFiles(type === 'video' ? Media.isVideo : (f) => Media.isVideo(f) || Media.isImage(f)));
    dropZone($('#media-main'), runImport);
    const grid = $('#media-grid');
    grid.addEventListener('input', (e) => {
      const id = e.target.dataset.title;
      if (id) { byId(coll, id).title = e.target.value || 'Untitled'; Store.save(); }
    });
    grid.addEventListener('click', async (e) => {
      const del = (e.target.closest('[data-del]') || {}).dataset?.del;
      if (del) { if (await deleteThing(type, del)) renderBuild(); return; }
      const card = e.target.closest('.media-card');
      if (e.target.closest('.media-thumb') && card) previewMedia(byId(coll, card.dataset.id), type);
      if (e.target.dataset.default) { S().defaultBackground = e.target.dataset.default; Store.save(); invalidateSlides(); renderBuild(); toast('Default background set.'); }
    });
  }

  async function previewMedia(x, type) {
    const m = $('#modal');
    const url = await Store.url(x.path);
    m.innerHTML = `<div class="modal-card"><div class="col-head"><h2>${esc(x.title)}</h2><button class="btn" id="modal-close">Close</button></div>
      ${x.type === 'image' ? `<img src="${url}" class="modal-media">` : `<video src="${url}" class="modal-media" controls autoplay ${type === 'background' ? 'muted loop' : ''}></video>`}
      <p class="hint">${type === 'video' ? 'This preview plays on this computer only — not on the TV.' : ''}</p></div>`;
    m.classList.add('show');
    const close = () => { const v = $('video', m); if (v) v.pause(); m.classList.remove('show'); m.innerHTML = ''; };
    $('#modal-close').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
  }

  function buildVideos(body) {
    mediaGrid(body, {
      type: 'video', title: 'Videos', importLabel: '+ Import videos…', accept: 'video/*,.mp4,.m4v,.mov,.webm',
      hint: 'Lesson and worship videos. They play full screen on the TV with sound. MP4 files work best. Click a picture to preview.',
      importer: (files, p) => Media.importVideos(files, p),
    });
  }
  function buildBackgrounds(body) {
    mediaGrid(body, {
      type: 'background', title: 'Backgrounds', importLabel: '+ Import backgrounds…', accept: 'video/*,image/*,.mp4,.mov,.m4v',
      hint: 'Motion loops (or still pictures) shown behind song lyrics. The default background is used for any song that doesn’t pick its own.',
      importer: (files, p) => Media.importBackgrounds(files, p),
      extraButtons: (x) => S().defaultBackground === x.id ? '<span class="muted small">Default</span>' : `<button class="btn small" data-default="${x.id}">Make default</button>`,
    });
  }

  // ---------- Settings ----------
  const FONTS = ['Avenir Next', 'Helvetica Neue', 'Arial Rounded MT Bold', 'Futura', 'Gill Sans', 'Verdana', 'Chalkboard SE', 'Marker Felt', 'Noteworthy', 'Georgia'];
  const SET_SECTIONS = [
    ['appearance', 'Appearance'], ['lyrics', 'Lyrics on the TV'], ['tv', 'TV and sound'], ['logo', 'Logo'],
    ['timers', 'Timers'], ['ccli', 'CCLI'], ['pco', 'Planning Center'], ['library', 'Library folder'],
  ];

  function buildSettings(body) {
    if (!SET_SECTIONS.some(([k]) => k === B.setSection)) B.setSection = 'appearance';
    body.innerHTML = `
      <nav class="col card set-nav" aria-label="Settings sections">${SET_SECTIONS.map(([k, name]) =>
        `<button data-sec="${k}" class="${k === B.setSection ? 'active' : ''}">${name}</button>`).join('')}</nav>
      <section class="col card set-main" id="set-main"></section>`;
    $('.set-nav').onclick = (e) => {
      const b = e.target.closest('[data-sec]');
      if (b) { B.setSection = b.dataset.sec; renderBuild(); }
    };
    ({ appearance: setAppearance, lyrics: setLyrics, tv: setTv, logo: setLogo, ccli: setCcli, pco: setPco, library: setLibrary, timers: setTimers })[B.setSection]($('#set-main'), S());
  }

  function setAppearance(el, s) {
    const group = (key, name, help, current) => `
      <fieldset class="theme-group"><legend><strong>${name}</strong><span>${help}</span></legend>
        <div class="theme-opts">${['light', 'dark'].map((t) => `
          <label class="theme-opt ${current === t ? 'on' : ''}">
            <span class="mini ${t}"><span class="bar"></span><span class="panes"><span></span><span></span><span></span></span></span>
            <span class="row"><input type="radio" name="${key}" value="${t}" ${current === t ? 'checked' : ''}> ${t === 'light' ? 'Light' : 'Dark'}
              ${(key === 'buildTheme' ? 'light' : 'dark') === t ? '<span class="muted small" style="font-weight:600">Default</span>' : ''}</span>
          </label>`).join('')}</div>
      </fieldset>`;
    el.innerHTML = `
      <h1>Appearance</h1>
      <p class="lead">Each mode can have its own look. Using different looks for Build and Present makes it obvious at a glance whether you are editing or presenting.</p>
      ${group('buildTheme', 'Build mode', 'Playlists, songs, lessons and settings.', s.buildTheme || 'light')}
      ${group('presentTheme', 'Present mode', 'The screen volunteers use during class.', s.presentTheme || 'dark')}
      <h2>Accent color</h2>
      <div class="accent-row">${Object.keys(ACCENTS).map((k) => `<button class="accent-dot ${s.accent === k || (!s.accent && k === 'teal') ? 'on' : ''}" data-accent="${k}" style="background:${ACCENTS[k].light[0]}" aria-label="${k}" title="${k[0].toUpperCase() + k.slice(1)}"></button>`).join('')}</div>
      <p class="note">The TV always shows your slides and backgrounds exactly as designed. These settings only change this control screen.</p>`;
    el.onchange = (e) => {
      if (e.target.name === 'buildTheme' || e.target.name === 'presentTheme') {
        s[e.target.name] = e.target.value; Store.save(); applyTheme(); renderBuild();
      }
    };
    el.onclick = (e) => {
      const b = e.target.closest('[data-accent]');
      if (b) { s.accent = b.dataset.accent; Store.save(); applyTheme(); renderBuild(); }
    };
  }

  function setLyrics(el, s) {
    el.innerHTML = `
      <h1>Lyrics on the TV</h1>
      <p class="lead">How song words look on the TV.</p>
      <div class="form-grid">
        <label>Font<select id="set-font">${FONTS.map((f) => `<option ${f === s.font ? 'selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select></label>
        <label>Text color<input type="color" id="set-color" value="${esc(s.textColor)}"></label>
        <label>Biggest text size <span class="muted" id="set-size-val">${s.maxFontSize}</span><input type="range" id="set-size" min="50" max="160" value="${s.maxFontSize}"></label>
        <label>Lines per slide<select id="set-lines">${[1, 2, 3, 4, 5, 6, 8].map((n) => `<option ${n === Number(s.linesPerSlide) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Fade time (seconds)<input type="number" id="set-fade" min="0" max="3" step="0.1" value="${s.transitionSeconds}"></label>
        <label>Text position<select id="set-pos">${[['center', 'Centered'], ['lower', 'Lower third']].map(([v, n]) => `<option value="${v}" ${(s.textPosition || 'center') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Default background<select id="set-bg">${bgOptions(s.defaultBackground || 'none', { allowDefault: false })}</select></label>
        <label class="check"><input type="checkbox" id="set-upper" ${s.uppercase ? 'checked' : ''}> ALL CAPITALS</label>
        <label class="check"><input type="checkbox" id="set-shadow" ${s.shadow ? 'checked' : ''}> Text shadow (easier to read)</label>
      </div>
      <div class="sample-wrap"><div class="sample" id="set-sample"></div></div>`;
    const sample = new Renderer($('#set-sample'), { staticOnly: true });
    const drawSample = async () => {
      sample.setBackground(await resolveBg(s.defaultBackground));
      sample.setText('Jesus loves me, this I know\nFor the Bible tells me so\nLittle ones to Him belong\nThey are weak but He is strong', Songs.effectiveStyle({}, s));
    };
    drawSample();
    const upd = (key, val) => { s[key] = val; Store.save(); invalidateSlides(); drawSample(); Output.refreshStyle(); };
    $('#set-font').onchange = (e) => upd('font', e.target.value);
    $('#set-color').oninput = (e) => upd('textColor', e.target.value);
    $('#set-size').oninput = (e) => { $('#set-size-val').textContent = e.target.value; upd('maxFontSize', Number(e.target.value)); };
    $('#set-lines').onchange = (e) => upd('linesPerSlide', Number(e.target.value));
    $('#set-upper').onchange = (e) => upd('uppercase', e.target.checked);
    $('#set-shadow').onchange = (e) => upd('shadow', e.target.checked);
    $('#set-fade').onchange = (e) => upd('transitionSeconds', Math.max(0, Math.min(3, Number(e.target.value) || 0)));
    $('#set-bg').onchange = (e) => upd('defaultBackground', e.target.value === 'none' ? null : e.target.value);
    $('#set-pos').onchange = (e) => upd('textPosition', e.target.value);
  }

  function setTv(el, s) {
    el.innerHTML = `
      <h1>TV and sound</h1>
      <p class="lead">Videos play through the Mac’s sound output. The simplest setup: plug in the TV, then choose the TV under the Mac’s <b>Control Center → Sound</b>. Or pick the TV here so videos always use it, even if the Mac's sound is set elsewhere.</p>
      <div class="row gap" style="max-width:560px"><select id="set-speaker"><option value="">Mac’s current sound output</option>${s.audioDeviceId ? `<option value="${esc(s.audioDeviceId)}" selected>${esc(s.audioDeviceLabel || 'Chosen speaker')}</option>` : ''}</select>
      <button class="btn" id="set-speaker-find">Find speakers…</button></div>
      <p class="hint">Chrome will ask for microphone permission once. That is only how Chrome reveals speaker names; nothing is recorded.</p>`;
    $('#set-speaker-find').onclick = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) { /* names may be hidden, list anyway */ }
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
      $('#set-speaker').innerHTML = '<option value="">Mac’s current sound output</option>' +
        devices.filter((d) => d.deviceId !== 'default').map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === s.audioDeviceId ? 'selected' : ''}>${esc(d.label || 'Speaker')}</option>`).join('');
      toast(`Found ${devices.length} sound output${devices.length === 1 ? '' : 's'}. Choose the TV from the list.`);
    };
    $('#set-speaker').onchange = (e) => {
      s.audioDeviceId = e.target.value;
      s.audioDeviceLabel = e.target.value ? e.target.selectedOptions[0].textContent : '';
      Store.save(); toast('Saved. Videos will use this speaker.');
    };
  }

  function setLogo(el, s) {
    el.innerHTML = `
      <h1>Logo</h1>
      <p class="lead">Shown full screen on the TV when you press <b>Logo</b> (or L).</p>
      <div class="row gap"><div class="logo-prev" id="set-logo-prev"></div>
        <button class="btn" id="set-logo">Choose picture…</button>${s.logo ? '<button class="btn danger" id="set-logo-del">Remove</button>' : ''}</div>`;
    (async () => { if (s.logo) $('#set-logo-prev').innerHTML = `<img src="${await Store.url(s.logo)}" alt="Current logo">`; })();
    $('#set-logo').onclick = async () => {
      const [f] = await pickFiles({ accept: 'image/*', multiple: false });
      if (!f) return;
      try { const path = await Media.importLogo(f); Output.setLogoUrl(await Store.url(path)); renderBuild(); } catch (e) { toast(e.message, 'error'); }
    };
    if (s.logo) $('#set-logo-del').onclick = async () => { await Store.remove(s.logo); s.logo = null; Store.save(); Output.setLogoUrl(null); renderBuild(); };
  }

  function setCcli(el, s) {
    el.innerHTML = `
      <h1>CCLI</h1>
      <p class="lead">Your church’s CCLI license number is added to the song credits on the TV.</p>
      <div class="form-grid" style="max-width:640px">
        <label>Church CCLI License #<input id="set-ccli" value="${esc(s.ccliLicense)}"></label>
        <label class="check"><input type="checkbox" id="set-ccli-show" ${s.showCcliFooter ? 'checked' : ''}> Show song credits on each song’s first slide</label>
      </div>`;
    $('#set-ccli').oninput = (e) => { s.ccliLicense = e.target.value; Store.save(); invalidateSlides(); };
    $('#set-ccli-show').onchange = (e) => { s.showCcliFooter = e.target.checked; Store.save(); invalidateSlides(); };
  }

  function setPco(el) {
    el.innerHTML = `
      <h1>Planning Center</h1>
      <p class="lead">Lets you import songs, with their SongSelect lyrics and song order, straight from Planning Center Services.</p>
      <ol class="steps">
        <li>In Planning Center, make a login just for this classroom (e.g. “NC Kids Classroom”) with <b>Services: Viewer</b> access and no access to People or Giving. A token can see everything its login can.</li>
        <li>Signed in as that login, open <a href="https://api.planningcenteronline.com/oauth/applications" target="_blank" rel="noopener">api.planningcenteronline.com/oauth/applications</a> and create a <b>Personal Access Token</b>.</li>
        <li>Paste its Application ID and Secret here.</li>
      </ol>
      <div class="form-grid" style="max-width:640px">
        <label>Application ID<input id="pco-app" autocomplete="off" spellcheck="false" value="${esc((PCO.credentials() || {}).appId || '')}"></label>
        <label>Secret<input id="pco-secret" type="password" autocomplete="off" placeholder="${PCO.isConfigured() ? '•••••••• (saved)' : ''}"></label>
      </div>
      <div class="row gap"><button class="btn primary" id="pco-save">Save and test</button>${PCO.isConfigured() ? '<button class="btn danger" id="pco-forget">Disconnect</button>' : ''}<span id="pco-test" class="small"></span></div>
      <p class="hint">The token is stored only in Chrome on this Mac. It is not saved in the library folder or backups.</p>`;
    $('#pco-save').onclick = async () => {
      const appId = $('#pco-app').value.trim();
      const secret = $('#pco-secret').value.trim() || ((PCO.credentials() || {}).secret || '');
      const out = $('#pco-test');
      if (!appId || !secret) { out.textContent = 'Enter both the Application ID and the Secret.'; out.className = 'small error-text'; return; }
      PCO.saveCredentials(appId, secret);
      out.textContent = 'Testing…'; out.className = 'small muted';
      try {
        const org = await PCO.test();
        out.textContent = `Connected to ${org}.`; out.className = 'small ok-text';
        $('#pco-secret').value = ''; $('#pco-secret').placeholder = '•••••••• (saved)';
      } catch (e) { out.textContent = e.message; out.className = 'small error-text'; }
    };
    if ($('#pco-forget')) $('#pco-forget').onclick = () => { if (confirm('Remove the Planning Center token from this Mac?')) { PCO.forget(); renderBuild(); toast('Planning Center disconnected.'); } };
  }

  function setTimers(el) {
    const timers = D().timers || (D().timers = []);
    el.innerHTML = `
      <h1>Timers</h1>
      <p class="lead">Countdowns a volunteer can start with one click in Present mode (under <b>Timers</b>), or add to a playlist. The time shows big on the TV over the moving background.</p>
      <div class="timer-rows">${timers.map((t, i) => `
        <div class="timer-row" data-i="${i}">
          <label>Name<input data-f="title" value="${esc(t.title)}"></label>
          <label class="mins">Minutes<input data-f="minutes" type="number" min="0.25" step="0.25" value="${+(t.seconds / 60).toFixed(2)}"></label>
          <label>Message at zero<input data-f="message" value="${esc(t.message || '')}" placeholder="Time’s up!"></label>
          <label class="check"><input type="checkbox" data-f="chime" ${t.chime !== false ? 'checked' : ''}> Chime</label>
          <label class="check" title="Only when the timer is part of a playlist"><input type="checkbox" data-f="autoNext" ${t.autoNext ? 'checked' : ''}> In a playlist, go to the next item at zero</label>
          <button class="icon-btn danger" data-del="${i}" title="Delete this timer" aria-label="Delete ${esc(t.title)}">${icon('x')}</button>
        </div>`).join('') || '<p class="muted">No timers yet.</p>'}</div>
      <div class="row gap"><button class="btn primary" id="timer-add">${icon('plus', 14)} Add a timer</button><button class="btn" id="timer-reset">Put back the standard timers</button></div>`;
    el.oninput = (e) => {
      const row = e.target.closest('.timer-row');
      if (!row || !e.target.dataset.f) return;
      const t = timers[Number(row.dataset.i)], f = e.target.dataset.f;
      if (f === 'minutes') { const m = Number(e.target.value); if (m > 0) t.seconds = Math.round(m * 60); }
      else if (f === 'chime' || f === 'autoNext') t[f] = e.target.checked;
      else t[f] = e.target.value;
      Store.save(); invalidateSlides();
    };
    el.onclick = async (e) => {
      const d = e.target.closest('[data-del]');
      if (d) {
        const t = timers[Number(d.dataset.del)];
        if (await deleteThing('timer', t.id)) renderBuild();
        return;
      }
      if (e.target.closest('#timer-add')) {
        timers.push({ id: Media.id(), title: 'New timer', seconds: 300, message: 'Time’s up!', chime: true, autoNext: false });
        Store.save(); renderBuild();
        setTimeout(() => { const ins = $$('.timer-row input[data-f=title]'); const last = ins[ins.length - 1]; if (last) { last.focus(); last.select(); } }, 0);
      }
      if (e.target.closest('#timer-reset')) {
        const std = window.NC_DEFAULT_TIMERS();
        let added = 0;
        for (const t of std) if (!timers.some((x) => x.id === t.id)) { timers.push(t); added++; }
        Store.save(); renderBuild(); toast(added ? `Added ${added} standard timer${added === 1 ? '' : 's'} back.` : 'All the standard timers are already here.');
      }
    };
  }

  function setLibrary(el) {
    el.innerHTML = `
      <h1>Library folder</h1>
      <p class="lead">Everything is saved in the folder <b>${esc(Store.folderName)}</b>. Keep that folder in iCloud Drive or Dropbox so it is backed up. A dated copy of the library list is also kept in its <code>backups</code> folder.</p>
      <div><button class="btn" id="set-folder">Switch to a different folder…</button></div>
      <p class="muted small">NC Kids Presenter v${APP_VERSION}</p>`;
    $('#set-folder').onclick = async () => {
      try { await Store.choose(); invalidateSlides(); await afterLibraryOpen(); toast('Switched library folder.'); } catch (e) { /* cancelled */ }
    };
  }

  // =====================================================================
  //  MODES, THEME, SETUP & START
  // =====================================================================
  // Accent colors: [accent, text-on-accent, soft fill, ring, accent text] for each look.
  const ACCENTS = {
    teal:   { light: ['#0F766E', '#FFFFFF', '#F0FDFA', '#99F6E4', '#0F766E'], dark: ['#2DD4BF', '#052E2B', '#173330', '#1F5F55', '#5EEAD4'] },
    blue:   { light: ['#2563EB', '#FFFFFF', '#EFF6FF', '#BFDBFE', '#1D4ED8'], dark: ['#60A5FA', '#0B1B33', '#1B2A40', '#2B4A75', '#93C5FD'] },
    orange: { light: ['#C2410C', '#FFFFFF', '#FFF7ED', '#FED7AA', '#C2410C'], dark: ['#FB923C', '#2A1406', '#3A2618', '#6B3D1C', '#FDBA74'] },
    purple: { light: ['#7C3AED', '#FFFFFF', '#F5F3FF', '#DDD6FE', '#6D28D9'], dark: ['#A78BFA', '#1C1033', '#2A2240', '#4C3A7A', '#C4B5FD'] },
  };

  let mode = 'present';
  /** Light or dark depends on the mode (Settings → Appearance). */
  function applyTheme() {
    const s = (Store.data && Store.data.settings) || {};
    const onSetup = !$('#setup').classList.contains('hidden');
    const theme = onSetup ? 'light' : mode === 'present' ? (s.presentTheme || 'dark') : (s.buildTheme || 'light');
    const root = document.documentElement;
    root.dataset.theme = theme;
    const a = (ACCENTS[s.accent] || ACCENTS.teal)[theme];
    ['--accent', '--accent-ink', '--accent-soft', '--accent-ring', '--accent-text'].forEach((k, i) => root.style.setProperty(k, a[i]));
  }

  function setMode(m) {
    mode = m;
    $$('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    $('#present').classList.toggle('hidden', m !== 'present');
    $('#build').classList.toggle('hidden', m !== 'build');
    $('#build-tabs').classList.toggle('hidden', m !== 'build');
    applyTheme();
    if (m === 'present') renderPresent(); else renderBuild();
  }

  function setTvStatus(open) {
    const b = $('#tv-btn');
    b.classList.toggle('on', open);
    b.innerHTML = open ? '<span class="tv-dot"></span>TV is on <small>Close</small>' : `${icon('tv', 18)} Start TV`;
  }

  async function afterLibraryOpen() {
    $('#setup').classList.add('hidden');
    $('#topbar').classList.remove('hidden');
    Output.setLogoUrl(S().logo ? await Store.url(S().logo) : null);
    const empty = !D().songs.length && !D().lessons.length && !D().videos.length && !D().backgrounds.length;
    if (empty) { setMode('build'); setBuildTab('backgrounds'); toast('Welcome! Start by importing some motion backgrounds, then add songs.'); }
    else setMode('present');
  }

  function showSetup(state) {
    $('#setup').classList.remove('hidden');
    $('#topbar').classList.add('hidden');
    $('#present').classList.add('hidden');
    $('#build').classList.add('hidden');
    $('#setup-unsupported').classList.toggle('hidden', Store.supported());
    $('#setup-actions').classList.toggle('hidden', !Store.supported());
    $('#reconnect').classList.toggle('hidden', state !== 'needs-permission');
    if (state === 'needs-permission') $('#reconnect').textContent = `Open “${Store.folderName}”`;
    applyTheme();
  }

  function bindTop() {
    $$('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $$('#build-tabs button').forEach((b) => b.addEventListener('click', () => setBuildTab(b.dataset.tab)));
    $('#tv-btn').addEventListener('click', () => (Output.isOpen() ? Output.close() : Output.open()));
    $('#choose-folder').addEventListener('click', async () => {
      try { await Store.choose(); await afterLibraryOpen(); } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'error'); }
    });
    $('#reconnect').addEventListener('click', async () => {
      try { if (await Store.reconnect()) await afterLibraryOpen(); } catch (e) { toast(e.message, 'error'); }
    });
    Store.onSaved = () => { const el = $('#save-status'); el.textContent = 'Saved'; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 600); };
    Store.onError = (msg) => toast(msg, 'error');
    Output.onStatus = setTvStatus;
    window.addEventListener('beforeunload', (e) => {
      if (Output.isOpen()) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  async function start() {
    bindTop();
    bindPresent();
    Output.init($('#live-preview'));
    setTvStatus(false);
    if (!Store.supported()) { showSetup('none'); return; }
    // ?demo uses a private scratch folder inside Chrome — handy for trying things out.
    if (new URLSearchParams(location.search).has('demo') && navigator.storage && navigator.storage.getDirectory) {
      try { await Store.open(await navigator.storage.getDirectory()); Store.folderName = 'Demo (inside Chrome)'; await afterLibraryOpen(); return; }
      catch (e) { console.warn('Demo storage unavailable', e); }
    }
    let state = 'none';
    try { state = await Store.restore(); } catch (e) { toast(e.message, 'error'); }
    if (state === 'ready') await afterLibraryOpen(); else showSetup(state);
  }

  window.NCApp = { start, version: APP_VERSION, _P: P, step, goLive, setMode, setBuildTab };
  document.addEventListener('DOMContentLoaded', start);
})();
