# TabPlayer

A Guitar Pro–style tab viewer and player that runs in your browser. Paste a Songsterr URL and it fetches the tab, converts it to a full score (standard notation + tablature), and plays it back with a synthesizer. It also opens Guitar Pro, MusicXML and other files, and can save any loaded song as a real Guitar Pro `.gp` file.

Built on [alphaTab](https://alphatab.net) (MPL-2.0) for rendering, playback and file import/export.

## Quick start

```bash
npm install
npm start
# open http://localhost:5173
```

Requires Node.js 18+.

## Features

- **Songsterr import**: paste a song URL (`https://www.songsterr.com/a/wsa/...-tab-s269t2`) or just the song id. All tracks are imported, and the track in the URL (`t2`) is selected.
- **Open files**: `.gp`, `.gpx`, `.gp3`–`.gp5`, MusicXML, Capella, alphaTex (button or drag & drop).
- **Save as Guitar Pro (.gp)** and **MIDI**, plus **Print / PDF**.
- **Notation**: standard notation + tab, tab only, tab with rhythm, score only. Page or horizontal layout, zoom.
- **Playback**: play/pause/stop, seek, speed 25–200%, loop a selected range (drag across bars), metronome, count-in, master volume.
- **Mixer**: per-track mute / solo / volume; single or multi-track view.
- **Fretboard**: live fretboard showing the notes being played on the selected track.
- **Techniques imported from Songsterr**: bends, whammy bar, slides, hammer-ons/pull-offs, ties, vibrato, dead/ghost notes, harmonics, palm mute, let ring, staccato, accents, dynamics, crescendo, pick and brush strokes, grace notes, tuplets, chord names, tempo changes, time and key signatures, section markers, multiple voices, drums.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Esc | Stop |
| L | Toggle loop |
| M | Toggle metronome |
| + / - | Speed ±5% |

## How the Songsterr import works

Songsterr does not serve Guitar Pro files. It serves a JSON document per track. The local server (`server.js`) fetches `api/meta/{id}` and every track's JSON from Songsterr's CDN, which avoids browser CORS limits, and passes them to the browser. `public/songsterr.js` converts them into an alphaTab `Score`. From there it renders, plays, and exports to `.gp` like any other file. Lyrics are not imported.

## Project layout

```
server.js              Express server + /api/songsterr proxy
public/index.html      UI
public/app.js          Player UI logic (alphaTab API, mixer, fretboard, shortcuts)
public/songsterr.js    Songsterr JSON -> alphaTab Score converter
public/style.css       Styles
test/convert.test.mjs  Converts real songs, exports .gp, re-imports and compares
test/e2e.test.mjs      Headless Chrome/Edge test of the full UI
ROADMAP.md             Planned features
```

## Tests

```bash
npm test               # both suites
npm run test:convert   # converter + GP7 round-trip on 4 real songs
npm run test:e2e       # browser test (needs Chrome or Edge; set CHROME_PATH to override)
```

Both suites need internet access to reach Songsterr.

## Disclaimer

For personal practice use. Tabs fetched from Songsterr are subject to [Songsterr's Terms of Service](https://www.songsterr.com/a/wa/terms) and the rights of the songs' copyright holders. Don't redistribute exported files. Songsterr's endpoints are undocumented and may change without notice.
