# TabPlayer

A Guitar Pro–style tab viewer and player that runs in your browser. Paste a Songsterr URL and it fetches the tab, converts it to a full score (standard notation + tablature), and plays it back with a synthesizer, or with the original recording from YouTube in sync with the tab. It also opens Guitar Pro, MusicXML and other files, and can save any loaded song as a real Guitar Pro `.gp` file.

Built on [alphaTab](https://alphatab.net) (MPL-2.0) for rendering, playback and file import/export.

## Quick start

```bash
npm install
npm start
# open http://localhost:5173
```

Requires Node.js 18+.

## Features

- **Song search**: type an artist or title in the top box (press `/` to focus it). Pick a result with the mouse or ↑/↓ + Enter, or use the 🎸 / Bass / 🥁 buttons to open that song straight on its most popular guitar, bass or drum track.
- **Songsterr import**: paste a song URL (`https://www.songsterr.com/a/wsa/...-tab-s269t2`) or just the song id. All tracks are imported, and the track in the URL (`t2`) is selected. Pick an older revision from the sidebar.
- **YouTube audio**: for Songsterr songs with synced videos, choose *Audio → YouTube: Original recording* in the bottom bar. The video plays as the audio and the cursor follows it bar by bar (using Songsterr's sync points). Alternative videos, backing tracks and isolated tracks are listed too. Use −/+ in the video panel to nudge the sync. Speed snaps to YouTube's rates; the metronome, count-in and mixer only apply to the synth.
- **Open files**: `.gp`, `.gpx`, `.gp3`–`.gp5`, MusicXML, Capella, alphaTex (button or drag & drop).
- **Save as Guitar Pro (.gp)** and **MIDI**, plus **Print / PDF**.
- **Notation**: tab only (default; tracks without tab such as vocals and drums show standard notation), standard notation + tab, tab with rhythm, score only. Page or horizontal layout, zoom. View settings (notation, layout, zoom, fretboard, multi-track) are remembered for every song and kept in sync across browser tabs.
- **Playback**: play/pause/stop, seek, speed 25–200%, loop a selected range (drag across bars), metronome, count-in, master volume, current bar and section display.
- **Practice**: loop bars by number (type them, or press **A** / **B** to take the current bar). The loop is remembered for each song. The **speed trainer** starts the loop at a set speed and adds a few percent each time it comes round (or every few passes), up to a top speed. It works with synth audio.
- **Themes**: light, dark (including the score), midnight, Nord, forest, Dracula, rosé, sepia, high contrast, or follow the system setting. Pick an accent color, UI size and density; drag the sidebar edge or the fretboard divider to resize.
- **Mixer**: per-track mute / solo / volume and instrument sound (any General MIDI instrument, e.g. swap Overdriven for Distortion Guitar); single or multi-track view.
- **Sounds**: choose the synth soundfont under *Sound*: the small built-in Sonivox, or GeneralUser GS, MuseScore General or FluidR3 Mono. Larger ones are downloaded by the server on first use and cached in `cache/soundfonts/`.
- **Fretboard**: live fretboard showing the notes being played on the selected track.
- **Techniques imported from Songsterr**: bends, whammy bar, slides, hammer-ons/pull-offs, ties, vibrato, dead/ghost notes, harmonics, palm mute, let ring, staccato, accents, dynamics, crescendo, pick and brush strokes, up/down strokes, arpeggios, tremolo picking, trills, tap/slap/pop, sustain pedal, grace notes, tuplets, triplet feel, fermatas, chord names, tempo changes, time and key signatures, section markers, repeats, capo, tuning names, mid-song instrument changes, multiple voices, drums (Guitar Pro 7 articulations).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Esc | Stop |
| L | Toggle loop |
| M | Toggle metronome |
| + / - | Speed ±5% (±25% with YouTube audio) |
| ← / → | Previous / next bar |
| T | Toggle light / dark theme |
| / | Focus the song search |

## How the Songsterr import works

Songsterr does not serve Guitar Pro files. It serves a JSON document per track. The local server (`server.js`) fetches `api/meta/{id}` (or `api/meta/{id}/{revision}`), every track's JSON from Songsterr's CDN, and the YouTube sync points (`api/video-points/{id}/{revision}/list`), which avoids browser CORS limits, and passes them to the browser. `public/songsterr.js` converts them into an alphaTab `Score`. From there it renders, plays, and exports to `.gp` like any other file. Lyrics are not imported.

For YouTube audio, `public/youtube.js` switches alphaTab to its external-media player mode, embeds the video with the YouTube IFrame API, and turns Songsterr's per-bar timestamps into alphaTab sync points (repeats are expanded so each played bar gets its own timestamp).

## Project layout

```
server.js              Express server + Songsterr proxy (song, search, revisions)
public/index.html      UI
public/app.js          Player UI logic (alphaTab API, mixer, fretboard, shortcuts)
public/practice.js     Loop-by-bar and speed-trainer helpers
public/songsterr.js    Songsterr JSON -> alphaTab Score converter, video sync helpers
public/youtube.js      YouTube audio source synced with alphaTab
public/style.css       Styles
test/unit.test.mjs     Offline tests: converter features, sync mapping, server errors
test/convert.test.mjs  Converts real songs, exports .gp, re-imports, checks video sync and revisions
test/e2e.test.mjs      Headless Chrome/Edge test of the full UI
ROADMAP.md             Planned features
```

## Tests

```bash
npm test               # all suites
npm run test:unit      # offline unit tests (no network)
npm run test:convert   # converter + GP7 round-trip + video sync on 6 real songs
npm run test:e2e       # browser test (needs Chrome or Edge; set CHROME_PATH to override)
```

The converter and browser suites need internet access to reach Songsterr (and YouTube for the e2e test).

## Disclaimer

For personal practice use. Tabs fetched from Songsterr are subject to [Songsterr's Terms of Service](https://www.songsterr.com/a/wa/terms) and the rights of the songs' copyright holders. Don't redistribute exported files. Songsterr's endpoints are undocumented and may change without notice.
