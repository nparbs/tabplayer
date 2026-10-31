# TabPlayer

A Guitar Pro–style tab viewer and player that runs in your browser. Paste a Songsterr URL and it fetches the tab, converts it to a full score (standard notation + tablature), and plays it back with a synthesizer, or with the original recording from YouTube in sync with the tab. It also opens Guitar Pro, MusicXML and other files, and can save any loaded song as a real Guitar Pro `.gp` file.

Built on [alphaTab](https://alphatab.net) (MPL-2.0) for rendering, playback and file import/export.

## Quick start

```bash
npm install
npm start
# open http://localhost:5173
```

The server only listens on this computer. To use it from a phone or another PC, start it with `HOST=0.0.0.0`.

Requires Node.js 22+.

### Desktop app (Windows)

```bash
npm run desktop        # run the desktop app from the source (downloads Electron on first run)
npm run dist           # build the Windows installer: dist/TabPlayer Setup <version>.exe
```

The desktop app runs the same server inside Electron, so nothing else needs to be started. The installer registers TabPlayer for `.gp`, `.gpx`, `.gp3`–`.gp8`, `.musicxml` and `.mxl` files: double-click one in Explorer (or use File > Open, Ctrl+O) and it opens in a new tab. Downloaded soundfonts are kept in `%APPDATA%\TabPlayer\soundfonts`. The installer is not code-signed, so Windows SmartScreen asks for confirmation the first time.

### Offline / installable web app

Open TabPlayer in Chrome or Edge and click **⬇ Install** in the top bar (or the install icon in the address bar). The service worker caches the app, the player, the built-in soundfont and every song you open, so it starts and plays without the server or a connection: saved songs, recently opened songs and files all work offline; search and new Songsterr songs need the server and a connection. The installed app also opens Guitar Pro and MusicXML files from the system's "Open with" menu.

## Features

- **Song search**: type an artist or title in the top box (press `/` to focus it). Pick a result with the mouse or ↑/↓ + Enter, or use the 🎸 / Bass / 🥁 buttons to open that song straight on its most popular guitar, bass or drum track.
- **Songsterr import**: paste a song URL (`https://www.songsterr.com/a/wsa/...-tab-s269t2`) or just the song id. All tracks are imported, and the track in the URL (`t2`) is selected. Pick an older revision from the sidebar.
- **Your own YouTube video**: pick *Audio → Your own YouTube video…*, paste any link (works for opened files too), play it and press **⏱ Song starts now** when the first bar begins. The tab follows using its own tempo; use −/+ to fine-tune. Remembered per song. Best with recordings that keep the tab's tempo, such as lessons and backing tracks.
- **YouTube audio**: for Songsterr songs with synced videos, choose *Audio → YouTube: Original recording* in the bottom bar. The video plays as the audio and the cursor follows it bar by bar (using Songsterr's sync points). Alternative videos, backing tracks and isolated tracks are listed too. Use −/+ in the video panel to nudge the sync. Speed snaps to YouTube's rates; the metronome, count-in and mixer only apply to the synth.
- **Tabs**: keep several songs open at once in tabs above the score. A song you open from search, a link or a file goes into a new tab (or the current one if it is empty). Each tab keeps its own tracks, position and mixer. Middle-click or × closes a tab, `[` / `]` switch tabs. Open tabs come back when you reload the page; only the one you are looking at is loaded straight away. Unsaved edits come back too, until you save the `.gp` or close the tab.
- **Library**: the 📚 *Library* menu (or `B`) lists **Favourites** (star a song with ☆ in the sidebar or `F`), **Saved** songs and **Recent** songs (the last 30). **Save** keeps a copy of the song in the browser (IndexedDB), so it opens without an internet connection, and is used automatically if Songsterr can't be reached. Opened files are kept too, so they can be reopened from the library. Favourites and recent songs are also shown on the welcome screen.
- **Editing**: press **✏️ Edit** (or `E`) to edit the tab, Guitar Pro style. Click a note (or move with the arrow keys) and type fret numbers; change note lengths, dots and triplets; add techniques (hammer-on/pull-off, slide, bend, vibrato, palm mute, let ring, dead and ghost notes, accent, staccato, natural harmonic, tie); insert and delete beats and bars; copy and paste bars; set tempo, time signature, key signature, repeats and section markers per bar; add guitar or bass tracks, rename and retune tracks, or remove them. Undo / redo covers everything. Edited tabs show a dot; **Save .gp** (Ctrl+S) saves the result as a Guitar Pro file.
- **Open files**: `.gp`, `.gpx`, `.gp3`–`.gp5`, MusicXML, Capella, alphaTex (button or drag & drop).
- **Save as Guitar Pro (.gp)**, **MIDI** and **WAV** (the synth audio with your mixer settings; only the looped bars while a loop is on), plus **Print / PDF**.
- **Notation**: tab only (default; tracks without tab such as vocals and drums show standard notation), standard notation + tab, tab with rhythm, score only. Page or horizontal layout, zoom. View settings (notation, layout, zoom, fretboard, multi-track) are remembered for every song and kept in sync across browser tabs.
- **Playback**: play/pause/stop, seek, speed 25–200%, loop a selected range (drag across bars), master volume, current bar and section display.
- **Metronome and count-in**: the synth's classic click, or woodblock, click, beep or cowbell with an accented first beat and its own volume. The count-in is one or two bars of the current time signature and tempo, and also works with YouTube audio.
- **Transpose and capo**: transpose any track (or the whole song under *Sound*) by up to an octave either way. Playback and standard notation follow; the tab stays as written. Set or change the capo per guitar track; playback and the fretboard follow it.
- **Chord diagrams**: the *Chords* panel shows every chord in the selected track with a fingering diagram (from the file when it has one, otherwise a suggested shape for standard-shaped tunings, including slash chords). The chord being played is highlighted; click one to jump to where it is played next.
- **Practice**: loop bars by number (type them, or press **A** / **B** to take the current bar). The loop is remembered for each song. The **speed trainer** starts the loop at a set speed and adds a few percent each time it comes round (or every few passes), up to a top speed. It works with synth audio.
- **Themes**: light, dark (including the score), midnight, Nord, forest, Dracula, rosé, sepia, high contrast, or follow the system setting. Pick an accent color, UI size and density; drag the sidebar edge or the fretboard divider to resize.
- **Mixer**: per-track mute / solo / volume. Press **⚙ Modify** by the Tracks heading for each track's instrument sound, transpose and capo (and the song-wide transpose); changes stay listed on the track card when it's off. Instrument sound (any General MIDI instrument, e.g. swap Overdriven for Distortion Guitar); single or multi-track view.
- **Sounds**: choose the synth soundfont under *Sound*: the small built-in Sonivox, or GeneralUser GS, MuseScore General or FluidR3 Mono. Larger ones are downloaded by the server on first use and cached in `cache/soundfonts/`.
- **Fretboard and piano**: a live fretboard (stringed tracks) or piano keyboard (anything else, or by choice) shows the notes being played on the selected track. Options: note names instead of fret numbers, a map of every note on the neck, and a left-handed fretboard.
- **Techniques imported from Songsterr**: bends, whammy bar, slides, hammer-ons/pull-offs, ties, vibrato, dead/ghost notes, harmonics, palm mute, let ring, staccato, accents, dynamics, crescendo, pick and brush strokes, up/down strokes, arpeggios, tremolo picking, trills, tap/slap/pop, sustain pedal, grace notes, tuplets, triplet feel, fermatas, chord names, tempo changes, time and key signatures, section markers, repeats, capo, tuning names, mid-song instrument changes, multiple voices, drums (Guitar Pro 7 articulations).

### Keyboard shortcuts

While editing (✏️ Edit or `E`): `0`–`9` fret (two digits quickly for 10+), ←/→ beat, ↑/↓ string, Ctrl+←/→ bar, Home/End, `Del` clear note, `Shift+Del` / `Ctrl+Del` delete beat, `Insert` / `I` insert beat, `Ctrl+Insert` insert bar, `Ctrl+Shift+Del` delete bar, `+`/`-` longer / shorter, `.` dot, `U` triplet, `R` rest, `H` `S` `B` `V` `P` `L` `X` `G` `A` `K` `N` `T` techniques (hover the buttons for names), Ctrl+Z / Ctrl+Y undo / redo, Ctrl+C / Ctrl+V copy / paste a bar, Ctrl+S save .gp, Esc stop editing. Space still plays.


| Key | Action |
| --- | --- |
| Space | Play / pause |
| Esc | Stop |
| L | Toggle loop |
| M | Toggle metronome |
| C | Toggle count-in |
| + / - | Speed ±5% (±25% with YouTube audio) |
| ← / → | Previous / next bar |
| T | Toggle light / dark theme |
| E | Edit the tab |
| / | Focus the song search |
| F | Add / remove the current song from favourites |
| B | Open the library |
| [ / ] | Previous / next tab |
| Alt+W | Close the current tab |

## How the Songsterr import works

Songsterr does not serve Guitar Pro files. It serves a JSON document per track. The local server (`server.js`) fetches `api/meta/{id}` (or `api/meta/{id}/{revision}`), every track's JSON from Songsterr's CDN, and the YouTube sync points (`api/video-points/{id}/{revision}/list`), which avoids browser CORS limits, and passes them to the browser. `public/songsterr.js` converts them into an alphaTab `Score`. From there it renders, plays, and exports to `.gp` like any other file. Lyrics are not imported.

For YouTube audio, `public/youtube.js` switches alphaTab to its external-media player mode, embeds the video with the YouTube IFrame API, and turns Songsterr's per-bar timestamps into alphaTab sync points (repeats are expanded so each played bar gets its own timestamp).

## Project layout

```
server.js              Express server + Songsterr proxy (song, search, revisions)
public/index.html      UI
public/app.js          Player UI logic (alphaTab API, mixer, fretboard, shortcuts)
public/practice.js     Loop-by-bar and speed-trainer helpers
public/library.js      Favourites / saved / recent songs (IndexedDB) and open-tab storage
public/chords.js       Chord-name parser, fingering library and SVG chord diagrams
public/audio.js        Metronome / count-in clicks (Web Audio) and WAV encoding
public/editor.js       Edit operations on the alphaTab score model (notes, rhythm, bars, tracks, undo helpers)
public/sw.js           Service worker: offline caching of the app, alphaTab, soundfonts and songs
public/manifest.webmanifest  Installable web app manifest (icons, file handlers)
electron/              Desktop app: main process (server, window, file associations) and preload bridge
scripts/               Icon generator (from public/icon.svg) and the desktop dev launcher
public/songsterr.js    Songsterr JSON -> alphaTab Score converter, video sync helpers
public/youtube.js      YouTube audio source synced with alphaTab
public/style.css       Styles
test/unit.test.mjs     Offline tests: converter features, sync mapping, server errors
test/convert.test.mjs  Converts real songs, exports .gp, re-imports, checks video sync and revisions
test/e2e.test.mjs      Headless Chrome/Edge test of the full UI
ROADMAP.md             Planned features
.github/workflows/     CI: unit tests on every push; converter + browser tests as a non-blocking job
```

## Tests

```bash
npm test               # all suites
npm run test:unit      # offline unit tests (no network)
npm run test:convert   # converter + GP7 round-trip + video sync on 6 real songs
npm run test:e2e       # browser test (needs Chrome or Edge; set CHROME_PATH to override)
npm run test:desktop   # desktop app smoke test (starts Electron with a .gp file)
```

The converter and browser suites need internet access to reach Songsterr (and YouTube for the e2e test).

## Disclaimer

For personal practice use. Tabs fetched from Songsterr are subject to [Songsterr's Terms of Service](https://www.songsterr.com/a/wa/terms) and the rights of the songs' copyright holders. Don't redistribute exported files. Songsterr's endpoints are undocumented and may change without notice.
