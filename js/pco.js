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

  function loadCreds() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  class PcoError extends Error {
    constructor(message, kind) { super(message); this.kind = kind; }
  }

  const PCO = {
    _songs: null, // cached song list for searching

    credentials() { return loadCreds(); },
    isConfigured() { const c = loadCreds(); return !!(c && c.appId && c.secret); },
    saveCredentials(appId, secret) {
      localStorage.setItem(KEY, JSON.stringify({ appId: appId.trim(), secret: secret.trim() }));
      this._songs = null;
    },
    forget() { localStorage.removeItem(KEY); this._songs = null; },

    async get(pathOrUrl) {
      const c = loadCreds();
      if (!c) throw new PcoError('Planning Center isn’t set up yet. Add the access token in Build → Settings.', 'setup');
      const url = pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl;
      let res;
      try {
        res = await fetch(url, { headers: { Authorization: 'Basic ' + btoa(c.appId + ':' + c.secret), Accept: 'application/json' } });
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
