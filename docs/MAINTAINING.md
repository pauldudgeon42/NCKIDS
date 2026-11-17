# Maintaining NC Kids Presenter

This is for whoever looks after the code. You don't need to be a professional developer. The app is deliberately plain: HTML, CSS and JavaScript files with no frameworks. The same files run in Chrome (open `index.html`) and inside the **Mac app** (`desktop/`, built with Electron). To try a change quickly, edit a file and reload Chrome. To run the Mac app from the code: install Node.js, then `npm install` and `npm start`.

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
desktop/main.js     the Mac app: windows, TV placement, library on disk (nclib://), Planning Center bridge, Keychain token, self-check
desktop/preload.js  what the page may ask the Mac app to do (window.NCDesktop)
desktop/remote-server.js  the phone remote's web server (plain Node, no packages)
desktop/procontent.js     the ProContent window (website + toolbar) and catching its downloads
desktop/unzip.js          unpacks videos/pictures from ProContent .zip packs (plain Node, streams, ZIP64)
remote/             the phone remote page (index.html, remote.js, remote.css)
js/qr.js            QR code maker for the pairing link
package.json        Mac app settings for Electron and electron-builder
.github/workflows/  GitHub Actions: self-check + Mac installer build on every change
build/icon.png      the app icon
tests/              automated tests for the web files (optional, for developers)
```

### Design decisions (and why)

- **Opened straight from disk (`file://`).** No server needed, which means fewer things to break on a Sunday. Because of this, the scripts are plain `<script>` files rather than ES modules (Chrome blocks modules from `file://`).
- **The TV window is a blank pop-up that the control page draws into.** That keeps everything in one page's memory, so video files and pictures load once and work from `file://`. `output.js` writes the TV window's HTML itself, and there is no separate TV page.
- **One library folder, chosen by the user.** Chrome remembers it (IndexedDB) and asks for permission again when needed. The app code and the content are kept separate on purpose: the app can be replaced or rolled back without touching songs, lessons or videos.
- **One `library.json`** holds all songs, lessons, videos, backgrounds, playlists and settings. Media files sit next to it in `media/`. It's human-readable, so you can open it in a text editor if needed.
- **Chrome (or Edge) only.** Safari and Firefox don't support saving to a folder.

### Songs: how slides are made

`js/songs.js` is the one place that turns a song into slides. `layout(song, settings)` gives each section's slides in the order written. In automatic mode, blank lines are breaks and long parts are shared out under "lines per slide" (counting lines that would wrap on the TV). In manual mode, only blank lines are breaks. The Slides view edits a layout and writes it back to `song.lyrics` with `serialize()`, so the lyrics text is always the one source of truth. `effectiveStyle()` merges Settings with the song's own `style`, and each built slide carries that style to the renderer. `cleanLyrics()` does the paste tidy-up and returns a report of what it changed. `tests/song-editor-test.js` covers all of this.

### Planning Center

`js/pco.js` calls the Planning Center Services API (`/services/v2/songs` and `/songs/{id}/arrangements`) with a Personal Access Token using HTTP basic auth. Lyrics come from the arrangement's `lyrics` field (where SongSelect imports put them), and the song order from its `sequence`. The token is kept in `localStorage`, deliberately **not** in `library.json`, so it never ends up in iCloud, backups or GitHub. Imported songs carry a `pco: { songId, arrangementId, arrangementName, imported }` field.

**If the import says it "couldn't reach Planning Center" while the internet works**, Planning Center is probably refusing requests made directly from a web page (a browser rule called CORS). The fix is to move that call out of the browser: either the standalone Mac app (Electron), which isn't subject to that rule, or a tiny relay. `tests/pco-test.js` checks the import against a fake Planning Center, so it can't detect this. Only the real classroom Mac can.

### Look and themes

`css/app.css` is built on color tokens (`--bg`, `--panel`, `--text`, `--accent` …) defined twice: once for `html[data-theme="light"]` and once for `html[data-theme="dark"]`. `applyTheme()` in `js/app.js` sets `data-theme` from the current mode (`settings.buildTheme` / `settings.presentTheme`) and fills in the accent colors from `ACCENTS`. When adding UI, use the tokens rather than fixed colors so both looks keep working. Icons are inline line drawings from `ICONS` / `icon(name)` in `app.js`. Please don't use emoji in the interface.

### The Mac app

The Mac app loads the same `index.html` from `app://local/`, and `desktop/preload.js` gives the page a `window.NCDesktop` object. Each piece of web code checks for it:

- `store.js` reads and writes the library through `NCDesktop.fs` (a real folder on disk), and media is served to the page as `nclib://library/…` with byte ranges so videos can seek.
- `pco.js` sends requests through `NCDesktop.http` (which only allows Planning Center), so the browser's CORS rule doesn't apply, and keeps the token in `NCDesktop.secrets` (encrypted with `safeStorage` / Keychain).
- `output.js` lets the main process place the TV window: `setWindowOpenHandler` + `did-create-window` in `main.js` put it full screen on the other display.

Without `NCDesktop` (plain Chrome) everything falls back to the browser behavior.

**Building:** GitHub Actions (`.github/workflows/mac-app.yml`) runs `electron . --smoke-test` on Linux (it checks the library, media serving, the token and the TV window, then prints `SMOKE TEST PASSED`), then builds a universal `.dmg` on a Mac. The `.dmg` gets an ad-hoc signature, and the build fails if `codesign --verify` doesn't pass. Download it from the run's **Artifacts**. **Publishing a Release** (tag like `v1.1.0`) runs the build and attaches the installer to that Release; this is how volunteers get new versions. Bump `version` in `package.json` and `APP_VERSION` in `js/app.js` together.

The app isn't notarized by Apple (that needs a paid Apple Developer account), so the first launch on each Mac needs **System Settings → Privacy & Security → Open Anyway**. If the church gets an Apple Developer account later, add the certificate as GitHub secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`) and turn on notarization in `package.json`. Then the warning goes away and automatic updates become possible.

### Planning Center plan import

`openPlanImport()` / `analyzePlan()` / `importPlan()` in `js/app.js`, with `PCO.serviceTypes()`, `plans()`, `planItems()`, `itemAttachments()` and `downloadAttachment()` in `js/pco.js`.

- Each plan item becomes something: song items become songs (matched by `pco.songId`, created from the plan's arrangement if new). A custom song order in the plan is stored on the playlist item as `arrangement`. Headers become `label` items. Other items' attachments become a lesson (images + PDF pages, sorted by filename) and/or videos.
- Downloads: `POST {attachment}/open` returns a short-lived `attachment_url`. The Mac app saves it straight into the library (`NCDesktop.http.request` with `download` + `saveTo`). PDFs are rendered to JPEGs with PDF.js (`vendor/pdfjs`, Apache-2.0).
- Re-importing: playlists keep `pco.planId`. Lessons remember a key made of their attachments' ids and update times, and videos remember `pco.attachmentId`, so unchanged files are reused rather than downloaded again.
- `tests/plan-import-test.js` runs the whole flow against a fake Planning Center.

### Things that work in Chrome but not in the Mac app

- **`window.prompt()` doesn't exist in Electron.** It returns null without showing anything. Use `askText()` in `js/app.js` (the app's own pop-up). `alert()` and `confirm()` do work. `tests/e2e.js` makes `prompt()` throw, so a new one gets caught.

### Phone remote

- `desktop/remote-server.js` is a plain Node `http` server (no packages), started from the **Phone** window. It listens on port 8765 (or the next free one) on every network interface.
- **Pairing:** a 4-digit code plus a random key in the QR link (`#p=…`). Pairing gives the phone a random token, kept in its browser storage. Codes, keys and tokens live only in memory, so they change when the remote is turned on again or someone clicks **New code**. After 8 wrong codes, pairing pauses for a minute.
- **Updates to phones:** Server-Sent Events (`/api/events`), chosen over WebSockets because they need no package. The page sends three kinds: `setup` (backgrounds, timers, playlists, theme), `playlist` (items and slide summaries) and `live` (what's on the TV, up next, timer, video). These are built in `publishRemote()` in `js/app.js` and sent only when they change.
- **Commands from phones:** `POST /api/cmd` → `onRemoteCommand()` in `js/app.js`, which calls the same functions as the Mac's buttons (`step`, `goLive`, `clearLive`, `pickLiveBg`, `startTimer`…).
- **Pictures:** `/lib/…` serves only image files from the library, to paired phones. `?w=` returns a smaller JPEG (resized with Electron's `nativeImage`).
- The phone page uses the Wake Lock API where it's allowed and otherwise plays a tiny silent looping video (`remote/awake.mp4`), so the phone screen stays on.
- `tests/remote-test.js` runs the real server, the app in Chrome and an iPhone-sized phone page together. The Mac app's self-check also starts the server, pairs and reads updates.

### ProContent

- There's no ProContent API for other apps, so this embeds the **public ProContent website** (`procontent.renewedvision.com`), signed in with the church's own account. Don't copy ProPresenter's private connection to Renewed Vision.
- `desktop/procontent.js` opens a window with a small toolbar (`desktop/procontent-bar.html`) above the website. The website runs in its own session (`persist:procontent`), sandboxed and with no access to the app. Its sign-in is saved there. **Settings → ProContent → Sign out** clears it.
- `will-download` on that session catches downloads. Videos and pictures are saved to a holding folder (`~/Library/Application Support/NC Kids Presenter/ProContent downloads`). `.zip` packs are unpacked there (`desktop/unzip.js`), and anything else goes to Downloads. The page is then told (`pc:download`, state `ready`) and imports the files with `Media.importBackgrounds` (copied on disk, not read into memory), marks them `source: 'procontent'` and sends `pc:done` so the holding folder is cleared.
- The self-check serves a stand-in website with a pack and a loop, downloads both through the window and checks three backgrounds arrive. `tests/procontent-test.js` checks the page side.

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
  songs:       [{ id, title, author, copyright, ccli, lyrics, arrangement, background,
                  slideMode,   // 'auto' (default) or 'manual' after Split here / Merge
                  style,       // null = Settings defaults, or { linesPerSlide, size: 'smaller'|'normal'|'larger', position: 'center'|'lower', uppercase }
                  pco }],
  lessons:     [{ id, title, slides: [{ id, path, name }], thumb }],
  videos:      [{ id, title, path, thumb, duration }],
  backgrounds: [ /* source: 'procontent' for ProContent downloads */{ id, title, type: 'video'|'image', path, thumb }],
  playlists:   [{ id, title, date, pco?, items: [{ id, type: 'song'|'lesson'|'video'|'background'|'timer'|'label', ref, title? (labels), background?, arrangement? }] }],
  timers:      [{ id, title, seconds, message, chime, autoNext }],   // countdowns; standard set in store.js defaultTimers()
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

`node lyrics-test.js` checks the lyric cleanup on chord-chart cases (no browser needed).
`node procontent-test.js` checks adding ProContent downloads to Backgrounds (packs, single loops, unplayable files, the ProContent tag and search).
`node remote-test.js` checks the phone remote (pairing, refusing unpaired phones, Next/Back/Clear/Black, tapping slides, timers, switching playlists, New code, Turn off).
`node plan-import-test.js` checks importing a Planning Center plan (songs with plan order, JPEG slides, PDF pages, video, headers, skipped PowerPoint, re-import without duplicates).
`node timer-test.js` checks the countdown timers (one-click start, pause, +1 min, custom, end message, playlist auto-advance).
`node song-editor-test.js` checks the song editor (paste cleanup, split / merge / edit, order chips, per-song look).
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
