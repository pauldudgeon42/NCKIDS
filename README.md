# ★ NC Kids Presenter

A simple presentation app for the kids' classroom on Sunday mornings. It shows **song lyrics over moving backgrounds**, **lesson slides** (the JPEGs from the curriculum download) and **videos with sound**, all on one TV.

It runs in Google Chrome on the classroom Mac. Nothing needs installing and there's no subscription.

---

## Running a Sunday (for volunteers)

1. Open **Google Chrome** and open **NC Kids Presenter** from the bookmarks bar.
2. If you see **Open "NC Kids Library"**, click it.
3. Click **Start TV**. A window opens on the TV. Move the mouse over to the TV and click **"Click here to fill the TV screen"** once.
4. Pick today's playlist at the top left. The whole playlist appears in the middle, one item after another, so you can scroll through everything.
5. Press **Next** (or **→**, **Space** or the clicker) to go forward and **←** to go back. You can also click any slide to put it on the TV, or click an item on the left to jump to it. Next then starts that item.

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

1. Install **Google Chrome** if it isn't there already.
2. Download this project from GitHub (**Code → Download ZIP**, or use the latest release) and put the folder somewhere permanent, e.g. `Documents/NCKIDS`.
3. Open `index.html` in Chrome (drag it onto the Chrome window), then **bookmark it** (⌘D) and show the bookmarks bar.
4. Create an empty folder for the library, ideally in **iCloud Drive** or Dropbox so it's backed up. Name it something like `NC Kids Library`. Then click **Choose library folder…** and pick it. When Chrome asks, choose **Allow on every visit** (or **Allow**).
5. Click **Start TV** with the TV plugged in. Chrome will ask to *manage windows on all your displays*. Click **Allow** so the TV window opens on the TV by itself. If Chrome blocks the pop-up, click the icon in the address bar and choose **Always allow pop-ups**.
6. **Sound:** connect the TV by HDMI and choose the TV in **Control Center → Sound** on the Mac. (Or go to **Build → Settings → TV sound → Find speakers…** and pick the TV there.)
7. Add your church's **CCLI License #** and a **logo** in Build → Settings (the CCLI and Logo sections).
   Present mode is dark and Build mode is light by default. Change either one, and the accent color, in **Settings → Appearance**.
8. **Planning Center (optional):** in Build → Settings → Planning Center, follow the three steps to paste in an access token, then click **Save and test**. Use a Planning Center login made just for the classroom with **Services: Viewer** access only, because the token can see everything its login can. The token is stored only in Chrome on that Mac.

> The library folder is the important part. The app itself can be re-downloaded at any time, but songs, lessons, videos and playlists only live in that folder.

---

## If something goes wrong

- **Nothing on the TV:** check the TV button says *TV is on*. If not, click it. If the TV window ended up on the laptop screen, drag it onto the TV and click "fill the TV screen".
- **Video has no sound on the TV:** Control Center → Sound → choose the TV. Then check Build → Settings → TV sound.
- **"Open library" doesn't appear, or the library is empty:** Build → Settings → *Switch to a different folder…* and pick the library folder again.
- **The playlist list got messed up:** inside the library folder, `backups/` has a dated copy of the list (`library-YYYY-MM-DD.json`). Close the app, copy the copy you want over `library.json`, and reopen.
- **Planning Center says it "couldn't reach Planning Center":** check the internet connection. If the internet works, Planning Center may not be letting this page connect directly. Tell whoever maintains the app (see docs/MAINTAINING.md → Planning Center).
- **A new version of the app broke something:** see "Going back to an older version" below.

## Going back to an older version

Every version that's been used in the classroom is saved as a **Release** on GitHub (v0.1.0, v0.2.0…).

1. On GitHub, open **Releases**, find the last version that worked, and download its **Source code (zip)**.
2. Unzip it and replace the app folder on the Mac with it (same location, so the bookmark still works).
3. Reload Chrome. Your library is untouched, because it lives in its own folder.

---

For the people who maintain the code, see **[docs/MAINTAINING.md](docs/MAINTAINING.md)**. The history of changes is in **[CHANGELOG.md](CHANGELOG.md)**.
