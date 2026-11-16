# Maintaining NC Kids Presenter

This is for whoever looks after the code. You don't need to be a professional developer. The app is deliberately plain: HTML, CSS and JavaScript files, with **no build step, no frameworks and no `npm install`**. Edit a file, reload Chrome, and you see the change.

## How it fits together

```
index.html          the control screen (Present + Build), loads the scripts below in order
css/app.css         look of the control screen
js/store.js         reads/writes the library folder (File System Access API), saving, daily backups
js/songs.js         lyrics → slides, arrangement ("V1 C V2 C"), CCLI SongSelect .txt import
js/renderer.js      draws one slide on a 1920×1080 stage (used for the TV, the preview and thumbnails)
js/media.js         importing backgrounds / videos / lesson images, making thumbnails
js/output.js        the TV window and live preview, black/clear/logo, video controls
js/pco.js           reads songs + arrangements (lyrics, order) from the Planning Center Services API
js/app.js           all the screens and buttons
tests/              automated smoke test (optional, for developers)
```

### Design decisions (and why)

- **Opened straight from disk (`file://`).** No server needed, which means fewer things to break on a Sunday. Because of this, the scripts are plain `<script>` files rather than ES modules (Chrome blocks modules from `file://`).
- **The TV window is a blank pop-up that the control page draws into.** That keeps everything in one page's memory, so video files and pictures load once and work from `file://`. `output.js` writes the TV window's HTML itself, and there is no separate TV page.
- **One library folder, chosen by the user.** Chrome remembers it (IndexedDB) and asks for permission again when needed. The app code and the content are kept separate on purpose: the app can be replaced or rolled back without touching songs, lessons or videos.
- **One `library.json`** holds all songs, lessons, videos, backgrounds, playlists and settings. Media files sit next to it in `media/`. It's human-readable, so you can open it in a text editor if needed.
- **Chrome (or Edge) only.** Safari and Firefox don't support saving to a folder.

### Planning Center

`js/pco.js` calls the Planning Center Services API (`/services/v2/songs` and `/songs/{id}/arrangements`) with a Personal Access Token using HTTP basic auth. Lyrics come from the arrangement's `lyrics` field (where SongSelect imports put them), and the song order from its `sequence`. The token is kept in `localStorage`, deliberately **not** in `library.json`, so it never ends up in iCloud, backups or GitHub. Imported songs carry a `pco: { songId, arrangementId, arrangementName, imported }` field.

**If the import says it "couldn't reach Planning Center" while the internet works**, Planning Center is probably refusing requests made directly from a web page (a browser rule called CORS). The fix is to move that call out of the browser: either the standalone Mac app (Electron), which isn't subject to that rule, or a tiny relay. `tests/pco-test.js` checks the import against a fake Planning Center, so it can't detect this. Only the real classroom Mac can.

### Look and themes

`css/app.css` is built on color tokens (`--bg`, `--panel`, `--text`, `--accent` …) defined twice: once for `html[data-theme="light"]` and once for `html[data-theme="dark"]`. `applyTheme()` in `js/app.js` sets `data-theme` from the current mode (`settings.buildTheme` / `settings.presentTheme`) and fills in the accent colors from `ACCENTS`. When adding UI, use the tokens rather than fixed colors so both looks keep working. Icons are inline line drawings from `ICONS` / `icon(name)` in `app.js`. Please don't use emoji in the interface.

### The library folder

```
library.json
backups/library-YYYY-MM-DD.json     one per day the library was changed; last 30 kept
media/backgrounds/<id>.mp4|.jpg
media/videos/<id>.mp4
media/lessons/<lessonId>/<slideId>.jpg
media/thumbs/<id>.jpg
media/logo-<id>.png
```

`library.json` outline (see `emptyLibrary()` in `js/store.js`):

```js
{
  version: 1,
  songs:       [{ id, title, author, copyright, ccli, lyrics, arrangement, background }],
  lessons:     [{ id, title, slides: [{ id, path, name }], thumb }],
  videos:      [{ id, title, path, thumb, duration }],
  backgrounds: [{ id, title, type: 'video'|'image', path, thumb }],
  playlists:   [{ id, title, date, items: [{ id, type: 'song'|'lesson'|'video'|'background', ref, background? }] }],
  settings:    { font, textColor, maxFontSize, uppercase, shadow, linesPerSlide, defaultBackground, ccliLicense, showCcliFooter, logo, audioDeviceId, ... }
}
```

**If you change this format:** keep old libraries working. Add new fields with defaults in `emptyLibrary()`, since `upgrade()` fills missing values automatically. If a change can't be handled that way, bump `DATA_VERSION` and write the conversion in `upgrade()`. Never make the app delete fields it doesn't recognize, because someone may roll the app back to an older version.

## Trying changes safely

- Open `index.html?demo` (add `?demo` to the address) to use a **scratch library stored inside Chrome** instead of the real folder. That way you can experiment without touching real content.
- Test on the classroom Mac with the TV connected before Sunday.

### Automated smoke test (optional)

Needs Node.js, Playwright, Chrome, ffmpeg and Python with Pillow:

```sh
cd tests
./make-test-media.sh          # creates sample videos, slides, a song file and a logo
python3 -m http.server 8765 --directory ..  &
node e2e.js                   # imports everything, builds a playlist, runs it on a "TV" window
```

`node pco-test.js` checks the Planning Center import against a fake Planning Center (no real account needed).

It prints what it checked and lists any page errors at the end (`ERRORS: none` is the goal). Screenshots go to `tests/shots/`.

## Making a change and releasing it

1. Make the change on a branch, or on `main` if it's small.
2. Write a clear commit message: *what* changed and *why* ("Make Clear also stop videos, because volunteers expected it to").
3. Add a line to `CHANGELOG.md` in plain English.
4. Update the version in `js/app.js` (`APP_VERSION`).
5. When it has been tested on the classroom Mac, create a **Release** on GitHub with a tag like `v0.2.0`. Releases are how volunteers roll back (see README).

## Working with Claude on this project

This app was first built with Claude (Anthropic's AI assistant). To continue that way, share this repository with Claude and describe the change in everyday terms ("the lyrics are too small on the TV", "add a countdown timer before class"). Ask it to follow this guide: keep things dependency-free, keep old libraries working, update the changelog, and test before releasing.

## Ideas not built yet

- Countdown timer slide ("Class starts in 5:00")
- Bible verse slides
- A phone remote
- Standalone Mac app (wrap these same files with Electron. Nothing needs rewriting.)
- Pulling playlists from Planning Center
