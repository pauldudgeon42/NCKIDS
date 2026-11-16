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
 * starts a new slide, and long sections are split every N lines (Settings).
 * The arrangement ("V1 C V2 C B C") picks the order; empty means "as written".
 */
(function () {
  const SECTION_NAMES = [
    ['pre-chorus', 'P'], ['prechorus', 'P'], ['pre chorus', 'P'],
    ['verse', 'V'], ['chorus', 'C'], ['bridge', 'B'], ['tag', 'T'],
    ['intro', 'I'], ['outro', 'O'], ['ending', 'E'], ['interlude', 'IN'],
    ['refrain', 'R'], ['hook', 'H'], ['vamp', 'VA'], ['instrumental', 'IN'],
    ['misc', 'M'], ['part', 'PT'],
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

  /** Arrangement text → list of section keys. Accepts "V1 C V2 C" or "Verse 1, Chorus". */
  function parseArrangement(text, sections) {
    if (!text || !text.trim()) return sections.map((s) => s.key);
    const byKey = {};
    for (const s of sections) { byKey[s.key.toUpperCase()] = s.key; byKey[s.label.toUpperCase()] = s.key; }
    const tokens = text.split(/[,;\n]+/).flatMap((part) => {
      const p = part.trim();
      if (!p) return [];
      if (byKey[p.toUpperCase()]) return [p];
      return p.split(/\s+/);
    });
    const out = [];
    for (const t of tokens) {
      const k = byKey[t.toUpperCase()] || byKey[(t + '1').toUpperCase()];
      if (k) out.push(k);
    }
    return out.length ? out : sections.map((s) => s.key);
  }

  // ---------- fitting lyrics on screen ----------
  // The lyrics area on the TV is 88% of a 1920px-wide stage (see renderer.js).
  const TEXT_WIDTH = 1920 * 0.88 * 0.97; // small safety margin for font differences
  let measureCtx = null;
  function setFont(settings) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    // Text may shrink up to 20% to keep a line whole before it counts as two lines.
    const size = (Number(settings.maxFontSize) || 110) * 0.8;
    measureCtx.font = `700 ${size}px "${settings.font || 'Avenir Next'}", "Avenir Next", "Helvetica Neue", Arial, sans-serif`;
  }
  function textWidth(t, settings) {
    return measureCtx.measureText(settings.uppercase ? t.toUpperCase() : t).width;
  }
  /** Break one lyric line into the lines it would take up on the TV at full text size. */
  function wrapLine(line, settings) {
    if (typeof document === 'undefined' || textWidth(line, settings) <= TEXT_WIDTH) return [line];
    const words = line.split(/\s+/);
    const out = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (!cur || textWidth(next, settings) <= TEXT_WIDTH) cur = next;
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

  /** Build the slides for a song. */
  function buildSlides(song, settings) {
    const perSlide = Math.max(1, Number(settings.linesPerSlide) || 4);
    const sections = parseSections(song.lyrics);
    const map = Object.fromEntries(sections.map((s) => [s.key, s]));
    const order = parseArrangement(song.arrangement, sections);
    if (typeof document !== 'undefined') setFont(settings);
    const slides = [];
    for (const key of order) {
      const s = map[key];
      if (!s) continue;
      for (const chunk of s.chunks) {
        // Long lines that would wrap on the TV count as more than one line.
        const screenLines = chunk.flatMap((line) => wrapLine(line, settings));
        for (const group of splitEvenly(screenLines, perSlide)) {
          slides.push({ kind: 'text', label: s.label, text: group.join('\n') });
        }
      }
    }
    if (slides.length && settings.showCcliFooter) {
      slides[0].footer = ccliFooter(song, settings);
    }
    return slides;
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
    song.lyrics = body.join('\n').replace(/^\n+|\n+$/g, '');
    if (!song.title) song.title = fallbackTitle || 'Untitled song';
    return song;
  }

  window.Songs = { parseSections, parseArrangement, buildSlides, parseSongFile, ccliFooter, splitEvenly };
})();
