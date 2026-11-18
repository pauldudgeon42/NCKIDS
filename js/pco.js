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
      if (res.status === 403) throw new PcoError('The NCKids Classroom login doesn’t have permission to see this in Planning Center (403).', 'auth');
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
      const path = `/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/items?per_page=100&include=song,arrangement,media`;
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
          mediaIds: ((rel.media && rel.media.data) || []).map((m) => String(m.id)),
          song: song && { id: song.id, title: song.attributes.title || a.title, author: song.attributes.author || '',
            copyright: song.attributes.copyright || '', ccli: song.attributes.ccli_number ? String(song.attributes.ccli_number) : '' },
        };
      });
    },

    /**
     * Every file attached anywhere in a plan (its items, their media, songs…), in one call.
     * Each comes back tagged with what it's attached to (attachableType / attachableId).
     */
    async planAttachments(serviceTypeId, planId) {
      const rows = await this.getAll(`/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/all_attachments?per_page=100`);
      return rows.map((r) => {
        const at = (r.relationships && r.relationships.attachable && r.relationships.attachable.data) || {};
        const att = Object.assign(mapAttachment(r), { attachableType: at.type || '', attachableId: at.id ? String(at.id) : '' });
        // Other addresses for the same file, in case "open" isn't accepted at the first one.
        if (att.attachableType === 'Item') att.alt = [`${API}/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/items/${att.attachableId}/attachments/${att.id}`];
        else if (att.attachableType === 'Media') att.alt = [`${API}/media/${att.attachableId}/attachments/${att.id}`];
        return att;
      });
    },

    /** Files attached to one plan item (and to its Planning Center Media). Used if planAttachments finds none. */
    async itemAttachments(serviceTypeId, planId, item) {
      const base = item.self || `${API}/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(item.id)}`;
      const atts = (await this.getAll(base + '/attachments?per_page=100')).map(mapAttachment);
      if (!atts.length && (item.mediaIds || []).length) {
        for (const mid of item.mediaIds) atts.push(...(await this.getAll(`/media/${encodeURIComponent(mid)}/attachments?per_page=100`)).map(mapAttachment));
      }
      return atts;
    },

    /** Ask Planning Center for a short-lived download link for an attachment. */
    async openUrl(att) {
      const c = loadCreds();
      const headers = { Authorization: 'Basic ' + btoa(c.appId + ':' + c.secret), Accept: 'application/json', 'Content-Type': 'application/json' };
      const tries = [...(att.alt || []), att.self, `${API}/attachments/${att.id}`].filter((v, i, arr) => v && arr.indexOf(v) === i);
      let last = 0;
      for (const base of tries) {
        const res = await pcoFetch(base + '/open', headers, { method: 'POST', body: JSON.stringify({ data: {} }) });
        if (res.ok) {
          const body = await res.json();
          const url = body && body.data && body.data.attributes && (body.data.attributes.attachment_url || body.data.attributes.url);
          if (url) return url;
          throw new PcoError(`Planning Center didn't give a download link for “${att.filename}”.`, 'http');
        }
        last = res.status;
        if (res.status === 401 || res.status === 403) break; // a permission problem won't change at another address
      }
      throw new PcoError(last === 403 ? `The NCKids Classroom login isn’t allowed to download “${att.filename}” (403).` : `Planning Center wouldn't open “${att.filename}” (${last}).`, 'http');
    },

    /** Download one attachment into the library (Mac app only). Returns the saved library path. */
    async downloadAttachment(att, saveTo) {
      const url = await this.openUrl(att);
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

  // File types by content type, for attachments whose name has no extension.
  const TYPE_EXT = {
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v', 'video/webm': 'webm',
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf',
  };
  /**
   * One attachment, as the app needs it. "linked" is a web link (YouTube, Vimeo, a URL),
   * which can't be downloaded. Uploaded files are AttachmentS3 (sometimes with a
   * linked_url too, which must not make them count as links).
   */
  function mapAttachment(r) {
    const a = r.attributes || {};
    const type = String(a.pco_type || '');
    const contentType = String(a.content_type || '').toLowerCase().split(';')[0].trim();
    let filename = String(a.filename || a.display_name || 'file').trim();
    const ext = (filename.match(/\.([a-z0-9]+)$/i) || [])[1];
    if ((!ext || !Object.values(TYPE_EXT).includes(ext.toLowerCase())) && TYPE_EXT[contentType]) filename += '.' + TYPE_EXT[contentType];
    const linked = /Link|Youtube|Vimeo|Spotify|Soundcloud/i.test(type) || (!type && !!a.linked_url && !a.file_size);
    return {
      id: r.id, filename, contentType, size: a.file_size || 0, linked, linkUrl: a.linked_url || '',
      downloadable: a.downloadable !== false, pcoType: type,
      self: (r.links && r.links.self) || `${API}/attachments/${r.id}`, updated: a.updated_at || '',
    };
  }

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
