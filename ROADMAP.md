# Roadmap

The goal is to get as close to Guitar Pro as practical in a browser app. Status: ✅ done · 🚧 partial · ⬜ planned

## v0.1: Viewer and player (current)

- ✅ Songsterr URL / id import (all tracks, selected track from URL)
- ✅ Open GP3–GP8, GPX, MusicXML, Capella, alphaTex
- ✅ Export Guitar Pro 7 `.gp`, MIDI, print / PDF
- ✅ Standard notation + tab, tab-only, score-only, page / horizontal layout, zoom
- ✅ Playback: speed, seek, loop selection, metronome, count-in, master volume
- ✅ Per-track mute / solo / volume, multi-track view
- ✅ Live fretboard
- ✅ Keyboard shortcuts
- ✅ Converter + browser test suites

## v0.2: Import fidelity

- ⬜ Repeats and alternate endings from Songsterr (if present in the data; currently mapped defensively)
- ⬜ Mid-song instrument changes (`trackSoundAutomations`)
- ⬜ Tremolo picking, sustain pedal, up-strokes
- ⬜ Capo and alternate-tuning names
- ⬜ Bass displayed an octave up (standard bass notation)
- ⬜ Drum articulation mapping verified against Songsterr's drum kit
- ⬜ Pick an older Songsterr revision
- ⬜ Better error messages for restricted or removed songs

## v0.3: Practice tools (Guitar Pro "Speed Trainer" and more)

- ⬜ Speed trainer: loop that increases tempo by N% each pass
- ⬜ A/B loop markers by bar number, saved per song
- ⬜ Count-in length and metronome sound options
- ⬜ Per-track transpose, and capo for playback
- ⬜ Chord diagrams panel
- ⬜ Piano keyboard view (alongside the fretboard)
- ⬜ Left-handed fretboard and a fretboard note-name overlay
- ⬜ Recently opened songs and favourites (local storage)
- ⬜ Export audio (WAV) via alphaTab's audio exporter

## v0.4: Editing (the big one)

Guitar Pro is an editor. alphaTab is a renderer/player, so editing needs our own model layer on top of it.

- ⬜ Select a note/beat; keyboard entry of fret numbers on a string
- ⬜ Change durations, dots, tuplets; insert/delete beats and bars
- ⬜ Toggle techniques (bend, slide, HO/PO, PM, vibrato, harmonics…)
- ⬜ Edit time/key signature, tempo, sections, repeats
- ⬜ Add/remove tracks, change instrument and tuning
- ⬜ Undo / redo
- ⬜ Copy / paste bars
- ⬜ Save edits back to `.gp`

## v0.5: Packaging

- ⬜ Desktop app (Electron or Tauri) with native file associations for `.gp*`
- ⬜ Installable PWA with offline cache of opened songs
- ⬜ Better soundfont option (larger GM bank, downloadable)
- ⬜ CI: run converter and e2e tests on GitHub Actions

## Known limitations

- Songsterr's API is undocumented. Format changes may break import; the converter test will catch this.
- Lyrics are intentionally not imported.
- No editing yet (see v0.4).
