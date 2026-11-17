/*
 * songs.js — turning typed lyrics into slides.
 *
 * Lyrics are plain text with section labels on their own line:
 *
 *   Verse 1
 *   Jesus loves me this I know
 *   For the Bible tells me so
 *
 *   Chorus
 *   Yes, Jesus loves me ...
 *
 * Labels may also be written [Verse 1] or Verse 1:. A blank line inside a section
 * starts a new slide, and long sections are split every N lines (Settings, or the
 * song's own look). In the Slides view people can split and merge slides by hand,
 * which sets song.slideMode = 'manual' and writes the breaks back as blank lines.
 * The arrangement ("Verse 1, Chorus, Verse 2") picks the order; empty means "as written".
 * cleanLyrics() tidies pasted chord charts: chords, CCLI lines, (x2) repeats, labels.
 */
(function () {
  const SECTION_NAMES = [
    ['pre-chorus', 'P'], ['prechorus', 'P'], ['pre chorus', 'P'],
    ['verse', 'V'], ['chorus', 'C'], ['bridge', 'B'], ['tag', 'T'],
    ['intro', 'I'], ['outro', 'O'], ['ending', 'E'], ['interlude', 'IN'],
    ['refrain', 'R'], ['hook', 'H'], ['vamp', 'VA'], ['instrumental', 'IN'],
    ['misc', 'M'], ['part', 'PT'],
    ['post-chorus', 'PO'], ['postchorus', 'PO'], ['post chorus', 'PO'],
    ['turnaround', 'TA'], ['break', 'BK'], ['solo', 'SO'], ['coda', 'CO'], ['channel', 'CH'],
  ];
  const HEADER_RE = new RegExp(
    '^\\s*\\[?\\s*(' + SECTION_NAMES.map((s) => s[0].replace(' ', '\\s')).join('|') + ')\\s*(\\d+)?\\s*\\]?\\s*:?\\s*$',
    'i'
  );

  function sectionKey(name, num) {
    const found = SECTION_NAMES.find((s) => s[0] === name.toLowerCase().replace(/\s+/g, ' '));
    const abbr = found ? found[1] : name.slice(0, 2).toUpperCase();
    return abbr + (num || '');
  }
  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
  }

  /** Split lyrics text into sections: [{key, label, chunks: [[line, line], ...]}] */
  function parseSections(lyrics) {
    const lines = (lyrics || '').replace(/\r\n?/g, '\n').split('\n');
    const sections = [];
    let current = null;
    let chunk = [];
    const flushChunk = () => {
      if (chunk.length && current) current.chunks.push(chunk);
      chunk = [];
    };
    for (const raw of lines) {
      const line = raw.trim();
      const m = line.match(HEADER_RE);
      if (m) {
        flushChunk();
        const name = m[1].toLowerCase().replace(/\s+/g, ' ');
        current = { key: sectionKey(name, m[2]), label: titleCase(name) + (m[2] ? ' ' + m[2] : ''), chunks: [] };
        sections.push(current);
        continue;
      }
      if (!line) { flushChunk(); continue; }
      if (!current) {
        current = { key: 'V1', label: 'Verse 1', chunks: [] };
        sections.push(current);
      }
      chunk.push(line);
    }
    flushChunk();
    // Make duplicate keys unique (two plain "Chorus" sections → C, C2 ...)
    const seen = {};
    for (const s of sections) {
      if (seen[s.key]) { seen[s.key]++; s.key = s.key + seen[s.key]; } else seen[s.key] = 1;
    }
    return sections.filter((s) => s.chunks.length);
  }

  /**
   * Arrangement text → list of section keys. Accepts short keys ("V1 C V2 C"),
   * full names ("Verse 1, Chorus") and Planning Center sequences, where names may
   * not match the lyrics exactly ("Chorus 1" vs "Chorus", "Verse" vs "Verse 1").
   */
  function parseArrangement(text, sections) {
    if (!text || !text.trim()) return sections.map((s) => s.key);
    const byKey = {};
    for (const s of sections) { byKey[s.key.toUpperCase()] = s.key; byKey[s.label.toUpperCase()] = s.key; }
    const find = (t) => {
      const u = t.trim().toUpperCase();
      if (byKey[u]) return byKey[u];
      const m = t.match(HEADER_RE);
      if (m) {
        const base = sectionKey(m[1].toLowerCase().replace(/\s+/g, ' '), '');
        const num = m[2] || '';
        return byKey[(base + num).toUpperCase()] || byKey[(base + (num || '1')).toUpperCase()] ||
          (num === '1' ? byKey[base.toUpperCase()] : null) || null;
      }
      return byKey[(u + '1')] || null;
    };
    const tokens = text.split(/[,;\n]+/).flatMap((part) => {
      const p = part.trim();
      if (!p) return [];
      if (find(p)) return [p];
      return p.split(/\s+/);
    });
    const out = [];
    for (const t of tokens) { const k = find(t); if (k) out.push(k); }
    return out.length ? out : sections.map((s) => s.key);
  }

  // ---------- the look of one song ----------
  const SIZE_FACTORS = { smaller: 0.8, normal: 1, larger: 1.2 };
  const STYLE_KEYS = ['linesPerSlide', 'size', 'position', 'uppercase'];

  /** Does this song follow the Settings defaults (no look of its own)? */
  function usesDefaults(song) {
    return !(song.style && Object.keys(song.style).length) && !song.background;
  }

  /**
   * Settings with this song's own look on top. `size` scales the biggest text size;
   * `position` is 'center' or 'lower' (lower third).
   */
  function effectiveStyle(song, settings) {
    const own = (song && song.style) || {};
    const st = Object.assign({}, settings);
    st.linesPerSlide = own.linesPerSlide || settings.linesPerSlide || 4;
    st.position = own.position || settings.textPosition || 'center';
    if (own.uppercase !== undefined) st.uppercase = own.uppercase;
    st.size = own.size || 'normal';
    st.maxFontSize = Math.round((Number(settings.maxFontSize) || 110) * (SIZE_FACTORS[st.size] || 1));
    return st;
  }

  // ---------- fitting lyrics on screen ----------
  // The lyrics area on the TV is 88% of a 1920px-wide stage (see renderer.js).
  const TEXT_WIDTH = 1920 * 0.88 * 0.97; // small safety margin for font differences
  let measureCtx = null;
  function setFont(style) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    // Text may shrink up to 20% to keep a line whole before it counts as two lines.
    const size = (Number(style.maxFontSize) || 110) * 0.8;
    measureCtx.font = `700 ${size}px "${style.font || 'Avenir Next'}", "Avenir Next", "Helvetica Neue", Arial, sans-serif`;
  }
  function textWidth(t, style) {
    return measureCtx.measureText(style.uppercase ? t.toUpperCase() : t).width;
  }
  /** Break one lyric line into the lines it would take up on the TV. */
  function wrapLine(line, style) {
    if (typeof document === 'undefined' || textWidth(line, style) <= TEXT_WIDTH) return [line];
    const words = line.split(/\s+/);
    const out = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (!cur || textWidth(next, style) <= TEXT_WIDTH) cur = next;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out;
  }
  /**
   * Split a group of lines into slides of at most `max` on-screen lines.
   * Lines are shared out evenly, so 5 lines become 3 + 2 rather than 4 + 1.
   */
  function splitEvenly(lines, max) {
    if (lines.length <= max) return [lines];
    const count = Math.ceil(lines.length / max);
    const per = Math.ceil(lines.length / count);
    const out = [];
    for (let i = 0; i < lines.length; i += per) out.push(lines.slice(i, i + per));
    return out;
  }

  /**
   * Each section with its slides, in the order written: [{key, label, slides: [[line, …], …]}].
   *  - Automatic (the default): blank lines start new slides, and long parts are
   *    shared out so no slide passes "lines per slide" on the TV.
   *  - By hand (song.slideMode === 'manual', set when Split here / Merge is used in
   *    the Slides view): every blank line is a slide break and nothing else is changed.
   */
  function layout(song, settings) {
    const st = effectiveStyle(song, settings);
    const sections = parseSections(song.lyrics);
    if (song.slideMode === 'manual') {
      return sections.map((s) => ({ key: s.key, label: s.label, slides: s.chunks.map((c) => c.slice()) }));
    }
    const per = Math.max(1, Number(st.linesPerSlide) || 4);
    if (typeof document !== 'undefined') setFont(st);
    return sections.map((s) => ({
      key: s.key,
      label: s.label,
      slides: s.chunks.flatMap((chunk) => splitEvenly(chunk.flatMap((line) => wrapLine(line, st)), per)),
    }));
  }

  /** Turn a layout back into lyrics text: a label line per section, a blank line between slides. */
  function serialize(lay) {
    return lay
      .filter((s) => s.slides.some((sl) => sl.length))
      .map((s) => s.label + '\n' + s.slides.filter((sl) => sl.length).map((sl) => sl.join('\n')).join('\n\n'))
      .join('\n\n');
  }

  /** Build the slides for a song, in song order, each carrying the look to draw it with. */
  function buildSlides(song, settings) {
    const st = effectiveStyle(song, settings);
    const lay = layout(song, settings);
    const map = Object.fromEntries(lay.map((s) => [s.key, s]));
    const order = parseArrangement(song.arrangement, lay);
    const slides = [];
    for (const key of order) {
      const s = map[key];
      if (!s) continue;
      for (const group of s.slides) slides.push({ kind: 'text', label: s.label, key: s.key, text: group.join('\n'), style: st });
    }
    if (slides.length && settings.showCcliFooter) slides[0].footer = ccliFooter(song, settings);
    return slides;
  }

  /** Section type → color group, used for the colored section labels and order chips. */
  function sectionKind(key) {
    const k = String(key).replace(/\d+$/, '').toUpperCase();
    return { V: 'verse', C: 'chorus', B: 'bridge', P: 'pre', T: 'tag' }[k] || 'other';
  }

  // ---------- tidying pasted lyrics ----------
  const CHORD = /^[A-G](#|b|♯|♭)?(m|maj|min|dim|aug|sus|add|M)?\d{0,2}(sus\d?|add\d{1,2}|maj\d?|b\d|#\d|\+|°)*(\/[A-G](#|b|♯|♭)?)?$/;
  const REPEAT_RE = /\s*[([]?\s*(?:x\s*(\d)|(\d)\s*x|repeat\s*x?\s*(\d)?)\s*[)\]]?\s*$/i;
  const ABBREV = { V: 'Verse', C: 'Chorus', B: 'Bridge', PC: 'Pre-Chorus', P: 'Pre-Chorus', T: 'Tag' };

  // Marks that show up on chord lines but aren't words: bar lines, slashes, repeats, "N.C." (no chord)
  const CHART_MARK = /^(?:[|/.\-–—:%]+|\|:|:\||\(?\s*(?:x\s*\d+|\d+\s*x)\s*\)?|N\.?C\.?|\(|\))$/i;
  function isChordLine(line) {
    const tokens = line.trim().split(/[\s|]+|\s-\s|(?<=\S)-(?=[A-G])/).filter((t) => t);
    if (!tokens.length) return false;
    const rest = tokens.filter((t) => !CHART_MARK.test(t));
    if (!rest.length) return tokens.some((t) => /^N\.?C\.?$/i.test(t)) || tokens.some((t) => /[|/%]/.test(t)) || tokens.every((t) => /^[|:\-–—]+$/.test(t));
    // "A B C D E F G" is the alphabet song, not chords
    if (rest.length >= 3 && rest.every((t, i) => /^[A-G]$/.test(t) && (i === 0 || t.charCodeAt(0) === rest[i - 1].charCodeAt(0) + 1))) return false;
    return rest.every((t) => CHORD.test(t.replace(/[()]/g, '')));
  }
  // Notes for the band or a group of singers, at the end of a lyric line: "Come on in (Kids)"
  const SINGER_NOTE = /\s*[([](?:kids|girls|boys|all|everyone|men|women|guys|ladies|leader|lead|echo|instrumental|inst\.?|hold|clap|claps|spoken|shout|soft|quiet|loud|build|tacet|band|drums|key change|modulate|optional|\d+(?:st|nd|rd|th)? time(?: only)?)[)\]]\s*$/i;
  // Commands from Planning Center chord charts
  const PCO_COMMAND = /^(?:COLUMN[_ ]BREAK|PAGE[_ ]BREAK|\{[^}]*\}|<[^>]*>)$/i;
  // "Turnaround: G C D" or "INTRO - | G | C |": a section name followed by chords
  const LABEL_WITH_CHORDS = new RegExp('^\\[?\\s*(' + SECTION_NAMES.map((x) => x[0].replace(' ', '\\s')).join('|') + ')\\s*(\\d+)?\\s*\\]?\\s*[:\\-–—]\\s*(.+)$', 'i');

  /**
   * Clean up lyrics pasted from a chord chart, a website or a lyrics sheet.
   * Returns { text, report: { chords, footer, repeats, labels, notes, longLines: [] }, changed }.
   */
  function cleanLyrics(raw, settings) {
    const report = { chords: 0, footer: 0, repeats: 0, labels: 0, notes: 0, longLines: [] };
    const lines = (raw || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').split('\n');
    const out = [];
    let chunkStart = 0; // index in `out` where the current group of lines began
    for (let raw2 of lines) {
      let line = raw2.replace(/\s+$/, '');
      const t = line.trim();
      if (!t) { out.push(''); chunkStart = out.length; continue; }
      if (PCO_COMMAND.test(t)) { report.notes++; continue; }
      // a section name with chords after it: keep the name, drop the chords
      const lc = t.match(LABEL_WITH_CHORDS);
      if (lc && isChordLine(lc[3])) {
        report.chords += lc[3].split(/\s+/).length;
        out.push(titleCase(lc[1].toLowerCase().replace(/\s+/g, ' ')) + (lc[2] ? ' ' + lc[2] : ''));
        report.labels++; chunkStart = out.length; continue;
      }
      // CCLI / copyright footer lines
      if (/^(CCLI (Song|License)|For use solely|©|\(c\)\s|Copyright|www\.ccli\.com|All rights reserved|Public Domain$)/i.test(t)) { report.footer++; continue; }
      // a line of chords only, e.g. "G    D/F#   Em7   C"
      if (isChordLine(t)) { report.chords += t.split(/\s+/).length; continue; }
      // chords written inside the words: [G]Amazing [D]grace
      const bracketed = line.match(/\[[A-G][^\]\s]{0,8}\]/g);
      if (bracketed) { report.chords += bracketed.length; line = line.replace(/\[[A-G][^\]\s]{0,8}\]/g, '').replace(/\s{2,}/g, ' ').trim(); }
      // spaces left from lining words up under chords: "Who's got a big  house"
      let tt = line.trim().replace(/\s{2,}/g, ' ');
      const sn = tt.match(SINGER_NOTE);
      if (sn && sn.index > 0) { tt = tt.slice(0, sn.index).trim(); report.notes++; }
      // section labels: "VERSE 1:", "[Chorus]", "V1", "PC"
      const ab = tt.match(/^\[?\s*(PC|V|C|B|P|T)\s*(\d{0,2})\s*\]?:?$/i);
      if (ab) { out.push(ABBREV[ab[1].toUpperCase()] + (ab[2] ? ' ' + ab[2] : '')); report.labels++; chunkStart = out.length; continue; }
      const hm = tt.match(HEADER_RE);
      if (hm) {
        const label = titleCase(hm[1].toLowerCase().replace(/\s+/g, ' ')) + (hm[2] ? ' ' + hm[2] : '');
        if (label !== tt) report.labels++;
        out.push(label); chunkStart = out.length; continue;
      }
      // a repeat marker on its own line: "(x2)" or "Repeat" → repeat the lines just above
      const solo = tt.match(/^[([]?\s*(?:x\s*(\d)|(\d)\s*x|repeat\s*x?\s*(\d)?)\s*[)\]]?$/i);
      if (solo) {
        const n = Number(solo[1] || solo[2] || solo[3] || 2);
        const block = out.slice(chunkStart).filter((l) => l);
        for (let k = 1; k < n; k++) out.push(...block);
        report.repeats++; continue;
      }
      // other notes in brackets on their own line: "(Instrumental)", "*Key change*", "(Repeat Chorus)"
      if (/^[([*].*[)\]*]$/.test(tt)) { report.notes++; continue; }
      // a repeat marker at the end of a line: "Deep and wide (x2)"
      const rm = tt.match(REPEAT_RE);
      if (rm && rm.index > 0) {
        const n = Number(rm[1] || rm[2] || rm[3] || 2);
        const words = tt.slice(0, rm.index).trim();
        for (let k = 0; k < n; k++) out.push(words);
        report.repeats++; continue;
      }
      out.push(tt);
    }
    // Drop sections left with no words (an "Instrumental" or "Vamp" that only had chords).
    const kept = [];
    for (let i = 0; i < out.length; i++) {
      if (out[i] && HEADER_RE.test(out[i])) {
        let j = i + 1;
        while (j < out.length && !(out[j] && HEADER_RE.test(out[j])) && !out[j]) j++;
        if (j >= out.length || HEADER_RE.test(out[j])) { report.empty = (report.empty || 0) + 1; continue; }
      }
      kept.push(out[i]);
    }
    const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
    // lines too long to fit on one line on the TV
    if (typeof document !== 'undefined' && settings) {
      const st = effectiveStyle({}, settings);
      setFont(st);
      for (const l of text.split('\n')) if (l && !HEADER_RE.test(l) && wrapLine(l, st).length > 1) report.longLines.push(l);
    }
    const changed = report.chords + report.footer + report.repeats + report.labels + report.notes + (report.empty || 0) > 0;
    return { text, report, changed };
  }

  /** "Removed 14 chord letters and 3 CCLI footer lines, wrote out 2 repeats …" */
  function describeCleanup(r) {
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const join = (arr) => arr.join(', ').replace(/, ([^,]*)$/, ' and $1');
    const removed = [];
    if (r.chords) removed.push(plural(r.chords, 'chord', 'chords'));
    if (r.footer) removed.push(plural(r.footer, 'CCLI or copyright line', 'CCLI or copyright lines'));
    if (r.notes) removed.push(plural(r.notes, 'note like “(Instrumental)”', 'notes like “(Instrumental)”'));
    if (r.empty) removed.push(plural(r.empty, 'section with no words (like an instrumental)', 'sections with no words (like instrumentals)'));
    const parts = [];
    if (removed.length) parts.push('removed ' + join(removed));
    if (r.repeats) parts.push('wrote out ' + plural(r.repeats, 'repeat marked “(x2)”', 'repeats marked “(x2)”'));
    if (r.labels) parts.push('fixed ' + plural(r.labels, 'section label', 'section labels'));
    if (!parts.length) return '';
    const s = parts.length > 1 ? parts.slice(0, -1).join('; ') + '; and ' + parts[parts.length - 1] : parts[0];
    return s[0].toUpperCase() + s.slice(1) + '.';
  }

  function ccliFooter(song, settings) {
    const parts = [];
    if (song.title) parts.push('“' + song.title + '”');
    if (song.author) parts.push(song.author);
    if (song.copyright) parts.push(/^(©|public domain)/i.test(song.copyright) ? song.copyright : '© ' + song.copyright);
    if (song.ccli) parts.push('CCLI Song # ' + song.ccli);
    if (settings.ccliLicense) parts.push('CCLI License # ' + settings.ccliLicense);
    return parts.join('  ·  ');
  }

  /**
   * Read a lyrics file downloaded from CCLI SongSelect (.txt), or any plain text
   * whose first line is the title. Returns {title, author, ccli, copyright, lyrics}.
   */
  function parseSongFile(text, fallbackTitle) {
    const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    const song = { title: '', author: '', ccli: '', copyright: '', lyrics: '' };
    // Title = first non-empty line, unless it is a section header.
    let start = 0;
    while (start < lines.length && !lines[start].trim()) start++;
    if (start < lines.length && !HEADER_RE.test(lines[start])) {
      song.title = lines[start].trim();
      start++;
    }
    const body = [];
    let inFooter = false;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i].trim();
      const ccli = line.match(/^CCLI Song\s*#?\s*(\d+)/i);
      if (ccli) {
        inFooter = true;
        song.ccli = ccli[1];
        // the authors line usually follows the song number
        const next = (lines[i + 1] || '').trim();
        if (next && !/^©|^\(c\)|copyright|for use solely|ccli/i.test(next)) { song.author = next.replace(/\s*\|\s*/g, ', '); i++; }
        continue;
      }
      if (/^public domain$/i.test(line)) { inFooter = true; song.copyright = 'Public Domain'; continue; }
      if (/^(©|\(c\)|copyright)/i.test(line)) { inFooter = true; song.copyright = line.replace(/^(©|\(c\)|copyright)\s*/i, '© '); continue; }
      if (/^(for use solely|ccli license|note: reproduction|www\.ccli\.com|all rights reserved)/i.test(line)) { inFooter = true; continue; }
      if (inFooter) continue;
      body.push(lines[i]);
    }
    song.lyrics = cleanLyrics(body.join('\n')).text;
    if (!song.title) song.title = fallbackTitle || 'Untitled song';
    return song;
  }

  window.Songs = {
    parseSections, parseArrangement, buildSlides, parseSongFile, ccliFooter, splitEvenly,
    layout, serialize, effectiveStyle, usesDefaults, sectionKind, cleanLyrics, describeCleanup, STYLE_KEYS,
  };
})();
