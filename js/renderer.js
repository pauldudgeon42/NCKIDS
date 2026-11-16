/*
 * renderer.js — draws a slide onto a 1920×1080 "stage".
 *
 * The same Renderer is used three ways:
 *   - the TV output window (full size, with sound)
 *   - the small "Live" preview in the control screen (muted)
 *   - slide thumbnails (static, no video playback)
 *
 * Layers, bottom to top: background → image slide → lyrics → footer → video → logo → black.
 */
(function () {
  const W = 1920, H = 1080;

  const CSS = `
  .r-host { position: relative; overflow: hidden; background: #000; }
  .r-stage { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0; overflow: hidden; background: #000; }
  .r-layer { position: absolute; inset: 0; transition: opacity var(--r-fade, .5s) ease; }
  .r-layer > img, .r-layer > video { position: absolute; inset: 0; width: 100%; height: 100%; }
  .r-bg > * { object-fit: cover; transition: opacity var(--r-fade, .5s) ease; }
  .r-image > img { object-fit: contain; background: #000; transition: opacity var(--r-fade, .5s) ease; }
  .r-video > video { object-fit: contain; background: #000; }
  .r-text { display: flex; align-items: center; justify-content: center; }
  .r-text-inner { position: absolute; left: 6%; right: 6%; top: 8%; bottom: 12%; display: flex; align-items: center; justify-content: center;
                  text-align: center; white-space: pre-line; line-height: 1.18; font-weight: 700; transition: opacity var(--r-fade, .5s) ease; }
  .r-text-inner.shadow { text-shadow: 0 4px 18px rgba(0,0,0,.85), 0 2px 4px rgba(0,0,0,.9); }
  .r-footer { top: auto; height: 70px; font-family: "Helvetica Neue", Arial, sans-serif; display: flex; align-items: center; justify-content: center; font-size: 24px; color: rgba(255,255,255,.85);
              text-shadow: 0 2px 6px rgba(0,0,0,.9); padding: 0 40px; text-align: center; }
  .r-logo { display: flex; align-items: center; justify-content: center; background: #000; }
  .r-logo > img { position: static; max-width: 70%; max-height: 70%; width: auto; height: auto; object-fit: contain; }
  .r-black { background: #000; }
  .r-hidden { opacity: 0 !important; pointer-events: none; }
  `;

  function injectCss(doc) {
    if (doc.getElementById('r-css')) return;
    const s = doc.createElement('style');
    s.id = 'r-css';
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  /** Largest font size (≤ max) at which `el`'s text fits inside its box. */
  function fitText(el, max) {
    let lo = 24, hi = max, best = lo;
    el.style.fontSize = hi + 'px';
    if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return hi;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      el.style.fontSize = mid + 'px';
      if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    el.style.fontSize = best + 'px';
    return best;
  }

  class Renderer {
    /**
     * @param host   element to draw into (sized by CSS); a 1920×1080 stage is scaled to fit it
     * @param opts   { muted: bool, staticOnly: bool, onVideoTime(cur, dur), onVideoEnded() }
     */
    constructor(host, opts = {}) {
      this.host = host;
      this.doc = host.ownerDocument;
      this.win = this.doc.defaultView;
      this.opts = opts;
      injectCss(this.doc);
      host.classList.add('r-host');
      const stage = this.doc.createElement('div');
      stage.className = 'r-stage';
      stage.innerHTML = `
        <div class="r-layer r-bg"></div>
        <div class="r-layer r-image r-hidden"></div>
        <div class="r-layer r-text"></div>
        <div class="r-layer r-footer r-hidden"></div>
        <div class="r-layer r-video r-hidden"></div>
        <div class="r-layer r-logo r-hidden"></div>
        <div class="r-layer r-black r-hidden"></div>`;
      host.appendChild(stage);
      this.stage = stage;
      this.el = {};
      for (const n of ['bg', 'image', 'text', 'footer', 'video', 'logo', 'black']) this.el[n] = stage.querySelector('.r-' + n);
      this.bgKey = null;
      this.videoEl = null;
      this.fit();
      if (this.win.ResizeObserver) {
        this._ro = new this.win.ResizeObserver(() => this.fit());
        this._ro.observe(host);
      }
    }

    fit() {
      const w = this.host.clientWidth, h = this.host.clientHeight;
      if (!w || !h) return;
      const s = Math.min(w / W, h / H);
      this.stage.style.transform = `translate(${(w - W * s) / 2}px, ${(h - H * s) / 2}px) scale(${s})`;
    }

    setFade(seconds) { this.stage.style.setProperty('--r-fade', (seconds ?? 0.5) + 's'); }

    /** bg = {url, type:'video'|'image'} or null */
    setBackground(bg) {
      const key = bg ? bg.url : null;
      if (key === this.bgKey) return;
      this.bgKey = key;
      const layer = this.el.bg;
      const old = Array.from(layer.children);
      if (bg && bg.url) {
        let node;
        if (bg.type === 'video' && !this.opts.staticOnly) {
          node = this.doc.createElement('video');
          node.muted = true; node.loop = true; node.autoplay = true; node.playsInline = true;
          node.src = bg.url;
          node.play().catch(() => {});
        } else {
          node = this.doc.createElement('img');
          node.src = bg.type === 'video' ? (bg.thumb || '') : bg.url;
        }
        node.style.opacity = '0';
        layer.appendChild(node);
        requestAnimationFrame(() => requestAnimationFrame(() => { node.style.opacity = '1'; }));
      }
      const fadeMs = this.opts.staticOnly ? 0 : 700;
      for (const o of old) {
        o.style.opacity = '0';
        setTimeout(() => { if (o.pause) o.pause(); o.remove(); }, fadeMs);
      }
    }

    /** Show a text slide. style = settings */
    setText(text, style) {
      const layer = this.el.text;
      const old = Array.from(layer.children);
      if (text) {
        const inner = this.doc.createElement('div');
        inner.className = 'r-text-inner' + (style.shadow ? ' shadow' : '');
        inner.style.fontFamily = `"${style.font}", "Avenir Next", "Helvetica Neue", Arial, sans-serif`;
        inner.style.color = style.textColor || '#fff';
        if (style.uppercase) inner.style.textTransform = 'uppercase';
        inner.textContent = text;
        if (style.position === 'lower') { inner.style.top = '56%'; inner.style.bottom = '5%'; }
        inner.style.opacity = '0';
        layer.appendChild(inner);
        fitText(inner, Number(style.maxFontSize) || 110);
        if (this.opts.staticOnly) inner.style.opacity = '1';
        else requestAnimationFrame(() => requestAnimationFrame(() => { inner.style.opacity = '1'; }));
      }
      for (const o of old) {
        o.style.opacity = '0';
        setTimeout(() => o.remove(), this.opts.staticOnly ? 0 : 600);
      }
    }

    setFooter(text) {
      this.el.footer.textContent = text || '';
      this.el.footer.classList.toggle('r-hidden', !text);
    }

    setImage(url) {
      const layer = this.el.image;
      const old = Array.from(layer.children);
      if (url) {
        const img = this.doc.createElement('img');
        img.src = url;
        layer.appendChild(img);
        layer.classList.remove('r-hidden');
        img.style.opacity = this.opts.staticOnly ? '1' : '0';
        if (!this.opts.staticOnly) {
          const show = () => requestAnimationFrame(() => { img.style.opacity = '1'; });
          if (img.complete) show(); else { img.onload = show; img.onerror = show; }
        }
      } else {
        layer.classList.add('r-hidden');
      }
      for (const o of old) setTimeout(() => o.remove(), this.opts.staticOnly ? 0 : 600);
    }

    /** Start a video. Returns the <video> element. */
    playVideo(url, sinkId) {
      this.stopVideo();
      const v = this.doc.createElement('video');
      v.src = url;
      v.playsInline = true;
      v.muted = !!this.opts.muted;
      v.autoplay = false;
      this.el.video.appendChild(v);
      this.el.video.classList.remove('r-hidden');
      this.videoEl = v;
      const start = () => v.play().catch((e) => console.warn('Video play failed', e));
      if (sinkId && typeof v.setSinkId === 'function' && !this.opts.muted) {
        v.setSinkId(sinkId).catch((e) => console.warn('Could not use chosen speaker, using default', e)).finally(start);
      } else start();
      v.addEventListener('timeupdate', () => this.opts.onVideoTime && this.opts.onVideoTime(v.currentTime, v.duration || 0, v.paused));
      v.addEventListener('pause', () => this.opts.onVideoTime && this.opts.onVideoTime(v.currentTime, v.duration || 0, true));
      v.addEventListener('play', () => this.opts.onVideoTime && this.opts.onVideoTime(v.currentTime, v.duration || 0, false));
      v.addEventListener('ended', () => this.opts.onVideoEnded && this.opts.onVideoEnded());
      v.addEventListener('error', () => this.opts.onVideoError && this.opts.onVideoError(v.error));
      return v;
    }

    /** Static frame for thumbnails */
    setVideoPoster(url) {
      this.el.video.innerHTML = '';
      if (url) {
        const img = this.doc.createElement('img');
        img.src = url;
        img.style.objectFit = 'contain';
        this.el.video.appendChild(img);
        this.el.video.classList.remove('r-hidden');
      } else this.el.video.classList.add('r-hidden');
    }

    stopVideo() {
      if (this.videoEl) {
        this.videoEl.pause();
        this.videoEl.removeAttribute('src');
        this.videoEl.load();
        this.videoEl.remove();
        this.videoEl = null;
      }
      this.el.video.innerHTML = '';
      this.el.video.classList.add('r-hidden');
    }

    setLogo(url) {
      this.el.logo.innerHTML = '';
      if (url) {
        const img = this.doc.createElement('img');
        img.src = url;
        this.el.logo.appendChild(img);
      }
    }
    showLogo(on) { this.el.logo.classList.toggle('r-hidden', !on); }
    showBlack(on) { this.el.black.classList.toggle('r-hidden', !on); }

    destroy() {
      this.stopVideo();
      if (this._ro) this._ro.disconnect();
      this.stage.remove();
    }
  }

  window.Renderer = Renderer;
  window.fitText = fitText;
})();
