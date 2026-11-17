# ★ NC Kids Presenter

A simple presentation app for the kids' classroom on Sunday mornings. It shows **song lyrics over moving backgrounds**, **lesson slides** (the JPEGs from the curriculum download) and **videos with sound**, all on one TV.

It's a **Mac app** (and can also run in Google Chrome for testing). There's no subscription.

---

## Running a Sunday (for volunteers)

1. Open **NC Kids Presenter** from the Dock.
2. Click **Start TV**. The TV shows the presentation full screen by itself.
3. Pick today's playlist at the top left. The whole playlist appears in the middle, one item after another, so you can scroll through everything.
4. Press **Next** (or **→**, **Space** or the clicker) to go forward and **←** to go back. You can also click any slide to put it on the TV, or click an item on the left to jump to it. Next then starts that item.

| Key | What it does |
|---|---|
| → / Space / clicker | Next slide (moves on to the next song or lesson automatically) |
| ← | Previous slide |
| **C** | Clear: removes words, slides or video but keeps the moving background |
| **B** | Black screen (press again to bring it back) |
| **L** | Show the logo |
| **P** | Pause or play a video |

The box marked **On the TV** always shows exactly what the kids are seeing. On the left, finished items get a check mark, the current item is highlighted, and the next one says "up next".

**Timers:** under **Timers** on the right, click one (Cleanup time, Game time…) and the countdown appears big on the TV over the background. Pause, add a minute, restart or stop it from the box that appears. At zero the TV shows "Time's up!" with a soft chime. Use **Custom** for any other length. Timers can also go in a playlist like a song. "Class starts soon" moves on to the next item by itself when it reaches zero. Change the timers in Build → Settings → Timers.

**Changing the background live:** click any picture under **Backgrounds** (right side) and it fades in behind the words straight away, staying for the next songs too. Songs that were given their own background still use it. Click **↺ Song's own** to go back to normal.

When a video finishes, the screen fades back to the moving background on its own.

---

## Getting ready for a lesson (for the person who preps)

Everything happens in **Build** mode.

**Motion backgrounds:** Backgrounds tab → **Import backgrounds…** (or drag files from Finder). Click **Make default** on the one you use most.

**Songs:** Songs tab → **New song**, then paste the lyrics into the **Lyrics** view with a label line before each part:

```
Verse 1
Jesus loves me, this I know
For the Bible tells me so

Chorus
Yes, Jesus loves me
```

You can paste straight from a chord chart or lyrics website. Chords, CCLI lines and notes like "(Instrumental)" are removed, and "(x2)" repeats are written out. A note says what changed, with **Undo**.

Switch to the **Slides** view to see the song as slides. Hover between two lines and click **Split here** to start a new slide, or click **Merge** between two slides to join them. Click any words to fix them.

On the right:
- **Song order:** drag the colored chips to reorder, click × to remove a part (for example a verse you skip with the kids), or click "+ Chorus" to add one.
- **Look for this song:** change the lines per slide, text size, text position (centered or lower third), all caps or the background for just this song. Tick **Use Settings defaults** to undo.

If you download lyrics from **CCLI SongSelect** as a `.txt` file, use **Import .txt**. The title, authors and CCLI number fill in automatically.

**Songs from Planning Center (easiest):** Songs tab → **⬇ From Planning Center**. Type part of the title, click the song to check the lyrics and choose the arrangement, then **Import this song**. Or tick several songs and click **Import ticked songs**. The lyrics, song order and CCLI details all come across. If the song changes in Planning Center later, open it and click **↻ Update from Planning Center**.

**Lesson slides:** Lessons tab → **+ From a folder…** and choose the lesson's JPEG folder from the curriculum download. The slides come in order (Slide 2 before Slide 10). You can also pick individual pictures, or drag them in from Finder.

**Videos:** Videos tab → **Import videos…**. MP4 works best. If a video won't import, it's in a format Chrome can't play. Open it in QuickTime and use *File → Export As → 1080p* to fix it.

**Playlist:** Playlists tab → **+ New**, set the date, then click **+** next to items on the right (or drag them in). Drag to reorder. **Duplicate** last week's playlist to save time.

---

## First-time setup on the classroom Mac

1. **Download the app.** On GitHub, open **Releases**, pick the newest version, and download `NC-Kids-Presenter-…-mac.dmg`. (Every build is also under **Actions** → the latest "Mac app" run → **Artifacts**.)
2. Open the `.dmg` and drag **NC Kids Presenter** into **Applications**.
3. **The first time only:** open it from Applications. macOS will say it can't check the app for malicious software, because the church hasn't paid for an Apple developer certificate. Click **Done**, then go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to NC Kids Presenter. From then on it opens normally. Right-click the Dock icon → Options → **Keep in Dock**.
4. **Choose the library folder.** Make an empty folder, ideally in **iCloud Drive** or Dropbox so it's backed up (e.g. `NC Kids Library`), and pick it when the app asks. If you were already using the browser version, pick the same folder: everything is already there.
5. Plug in the TV and click **Start TV**: the presentation fills the TV by itself. If the TV is plugged in after, the TV window moves onto it on its own.
6. **Sound:** choose the TV in **Control Center → Sound** on the Mac, or in the app under **Build → Settings → TV and sound → Find speakers…**. The first time, macOS asks about the microphone; that's only how the app learns speaker names. Nothing is recorded.
7. Add your church's **CCLI License #** and a **logo** in Build → Settings (the CCLI and Logo sections).
   Present mode is dark and Build mode is light by default; change either, and the accent color, in **Settings → Appearance**.
8. **Planning Center:** in Build → Settings → Planning Center, paste the access token from the NCKids Classroom login, then **Save and test**. In the Mac app the token is encrypted with the Mac Keychain.

> The library folder is the important part. The app can be re-downloaded at any time, but songs, lessons, videos and playlists only live in that folder.

**Running it in Chrome instead (for testing):** download the project, open `index.html` in Google Chrome, and choose the library folder. Everything works except the Planning Center import (Planning Center doesn't allow browser pages to connect), and the TV window needs one click to fill the screen.

## If something goes wrong

- **Nothing on the TV:** check the TV button says *TV is on*. If not, click it. If the TV window ended up on the laptop screen, check the TV is plugged in, then close and start the TV again.
- **"NC Kids Presenter is damaged" or "can't be opened":** see First-time setup, step 3 (Open Anyway). If it still won't open, download it again from Releases.
- **Video has no sound on the TV:** Control Center → Sound → choose the TV. Then check Build → Settings → TV sound.
- **"Open library" doesn't appear, or the library is empty:** Build → Settings → *Switch to a different folder…* and pick the library folder again.
- **The playlist list got messed up:** inside the library folder, `backups/` has a dated copy of the list (`library-YYYY-MM-DD.json`). Close the app, copy the copy you want over `library.json`, and reopen.
- **Planning Center says it "couldn't reach Planning Center":** check the internet connection. In the Chrome version this is expected (see above); use the Mac app.
- **A new version of the app broke something:** see "Going back to an older version" below.

## Going back to an older version

Every version is saved as a **Release** on GitHub (v1.0.0, v1.1.0…), each with its own Mac installer.

1. On GitHub, open **Releases**, find the last version that worked, and download its `.dmg`.
2. Quit the app, drag the older NC Kids Presenter into Applications (replace the current one), and open it.
3. Your library is untouched, because it lives in its own folder.

---

For the people who maintain the code, see **[docs/MAINTAINING.md](docs/MAINTAINING.md)**. The history of changes is in **[CHANGELOG.md](CHANGELOG.md)**.
