/*
 * pco.js — reading songs from Planning Center Services.
 *
 * Uses a Planning Center "Personal Access Token" (an Application ID + Secret),
 * sent with HTTP basic auth. The token is kept in this Chrome on this Mac only
 * (localStorage), never in the library folder, so it is not copied to iCloud,
 * backups or GitHub.
 *
 * Tip: create the token from a Planning Center login that only has view access
 * to Services, because a token can see everything its user can.
 *
 * What we read (Services API v2):
 *   GET /songs                         title, author, copyright, CCLI number
 *   GET /songs/{id}/arrangements       name, lyrics (from SongSelect), sequence (song order)
 */
(function () {
  const API = 'https://api.planningcenteronline.com/services/v2';
  const KEY = 'nckids.pco';

  // In the Mac app the token is kept encrypted with the Mac Keychain; in Chrome, in this browser only.
  const DESK = window.NCDesktop;
  function loadCreds() {
    try { return JSON.parse((DESK ? DESK.secrets.get(KEY) : localStorage.getItem(KEY)) || 'null'); } catch (e) { return null; }
  }
  function storeCreds(value) {
    if (DESK) { if (value) DESK.secrets.set(KEY, value); else DESK.secrets.remove(KEY); }
    else if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY);
  }

  /** fetch() for Planning Center: through the Mac app when there is one (no browser CORS block). */
  async function pcoFetch(url, headers, opts = {}) {
    if (DESK) {
      const r = await DESK.http.request(url, Object.assign({ headers }, opts));
      return { ok: r.ok, status: r.status, saved: r.saved, headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? r.retryAfter : null) }, json: async () => JSON.parse(r.text || 'null') };
    }
    return fetch(url, { headers, method: opts.method || 'GET', body: opts.body });
  }

  class PcoError extends Error {
    constructor(message, kind) { super(message); this.kind = kind; }
  }

  const PCO = {
    _songs: null, // cached song list for searching

    credentials() { return loadCreds(); },
    isConfigured() { const c = loadCreds(); return !!(c && c.appId && c.secret); },
    saveCredentials(appId, secret) {
      storeCreds(JSON.stringify({ appId: appId.trim(), secret: secret.trim() }));
      this._songs = null;
    },
    forget() { storeCreds(null); this._songs = null; },
    /** Where the token is kept, for the Settings screen. */
    storageNote() { return DESK ? 'The token is stored only on this Mac, encrypted with the Mac Keychain. It is not saved in the library folder or backups.' : 'The token is stored only in Chrome on this Mac. It is not saved in the library folder or backups.'; },
    auth() { const c = loadCreds(); return c ? 'Basic ' + btoa(c.appId + ':' + c.secret) : ''; },
    fetch: pcoFetch,

    async get(pathOrUrl) {
      const c = loadCreds();
      if (!c) throw new PcoError('Planning Center isn’t set up yet. Add the access token in Build → Settings.', 'setup');
      const url = pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl;
      let res;
      try {
        res = await pcoFetch(url, { Authorization: 'Basic ' + btoa(c.appId + ':' + c.secret), Accept: 'application/json' });
      } catch (e) {
        throw new PcoError('Couldn’t reach Planning Center. Check the internet connection. ' +
          '(If the internet is fine, Planning Center may not allow this page to connect directly. See README → Planning Center.)', 'network');
      }
      if (res.status === 401) throw new PcoError('Planning Center didn’t accept the access token. Check the Application ID and Secret in Settings.', 'auth');
      if (res.status === 403) throw new PcoError('That Planning Center login doesn’t have permission to view Services songs.', 'auth');
      if (res.status === 429) {
        const wait = Number(res.headers.get('Retry-After') || 5);
        await new Promise((r) => setTimeout(r, wait * 1000));
        return this.get(pathOrUrl);
      }
      if (!res.ok) throw new PcoError(`Planning Center returned an error (${res.status}).`, 'http');
      return res.json();
    },

    /** Follow "next" links and gather every record. */
    async getAll(path, onPage) {
      const out = [];
      let next = path;
      while (next) {
        const page = await this.get(next);
        out.push(...(page.data || []));
        if (onPage) onPage(out.length, page.meta && page.meta.total_count);
        next = page.links && page.links.next;
      }
      return out;
    },

    /** Quick check that the token works. Returns the organization name. */
    async test() {
      const r = await this.get('');
      const name = r && r.data && r.data.attributes && r.data.attributes.name;
      return name || 'your church';
    },

    /** Every song in the library (cached), as {id, title, author, copyright, ccli, hidden}. */
    async songs(force, onProgress) {
      if (this._songs && !force) return this._songs;
      const rows = await this.getAll('/songs?per_page=100&order=title&fields[Song]=title,author,copyright,ccli_number,hidden,updated_at', onProgress);
      this._songs = rows.map((r) => ({
        id: r.id,
        title: r.attributes.title || 'Untitled',
        author: r.attributes.author || '',
        copyright: r.attributes.copyright || '',
        ccli: r.attributes.ccli_number ? String(r.attributes.ccli_number) : '',
        hidden: !!r.attributes.hidden,
      }));
      return this._songs;
    },

    /** Arrangements of one song, those with lyrics first. */
    async arrangements(songId) {
      const rows = await this.getAll(`/songs/${encodeURIComponent(songId)}/arrangements?per_page=100`);
      return rows.map((r) => ({
        id: r.id,
        name: r.attributes.name || 'Arrangement',
        lyrics: (r.attributes.lyrics || '').replace(/\r\n?/g, '\n').trim(),
        sequence: r.attributes.sequence || [],
        sequenceShort: r.attributes.sequence_short || [],
        updated: r.attributes.updated_at || '',
      })).sort((a, b) => (b.lyrics ? 1 : 0) - (a.lyrics ? 1 : 0));
    },

    // ---------- plans (service orders) ----------
    async serviceTypes() {
      const rows = await this.getAll('/service_types?per_page=100&order=sequence');
      return rows.map((r) => ({ id: r.id, name: r.attributes.name }));
    },

    /** Upcoming plans first, then the last few past ones. */
    async plans(serviceTypeId) {
      const st = encodeURIComponent(serviceTypeId);
      const map = (r) => ({ id: r.id, title: r.attributes.title || '', dates: r.attributes.dates || r.attributes.short_dates || '',
        sortDate: r.attributes.sort_date || '', items: r.attributes.items_count || 0, series: r.attributes.series_title || '' });
      const future = (await this.get(`/service_types/${st}/plans?filter=future&order=sort_date&per_page=12`)).data || [];
      const past = (await this.get(`/service_types/${st}/plans?filter=past&order=-sort_date&per_page=6`)).data || [];
      return { future: future.map(map), past: past.map(map) };
    },

    /** The order of service, with songs and arrangements filled in. */
    async planItems(serviceTypeId, planId) {
      const path = `/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/items?per_page=100&include=song,arrangement`;
      const out = [];
      const included = {};
      let next = path;
      while (next) {
        const page = await this.get(next);
        for (const inc of page.included || []) included[inc.type + ':' + inc.id] = inc;
        out.push(...(page.data || []));
        next = page.links && page.links.next;
      }
      return out.map((r) => {
        const a = r.attributes || {}, rel = r.relationships || {};
        const songRef = rel.song && rel.song.data, arrRef = rel.arrangement && rel.arrangement.data;
        const song = songRef && included['Song:' + songRef.id];
        const seq = a.custom_arrangement_sequence_full || a.custom_arrangement_sequence || null;
        return {
          id: r.id, kind: a.item_type || 'item', title: (a.title || '').trim() || 'Untitled', self: r.links && r.links.self,
          songId: songRef && songRef.id, arrangementId: arrRef && arrRef.id,
          customSequence: Array.isArray(seq) && seq.length ? seq : null,
          song: song && { id: song.id, title: song.attributes.title || a.title, author: song.attributes.author || '',
            copyright: song.attributes.copyright || '', ccli: song.attributes.ccli_number ? String(song.attributes.ccli_number) : '' },
        };
      });
    },

    /** Files attached to a plan item (and to its Planning Center Media, for media items). */
    async itemAttachments(serviceTypeId, planId, item) {
      const base = item.self || `${API}/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(item.id)}`;
      const map = (r) => ({ id: r.id, filename: r.attributes.filename || r.attributes.display_name || 'file', contentType: r.attributes.content_type || '',
        size: r.attributes.file_size || 0, linked: !!r.attributes.linked_url, self: r.links && r.links.self, updated: r.attributes.updated_at || '' });
      let atts = (await this.getAll(base + '/attachments?per_page=100')).map(map);
      if (!atts.length && item.kind === 'media') {
        for (const m of await this.getAll(base + '/media?per_page=25')) {
          const mself = (m.links && m.links.self) || `${API}/media/${m.id}`;
          atts.push(...(await this.getAll(mself + '/attachments?per_page=100')).map(map));
        }
      }
      return atts.filter((x) => !x.linked);
    },

    /** Download one attachment into the library (Mac app only). Returns the saved library path. */
    async downloadAttachment(att, saveTo) {
      const c = loadCreds();
      const headers = { Authorization: 'Basic ' + btoa(c.appId + ':' + c.secret), Accept: 'application/json', 'Content-Type': 'application/json' };
      const res = await pcoFetch(att.self + '/open', headers, { method: 'POST', body: JSON.stringify({ data: {} }) });
      if (!res.ok) throw new PcoError(`Planning Center wouldn't open “${att.filename}” (${res.status}).`, 'http');
      const body = await res.json();
      const url = body && body.data && body.data.attributes && (body.data.attributes.attachment_url || body.data.attributes.url);
      if (!url) throw new PcoError(`Planning Center didn't give a download link for “${att.filename}”.`, 'http');
      const r = await window.NCDesktop.http.request(url, { download: true, saveTo });
      if (!r.ok) throw new PcoError(`Downloading “${att.filename}” failed (${r.status}).`, 'http');
      return saveTo;
    },

    /** Turn a PCO song + arrangement into a song for this app. */
    toSong(pcoSong, arr) {
      return {
        title: pcoSong.title,
        author: pcoSong.author,
        copyright: pcoSong.copyright,
        ccli: pcoSong.ccli,
        lyrics: window.Songs ? Songs.cleanLyrics(cleanLyrics(arr.lyrics)).text : cleanLyrics(arr.lyrics),
        arrangement: (arr.sequence || []).join(', '),
        pco: { songId: pcoSong.id, arrangementId: arr.id, arrangementName: arr.name, imported: new Date().toISOString() },
      };
    },
  };

  /** Tidy SongSelect lyrics: drop chord-chart markup and CCLI footer lines if present. */
  function cleanLyrics(text) {
    return (text || '')
      .split('\n')
      .filter((l) => !/^\s*(CCLI (Song|License)|For use solely|©|Copyright)/i.test(l))
      .map((l) => l.replace(/\[[A-G][#b]?[^\]\s]*\]/g, '').replace(/\s+$/, '')) // [G] [Am7] style chords
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  PCO.cleanLyrics = cleanLyrics;
  PCO.PcoError = PcoError;
  window.PCO = PCO;
})();
