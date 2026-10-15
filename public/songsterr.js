// Converts Songsterr's per-track JSON into an alphaTab Score model.
// Works in the browser (pass window.alphaTab) and in Node (pass the imported module).

// Songsterr drum notes use Guitar Pro 7 articulation ids: General MIDI numbers, plus
// 91-127 for variants (91 snare rim shot, 92 half-open hi-hat, 93 ride edge, 97/98 choked
// crashes, 99 low cowbell, ...). alphaTab's articulation table uses the same ids.
const DRUM_INSTRUMENT_ID = 1024;
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const TICKS_PER_QUARTER = 960;

export function parseSongsterrUrl(input) {
  const s = String(input).trim();
  if (/^\d+$/.test(s)) return { songId: Number(s), trackIndex: null };
  const m = s.match(/-s(\d+)(?:t(\d+))?(?:[/?#]|$)/i) || s.match(/[?&]id=(\d+)/);
  if (!m) return null;
  return { songId: Number(m[1]), trackIndex: m[2] !== undefined ? Number(m[2]) : null };
}

/** True while the text looks like a URL or song id being typed, rather than a search query. */
export function looksLikeSongsterrLink(input) {
  const s = String(input).trim();
  return /^\d+$/.test(s) || /^https?:|songsterr\.com|^www\./i.test(s);
}

/** Builds a Songsterr song URL that parseSongsterrUrl understands (optionally with a track). */
export function songsterrUrl(song, track = null) {
  const slug = `${song.artist || ''} ${song.title || ''}`
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'song';
  return `https://www.songsterr.com/a/wsa/${slug}-tab-s${song.songId}${track != null ? `t${track}` : ''}`;
}

/** Trims Songsterr's search response to what the search box shows. */
export function normalizeSearchResults(list) {
  return (Array.isArray(list) ? list : [])
    .filter(s => s && s.songId && s.hasPlayer !== false && !s.isJunk)
    .map(s => ({
      songId: s.songId,
      artist: s.artist || '',
      title: s.title || '',
      trackCount: Array.isArray(s.tracks) ? s.tracks.length : s.tracks ?? null,
      tracks: { guitar: s.popularTrackGuitar ?? null, bass: s.popularTrackBass ?? null, drums: s.popularTrackDrum ?? null },
      defaultTrack: s.popularTrack ?? s.defaultTrack ?? null,
    }));
}

/** Human readable tuning name: preset names ("Standard", "Dropped D") or the notes low to high. */
export function tuningName(at, tuning, preferFlats = false) {
  if (!tuning?.length) return '';
  const preset = at.model.Tuning.findTuning(tuning);
  if (preset?.name) return preset.name.replace(/^(Guitar|Bass)\s+/, '').replace(/\s+Tuning$/, '');
  const names = preferFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return tuning.slice().reverse().map(n => names[((n % 12) + 12) % 12]).join(' ');
}

function tupletDenominator(n) {
  let d = 1;
  while (d * 2 < n) d *= 2;
  return d;
}

function keySignatureOf(ks) {
  const count = Math.min(7, Math.abs(ks.accidentalCount || 0));
  return ks.transposeAs === 'b' ? -count : count;
}

function isBassProgram(id) {
  return id >= 32 && id <= 39;
}

function applySlide(note, slide, at) {
  const s = String(slide).toLowerCase();
  if (s.startsWith('below')) note.slideInType = at.SlideInType.IntoFromBelow;
  else if (s.startsWith('above')) note.slideInType = at.SlideInType.IntoFromAbove;
  if (s.endsWith('shift')) note.slideOutType = at.SlideOutType.Shift;
  else if (s.endsWith('legato')) note.slideOutType = at.SlideOutType.Legato;
  else if (s.endsWith('downwards')) note.slideOutType = at.SlideOutType.OutDown;
  else if (s.endsWith('upwards')) note.slideOutType = at.SlideOutType.OutUp;
}

function vibratoOf(v, at) {
  if (!v) return at.VibratoType.None;
  return v === 'wide' ? at.VibratoType.Wide : at.VibratoType.Slight;
}

/** Length of a Songsterr beat as a fraction of a whole note. */
function beatLength(sb) {
  if (Array.isArray(sb.duration) && sb.duration[1]) return sb.duration[0] / sb.duration[1];
  let len = 1 / (sb.type || 4);
  len *= 2 - 1 / 2 ** (sb.dots || 0);
  if (sb.tuplet > 1) len *= tupletDenominator(sb.tuplet) / sb.tuplet;
  return len;
}

/** Bar-relative start positions (0..1) of the voice-0 beats marked with sustainPedal. */
function pedalPositions(measure) {
  const [num, den] = measure?.signature || [4, 4];
  const out = [];
  let pos = 0;
  for (const sb of measure?.voices?.[0]?.beats || []) {
    if (sb.sustainPedal) out.push(Math.min(1, pos / (num / den)));
    if (!sb.graceNote) pos += beatLength(sb);
  }
  return out;
}

function alternateEndingsMask(value) {
  return [].concat(value).reduce((acc, n) => {
    const i = Number(n);
    return i >= 1 && i <= 8 ? acc | (1 << (i - 1)) : acc;
  }, 0);
}

/**
 * @param at the alphaTab module/namespace
 * @param meta response of https://www.songsterr.com/api/meta/{id}
 * @param tracks array of track JSON objects (same order as meta.tracks)
 */
export function songsterrToScore(at, meta, tracks) {
  const M = at.model;
  const score = new M.Score();
  score.title = meta.title || '';
  score.artist = meta.artist || '';
  score.tab = meta.author?.name ? `Songsterr rev. ${meta.revisionId} by ${meta.author.name}` : '';

  const barCount = Math.max(1, ...tracks.map(t => t.measures?.length || 0));
  const reference = tracks.find(t => t.automations?.tempo?.length) || tracks[0];
  const measuresAt = i => tracks.map(t => t.measures?.[i]).filter(Boolean);

  // Master bars: time signature, key, tempo, sections, repeats.
  let num = 4, den = 4, key = 0, keyType = 0, tripletFeel = M.TripletFeel.NoTripletFeel;
  const keys = [];
  for (let i = 0; i < barCount; i++) {
    const mb = new M.MasterBar();
    const ms = measuresAt(i);
    const sigMeasure = ms.find(m => m.signature);
    if (sigMeasure) [num, den] = sigMeasure.signature;
    mb.timeSignatureNumerator = num;
    mb.timeSignatureDenominator = den;

    const ksMeasure = ms.find(m => m.keySignature);
    if (ksMeasure) {
      key = keySignatureOf(ksMeasure.keySignature);
      keyType = ksMeasure.keySignature.mode === 'minor' ? M.KeySignatureType.Minor : M.KeySignatureType.Major;
    }
    keys.push([key, keyType]);

    const feel = ms.find(m => m.tripletFeel)?.tripletFeel;
    if (feel) tripletFeel = { '8th': M.TripletFeel.Triplet8th, '16th': M.TripletFeel.Triplet16th }[feel] ?? M.TripletFeel.NoTripletFeel;
    mb.tripletFeel = tripletFeel;

    const markerMeasure = ms.find(m => m.marker?.text);
    if (markerMeasure) {
      const sec = new M.Section();
      sec.text = markerMeasure.marker.text;
      sec.marker = '';
      mb.section = sec;
    }
    if (ms.some(m => m.doubleBarline)) mb.isDoubleBar = true;
    // Repeats can be stored on any track. `repeat` is the total number of plays.
    if (ms.some(m => m.repeatStart)) mb.isRepeatStart = true;
    const close = ms.find(m => m.repeat || m.repeatClose);
    if (close) mb.repeatCount = Math.max(2, Number(close.repeat || close.repeatClose) || 2);
    const ending = ms.find(m => m.alternateEnding != null)?.alternateEnding;
    if (ending != null) mb.alternateEndings = alternateEndingsMask(ending);
    score.addMasterBar(mb);
  }

  const barTicks = mb => TICKS_PER_QUARTER * 4 * mb.timeSignatureNumerator / mb.timeSignatureDenominator;
  const tempos = (reference?.automations?.tempo || []).slice();
  if (!tempos.some(t => t.measure === 0)) tempos.unshift({ measure: 0, position: 0, bpm: 120 });
  for (const t of tempos) {
    const mb = score.masterBars[t.measure];
    if (!mb) continue;
    const a = new M.Automation();
    a.type = M.AutomationType.Tempo;
    a.value = t.bpm;
    a.isLinear = !!t.linear;
    a.ratioPosition = Math.min(1, (t.position || 0) / barTicks(mb));
    a.isVisible = t.visible !== false;
    mb.tempoAutomations.push(a);
  }
  for (const f of reference?.automations?.fermata || []) {
    const mb = score.masterBars[f.measure];
    if (!mb) continue;
    const fermata = new M.Fermata();
    fermata.type = { short: M.FermataType.Short, long: M.FermataType.Long }[f.type] ?? M.FermataType.Medium;
    fermata.length = f.length || 1;
    mb.addFermata(f.position || 0, fermata);
  }

  let channel = 0;
  const soundChanges = [];
  tracks.forEach((st, ti) => {
    const info = meta.tracks?.[ti] || {};
    const isDrums = st.instrumentId === DRUM_INSTRUMENT_ID || info.instrumentId === DRUM_INSTRUMENT_ID;
    const isVocal = !!info.isVocalTrack;
    const isFretted = !isDrums && !isVocal && st.instrumentId >= 24 && st.instrumentId <= 39;

    const track = new M.Track();
    track.name = st.name || info.name || `Track ${ti + 1}`;
    track.shortName = (info.instrument || st.instrument || track.name).slice(0, 10);
    const pb = track.playbackInfo;
    pb.volume = Math.round(15 * (st.volume ?? 1));
    pb.balance = 8 + Math.round(7 * (st.balance || 0));
    if (isDrums) {
      pb.primaryChannel = pb.secondaryChannel = 9;
      pb.program = 0;
    } else {
      if (channel === 9) channel++;
      pb.primaryChannel = channel++;
      if (channel === 9) channel++;
      pb.secondaryChannel = channel++;
      if (channel > 15) channel = 0; // more than 7 melodic tracks: share channels
      pb.program = Math.max(0, Math.min(127, st.instrumentId | 0));
    }

    const staff = new M.Staff();
    track.addStaff(staff);
    const tuning = st.tuning || info.tuning || [64, 59, 55, 50, 45, 40];
    if (isDrums) {
      staff.isPercussion = true;
      staff.showTablature = false;
      staff.stringTuning = new M.Tuning('', [], false);
    } else {
      const preset = M.Tuning.findTuning(tuning);
      staff.stringTuning = new M.Tuning(tuningName(at, tuning, !!st.tuningFlat), tuning.slice(), !!preset?.isStandard);
      staff.showTablature = isFretted;
      staff.showStandardNotation = true;
      if (st.capo > 0) staff.capo = st.capo | 0;
      // Guitar and bass are written an octave above how they sound.
      if (isFretted) staff.displayTranspositionPitch = -12;
    }
    score.addTrack(track);

    for (const a of st.trackAutomations?.trackSoundAutomations || []) {
      const program = st.sounds?.[a.soundId]?.instrumentId;
      if (isDrums || program == null || program < 0 || program > 127) continue;
      soundChanges.push({ staff, measure: a.measure, position: a.position || 0, program });
    }

    const strings = st.strings || staff.stringTuning.tunings.length || 6;
    let clef = isBassProgram(st.instrumentId) ? M.Clef.F4 : M.Clef.G2;
    let dynamics = M.DynamicValue.F;
    let chordCounter = 0;
    let pedalDown = false;
    const voiceCount = Math.max(1, ...(st.measures || []).map(m => m.voices?.length || 0));
    const pedals = Array.from({ length: barCount }, (_, bi) => pedalPositions(st.measures?.[bi]));

    for (let bi = 0; bi < barCount; bi++) {
      const sm = st.measures?.[bi];
      const bar = new M.Bar();
      if (isDrums) clef = M.Clef.Neutral;
      else if (sm?.clef && M.Clef[sm.clef] !== undefined) clef = M.Clef[sm.clef];
      bar.clef = clef;
      [bar.keySignature, bar.keySignatureType] = keys[bi];
      staff.addBar(bar);

      // Sustain pedal: each marked beat (re)presses the pedal. It is lifted at the end of
      // the bar unless the next bar marks it again.
      for (const pos of pedals[bi]) {
        if (pedalDown && pos > 0) bar.sustainPedals.push(pedalMarker(M, Math.max(0, pos - 0.001), M.SustainPedalMarkerType.Up));
        bar.sustainPedals.push(pedalMarker(M, pos, M.SustainPedalMarkerType.Down));
        pedalDown = true;
      }
      const next = pedals[bi + 1] || [];
      if (pedalDown && (!next.length || next[0] === 0)) {
        bar.sustainPedals.push(pedalMarker(M, 1, M.SustainPedalMarkerType.Up));
        pedalDown = false;
      }

      for (let vi = 0; vi < voiceCount; vi++) {
        const sv = sm?.voices?.[vi];
        const voice = new M.Voice();
        bar.addVoice(voice);
        const beats = sv?.beats?.length ? sv.beats : [{ rest: true, type: 1 }];
        for (const sb of beats) {
          const beat = new M.Beat();
          beat.duration = sb.type || 4;
          beat.dots = sb.dots || 0;
          if (sb.tuplet && sb.tuplet > 1) {
            beat.tupletNumerator = sb.tuplet;
            beat.tupletDenominator = tupletDenominator(sb.tuplet);
          }
          if (sb.graceNote === 'beforeBeat') beat.graceType = M.GraceType.BeforeBeat;
          else if (sb.graceNote === 'onBeat') beat.graceType = M.GraceType.OnBeat;

          if (sb.velocity && M.DynamicValue[sb.velocity.toUpperCase()] !== undefined) {
            dynamics = M.DynamicValue[sb.velocity.toUpperCase()];
          }
          beat.dynamics = dynamics;
          if (sb.gradualVelocity === 'crescendo') beat.crescendo = M.CrescendoType.Crescendo;
          else if (sb.gradualVelocity === 'decrescendo') beat.crescendo = M.CrescendoType.Decrescendo;
          if (sb.pickStroke === 'down') beat.pickStroke = M.PickStroke.Down;
          else if (sb.pickStroke === 'up') beat.pickStroke = M.PickStroke.Up;
          if (sb.brushStroke) {
            beat.brushType = sb.brushStroke.direction === 'up' ? M.BrushType.BrushUp : M.BrushType.BrushDown;
            beat.brushDuration = sb.brushStroke.duration || 60;
          } else if (sb.arpeggio) {
            beat.brushType = sb.arpeggio.direction === 'up' ? M.BrushType.ArpeggioUp : M.BrushType.ArpeggioDown;
            beat.brushDuration = sb.arpeggio.duration || 60;
          } else if (sb.downArpeggio) {
            beat.brushType = M.BrushType.ArpeggioDown;
            beat.brushDuration = 60;
          } else if (sb.upStroke || sb.downStroke) {
            beat.brushType = sb.upStroke ? M.BrushType.BrushUp : M.BrushType.BrushDown;
            beat.brushDuration = 30;
          }
          if (Array.isArray(sb.tremolo)) {
            const speed = Number(sb.tremolo[1]);
            beat.tremoloSpeed = speed >= 32 ? M.Duration.ThirtySecond : speed >= 16 ? M.Duration.Sixteenth : M.Duration.Eighth;
          }
          if (sb.tapping) beat.tap = true;
          if (sb.slapping) beat.slap = true;
          if (sb.popping) beat.pop = true;
          if (sb.text?.text) beat.text = sb.text.text;
          if (sb.chord?.text && !isDrums) {
            const chord = new M.Chord();
            chord.name = sb.chord.text;
            chord.showDiagram = false;
            const id = `c${chordCounter++}`;
            staff.addChord(id, chord);
            beat.chordId = id;
          }
          if (sb.tremoloBar?.points?.length) {
            for (const p of sb.tremoloBar.points) beat.addWhammyBarPoint(new M.BendPoint(p.position, Math.round(p.tone / 25)));
          }
          if (sb.vibratoWithTremoloBar) beat.vibrato = vibratoOf(sb.vibratoWithTremoloBar, M);

          const restBeat = sb.rest || !sb.notes || sb.notes.every(n => n.rest);
          if (!restBeat) {
            for (const sn of sb.notes) {
              if (sn.rest) continue;
              const note = new M.Note();
              note.fret = sn.fret | 0;
              if (isDrums) {
                note.percussionArticulation = note.fret;
              } else {
                const s = Math.round(sn.string);
                if (s < 0 || s >= strings) continue;
                note.string = strings - s;
                if (sn.trill?.auxiliaryFret != null && tuning[s] != null) {
                  note.trillValue = (sn.trill.auxiliaryFret | 0) + staff.capo + tuning[s];
                  note.trillSpeed = M.Duration.Sixteenth;
                }
              }
              if (sn.tie) note.isTieDestination = true;
              if (sn.hp) note.isHammerPullOrigin = true;
              if (sn.dead) note.isDead = true;
              if (sn.ghost) note.isGhost = true;
              if (sn.staccato) note.isStaccato = true;
              if (sn.accentuated) note.accentuated = sn.accentuated === 2 ? M.AccentuationType.Heavy : M.AccentuationType.Normal;
              if (sn.slide) applySlide(note, sn.slide, M);
              if (sn.leftHandVibrato) note.vibrato = vibratoOf(sn.leftHandVibrato, M);
              if (sn.harmonic) {
                const h = { natural: 'Natural', artificial: 'Artificial', pinch: 'Pinch', tap: 'Tap', semi: 'Semi', feedback: 'Feedback' }[sn.harmonic];
                note.harmonicType = h ? M.HarmonicType[h] : M.HarmonicType.Natural;
                note.harmonicValue = sn.harmonicFret ?? 12;
              }
              if (sn.bend?.points?.length) {
                for (const p of sn.bend.points) note.addBendPoint(new M.BendPoint(p.position, Math.round(p.tone / 25)));
              }
              if (sb.letRing) note.isLetRing = true;
              if (sb.palmMute) note.isPalmMute = true;
              beat.addNote(note);
            }
          }
          voice.addBeat(beat);
        }
      }
    }
  });

  const settings = new at.Settings();
  score.finish(settings);

  // Mid-song instrument changes need beat timing, which is only known after finish().
  for (const { staff, measure, position, program } of soundChanges) {
    const voice = staff.bars[measure]?.voices[0];
    if (!voice?.beats.length) continue;
    const beat = voice.beats.findLast(b => b.playbackStart <= position) || voice.beats[0];
    const a = new M.Automation();
    a.type = M.AutomationType.Instrument;
    a.value = program;
    a.ratioPosition = 0;
    beat.automations.push(a);
  }
  return score;
}

function pedalMarker(M, ratioPosition, pedalType) {
  const m = new M.SustainPedalMarker();
  m.ratioPosition = ratioPosition;
  m.pedalType = pedalType;
  return m;
}

/** Master bar indexes in the order they are played (repeats and alternate endings expanded). */
export function playbackBarOrder(at, score) {
  const gen = new at.midi.MidiFileGenerator(score, new at.Settings(), new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile()));
  gen.generate();
  return gen.tickLookup.masterBars.map(m => m.masterBar.index);
}

/**
 * Converts Songsterr video points (seconds at which each played bar starts in the video)
 * into alphaTab FlatSyncPoints for Score.applyFlatSyncPoints.
 * @param barOrder result of playbackBarOrder
 * @param points seconds, one per played bar
 * @param offsetMs shifts the whole mapping (positive = tab later in the video)
 */
export function videoSyncPoints(barOrder, points, offsetMs = 0) {
  const occurrences = new Map();
  const out = [];
  barOrder.forEach((barIndex, i) => {
    const occurrence = occurrences.get(barIndex) ?? 0;
    occurrences.set(barIndex, occurrence + 1);
    if (i >= points.length || !Number.isFinite(points[i])) return;
    out.push({ barIndex, barOccurence: occurrence, barPosition: 0, millisecondOffset: Math.round(points[i] * 1000 + offsetMs) });
  });
  return out;
}

const FEATURE_ORDER = { original: 0, alternative: 1, backing: 2, solo: 3 };

/**
 * Cleans up Songsterr's video-points list: finished videos with timing only, de-duplicated,
 * the original recording first. Each gets a readable label.
 */
export function normalizeVideos(list, metaTracks = []) {
  const seen = new Set();
  const videos = [];
  for (const v of Array.isArray(list) ? list : []) {
    if (v?.status !== 'done' || !v.videoId || !Array.isArray(v.points) || v.points.length < 2) continue;
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    const feature = v.feature || 'original';
    videos.push({ videoId: v.videoId, feature, points: v.points, tracks: v.tracks || null });
  }
  videos.sort((a, b) => (FEATURE_ORDER[a.feature] ?? 9) - (FEATURE_ORDER[b.feature] ?? 9));
  let alt = 0;
  const trackNames = ids => (ids || []).map(i => shortTrackName(metaTracks[i]?.name)).filter(Boolean).join(', ');
  for (const v of videos) {
    if (v.feature === 'original') v.label = 'Original recording';
    else if (v.feature === 'alternative') v.label = `Alternative video ${++alt}`;
    else if (v.feature === 'backing') v.label = v.tracks?.length ? `Backing track (no ${trackNames(v.tracks)})` : 'Backing track';
    else if (v.feature === 'solo') v.label = v.tracks?.length ? `Isolated ${trackNames(v.tracks)}` : 'Isolated track';
    else v.label = v.feature;
  }
  return videos;
}

function shortTrackName(name) {
  if (!name) return '';
  const parts = String(name).split('|').map(s => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || name;
}
