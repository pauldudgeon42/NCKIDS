# ★ NC Kids Presenter

A simple presentation app for the kids' classroom on Sunday mornings. It shows **song lyrics over moving backgrounds**, **lesson slides** (the JPEGs from the curriculum download) and **videos with sound**, all on one TV.

It runs in Google Chrome on the classroom Mac. Nothing needs installing and there's no subscription.

---

## Running a Sunday (for volunteers)

1. Open **Google Chrome** and open **NC Kids Presenter** from the bookmarks bar.
2. If you see **Open "NC Kids Library"**, click it.
3. Click **📺 Start TV**. A window opens on the TV. Move the mouse over to the TV and click **"Click here to fill the TV screen"** once.
4. Pick today's playlist at the top left.
5. Press **→** or **Space** (or the clicker) to go forward and **←** to go back. You can also click any slide to put it on the TV.

| Key | What it does |
|---|---|
| → / Space / clicker | Next slide (moves on to the next song or lesson automatically) |
| ← | Previous slide |
| **C** | Clear: removes words, slides or video but keeps the moving background |
| **B** | Black screen (press again to bring it back) |
| **L** | Show the logo |
| **P** | Pause or play a video |

The box marked **On the TV now** always shows exactly what the kids are seeing.

When a video finishes, the screen fades back to the moving background on its own.

---

## Getting ready for a lesson (for the person who preps)

Everything happens in **Build** mode.

**Motion backgrounds:** Backgrounds tab → **Import backgrounds…** (or drag files from Finder). Click **Make default** on the one you use most.

**Songs:** Songs tab → **+ New song**, then paste the lyrics with a label line before each part:

```
Verse 1
Jesus loves me, this I know
For the Bible tells me so

Chorus
Yes, Jesus loves me
```

A blank line inside a part starts a new slide. Long parts are split automatically (Settings → Lines per slide). Use **Order** to repeat parts, e.g. `V1 C V2 C`.
If you download lyrics from **CCLI SongSelect** as a `.txt` file, use **Import .txt**. The title, authors and CCLI number fill in automatically.

**Lesson slides:** Lessons tab → **+ From a folder…** and choose the lesson's JPEG folder from the curriculum download. The slides come in order (Slide 2 before Slide 10). You can also pick individual pictures, or drag them in from Finder.

**Videos:** Videos tab → **Import videos…**. MP4 works best. If a video won't import, it's in a format Chrome can't play. Open it in QuickTime and use *File → Export As → 1080p* to fix it.

**Playlist:** Playlists tab → **+ New**, set the date, then click **+** next to items on the right (or drag them in). Drag to reorder. **Duplicate** last week's playlist to save time.

---

## First-time setup on the classroom Mac

1. Install **Google Chrome** if it isn't there already.
2. Download this project from GitHub (**Code → Download ZIP**, or use the latest release) and put the folder somewhere permanent, e.g. `Documents/NCKIDS`.
3. Open `index.html` in Chrome (drag it onto the Chrome window), then **bookmark it** (⌘D) and show the bookmarks bar.
4. Create an empty folder for the library, ideally in **iCloud Drive** or Dropbox so it's backed up. Name it something like `NC Kids Library`. Then click **Choose library folder…** and pick it. When Chrome asks, choose **Allow on every visit** (or **Allow**).
5. Click **📺 Start TV** with the TV plugged in. Chrome will ask to *manage windows on all your displays*. Click **Allow** so the TV window opens on the TV by itself. If Chrome blocks the pop-up, click the icon in the address bar and choose **Always allow pop-ups**.
6. **Sound:** connect the TV by HDMI and choose the TV in **Control Center → Sound** on the Mac. (Or go to **Build → Settings → TV sound → Find speakers…** and pick the TV there.)
7. Add your church's **CCLI License #** and a **logo** in Build → Settings.

> The library folder is the important part. The app itself can be re-downloaded at any time, but songs, lessons, videos and playlists only live in that folder.

---

## If something goes wrong

- **Nothing on the TV:** check the TV button says *TV is on*. If not, click it. If the TV window ended up on the laptop screen, drag it onto the TV and click "fill the TV screen".
- **Video has no sound on the TV:** Control Center → Sound → choose the TV. Then check Build → Settings → TV sound.
- **"Open library" doesn't appear, or the library is empty:** Build → Settings → *Switch to a different folder…* and pick the library folder again.
- **The playlist list got messed up:** inside the library folder, `backups/` has a dated copy of the list (`library-YYYY-MM-DD.json`). Close the app, copy the copy you want over `library.json`, and reopen.
- **A new version of the app broke something:** see "Going back to an older version" below.

## Going back to an older version

Every version that's been used in the classroom is saved as a **Release** on GitHub (v0.1.0, v0.2.0…).

1. On GitHub, open **Releases**, find the last version that worked, and download its **Source code (zip)**.
2. Unzip it and replace the app folder on the Mac with it (same location, so the bookmark still works).
3. Reload Chrome. Your library is untouched, because it lives in its own folder.

---

For the people who maintain the code, see **[docs/MAINTAINING.md](docs/MAINTAINING.md)**. The history of changes is in **[CHANGELOG.md](CHANGELOG.md)**.
