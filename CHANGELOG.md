# Changelog

Plain-English notes on what changed in each version. Newest first.
Version numbers: **major.minor.fix**. A new minor number means new features, and a new fix number means bug fixes only.

## v1.0.0 — the Mac app (November 2026)

- **NC Kids Presenter is now a Mac app.** Download the installer from GitHub Releases, drag it to Applications, and open it from the Dock. No more Chrome bookmark.
- **The TV fills by itself:** Start TV puts the presentation full screen on the TV, without the "click to fill" step. If the TV is plugged in later, the TV window moves onto it.
- **Planning Center works:** the song import (and Save and test) now connect, because the Mac app isn't subject to the browser's block. The token is encrypted with the Mac Keychain.
- **The library is saved straight to disk.** Imported videos and pictures are copied directly from their files, which is faster for big videos. The same library folder works in both the Mac app and the Chrome version.
- **Folder imports** (lesson slides, videos, backgrounds) use the normal Mac folder dialog.
- GitHub builds the installer automatically for every change, and attaches it to each published Release.

## v0.6.0 — countdown timers (November 2026)

- **Timers in Present mode:** one click starts a countdown on the TV, shown big over the moving background. Six are ready to go: Class starts soon (5 min), Cleanup time (3), Game time (2), Activity time (10), Discussion time (5) and Quiet time (1). **Custom** starts any length with your own name.
- While a timer runs: **Pause / Resume**, **+1 min**, **Restart** and **Stop**, with a progress bar and time left. The last 10 seconds turn yellow. At zero the TV shows a message ("Time's up!") and a soft chime plays through the TV speakers.
- **Timers in playlists:** add a timer like any song or lesson. "Class starts soon" is set to move on to the next item by itself at zero (after showing "Let's begin!" for a few seconds).
- **Settings → Timers:** rename timers, change their length, the message at zero, the chime, and whether they move on in a playlist. Add your own, or put back the standard ones.
- After a timer, Next carries on with the playlist where you left off.

## v0.5.0 — more control over songs (November 2026)

- **Slides view for songs:** see a song as its actual slides, grouped by part. Hover between two lines for **Split here** to start a new slide, or use **Merge** where two slides meet to join them. Click any words to fix them right on the slide. Once you split or merge, the song keeps your breaks, and **Let the app split them again** undoes that.
- **Lyrics view** keeps the text box (plus author, copyright and CCLI number). Switch between the two with the Slides / Lyrics buttons.
- **Paste cleanup:** pasting lyrics removes chord letters (chord-only lines and [G]-style chords), CCLI and copyright lines and notes like "(Instrumental)". It writes out "(x2)" repeats and fixes section labels ("VERSE 1:", "[Chorus]", "V1"). A note lists what changed, with **Undo**. It also warns about lines too long for one line on the TV. **Tidy up these lyrics** does the same for lyrics already in a song, and SongSelect and Planning Center imports are tidied automatically.
- **Song order chips:** colored chips that match each part. Drag to reorder, click × to remove, click "+ Chorus" to add. **Use the order written** clears it.
- **Look for this song:** each song uses the Settings defaults until you change something here: lines per slide, text position (centered or lower third), text size (smaller, normal, larger), all caps and background. Tick **Use Settings defaults** to go back.
- **Text position** default added to Settings → Lyrics on the TV.
- Updating a song from Planning Center asks first if you've arranged its slides by hand.

## v0.4.0 — new look (November 2026)

- **Redesigned throughout:** friendlier, rounded look with cards, a softer typeface and clearer buttons. All emojis are replaced with simple line icons.
- **Present is dark, Build is light (by default),** so it's obvious at a glance whether you're presenting or editing. **Settings → Appearance** lets you choose light or dark for each mode, plus an accent color (teal, blue, orange or purple).
- **The whole playlist scrolls as one list in Present mode.** Every song, lesson and video is shown one after another. Click an item on the left to jump to it. Next starts that item. The view follows along as slides go live.
- **The playlist shows progress:** finished items get a check mark, the current one is highlighted ("on the TV now"), and the next one says "up next".
- **Bigger Next button** with Back, Clear, Black and Logo underneath.
- After **Clear**, or when a video finishes, Next carries on from where you were instead of starting the playlist over.
- **Settings is split into sections:** Appearance, Lyrics on the TV, TV and sound, Logo, CCLI, Planning Center, Library folder.
- The section tabs for Build mode now sit in the top bar.

## v0.3.0 — songs from Planning Center (November 2026)

- **Import songs from Planning Center:** Songs tab → **⬇ From Planning Center**. Search the whole song bank, click a song to see its SongSelect lyrics, pick the arrangement, and import it. You can also tick several songs and import them all at once.
- Imported songs bring their **lyrics, song order (from the arrangement), authors, copyright and CCLI number**, so the credits slide is filled in automatically.
- **↻ Update from Planning Center** on an imported song pulls the latest lyrics and order (the chosen background stays).
- Song order matching is more forgiving: "Chorus 1" matches a part labeled "Chorus", and parts with no lyrics (like "Instrumental") are skipped.
- Connection is set up once in **Settings → Planning Center**. The access token stays in Chrome on that Mac and is never saved to the library folder.

## v0.2.0 — backgrounds you can see and change live (November 2026)

- **Live background bank in Present mode:** click any background under "Backgrounds" to change what's behind the words right away. It stays for the following slides and songs. A song that was given its own background still switches to it. Click **↺ Song's own** to go back to each song's chosen backgrounds.
- **Picking a song's background** is now a row of pictures in the song editor instead of a drop-down list.
- **Lyrics split by what fits on the TV:** no slide shows more than 4 lines on screen (or whatever "Lines per slide" is set to). A long line that would wrap counts as two lines. Text shrinks a little before a line is split. Extra lines are shared out evenly, so 5 lines become 3 + 2 rather than 4 + 1.
- Clicking a button in Present mode no longer steals the Space/Enter keys from the clicker.

## v0.1.0 — first test version (November 2026)

The first version, for testing at home before using it in the classroom.

- **Present mode:** pick a playlist, click slides or use the arrow keys / clicker, with Black, Clear and Logo buttons and a live preview of the TV.
- **TV window:** opens on the TV automatically (after Chrome's one-time permission), fills the screen with one click, and hides the mouse pointer.
- **Songs:** type or paste lyrics with Verse/Chorus/Bridge labels, set the order, preview the slides, and import `.txt` files from CCLI SongSelect. Song credits and the CCLI license number show on each song's first slide.
- **Motion backgrounds:** import loops, pick a default, and override per song or per playlist item.
- **Lessons:** import slide JPEGs (from files or a whole folder) in the right order, reorder or remove slides.
- **Videos:** import, preview, and play on the TV with sound, with pause, ±10 seconds and restart controls. Fades back to the background when finished.
- **Playlists:** create, date, duplicate, reorder by drag-and-drop.
- **Settings:** font, color, size, all caps, shadow, lines per slide, fade time, CCLI license, logo, TV speaker choice.
- **Safety:** everything is saved automatically to the library folder, with a dated backup of the library list each day it's changed.
