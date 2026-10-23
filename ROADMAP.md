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

## v0.2: Import fidelity, YouTube audio, themes (current)

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
- ✅ Better soundfont option (larger GM bank, downloadable)
- ✅ Per-track instrument override
- ⬜ CI: run unit, converter and e2e tests on GitHub Actions
- ⬜ YouTube audio for files opened locally (custom video URL + manual sync)

## Known limitations

- Songsterr's API is undocumented. Format changes may break import; the converter test will catch this.
- Lyrics are intentionally not imported.
- No editing yet (see v0.4).
