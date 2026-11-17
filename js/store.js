/*
 * store.js — the library folder.
 *
 * Everything the app knows lives in ONE folder on the computer (the "library"):
 *
 *   NCKIDS Library/
 *     library.json            songs, lessons, videos, backgrounds, playlists, settings
 *     backups/                a dated copy of library.json, kept automatically
 *     media/backgrounds/      motion backgrounds (mp4/mov) and still backgrounds
 *     media/videos/           lesson videos
 *     media/lessons/<id>/     slide images for each lesson/presentation
 *     media/thumbs/           small preview images the app generates
 *
 * Chrome's File System Access API lets the page read and write that folder after
 * the user picks it once. The folder handle is remembered in IndexedDB so the
 * next visit only needs a one-click "Reconnect".
 */
(function () {
  const DATA_FILE = 'library.json';
  const BACKUP_DIR = 'backups';
  const MAX_BACKUPS = 30;
  const DATA_VERSION = 1;

  // ---------- tiny IndexedDB helper (remembers the folder between visits) ----------
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('nckids', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const r = db.transaction('handles').objectStore('handles').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, value) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function defaultTimers() {
    const t = (id, title, seconds, message, autoNext) => ({ id, title, seconds, message, chime: true, autoNext: !!autoNext });
    return [
      t('t-start', 'Class starts soon', 300, 'Let’s begin!', true),
      t('t-cleanup', 'Cleanup time', 180, 'Time’s up!'),
      t('t-game', 'Game time', 120, 'Time’s up!'),
      t('t-activity', 'Activity time', 600, 'Time’s up!'),
      t('t-discuss', 'Discussion time', 300, 'Time’s up!'),
      t('t-quiet', 'Quiet time', 60, 'Time’s up!'),
    ];
  }

  function emptyLibrary() {
    return {
      version: DATA_VERSION,
      songs: [],
      lessons: [],
      videos: [],
      backgrounds: [],
      playlists: [],
      // Countdown timers (Present mode → Timers, and as playlist items). Edit in Settings → Timers.
      timers: defaultTimers(),
      settings: {
        font: 'Avenir Next',
        textColor: '#ffffff',
        maxFontSize: 110,
        uppercase: false,
        shadow: true,
        linesPerSlide: 4,
        defaultBackground: null,
        ccliLicense: '',
        showCcliFooter: true,
        logo: null,
        audioDeviceId: '',
        audioDeviceLabel: '',
        transitionSeconds: 0.5,
        textPosition: 'center',  // or 'lower' (lower third); songs can override
        lastPlaylist: null,
        buildTheme: 'light',   // Settings → Appearance
        presentTheme: 'dark',
        accent: 'teal',
      },
    };
  }

  // Fill in any settings/collections added in newer versions so old libraries keep working.
  function upgrade(data) {
    const base = emptyLibrary();
    for (const k of Object.keys(base)) if (data[k] === undefined) data[k] = base[k];
    data.settings = Object.assign({}, base.settings, data.settings || {});
    data.version = DATA_VERSION;
    return data;
  }

  const Store = {
    root: null,       // FileSystemDirectoryHandle of the library folder
    data: null,       // parsed library.json
    folderName: '',
    _urls: new Map(), // path -> object URL cache
    _saveTimer: null,
    _savePromise: Promise.resolve(),
    onSaved: null,
    onError: null,

    supported() {
      return typeof window.showDirectoryPicker === 'function';
    },

    /** Look for a folder remembered from last time. Returns 'ready' | 'needs-permission' | 'none'. */
    async restore() {
      let handle = null;
      try { handle = await idbGet('library'); } catch (e) { /* no IndexedDB */ }
      if (!handle) return 'none';
      this._pending = handle;
      this.folderName = handle.name;
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') { await this.open(handle); return 'ready'; }
      return 'needs-permission';
    },

    /** Must be called from a click. */
    async reconnect() {
      const handle = this._pending;
      if (!handle) return false;
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return false;
      await this.open(handle);
      return true;
    },

    /** Must be called from a click. */
    async choose() {
      const handle = await window.showDirectoryPicker({ id: 'nckids-library', mode: 'readwrite' });
      await this.open(handle);
      try { await idbSet('library', handle); } catch (e) { /* ignore */ }
    },

    async open(handle) {
      this.root = handle;
      this.folderName = handle.name;
      for (const url of this._urls.values()) URL.revokeObjectURL(url);
      this._urls.clear();
      const existing = await this.readText(DATA_FILE);
      if (existing) {
        try {
          this.data = upgrade(JSON.parse(existing));
        } catch (e) {
          throw new Error('library.json in this folder is damaged. Restore a copy from the "backups" folder inside it.');
        }
      } else {
        this.data = emptyLibrary();
        await this.saveNow();
      }
    },

    // ---------- paths & files ----------
    async dir(path, create = true) {
      let d = this.root;
      for (const part of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create });
      return d;
    },
    splitPath(path) {
      const parts = path.split('/');
      return { dir: parts.slice(0, -1).join('/'), name: parts[parts.length - 1] };
    },
    async fileHandle(path, create = false) {
      const { dir, name } = this.splitPath(path);
      const d = await this.dir(dir, create);
      return d.getFileHandle(name, { create });
    },
    async readText(path) {
      try {
        const fh = await this.fileHandle(path);
        return await (await fh.getFile()).text();
      } catch (e) {
        if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
        throw e;
      }
    },
    async writeFile(path, contents) {
      const fh = await this.fileHandle(path, true);
      const w = await fh.createWritable();
      if (contents && typeof contents.stream === 'function') {
        await contents.stream().pipeTo(w); // pipeTo closes the writable
      } else {
        await w.write(contents);
        await w.close();
      }
      this._urls.delete(path);
      return path;
    },
    async getFile(path) {
      return (await this.fileHandle(path)).getFile();
    },
    /** An object URL for a library file, cached. Returns null if missing. */
    async url(path) {
      if (!path) return null;
      if (this._urls.has(path)) return this._urls.get(path);
      try {
        const url = URL.createObjectURL(await this.getFile(path));
        this._urls.set(path, url);
        return url;
      } catch (e) {
        console.warn('Missing file in library:', path);
        return null;
      }
    },
    cachedUrl(path) { return this._urls.get(path) || null; },
    async remove(path) {
      try {
        const { dir, name } = this.splitPath(path);
        const d = await this.dir(dir, false);
        await d.removeEntry(name, { recursive: true });
      } catch (e) { /* already gone */ }
      const url = this._urls.get(path);
      if (url) URL.revokeObjectURL(url);
      this._urls.delete(path);
    },

    // ---------- saving ----------
    /** Save soon (batches rapid edits like typing). */
    save() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.saveNow(), 400);
    },
    saveNow() {
      clearTimeout(this._saveTimer);
      this._savePromise = this._savePromise.then(() => this._write()).catch((e) => {
        console.error(e);
        if (this.onError) this.onError('Could not save the library: ' + e.message);
      });
      return this._savePromise;
    },
    async _write() {
      if (!this.root || !this.data) return;
      await this._dailyBackup();
      await this.writeFile(DATA_FILE, JSON.stringify(this.data, null, 2));
      if (this.onSaved) this.onSaved();
    },
    /** Before the first save of each day, keep a copy of yesterday's library.json. */
    async _dailyBackup() {
      const today = new Date().toISOString().slice(0, 10);
      if (this._backedUp === today) return;
      this._backedUp = today;
      const current = await this.readText(DATA_FILE);
      if (!current) return;
      const name = `${BACKUP_DIR}/library-${today}.json`;
      if (await this.readText(name)) return;
      await this.writeFile(name, current);
      // prune old backups
      const d = await this.dir(BACKUP_DIR);
      const names = [];
      for await (const [n] of d.entries()) if (n.startsWith('library-')) names.push(n);
      names.sort();
      while (names.length > MAX_BACKUPS) await d.removeEntry(names.shift());
    },
  };

  window.Store = Store;
  window.NC_DATA_VERSION = DATA_VERSION;
  window.NC_DEFAULT_TIMERS = defaultTimers;
})();
