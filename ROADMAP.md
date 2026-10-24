# Roadmap

The goal is to get as close to Guitar Pro as practical in a browser app. Status: ✅ done · 🚧 partial · ⬜ planned

## v0.1: Viewer and player

- ✅ Songsterr URL / id import (all tracks, selected track from URL)
- ✅ Open GP3–GP8, GPX, MusicXML, Capella, alphaTex
- ✅ Export Guitar Pro 7 `.gp`, MIDI, print / PDF
- ✅ Standard notation + tab, tab-only, score-only, page / horizontal layout, zoom
- ✅ Playback: speed, seek, loop selection, metronome, count-in, master volume
- ✅ Per-track mute / solo / volume, multi-track view
- ✅ Live fretboard
- ✅ Keyboard shortcuts
- ✅ Converter + browser test suites

## v0.2: Import fidelity, YouTube audio, themes

- ✅ Repeats from Songsterr (`repeatStart` / `repeat` on any track; verified against video sync points)
- 🚧 Alternate endings: mapped if present, but no Songsterr song using them has been found to verify
- ✅ Mid-song instrument changes (`trackSoundAutomations` → program changes)
- ✅ Tremolo picking, sustain pedal, up/down strokes and arpeggios (plus tap/slap/pop, trills, triplet feel, fermatas)
- ✅ Capo (applied to playback and fretboard) and alternate-tuning names
- ✅ Guitar and bass displayed an octave up (standard notation for fretted instruments)
- ✅ Drum articulation mapping verified: Songsterr uses Guitar Pro 7 articulation ids (e.g. 91 rim shot, 92 half-open hi-hat, 93 ride edge)
- ✅ Pick an older Songsterr revision
- ✅ Better error messages for restricted, rejected or removed songs
- ✅ Play the original recording from YouTube in sync with the tab (Songsterr video sync points), with sync offset nudge
- ✅ Themes: light, dark (dark score paper), midnight, sepia, high contrast, follow system
- ✅ Song search (Songsterr catalogue) with keyboard navigation and open-on-instrument buttons
- ✅ UI: welcome screen with sample songs, bar/section readout, ←/→ bar navigation, collapsible sidebar, phone layout

## v0.3: Practice tools (Guitar Pro "Speed Trainer" and more)

- ✅ Speed trainer: loop that increases tempo by N% each pass (or every N passes) up to a top speed
- ✅ A/B loop markers by bar number, saved per song
- ✅ Count-in length (1–2 bars, works with YouTube audio) and metronome sounds with an accented first beat
- ✅ Per-track and whole-song transpose, and per-track capo for playback
- ✅ Chord diagrams panel (file fingerings, or suggested shapes from chord names), highlights the current chord
- ✅ Piano keyboard view (automatic for non-stringed tracks, or by choice)
- ✅ Left-handed fretboard, note names, and a whole-neck note-name map
- ✅ Recently opened songs, favourites and saved (offline) songs, in IndexedDB
- ✅ Several songs open at once in tabs, restored on reload
- ✅ Export audio (WAV) via alphaTab's audio exporter, with the mixer applied; exports the loop when looping

## v0.4: Editing

Guitar Pro is an editor. alphaTab is a renderer/player, so `public/editor.js` edits a copy of alphaTab's score model and the app rebuilds it through alphaTab's JSON form (which recomputes indexes, ties and timing) before re-rendering.

- ✅ Select a note/beat (click or arrow keys); keyboard entry of fret numbers on a string
- ✅ Change durations, dots, triplets; insert/delete beats and bars
- ✅ Toggle techniques (bend, slide, HO/PO, PM, vibrato, harmonics, let ring, dead/ghost notes, accent, staccato, ties)
- ✅ Edit time/key signature, tempo, sections, repeats
- ✅ Add/remove tracks, rename, change instrument (sound) and tuning
- ✅ Undo / redo (bar snapshots for note edits, whole-score snapshots for structural edits)
- ✅ Copy / paste bars
- ✅ Save edits back to `.gp`
- ⬜ Edit a second voice, and pitch entry for non-tab tracks (piano, vocals) and drums
- ⬜ Multi-bar selection for copy / paste / delete; other tuplets (5, 6, 7…); custom bends and slides in/out
- ⬜ Alternate endings and Da Capo / Coda directions
- ⬜ Keep unsaved edits across a page reload

## v0.5: Packaging (current)

- ✅ Desktop app (Electron, Windows installer) with the server built in and file associations for `.gp*`, MusicXML
- ✅ Installable PWA: offline cache of the app, player, soundfonts and opened songs; opens files from the OS
- ⬜ Code-signed installer and auto-update
- ⬜ macOS and Linux desktop builds
- ✅ Better soundfont option (larger GM bank, downloadable)
- ✅ Per-track instrument override
- ✅ CI: unit tests on GitHub Actions for every push; converter and e2e tests as a non-blocking job (they need Songsterr and YouTube)
- ✅ YouTube audio for any song, including opened files (custom video link, "Song starts now" sync, nudge)
- ⬜ Per-bar manual sync for recordings that drift from the tab's tempo (tap along to set bar times)

## Known limitations

- Songsterr's API is undocumented. Format changes may break import; the converter test will catch this.
- Lyrics are intentionally not imported.
- No editing yet (see v0.4).
