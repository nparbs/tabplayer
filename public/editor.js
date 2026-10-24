// Editing: operations on the alphaTab score model, used by the edit mode in app.js.
// alphaTab renders and plays but doesn't edit, so each edit mutates a working copy of the score;
// app.js then rebuilds it through alphaTab's JSON form, which recomputes indexes, ties and timing.
//
// A selection is { track, staff, bar, beat, string } (indexes; voice 1 only). `string` uses alphaTab's
// numbering, 1 = the lowest string. Operations return the new selection, or null when nothing changed.

export const DURATIONS = [1, 2, 4, 8, 16, 32, 64]; // whole .. sixty-fourth
export const MAX_FRET = 30;

/** Note techniques that can be toggled on the selected note. */
export function techniques(at) {
  const M = at.model;
  const flag = prop => ({ get: n => !!n[prop], set: (n, on) => { n[prop] = on; } });
  return {
    hammer: { label: 'Hammer-on / pull-off', short: 'H', key: 'h', ...flag('isHammerPullOrigin') },
    slide: {
      label: 'Slide', short: 'S', key: 's',
      get: n => n.slideOutType !== M.SlideOutType.None,
      set: (n, on) => { n.slideOutType = on ? M.SlideOutType.Shift : M.SlideOutType.None; },
    },
    bend: {
      label: 'Full bend', short: 'B', key: 'b',
      get: n => n.bendType !== M.BendType.None && !!n.bendPoints?.length,
      set: (n, on) => {
        n.bendPoints = [];
        n.bendType = on ? M.BendType.Bend : M.BendType.None;
        if (on) for (const [offset, value] of [[0, 0], [15, 4], [60, 4]]) n.addBendPoint(new M.BendPoint(offset, value));
      },
    },
    vibrato: {
      label: 'Vibrato', short: '~', key: 'v',
      get: n => n.vibrato !== M.VibratoType.None,
      set: (n, on) => { n.vibrato = on ? M.VibratoType.Slight : M.VibratoType.None; },
    },
    palmMute: { label: 'Palm mute', short: 'PM', key: 'p', ...flag('isPalmMute') },
    letRing: { label: 'Let ring', short: 'LR', key: 'l', ...flag('isLetRing') },
    dead: { label: 'Dead note', short: 'X', key: 'x', ...flag('isDead') },
    ghost: { label: 'Ghost note', short: '( )', key: 'g', ...flag('isGhost') },
    accent: {
      label: 'Accent', short: '>', key: 'a',
      get: n => n.accentuated !== M.AccentuationType.None,
      set: (n, on) => { n.accentuated = on ? M.AccentuationType.Normal : M.AccentuationType.None; },
    },
    staccato: { label: 'Staccato', short: '·', key: 'k', ...flag('isStaccato') },
    harmonic: {
      label: 'Natural harmonic', short: 'Harm', key: 'n',
      get: n => n.harmonicType !== M.HarmonicType.None,
      set: (n, on) => { n.harmonicType = on ? M.HarmonicType.Natural : M.HarmonicType.None; n.harmonicValue = on ? n.fret : 0; },
    },
  };
}

// ---------- selection ----------

export function target(score, sel) {
  const track = score.tracks[sel.track];
  const staff = track?.staves[sel.staff ?? 0];
  const bar = staff?.bars[sel.bar];
  const voice = bar?.voices[0];
  const beat = voice?.beats[sel.beat];
  const note = beat?.notes.find(n => n.string === sel.string) ?? null;
  return { track, staff, bar, voice, beat, note };
}

export const isStringed = staff => !!staff && !staff.isPercussion && staff.tuning.length > 0;

/** Keeps a selection inside the score (after deleting beats or bars, or switching tracks). */
export function clampSelection(score, sel) {
  const t = Math.max(0, Math.min(score.tracks.length - 1, sel.track ?? 0));
  const staves = score.tracks[t].staves;
  const s = Math.max(0, Math.min(staves.length - 1, sel.staff ?? 0));
  const staff = staves[s];
  const b = Math.max(0, Math.min(staff.bars.length - 1, sel.bar ?? 0));
  const beats = staff.bars[b].voices[0].beats.length;
  const strings = staff.tuning.length || 1;
  return {
    track: t, staff: s, bar: b,
    beat: Math.max(0, Math.min(beats - 1, sel.beat ?? 0)),
    string: Math.max(1, Math.min(strings, sel.string ?? strings)),
  };
}

/** Next / previous beat, continuing into the neighbouring bar. */
export function moveBeat(score, sel, dir) {
  const { staff } = target(score, sel);
  let { bar, beat } = sel;
  beat += dir;
  if (beat < 0) {
    if (bar === 0) return { ...sel, beat: 0 };
    bar -= 1;
    beat = staff.bars[bar].voices[0].beats.length - 1;
  } else if (beat >= staff.bars[bar].voices[0].beats.length) {
    if (bar === staff.bars.length - 1) return sel;
    bar += 1;
    beat = 0;
  }
  return { ...sel, bar, beat };
}

export function moveBar(score, sel, dir) {
  const { staff } = target(score, sel);
  return clampSelection(score, { ...sel, bar: Math.max(0, Math.min(staff.bars.length - 1, sel.bar + dir)), beat: 0 });
}

/** Up = towards the highest string. */
export function moveString(score, sel, dir) {
  const { staff } = target(score, sel);
  return { ...sel, string: Math.max(1, Math.min(staff.tuning.length || 1, sel.string + dir)) };
}

// ---------- notes ----------

export function setFret(at, score, sel, fret) {
  const { staff, beat, note } = target(score, sel);
  if (!isStringed(staff) || !beat || fret < 0 || fret > MAX_FRET) return null;
  if (note) {
    note.fret = fret;
    note.isTieDestination = false;
  } else {
    const n = new at.model.Note();
    n.string = sel.string;
    n.fret = fret;
    beat.addNote(n);
    beat.isEmpty = false;
  }
  return sel;
}

export function clearNote(score, sel) {
  const { beat, note } = target(score, sel);
  if (!note) return null;
  beat.notes.splice(beat.notes.indexOf(note), 1);
  return sel;
}

export function makeRest(score, sel) {
  const { beat } = target(score, sel);
  if (!beat?.notes.length) return null;
  beat.notes.splice(0);
  return sel;
}

/** Toggles a technique on the selected note. A tie joins the note to the previous one on the same string. */
export function toggleTechnique(at, score, sel, id) {
  const { note } = target(score, sel);
  if (!note) return null;
  if (id === 'tie') {
    if (note.isTieDestination) { note.isTieDestination = false; return sel; }
    const prev = moveBeat(score, sel, -1);
    if (prev.bar === sel.bar && prev.beat === sel.beat) return null;
    const origin = target(score, prev).beat.notes.find(n => n.string === sel.string);
    if (!origin) return null;
    note.fret = origin.fret;
    note.isTieDestination = true;
    return sel;
  }
  const tech = techniques(at)[id];
  if (!tech) return null;
  const on = !tech.get(note);
  // alphaTab drops a hammer-on / pull-off that has no next note on the same string to land on.
  if (id === 'hammer' && on) {
    const next = moveBeat(score, sel, 1);
    if (next === sel || !target(score, next).beat?.notes.some(n => n.string === sel.string)) return null;
  }
  tech.set(note, on);
  return sel;
}

// ---------- rhythm ----------

export function setDuration(score, sel, duration) {
  const { beat } = target(score, sel);
  if (!beat || !DURATIONS.includes(duration) || beat.duration === duration) return null;
  beat.duration = duration;
  return sel;
}

/** dir +1 = longer (half the value), -1 = shorter. */
export function changeDuration(score, sel, dir) {
  const { beat } = target(score, sel);
  if (!beat) return null;
  const i = DURATIONS.indexOf(beat.duration) - dir;
  return i >= 0 && i < DURATIONS.length ? setDuration(score, sel, DURATIONS[i]) : null;
}

export function toggleDot(score, sel) {
  const { beat } = target(score, sel);
  if (!beat) return null;
  beat.dots = beat.dots ? 0 : 1;
  return sel;
}

/** Inserts a rest of the same length before the selected beat (or after it). */
export function insertBeat(at, score, sel, after = false) {
  const { voice, beat } = target(score, sel);
  if (!voice) return null;
  const rest = new at.model.Beat();
  rest.duration = beat?.duration ?? at.model.Duration.Quarter;
  rest.dots = beat?.dots ?? 0;
  const at0 = sel.beat + (after ? 1 : 0);
  voice.beats.splice(at0, 0, rest);
  return { ...sel, beat: at0 };
}

/** Deletes the selected beat. The last beat of a bar becomes a rest instead. */
export function deleteBeat(score, sel) {
  const { voice } = target(score, sel);
  if (!voice) return null;
  if (voice.beats.length === 1) return makeRest(score, sel);
  voice.beats.splice(sel.beat, 1);
  return { ...sel, beat: Math.min(sel.beat, voice.beats.length - 1) };
}

// ---------- bars ----------

/** Adds an empty bar (whole rests in every track) after the selected bar, or before it. */
export function insertBar(at, score, sel, after = true) {
  const M = at.model;
  const index = sel.bar + (after ? 1 : 0);
  const ref = score.masterBars[sel.bar];
  const mb = new M.MasterBar();
  mb.timeSignatureNumerator = ref.timeSignatureNumerator;
  mb.timeSignatureDenominator = ref.timeSignatureDenominator;
  mb.timeSignatureCommon = ref.timeSignatureCommon;
  mb.tripletFeel = ref.tripletFeel;
  score.masterBars.splice(index, 0, mb);
  for (const track of score.tracks) for (const staff of track.staves) {
    const like = staff.bars[sel.bar];
    const bar = new M.Bar();
    bar.clef = like.clef;
    bar.clefOttava = like.clefOttava;
    bar.keySignature = like.keySignature;
    bar.keySignatureType = like.keySignatureType;
    const voice = new M.Voice();
    const rest = new M.Beat();
    rest.duration = M.Duration.Whole;
    voice.addBeat(rest);
    bar.addVoice(voice);
    staff.bars.splice(index, 0, bar);
  }
  return { ...sel, bar: index, beat: 0 };
}

export function deleteBar(score, sel) {
  if (score.masterBars.length <= 1) return null;
  const index = sel.bar;
  const removed = score.masterBars[index];
  // Keep a section marker or tempo change that started here by moving it to the next bar.
  const next = score.masterBars[index + 1];
  if (next) {
    if (removed.section && !next.section) next.section = removed.section;
    if (removed.tempoAutomations?.length && !next.tempoAutomations?.length) next.tempoAutomations = removed.tempoAutomations;
  }
  score.masterBars.splice(index, 1);
  for (const track of score.tracks) for (const staff of track.staves) staff.bars.splice(index, 1);
  return { ...sel, bar: Math.min(index, score.masterBars.length - 1), beat: 0 };
}

export function setTimeSignature(score, sel, numerator, denominator) {
  const mb = score.masterBars[sel.bar];
  numerator = Math.trunc(Number(numerator));
  denominator = Math.trunc(Number(denominator));
  if (!mb || !(numerator >= 1 && numerator <= 32) || ![1, 2, 4, 8, 16, 32].includes(denominator)) return null;
  if (mb.timeSignatureNumerator === numerator && mb.timeSignatureDenominator === denominator) return null;
  mb.timeSignatureNumerator = numerator;
  mb.timeSignatureDenominator = denominator;
  mb.timeSignatureCommon = false;
  return sel;
}

/** Sets a tempo change at the start of the selected bar (the song tempo for bar 1), or removes it (bpm null). */
export function setTempo(at, score, sel, bpm) {
  const mb = score.masterBars[sel.bar];
  if (!mb) return null;
  if (bpm === null || bpm === '') {
    if (sel.bar === 0 || !mb.tempoAutomations?.length) return null;
    mb.tempoAutomations = [];
    return sel;
  }
  bpm = Math.round(Number(bpm));
  if (!(bpm >= 20 && bpm <= 400)) return null;
  const auto = at.model.Automation.buildTempoAutomation(false, 0, bpm, 2);
  const others = (mb.tempoAutomations ?? []).filter(a => a.ratioPosition > 0);
  mb.tempoAutomations = [auto, ...others];
  if (sel.bar === 0) score.tempo = bpm;
  return sel;
}

/** Sets (or with empty text removes) the section marker at the selected bar. */
export function setSection(at, score, sel, text) {
  const mb = score.masterBars[sel.bar];
  if (!mb) return null;
  text = String(text ?? '').trim();
  if (!text) {
    if (!mb.section) return null;
    mb.section = null;
    return sel;
  }
  if (mb.section?.text === text) return null;
  const section = new at.model.Section();
  section.text = text;
  section.marker = '';
  mb.section = section;
  return sel;
}

// ---------- alphaTab JSON (Map trees) for copy / paste and bar-level undo ----------

/** Deep copy of alphaTab's JSON form. stripIds drops "id" keys so pasted copies get fresh ids. */
export function cloneJs(value, stripIds = false) {
  if (value instanceof Map) {
    const out = new Map();
    for (const [k, v] of value) if (!(stripIds && k === 'id')) out.set(k, cloneJs(v, stripIds));
    return out;
  }
  if (Array.isArray(value)) return value.map(v => cloneJs(v, stripIds));
  if (ArrayBuffer.isView(value)) return value.slice();
  return value;
}

export const barJs = (js, sel) => js.get('tracks')[sel.track].get('staves')[sel.staff ?? 0].get('bars')[sel.bar];

/** Replaces a bar's contents in the JSON form (keeps the target bar's id). */
export function putBarJs(js, sel, bar, { fresh = false } = {}) {
  const bars = js.get('tracks')[sel.track].get('staves')[sel.staff ?? 0].get('bars');
  const copy = cloneJs(bar, fresh);
  if (bars[sel.bar]?.has('id')) copy.set('id', bars[sel.bar].get('id'));
  bars[sel.bar] = copy;
  return js;
}

// ---------- tracks and tunings ----------

// Highest string first (alphaTab's order), as MIDI note numbers.
export const TUNINGS = [
  ['Standard', [64, 59, 55, 50, 45, 40]], ['Drop D', [64, 59, 55, 50, 45, 38]], ['E♭ standard', [63, 58, 54, 49, 44, 39]],
  ['D standard', [62, 57, 53, 48, 43, 38]], ['Drop C', [62, 57, 53, 48, 43, 36]], ['DADGAD', [62, 57, 55, 50, 45, 38]],
  ['Open G', [62, 59, 55, 50, 43, 38]], ['Open D', [62, 57, 54, 50, 45, 38]], ['Open E', [64, 59, 56, 52, 47, 40]],
  ['7-string standard', [64, 59, 55, 50, 45, 40, 35]], ['7-string drop A', [64, 59, 55, 50, 45, 40, 33]],
  ['Bass standard', [43, 38, 33, 28]], ['Bass drop D', [43, 38, 33, 26]], ['Bass E♭', [42, 37, 32, 27]],
  ['5-string bass', [43, 38, 33, 28, 23]],
];
export const NEW_TRACKS = {
  guitar: { name: 'Guitar', program: 27, tuning: TUNINGS[0][1] },
  acoustic: { name: 'Acoustic guitar', program: 25, tuning: TUNINGS[0][1] },
  bass: { name: 'Bass', program: 33, tuning: TUNINGS[11][1] },
};

/** Changes a stringed track's tuning (same number of strings; frets stay, pitches follow). */
export function setTuning(at, score, trackIndex, tuning, name = '') {
  const staff = score.tracks[trackIndex]?.staves[0];
  if (!isStringed(staff) || tuning.length !== staff.tuning.length || tuning.every((p, i) => p === staff.tuning[i])) return null;
  for (const st of score.tracks[trackIndex].staves) {
    if (st.tuning.length === tuning.length) st.stringTuning = new at.model.Tuning(name, [...tuning], name === 'Standard');
  }
  return true;
}

export function renameTrack(score, trackIndex, name) {
  const track = score.tracks[trackIndex];
  name = String(name ?? '').trim();
  if (!track || !name || track.name === name) return null;
  track.name = name;
  track.shortName = name.slice(0, 10);
  return true;
}

/** Adds an empty guitar or bass track (rests in every bar) and returns its index. */
export function addTrack(at, score, kind = 'guitar') {
  const M = at.model;
  const preset = NEW_TRACKS[kind] ?? NEW_TRACKS.guitar;
  const track = new M.Track();
  track.name = preset.name;
  track.shortName = preset.name.slice(0, 10);
  // A free pair of MIDI channels (9 is drums).
  const used = new Set(score.tracks.flatMap(t => [t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel]));
  const free = [...Array(16).keys()].filter(c => c !== 9 && !used.has(c));
  track.playbackInfo.primaryChannel = free[0] ?? 0;
  track.playbackInfo.secondaryChannel = free[1] ?? free[0] ?? 0;
  track.playbackInfo.program = preset.program;
  track.playbackInfo.volume = 12;
  track.playbackInfo.balance = 8;
  const staff = new M.Staff();
  staff.showTablature = true;
  staff.showStandardNotation = true;
  staff.stringTuning = new M.Tuning('Standard', [...preset.tuning], true);
  staff.displayTranspositionPitch = -12; // guitar and bass are written an octave up
  track.addStaff(staff);
  for (let i = 0; i < score.masterBars.length; i++) {
    const bar = new M.Bar();
    bar.clef = kind === 'bass' ? M.Clef.F4 : M.Clef.G2;
    const voice = new M.Voice();
    const rest = new M.Beat();
    rest.duration = M.Duration.Whole;
    voice.addBeat(rest);
    bar.addVoice(voice);
    staff.addBar(bar);
  }
  score.addTrack(track);
  return score.tracks.length - 1;
}

export function removeTrack(score, trackIndex) {
  if (score.tracks.length <= 1 || !score.tracks[trackIndex]) return null;
  score.tracks.splice(trackIndex, 1);
  return true;
}

// ---------- tuplets, repeats, key signatures ----------

/** Toggles a triplet (3 in the time of 2) on the selected beat. */
export function toggleTriplet(score, sel) {
  const { beat } = target(score, sel);
  if (!beat) return null;
  const on = beat.tupletNumerator !== 3;
  beat.tupletNumerator = on ? 3 : -1;
  beat.tupletDenominator = on ? 2 : -1;
  return sel;
}

export function toggleRepeatStart(score, sel) {
  const mb = score.masterBars[sel.bar];
  if (!mb) return null;
  mb.isRepeatStart = !mb.isRepeatStart;
  return sel;
}

/** Ends a repeat at the selected bar, played `count` times in all (0 removes it). */
export function setRepeatEnd(score, sel, count) {
  const mb = score.masterBars[sel.bar];
  count = Math.trunc(Number(count));
  if (!mb || !(count === 0 || (count >= 2 && count <= 16)) || mb.repeatCount === count) return null;
  mb.repeatCount = count;
  return sel;
}

/**
 * Sets the key signature (-7 = 7 flats .. 7 sharps) from the selected bar on, in every track,
 * up to the next bar that already had a different key.
 */
export function setKeySignature(score, sel, key) {
  key = Math.trunc(Number(key));
  if (!(key >= -7 && key <= 7)) return null;
  let changed = false;
  for (const track of score.tracks) for (const staff of track.staves) {
    if (staff.isPercussion) continue;
    const old = staff.bars[sel.bar]?.keySignature;
    for (let b = sel.bar; b < staff.bars.length && staff.bars[b].keySignature === old; b++) {
      if (staff.bars[b].keySignature !== key) { staff.bars[b].keySignature = key; changed = true; }
    }
  }
  return changed ? sel : null;
}
