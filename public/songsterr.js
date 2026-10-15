// Converts Songsterr's per-track JSON into an alphaTab Score model.
// Works in the browser (pass window.alphaTab) and in Node (pass the imported module).

const GP5_PERCUSSION_MAP = new Map([[27, 42], [28, 60], [29, 29], [30, 30], [32, 31]]);
const DRUM_INSTRUMENT_ID = 1024;

export function parseSongsterrUrl(input) {
  const s = String(input).trim();
  if (/^\d+$/.test(s)) return { songId: Number(s), trackIndex: null };
  const m = s.match(/-s(\d+)(?:t(\d+))?(?:[/?#]|$)/i) || s.match(/[?&]id=(\d+)/);
  if (!m) return null;
  return { songId: Number(m[1]), trackIndex: m[2] !== undefined ? Number(m[2]) : null };
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

  // Master bars: time signature, key, tempo, sections, repeats.
  let num = 4, den = 4, key = 0, keyType = 0;
  const keys = [];
  for (let i = 0; i < barCount; i++) {
    const mb = new M.MasterBar();
    const refMeasure = reference?.measures?.[i] || {};
    const sigMeasure = tracks.map(t => t.measures?.[i]).find(m => m?.signature);
    if (sigMeasure) [num, den] = sigMeasure.signature;
    mb.timeSignatureNumerator = num;
    mb.timeSignatureDenominator = den;

    const ksMeasure = tracks.map(t => t.measures?.[i]).find(m => m?.keySignature);
    if (ksMeasure) {
      key = keySignatureOf(ksMeasure.keySignature);
      keyType = ksMeasure.keySignature.mode === 'minor' ? M.KeySignatureType.Minor : M.KeySignatureType.Major;
    }
    keys.push([key, keyType]);

    const markerMeasure = tracks.map(t => t.measures?.[i]).find(m => m?.marker?.text);
    if (markerMeasure) {
      const sec = new M.Section();
      sec.text = markerMeasure.marker.text;
      sec.marker = '';
      mb.section = sec;
    }
    if (refMeasure.doubleBarline) mb.isDoubleBar = true;
    // Defensive: Songsterr rarely sends repeat info, but map it if present.
    if (refMeasure.repeatStart) mb.isRepeatStart = true;
    if (refMeasure.repeatClose || refMeasure.repeat) mb.repeatCount = Number(refMeasure.repeat || refMeasure.repeatClose) || 2;
    if (refMeasure.alternateEnding) {
      const endings = [].concat(refMeasure.alternateEnding);
      mb.alternateEndings = endings.reduce((acc, n) => acc | (1 << (Number(n) - 1)), 0);
    }
    score.addMasterBar(mb);
  }

  const tempos = reference?.automations?.tempo || [];
  if (!tempos.some(t => t.measure === 0)) tempos.unshift({ measure: 0, position: 0, bpm: 120 });
  for (const t of tempos) {
    const mb = score.masterBars[t.measure];
    if (!mb) continue;
    const a = new M.Automation();
    a.type = M.AutomationType.Tempo;
    a.value = t.bpm;
    a.isLinear = !!t.linear;
    const barTicks = 960 * 4 * mb.timeSignatureNumerator / mb.timeSignatureDenominator;
    a.ratioPosition = Math.min(1, (t.position || 0) / barTicks);
    a.isVisible = t.visible !== false;
    mb.tempoAutomations.push(a);
  }

  let channel = 0;
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
    if (isDrums) {
      staff.isPercussion = true;
      staff.showTablature = false;
      staff.stringTuning = new M.Tuning('', [], false);
    } else {
      const tuning = st.tuning || info.tuning || [64, 59, 55, 50, 45, 40];
      staff.stringTuning = new M.Tuning('', tuning.slice(), false);
      staff.showTablature = isFretted;
      staff.showStandardNotation = true;
    }
    score.addTrack(track);

    const strings = st.strings || staff.stringTuning.tunings.length || 6;
    let clef = isBassProgram(st.instrumentId) ? M.Clef.F4 : M.Clef.G2;
    let dynamics = M.DynamicValue.F;
    let chordCounter = 0;
    const voiceCount = Math.max(1, ...(st.measures || []).map(m => m.voices?.length || 0));

    for (let bi = 0; bi < barCount; bi++) {
      const sm = st.measures?.[bi];
      const bar = new M.Bar();
      if (isDrums) clef = M.Clef.Neutral;
      else if (sm?.clef && M.Clef[sm.clef] !== undefined) clef = M.Clef[sm.clef];
      bar.clef = clef;
      [bar.keySignature, bar.keySignatureType] = keys[bi];
      staff.addBar(bar);

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
          }
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
                note.percussionArticulation = GP5_PERCUSSION_MAP.get(note.fret) ?? note.fret;
              } else {
                const s = Math.round(sn.string);
                if (s < 0 || s >= strings) continue;
                note.string = strings - s;
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
  return score;
}
