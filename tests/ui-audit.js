// UI audit: node ui-audit.js [width x height ...]  (app served on :8765)
// Fills a demo library like a real Sunday, visits every screen, saves screenshots to
// shots/audit-*.png and lists elements that overlap each other, spill out of their
// box, or run off the window. Not pass/fail: it's a checklist for a person to look at.
const { chromium } = require('playwright');
const OUT = __dirname + '/shots/';
const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ['1280x800', '1024x700', '1680x1050']).map((s) => s.split('x').map(Number));

async function seed(page) {
  await page.evaluate(async () => {
    const M = 'tests/media/';
    const file = async (name, as) => { const b = await (await fetch(M + name)).blob(); return new File([b], as || name, { type: b.type }); };
    const d = Store.data;
    const songs = [
      ['This Little Light of Mine', 'Verse 1\nThis little light of mine\nI’m gonna let it shine\nThis little light of mine\nI’m gonna let it shine\nLet it shine, let it shine, let it shine\n\nChorus\nHide it under a bushel? No!\nI’m gonna let it shine'],
      ['Jesus Loves Me', 'Verse 1\nJesus loves me this I know\nFor the Bible tells me so\nLittle ones to Him belong\nThey are weak but He is strong\n\nChorus\nYes, Jesus loves me\nYes, Jesus loves me\nYes, Jesus loves me\nThe Bible tells me so'],
      ['My God Is So Big, So Strong and So Mighty (There’s Nothing My God Cannot Do) – Kids Version', 'Verse 1\nMy God is so big, so strong and so mighty\nThere’s nothing my God cannot do'],
      ['Big House', 'Verse 1\nI don’t know where you lay your head\nOr where you call your home\n\nChorus\nCome on and go with me\nTo my Father’s house'],
      ['Deep and Wide', 'Chorus\nDeep and wide\nDeep and wide\nThere’s a fountain flowing deep and wide'],
    ];
    songs.forEach(([title, lyrics], i) => d.songs.push({ id: 's' + i, title, lyrics, author: i === 1 ? 'Anna Bartlett Warner' : '', ccli: i === 1 ? '1234567' : '', arrangement: '', background: '' }));
    let r = await Media.importBackgrounds([await file('bg_blue_loop.mp4', 'Blue Waves Loop.mp4'), await file('bg_space.mp4', 'Space Particles Slow Drift Extended Version.mp4'), await file('Slide2.jpg', 'Still Gradient.jpg')]);
    r.added[0].source = 'procontent';
    d.settings.defaultBackground = r.added[0].id;
    const bgs = r.added;
    r = await Media.importVideos([await file('Lesson_Video.mp4', 'Week 3 – Noah Builds the Ark (Bible Story Video).mp4')]);
    const vid = r.added[0];
    const les = await Media.importLesson([await file('Slide1.jpg'), await file('Slide2.jpg'), await file('Slide3.jpg'), await file('Slide10.jpg')], 'Week 3: Noah and the Ark — Large Group Lesson Slides');
    const logo = await Media.importLogo(await file('logo.png'));
    d.songs[0].background = bgs[1].id;
    d.playlists.push({ id: 'p1', title: 'Sunday School — November 22', date: '2026-11-22', items: [
      { id: 'a', type: 'label', title: 'Worship' }, { id: 'b', type: 'song', ref: 's0' }, { id: 'c', type: 'song', ref: 's2' }, { id: 'd', type: 'song', ref: 's1' },
      { id: 'e', type: 'label', title: 'Lesson' }, { id: 'f', type: 'video', ref: vid.id }, { id: 'g', type: 'lesson', ref: les.id },
      { id: 'h', type: 'label', title: 'Small groups and a very long section label to see what happens' }, { id: 'i', type: 'timer', ref: 't-discussion' }, { id: 'j', type: 'background', ref: bgs[2].id },
    ] });
    d.playlists.push({ id: 'p2', title: 'Wednesday Kids Night', date: '2026-11-25', items: [{ id: 'k', type: 'song', ref: 's3' }] });
    d.settings.lastPlaylist = 'p1';
    await Store.saveNow();
  });
}

async function audit(page) {
  return page.evaluate(() => {
    const out = [];
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
    const name = (el) => {
      let s = el.tagName.toLowerCase();
      if (el.id) s += '#' + el.id;
      else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
      const p = el.parentElement;
      const pn = p ? (p.id ? '#' + p.id : (typeof p.className === 'string' && p.className ? '.' + p.className.trim().split(/\s+/)[0] : p.tagName.toLowerCase())) : '';
      const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${pn} > ${s}${txt ? ` “${txt}”` : ''}`;
    };
    const W = innerWidth, H = innerHeight;
    const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('svg') && !['SCRIPT', 'STYLE', 'OPTION', 'BR'].includes(el.tagName) && vis(el));
    for (const el of all) {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      // Off the side of the window (ignoring things inside scrolling areas)
      let sc = el.parentElement, scrolls = false;
      while (sc && sc !== document.body) { const o = getComputedStyle(sc); if (/(auto|scroll|hidden)/.test(o.overflowX + o.overflowY)) { scrolls = true; break; } sc = sc.parentElement; }
      if (!scrolls && (r.right > W + 1 || r.left < -1)) out.push(['off-window', name(el)]);
      // Text spilling out of a box that doesn't scroll or clip
      if (el.children.length === 0 && el.textContent.trim() && cs.overflow === 'visible' && el.scrollWidth > el.clientWidth + 2 && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && cs.display !== 'inline') out.push(['text spills', name(el)]);
      // Ellipsis cutting text that is short anyway (box too small)
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim().length < 14) out.push(['short text cut', name(el)]);
      // Siblings that overlap (in normal layout, not positioned on purpose)
      if (cs.position === 'static' || cs.position === 'relative') {
        const sibs = [...el.children].filter((c) => vis(c) && ['static', 'relative'].includes(getComputedStyle(c).position) && getComputedStyle(c).float === 'none');
        for (let i = 0; i < sibs.length; i++) for (let j = i + 1; j < sibs.length; j++) {
          const a = sibs[i].getBoundingClientRect(), b = sibs[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 3 && oy > 3) out.push(['overlap', name(sibs[i]) + '  ×  ' + name(sibs[j])]);
        }
      }
      // Tiny click targets
      if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && (r.height < 24 || r.width < 24)) out.push(['small button', name(el) + ` ${Math.round(r.width)}×${Math.round(r.height)}`]);
    }
    return [...new Set(out.map((x) => x.join(': ')))];
  });
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' });
  for (const [w, h] of sizes) {
    for (const theme of ['default', 'swap']) {
      if (theme === 'swap' && w !== 1280) continue;
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.addInitScript(() => { window.NCProContentBridge = { open: async () => true, signOut: async () => true, done() {}, onDownload() {} }; });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());
      await page.goto('http://localhost:8765/?demo');
      await page.waitForSelector('#build:not(.hidden)');
      await page.evaluate(() => document.documentElement.classList.add('desktop'));
      await seed(page);
      if (theme === 'swap') {
        await page.evaluate(async () => { Object.assign(Store.data.settings, { buildTheme: 'dark', presentTheme: 'light', accent: 'purple' }); await Store.saveNow(); });
        await page.reload();
        await page.waitForSelector('#build:not(.hidden), #present:not(.hidden)');
        await page.evaluate(() => document.documentElement.classList.add('desktop'));
      }
      const tag = `${w}x${h}${theme === 'swap' ? '-swap' : ''}`;
      const shot = async (label) => {
        await page.waitForTimeout(450);
        await page.screenshot({ path: `${OUT}audit-${tag}-${label}.png` });
        const issues = await audit(page);
        console.log(`\n== ${tag} ${label} (${issues.length})`);
        issues.slice(0, 25).forEach((x) => console.log('  ' + x));
      };
      const tabs = ['songs', 'lessons', 'videos', 'backgrounds', 'playlists', 'settings'];
      await page.click('[data-mode=build]').catch(() => {});
      for (const t of tabs) {
        await page.click(`[data-tab=${t}]`);
        if (t === 'songs') await page.click('#song-list li:nth-child(2)').catch(() => {});
        if (t === 'lessons') await page.click('#lesson-list li:first-child').catch(() => {});
        if (t === 'playlists') await page.click('#pl-list li:first-child, #plan-list li:first-child').catch(() => {});
        await shot('build-' + t);
        if (t === 'songs') { await page.click('.se-views [data-view=lyrics], [data-view=lyrics]').catch(() => {}); await shot('build-songs-lyrics'); }
        if (t === 'settings' && w === 1280) {
          for (const sec of ['lyrics', 'tv', 'logo', 'timers', 'ccli', 'pco', 'procontent', 'library']) { await page.click(`[data-sec=${sec}]`).catch(() => {}); await shot('settings-' + sec); }
        }
      }
      await page.click('[data-mode=present]');
      await page.waitForSelector('#present-slides .slide-card');
      await shot('present-idle');
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      await shot('present-live');
      await page.evaluate(() => NCApp.goLive(8, 0)).catch(() => {});
      await shot('present-timer');
      if (w === 1280 && theme === 'default') {
        await page.click('#phone-btn').catch(() => {});
        await shot('phone-modal');
      }
      if (errors.length) console.log('PAGE ERRORS:', errors);
      await ctx.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
