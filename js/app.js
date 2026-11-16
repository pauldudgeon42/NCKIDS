/*
 * app.js — the control screen.
 *
 *   Present mode: pick today's playlist, click a slide (or press → / Space) to put it on the TV.
 *   Build mode:   manage playlists, songs, lessons, videos, backgrounds and settings.
 *
 * Data lives in Store.data (see store.js). Call Store.save() after changing it.
 */
(function () {
  const APP_VERSION = '0.2.0';

  // ---------- small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = () => Store.data;
  const S = () => Store.data.settings;
  const byId = (collection, id) => D()[collection].find((x) => x.id === id) || null;
  const COLLECTION = { song: 'songs', lesson: 'lessons', video: 'videos', background: 'backgrounds' };
  const ICON = { song: '♪', lesson: '▦', video: '▶', background: '✦' };
  const TYPE_NAME = { song: 'Song', lesson: 'Lesson', video: 'Video', background: 'Background' };

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
    if (slide.kind === 'text') { r.setText(slide.text, S()); r.setFooter(slide.footer || ''); }
    else if (slide.kind === 'image') r.setImage(slide.url);
    else if (slide.kind === 'video') r.setVideoPoster(slide.thumb);
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
  const P = {
    playlistId: null,
    selected: 0,       // item shown in the slide grid
    live: null,        // { item, slide } currently on the TV
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
    P.liveBgItem = P.live ? P.live.item : P.selected;
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
      ? lists.map((p) => `<option value="${p.id}" ${p.id === P.playlistId ? 'selected' : ''}>${esc(p.title)}${p.date ? ' — ' + esc(prettyDate(p.date)) : ''}</option>`).join('')
      : '<option>No playlists yet</option>';
    $('#present-empty').classList.toggle('hidden', lists.length > 0);
    renderPresentItems();
    renderPresentSlides();
    renderBank();
  }

  function renderPresentItems() {
    const pl = currentPlaylist();
    const ol = $('#present-items');
    if (!pl) { ol.innerHTML = ''; return; }
    if (P.selected >= pl.items.length) P.selected = 0;
    ol.innerHTML = pl.items.map((it, i) => `
      <li class="p-item ${i === P.selected ? 'selected' : ''} ${P.live && P.live.item === i ? 'live' : ''}" data-i="${i}">
        <span class="icon t-${it.type}">${ICON[it.type]}</span>
        <span class="name">${esc(itemTitle(it))}</span>
        <span class="type">${TYPE_NAME[it.type]}</span>
      </li>`).join('') || '<li class="muted pad">This playlist is empty. Add things to it in Build → Playlists.</li>';
  }

  let slidesRenderToken = 0;
  async function renderPresentSlides() {
    const token = ++slidesRenderToken;
    const pl = currentPlaylist();
    const grid = $('#present-slides');
    const title = $('#present-title');
    grid.innerHTML = '';
    if (!pl || !pl.items.length) { title.textContent = ''; return; }
    const item = pl.items[P.selected];
    title.innerHTML = `<span class="icon t-${item.type}">${ICON[item.type]}</span> ${esc(itemTitle(item))}`;
    const slides = await itemSlides(item);
    if (token !== slidesRenderToken) return;
    if (!slides.length) { grid.innerHTML = '<p class="muted pad">No slides. (Songs need lyrics; lessons need slide images.)</p>'; return; }
    const bgs = [];
    for (const s of slides) bgs.push(await effectiveBg(s, P.selected));
    if (token !== slidesRenderToken) return;
    slides.forEach((s, i) => {
      const card = slideCard(s, i);
      if (P.live && P.live.item === P.selected && P.live.slide === i) card.classList.add('live');
      grid.appendChild(card);
      drawThumb(card.querySelector('.thumb'), s, bgs[i]);
    });
    const liveCard = grid.querySelector('.live');
    if (liveCard) liveCard.scrollIntoView({ block: 'nearest' });
  }

  function markLive() {
    $$('#present-items .p-item').forEach((li) => li.classList.toggle('live', !!P.live && Number(li.dataset.i) === P.live.item));
    $$('#present-slides .slide-card').forEach((c) => c.classList.toggle('live', !!P.live && P.live.item === P.selected && Number(c.dataset.slide) === P.live.slide));
    const lc = $('#present-slides .slide-card.live');
    if (lc) lc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    const bg = await effectiveBg(slide, itemIndex);
    Output.show(bg === slide.bg ? slide : Object.assign({}, slide, { bg }));
    markBank();
    $('#video-controls').classList.toggle('hidden', slide.kind !== 'video');
    updateLiveButtons();
    if (P.selected !== itemIndex) { P.selected = itemIndex; renderPresentItems(); await renderPresentSlides(); }
    markLive();
  }

  async function step(dir) {
    const pl = currentPlaylist();
    if (!pl || !pl.items.length) return;
    if (!P.live) { await goLive(P.selected, 0); return; }
    // If the operator is looking at a different item than the live one, "next" starts that item.
    if (dir > 0 && P.selected !== P.live.item) { await goLive(P.selected, 0); return; }
    let { item, slide } = P.live;
    const slides = await itemSlides(pl.items[item]);
    if (dir > 0 && slide + 1 < slides.length) return goLive(item, slide + 1);
    if (dir < 0 && slide > 0) return goLive(item, slide - 1);
    // move to the next/previous item that has slides
    for (let i = item + dir; i >= 0 && i < pl.items.length; i += dir) {
      const s = await itemSlides(pl.items[i]);
      if (s.length) return goLive(i, dir > 0 ? 0 : s.length - 1);
    }
  }

  function updateLiveButtons() {
    $('#btn-black').classList.toggle('on', Output.state.black);
    $('#btn-logo').classList.toggle('on', Output.state.logo);
  }

  function clearLive() {
    Output.clear();
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
      P.playlistId = e.target.value; P.selected = 0;
      S().lastPlaylist = P.playlistId; Store.save();
      renderPresentItems(); renderPresentSlides();
    });
    $('#present-items').addEventListener('click', (e) => {
      const li = e.target.closest('.p-item');
      if (!li) return;
      P.selected = Number(li.dataset.i);
      renderPresentItems(); renderPresentSlides();
    });
    $('#present-items').addEventListener('dblclick', (e) => {
      const li = e.target.closest('.p-item');
      if (li) goLive(Number(li.dataset.i), 0);
    });
    $('#present-slides').addEventListener('click', (e) => {
      const card = e.target.closest('.slide-card');
      if (card) goLive(P.selected, Number(card.dataset.slide));
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
      $('#vc-play').textContent = paused ? '▶ Play' : '❚❚ Pause';
    };
    Output.onVideoEnded = () => {
      P.live = null;
      $('#video-controls').classList.add('hidden');
      markLive();
    };
    Output.onVideoError = () => toast('This video could not play. Try converting it to MP4.', 'error');
    Output.onKey = onKey;
    document.addEventListener('keydown', onKey);
  }

  // =====================================================================
  //  BUILD MODE
  // =====================================================================
  let buildTab = 'playlists';
  const B = { playlist: null, song: null, lesson: null, search: '', pickerFilter: 'all' };

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
      <section class="col col-list">
        <div class="col-head"><h2>Playlists</h2><button class="btn primary" id="pl-new">+ New</button></div>
        <ul class="list" id="pl-list">${lists.map((p) => `
          <li class="${p.id === B.playlist ? 'selected' : ''}" data-id="${p.id}">
            <strong>${esc(p.title)}</strong><small>${esc(prettyDate(p.date))} · ${p.items.length} item${p.items.length === 1 ? '' : 's'}</small>
          </li>`).join('') || '<li class="muted">No playlists yet. Click “+ New”.</li>'}</ul>
      </section>
      <section class="col col-main">
        ${pl ? `
        <div class="col-head">
          <input class="title-input" id="pl-title" value="${esc(pl.title)}" aria-label="Playlist name">
          <input type="date" id="pl-date" value="${esc(pl.date || '')}">
        </div>
        <div class="row gap">
          <button class="btn primary" id="pl-present">▶ Present this playlist</button>
          <button class="btn" id="pl-dup">Duplicate</button>
          <button class="btn danger" id="pl-del">Delete</button>
        </div>
        <p class="hint">Drag items to reorder. Add things from the list on the right.</p>
        <ol class="pl-items" id="pl-items">${pl.items.map((it, i) => `
          <li draggable="true" data-index="${i}">
            <span class="grip">⋮⋮</span>
            <span class="icon t-${it.type}">${ICON[it.type]}</span>
            <span class="name">${esc(itemTitle(it))}<small>${TYPE_NAME[it.type]}</small></span>
            ${it.type === 'song' ? `<label class="bg-pick">Background <select data-bg="${i}">${bgOptions(it.background || '', { defaultLabel: 'Song’s own' })}</select></label>` : ''}
            <button class="icon-btn" data-up="${i}" title="Move up">↑</button>
            <button class="icon-btn" data-down="${i}" title="Move down">↓</button>
            <button class="icon-btn danger" data-remove="${i}" title="Remove from playlist">✕</button>
          </li>`).join('') || '<li class="empty-drop">Empty. Drag songs, lessons, videos or backgrounds here →</li>'}</ol>` : '<p class="muted pad">Create a playlist for each Sunday or lesson.</p>'}
      </section>
      <section class="col col-picker">
        <div class="col-head"><h2>Add to playlist</h2></div>
        <input type="search" id="pick-search" placeholder="Search everything…" value="${esc(B.search)}">
        <div class="chips" id="pick-filter">${['all', 'song', 'lesson', 'video', 'background'].map((f) =>
          `<button class="chip ${B.pickerFilter === f ? 'active' : ''}" data-f="${f}">${f === 'all' ? 'All' : TYPE_NAME[f] + 's'}</button>`).join('')}</div>
        <ul class="list pick-list" id="pick-list"></ul>
      </section>`;

    const renderPicker = () => {
      const q = B.search.trim().toLowerCase();
      const rows = [];
      for (const type of ['song', 'lesson', 'video', 'background']) {
        if (B.pickerFilter !== 'all' && B.pickerFilter !== type) continue;
        for (const x of sortedBy(D()[COLLECTION[type]])) {
          if (q && !(x.title.toLowerCase().includes(q) || (type === 'song' && (x.lyrics || '').toLowerCase().includes(q)))) continue;
          rows.push(`<li draggable="true" data-type="${type}" data-ref="${x.id}">
            <span class="icon t-${type}">${ICON[type]}</span><span class="name">${esc(x.title)}<small>${TYPE_NAME[type]}</small></span>
            <button class="icon-btn add" data-add title="Add to playlist" ${pl ? '' : 'disabled'}>+</button></li>`);
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
      const t = e.target;
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
    $('#pl-present').onclick = () => { P.playlistId = pl.id; P.selected = 0; S().lastPlaylist = pl.id; Store.save(); setMode('present'); };
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
  function buildSongs(body) {
    const songs = sortedBy(D().songs);
    if (B.song && !byId('songs', B.song)) B.song = null;
    if (!B.song && songs[0]) B.song = songs[0].id;
    const song = byId('songs', B.song);
    body.innerHTML = `
      <section class="col col-list">
        <div class="col-head"><h2>Songs</h2></div>
        <div class="row gap wrap">
          <button class="btn primary" id="song-new">+ New song</button>
          <button class="btn" id="song-import" title="Lyrics files downloaded from CCLI SongSelect (.txt)">Import .txt</button>
        </div>
        <input type="search" id="song-search" placeholder="Search titles and lyrics…">
        <ul class="list" id="song-list"></ul>
      </section>
      <section class="col col-main song-editor">
        ${song ? `
        <div class="col-head"><input class="title-input" id="song-title" value="${esc(song.title)}" aria-label="Song title"></div>
        <div class="form-grid">
          <label>Author(s)<input id="song-author" value="${esc(song.author)}"></label>
          <label>Copyright<input id="song-copyright" value="${esc(song.copyright)}"></label>
          <label>CCLI Song #<input id="song-ccli" value="${esc(song.ccli)}"></label>
        </div>
        <div class="block-label">Background
          <span class="hint">Click the background to show behind this song. “Default” uses the default from the Backgrounds tab.</span>
          <div class="bg-tiles" id="song-bg"></div>
        </div>
        <label class="block">Lyrics
          <span class="hint">Put a label like <b>Verse 1</b>, <b>Chorus</b> or <b>Bridge</b> on its own line before each part. A blank line starts a new slide.</span>
          <textarea id="song-lyrics" spellcheck="true" placeholder="Verse 1&#10;Jesus loves me, this I know&#10;For the Bible tells me so&#10;&#10;Chorus&#10;Yes, Jesus loves me…">${esc(song.lyrics)}</textarea>
        </label>
        <label class="block">Order (optional)
          <span class="hint">Click the parts to build the order, or type it (e.g. <code>V1 C V2 C B C</code>). Leave empty to use the order written above.</span>
          <div class="row gap"><input id="song-arr" value="${esc(song.arrangement)}" placeholder="As written"><button class="btn small" id="song-arr-clear">Clear</button></div>
          <div class="chips" id="song-parts"></div>
        </label>
        <div class="row gap"><button class="btn danger" id="song-del">Delete song</button></div>` : '<p class="muted pad">Add your first song with “+ New song”, or import lyrics files from CCLI SongSelect.</p>'}
      </section>
      <section class="col col-preview">
        <div class="col-head"><h2>Slides</h2><span class="muted" id="song-count"></span></div>
        <div class="slide-grid small" id="song-slides"></div>
      </section>`;

    const renderList = () => {
      const q = ($('#song-search').value || '').toLowerCase();
      $('#song-list').innerHTML = songs.filter((s) => !q || s.title.toLowerCase().includes(q) || (s.lyrics || '').toLowerCase().includes(q))
        .map((s) => `<li class="${s.id === B.song ? 'selected' : ''}" data-id="${s.id}"><strong>${esc(s.title)}</strong><small>${esc(s.author || '')}</small></li>`).join('')
        || '<li class="muted">No songs yet.</li>';
    };
    renderList();
    $('#song-search').oninput = renderList;
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

    let previewTimer;
    const renderPreview = async () => {
      const slides = Songs.buildSlides(song, S());
      const bg = await resolveBg(song.background || S().defaultBackground);
      const grid = $('#song-slides');
      if (!grid) return;
      grid.innerHTML = '';
      $('#song-count').textContent = `${slides.length} slide${slides.length === 1 ? '' : 's'}`;
      slides.forEach((s, i) => { const c = slideCard(s, i); grid.appendChild(c); drawThumb(c.querySelector('.thumb'), s, bg); });
      const sections = Songs.parseSections(song.lyrics);
      $('#song-parts').innerHTML = sections.map((s) => `<button class="chip" data-key="${esc(s.key)}" title="${esc(s.label)}">${esc(s.key)} · ${esc(s.label)}</button>`).join('');
    };
    const changed = () => { Store.save(); invalidateSlides(); clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 250); };
    renderPreview();

    const bindField = (sel, key, rerenderList) => {
      $(sel).oninput = (e) => { song[key] = e.target.value; changed(); };
      if (rerenderList) $(sel).onchange = renderList;
    };
    bindField('#song-title', 'title', true);
    bindField('#song-author', 'author', true);
    bindField('#song-copyright', 'copyright');
    bindField('#song-ccli', 'ccli');
    bindField('#song-lyrics', 'lyrics');
    bindField('#song-arr', 'arrangement');
    bgTiles($('#song-bg'), song.background || '', (id) => { song.background = id; changed(); }, { withDefault: true });
    $('#song-parts').onclick = (e) => {
      const b = e.target.closest('[data-key]');
      if (!b) return;
      song.arrangement = ((song.arrangement || '').trim() + ' ' + b.dataset.key).trim();
      $('#song-arr').value = song.arrangement; changed();
    };
    $('#song-arr-clear').onclick = () => { song.arrangement = ''; $('#song-arr').value = ''; changed(); };
    $('#song-del').onclick = async () => { if (await deleteThing('song', song.id)) { B.song = null; renderBuild(); } };
  }

  // ---------- Lessons (slide images) ----------
  function buildLessons(body) {
    const lessons = sortedBy(D().lessons);
    if (B.lesson && !byId('lessons', B.lesson)) B.lesson = null;
    if (!B.lesson && lessons[0]) B.lesson = lessons[0].id;
    const lesson = byId('lessons', B.lesson);
    body.innerHTML = `
      <section class="col col-list">
        <div class="col-head"><h2>Lessons</h2></div>
        <p class="hint">A lesson is a set of slide pictures (the JPEGs in your curriculum download).</p>
        <div class="row gap wrap">
          <button class="btn primary" id="lesson-files">+ From pictures…</button>
          <button class="btn" id="lesson-folder">+ From a folder…</button>
        </div>
        <ul class="list" id="lesson-list">${lessons.map((l) => `<li class="${l.id === B.lesson ? 'selected' : ''}" data-id="${l.id}"><strong>${esc(l.title)}</strong><small>${l.slides.length} slides</small></li>`).join('') || '<li class="muted">No lessons yet.</li>'}</ul>
      </section>
      <section class="col col-wide" id="lesson-main">
        ${lesson ? `
        <div class="col-head"><input class="title-input" id="lesson-title" value="${esc(lesson.title)}" aria-label="Lesson name"></div>
        <div class="row gap">
          <button class="btn" id="lesson-add">+ Add more pictures</button>
          <button class="btn danger" id="lesson-del">Delete lesson</button>
        </div>
        <p class="hint">Drag slides to reorder. You can also drop pictures from Finder onto this area.</p>
        <div class="slide-grid editable" id="lesson-slides">${lesson.slides.map((s, i) => `
          <div class="slide-card" draggable="true" data-index="${i}"><div class="thumb"><img loading="lazy" data-path="${esc(s.path)}"></div>
          <div class="cap"><span class="num">${i + 1}</span>${esc(s.name || '')}<button class="icon-btn danger" data-del="${i}" title="Remove slide">✕</button></div></div>`).join('')}</div>` :
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
      const d = e.target.dataset.del;
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
      <section class="col col-full" id="media-main">
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
          <div class="row gap">${extraButtons ? extraButtons(x) : ''}<button class="icon-btn danger" data-del="${x.id}" title="Delete">✕</button></div>
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
      const del = e.target.dataset.del;
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
      extraButtons: (x) => S().defaultBackground === x.id ? '<span class="muted small">Default ✓</span>' : `<button class="btn small" data-default="${x.id}">Make default</button>`,
    });
  }

  // ---------- Settings ----------
  const FONTS = ['Avenir Next', 'Helvetica Neue', 'Arial Rounded MT Bold', 'Futura', 'Gill Sans', 'Verdana', 'Chalkboard SE', 'Marker Felt', 'Noteworthy', 'Georgia'];
  function buildSettings(body) {
    const s = S();
    body.innerHTML = `
      <section class="col col-main">
        <div class="col-head"><h2>Lyrics look</h2></div>
        <div class="form-grid">
          <label>Font<select id="set-font">${FONTS.map((f) => `<option ${f === s.font ? 'selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select></label>
          <label>Text color<input type="color" id="set-color" value="${esc(s.textColor)}"></label>
          <label>Biggest text size <span class="muted" id="set-size-val">${s.maxFontSize}</span><input type="range" id="set-size" min="50" max="160" value="${s.maxFontSize}"></label>
          <label>Lines per slide<select id="set-lines">${[1, 2, 3, 4, 5, 6, 8].map((n) => `<option ${n === Number(s.linesPerSlide) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" id="set-upper" ${s.uppercase ? 'checked' : ''}> ALL CAPITALS</label>
          <label class="check"><input type="checkbox" id="set-shadow" ${s.shadow ? 'checked' : ''}> Text shadow (easier to read)</label>
          <label>Fade time (seconds)<input type="number" id="set-fade" min="0" max="3" step="0.1" value="${s.transitionSeconds}"></label>
          <label>Default background<select id="set-bg">${bgOptions(s.defaultBackground || 'none', { allowDefault: false })}</select></label>
        </div>
        <div class="sample-wrap"><div class="sample" id="set-sample"></div></div>

        <div class="col-head"><h2>CCLI</h2></div>
        <div class="form-grid">
          <label>Church CCLI License #<input id="set-ccli" value="${esc(s.ccliLicense)}"></label>
          <label class="check"><input type="checkbox" id="set-ccli-show" ${s.showCcliFooter ? 'checked' : ''}> Show song credits on each song’s first slide</label>
        </div>
      </section>
      <section class="col col-main">
        <div class="col-head"><h2>TV sound</h2></div>
        <p class="hint">Videos play through the Mac’s sound output. The simplest setup: plug in the TV, then choose the TV under the Mac’s <b>Control Center → Sound</b>. Or pick the TV here so videos always use it, even if the Mac's sound is set elsewhere.</p>
        <div class="row gap"><select id="set-speaker"><option value="">Mac’s current sound output</option>${s.audioDeviceId ? `<option value="${esc(s.audioDeviceId)}" selected>${esc(s.audioDeviceLabel || 'Chosen speaker')}</option>` : ''}</select>
        <button class="btn" id="set-speaker-find">Find speakers…</button></div>
        <p class="hint small">Chrome will ask for microphone permission once. That is only how Chrome reveals speaker names; nothing is recorded.</p>

        <div class="col-head"><h2>Logo</h2></div>
        <p class="hint">Shown full screen when you press <b>Logo</b> (or L).</p>
        <div class="row gap"><div class="logo-prev" id="set-logo-prev"></div>
          <button class="btn" id="set-logo">Choose picture…</button>${s.logo ? '<button class="btn danger" id="set-logo-del">Remove</button>' : ''}</div>

        <div class="col-head"><h2>Library folder</h2></div>
        <p>Everything is saved in the folder <b>${esc(Store.folderName)}</b>. Keep that folder in iCloud Drive or Dropbox so it is backed up. A dated copy of the library list is also kept in its <code>backups</code> folder.</p>
        <button class="btn" id="set-folder">Switch to a different folder…</button>
        <p class="muted small">NC Kids Presenter v${APP_VERSION}</p>
      </section>`;

    const sample = new Renderer($('#set-sample'), { staticOnly: true });
    const drawSample = async () => {
      sample.setBackground(await resolveBg(s.defaultBackground));
      sample.setText('Jesus loves me, this I know\nFor the Bible tells me so\nLittle ones to Him belong\nThey are weak but He is strong', s);
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
    $('#set-ccli').oninput = (e) => upd('ccliLicense', e.target.value);
    $('#set-ccli-show').onchange = (e) => upd('showCcliFooter', e.target.checked);

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

    (async () => { if (s.logo) $('#set-logo-prev').innerHTML = `<img src="${await Store.url(s.logo)}">`; })();
    $('#set-logo').onclick = async () => {
      const [f] = await pickFiles({ accept: 'image/*', multiple: false });
      if (!f) return;
      try { const path = await Media.importLogo(f); Output.setLogoUrl(await Store.url(path)); renderBuild(); } catch (e) { toast(e.message, 'error'); }
    };
    if (s.logo) $('#set-logo-del').onclick = async () => { await Store.remove(s.logo); s.logo = null; Store.save(); Output.setLogoUrl(null); renderBuild(); };
    $('#set-folder').onclick = async () => {
      try { await Store.choose(); invalidateSlides(); await afterLibraryOpen(); toast('Switched library folder.'); } catch (e) { /* cancelled */ }
    };
  }

  // =====================================================================
  //  MODES, SETUP & START
  // =====================================================================
  let mode = 'present';
  function setMode(m) {
    mode = m;
    $$('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    $('#present').classList.toggle('hidden', m !== 'present');
    $('#build').classList.toggle('hidden', m !== 'build');
    if (m === 'present') renderPresent(); else renderBuild();
  }

  function setTvStatus(open) {
    const b = $('#tv-btn');
    b.classList.toggle('on', open);
    b.innerHTML = open ? '📺 TV is on <small>(click to close)</small>' : '📺 Start TV';
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
    Store.onSaved = () => { const el = $('#save-status'); el.textContent = 'Saved ✓'; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 600); };
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
