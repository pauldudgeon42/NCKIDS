/*
 * output.js — the TV window and the live preview.
 *
 * The TV window is a blank popup that this page draws into directly (same-origin
 * about:blank), so it works when index.html is opened straight from the disk.
 * Whatever is sent "live" is drawn twice: on the TV (with sound) and in the small
 * Live preview on the control screen (muted).
 */
(function () {
  const Output = {
    win: null,
    tv: null,        // Renderer in the TV window
    preview: null,   // Renderer in the control screen
    state: { bg: null, slide: null, black: false, logo: false },
    timer: null,         // running countdown: { title, total, remaining, endAt, paused, done, message, chime, autoNext, ... }
    onTimerTick: null,   // (timer or null) => void
    onTimerEnd: null,    // (timer) => void
    onStatus: null,      // (isOpen) => void
    onVideoTime: null,   // (cur, dur, paused) => void
    onVideoEnded: null,
    onKey: null,         // key presses inside the TV window are forwarded here

    init(previewHost) {
      // The preview only reports video progress when there is no TV window open.
      this.preview = new Renderer(previewHost, {
        muted: true,
        onVideoTime: (c, d, p) => { if (!this.tv && this.onVideoTime) this.onVideoTime(c, d, p); },
        onVideoEnded: () => { if (!this.tv) this._videoEnded(); },
      });
      setInterval(() => {
        if (this.win && this.win.closed) this._closed();
      }, 1000);
    },

    isOpen() { return !!(this.win && !this.win.closed && this.tv); },

    /** Open the TV window, on the second screen when Chrome lets us find it. Call from a click. */
    async open() {
      if (this.isOpen()) { this.win.focus(); return; }
      let features = 'popup,width=1280,height=720';
      try {
        if ('getScreenDetails' in window) {
          const details = await window.getScreenDetails();
          const other = details.screens.find((s) => s !== details.currentScreen) || null;
          if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
        }
      } catch (e) {
        console.info('Screen placement not allowed; opening a normal window.', e);
      }
      const win = window.open('', 'nckids_tv', features);
      if (!win) {
        alert('Chrome blocked the TV window. Click the pop-up icon in the address bar and choose "Always allow pop-ups", then try again.');
        return;
      }
      this.win = win;
      this._buildTvDocument();
      window.focus();
    },

    _buildTvDocument() {
      const doc = this.win.document;
      doc.open();
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>NC Kids — TV</title>
        <style>
          html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: none; }
          #tv { position: absolute; inset: 0; }
          #fs { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 10; cursor: pointer; }
          #fs button { font: 600 28px -apple-system, "Helvetica Neue", sans-serif; padding: 22px 40px; border-radius: 16px; border: 0;
                       background: #ffcc33; color: #222; cursor: pointer; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
          #fs p { position: absolute; bottom: 30px; width: 100%; text-align: center; color: #aaa; font: 18px -apple-system, sans-serif; }
          body.full #fs { display: none; }
        </style></head>
        <body><div id="tv"></div>
        <div id="fs"><button>Click here to fill the TV screen</button>
        <p>Or press F. This message never appears on the TV once it's full screen.</p></div></body></html>`);
      doc.close();
      const goFull = () => doc.documentElement.requestFullscreen().catch(() => {});
      doc.getElementById('fs').addEventListener('click', goFull);
      doc.addEventListener('fullscreenchange', () => doc.body.classList.toggle('full', !!doc.fullscreenElement));
      doc.addEventListener('keydown', (e) => {
        if ((e.key === 'f' || e.key === 'F') && !doc.fullscreenElement) { goFull(); return; }
        if (this.onKey) this.onKey(e);
      });
      let hideTimer;
      doc.addEventListener('mousemove', () => {
        doc.body.style.cursor = 'default';
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { doc.body.style.cursor = 'none'; }, 1500);
      });
      this.tv = new Renderer(doc.getElementById('tv'), {
        muted: false,
        onVideoTime: (c, d, p) => this.onVideoTime && this.onVideoTime(c, d, p),
        onVideoEnded: () => this._videoEnded(),
        onVideoError: (err) => this.onVideoError && this.onVideoError(err),
      });
      this.win.addEventListener('beforeunload', () => this._closed());
      this._redrawAll(this.tv);
      if (this.onStatus) this.onStatus(true);
    },

    close() {
      if (this.win && !this.win.closed) this.win.close();
      this._closed();
    },

    _closed() {
      if (!this.tv && !this.win) return;
      this.win = null;
      this.tv = null;
      if (this.onStatus) this.onStatus(false);
    },

    renderers() { return [this.preview, this.tv].filter(Boolean); },

    settings() { return (Store.data && Store.data.settings) || {}; },

    /** Redraw everything (used when the TV window first opens). */
    _redrawAll(r) {
      const st = this.state, s = this.settings();
      r.setFade(s.transitionSeconds);
      r.setLogo(this._logoUrl || null);
      r.setBackground(st.bg);
      this._drawSlide(r, st.slide, true);
      r.showLogo(st.logo);
      r.showBlack(st.black);
      r.setTimer(this.timer, s);
    },

    _drawSlide(r, slide, isRedraw) {
      const s = this.settings();
      if (!slide) { r.setText(''); r.setFooter(''); r.setImage(null); r.stopVideo(); r.setTimer(null); return; }
      if (slide.kind !== 'timer') r.setTimer(null);
      if (slide.kind === 'text') {
        r.stopVideo(); r.setImage(null);
        r.setText(slide.text, slide.style || s); r.setFooter(slide.footer || '');
      } else if (slide.kind === 'image') {
        r.stopVideo(); r.setText(''); r.setFooter('');
        r.setImage(slide.url);
      } else if (slide.kind === 'video') {
        r.setText(''); r.setFooter(''); r.setImage(null);
        // When the TV opens mid-video we don't restart the video on it.
        if (!isRedraw) r.playVideo(slide.url, r === this.tv ? s.audioDeviceId : '');
      } else if (slide.kind === 'timer') {
        r.stopVideo(); r.setImage(null); r.setText(''); r.setFooter('');
      } else { // 'background' – background only
        r.stopVideo(); r.setImage(null); r.setText(''); r.setFooter('');
      }
    },

    // ---------- public controls ----------
    setBackground(bg) {
      this.state.bg = bg;
      for (const r of this.renderers()) r.setBackground(bg);
    },

    /** Send a slide live. slide.background (if any) changes the background too. */
    show(slide) {
      this.state.slide = slide;
      this.state.black = false;
      this.state.logo = false;
      if (slide && slide.bg !== undefined) this.setBackground(slide.bg);
      if (!slide || slide.kind !== 'timer') this.stopTimer();
      for (const r of this.renderers()) {
        r.setFade(this.settings().transitionSeconds);
        r.showBlack(false); r.showLogo(false);
        this._drawSlide(r, slide, false);
      }
      if (slide && slide.kind === 'timer') this.startTimer(slide);
    },

    // ---------- countdown timers ----------
    startTimer(t) {
      this.stopTimer(true);
      const seconds = Math.max(1, Number(t.seconds) || 60);
      this.timer = Object.assign({}, t, { total: seconds, remaining: seconds, endAt: Date.now() + seconds * 1000, paused: false, done: false });
      this._timerInterval = setInterval(() => this._tick(), 200);
      this._tick();
    },
    _tick() {
      const t = this.timer;
      if (!t) return;
      if (!t.paused && !t.done) {
        t.remaining = Math.max(0, (t.endAt - Date.now()) / 1000);
        if (t.remaining <= 0) {
          t.done = true;
          if (t.chime) this.chime();
          if (this.onTimerEnd) setTimeout(() => this.onTimerEnd(t), 0);
        }
      }
      for (const r of this.renderers()) r.setTimer(t, this.settings());
      if (this.onTimerTick) this.onTimerTick(t);
    },
    pauseTimer() {
      const t = this.timer;
      if (!t || t.done) return;
      if (t.paused) { t.endAt = Date.now() + t.remaining * 1000; t.paused = false; } else t.paused = true;
      this._tick();
    },
    addTime(seconds) {
      const t = this.timer;
      if (!t) return;
      if (t.done) { t.done = false; t.remaining = 0; t.endAt = Date.now(); t.total = 0; }
      t.remaining += seconds; t.total += seconds;
      t.endAt = Date.now() + t.remaining * 1000;
      this._tick();
    },
    restartTimer() {
      const t = this.timer;
      if (!t) return;
      Object.assign(t, { remaining: t.total, endAt: Date.now() + t.total * 1000, paused: false, done: false });
      this._tick();
    },
    stopTimer(silent) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
      if (!this.timer) return;
      this.timer = null;
      for (const r of this.renderers()) r.setTimer(null);
      if (!silent && this.onTimerTick) this.onTimerTick(null);
    },
    /** A soft three-note bell, played through the TV speakers when one is chosen in Settings. */
    async chime() {
      try {
        const ctx = this._audio || (this._audio = new (window.AudioContext || window.webkitAudioContext)());
        const sink = this.settings().audioDeviceId;
        if (sink && ctx.setSinkId && ctx.sinkId !== sink) await ctx.setSinkId(sink).catch(() => {});
        if (ctx.state === 'suspended') await ctx.resume();
        [[880, 0], [1108.7, 0.18], [1318.5, 0.36]].forEach(([freq, at]) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = freq;
          const t0 = ctx.currentTime + at;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
          o.connect(g).connect(ctx.destination);
          o.start(t0); o.stop(t0 + 1.5);
        });
      } catch (e) { console.warn('Chime could not play', e); }
    },

    /** Remove words/slide/video but keep the background moving. */
    clear() {
      this.stopTimer();
      this.state.slide = null;
      for (const r of this.renderers()) this._drawSlide(r, null);
      if (this.onVideoTime) this.onVideoTime(0, 0, true);
    },

    toggleBlack(force) {
      this.state.black = force !== undefined ? force : !this.state.black;
      for (const r of this.renderers()) r.showBlack(this.state.black);
      return this.state.black;
    },

    toggleLogo(force) {
      this.state.logo = force !== undefined ? force : !this.state.logo;
      for (const r of this.renderers()) r.showLogo(this.state.logo);
      return this.state.logo;
    },

    setLogoUrl(url) {
      this._logoUrl = url;
      for (const r of this.renderers()) r.setLogo(url);
    },

    // video transport — the TV copy is the "real" one; the preview follows it
    _videos() { return this.renderers().map((r) => r.videoEl).filter(Boolean); },
    hasVideo() { return this._videos().length > 0; },
    playPause() {
      const vids = this._videos();
      if (!vids.length) return;
      const main = (this.tv && this.tv.videoEl) || vids[0];
      const play = main.paused;
      for (const v of vids) { if (play) v.play().catch(() => {}); else v.pause(); }
    },
    restartVideo() {
      for (const v of this._videos()) { v.currentTime = 0; v.play().catch(() => {}); }
    },
    seekBy(seconds) {
      for (const v of this._videos()) v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.1, v.currentTime + seconds));
    },
    _videoEnded() {
      // When a video finishes, fade back to the moving background.
      this.clear();
      if (this.onVideoEnded) this.onVideoEnded();
    },

    /** Re-apply text styling after settings change */
    refreshStyle() {
      const slide = this.state.slide;
      if (slide && slide.kind === 'text') for (const r of this.renderers()) { r.setText(slide.text, slide.style || this.settings()); }
    },
  };

  window.Output = Output;
})();
