// Chord names -> guitar fingerings, and chord diagrams as SVG.
// Songsterr only gives chord names, so shapes come from a small library: common open chords,
// then movable E-shape (root on the low string) and A-shape (root on the 5th string) barre chords.
// Frets are listed low string first; -1 = not played.

const NOTES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STANDARD = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

// Chord-quality spellings, longest first so "maj7" wins over "m".
const QUALITIES = [
  ['m7b5', 'm7b5'], ['m7-5', 'm7b5'], ['ø', 'm7b5'], ['dim7', 'dim7'], ['°7', 'dim7'], ['maj9', 'maj7'], ['maj7', 'maj7'], ['M7', 'maj7'], ['Δ', 'maj7'],
  ['7sus4', '7sus4'], ['add9', 'add9'], ['add2', 'add9'], ['sus2', 'sus2'], ['sus4', 'sus4'], ['sus', 'sus4'],
  ['min7', 'm7'], ['m7', 'm7'], ['-7', 'm7'], ['m6', 'm6'], ['m9', 'm7'], ['min', 'm'], ['m', 'm'], ['-', 'm'],
  ['dim', 'dim'], ['°', 'dim'], ['aug', 'aug'], ['+', 'aug'], ['13', '7'], ['11', '7'], ['9', '9'], ['7', '7'], ['6', '6'], ['5', '5'], ['maj', 'maj'],
];

/** Parses names like "F#m7", "Bbmaj7", "C/G", "Asus2". Returns { root, quality, bass } (pitch classes) or null. */
export function parseChordName(name) {
  const m = /^\s*([A-Ga-g])([#♯b♭]?)(.*?)(?:\/([A-Ga-g])([#♯b♭]?))?\s*$/.exec(String(name ?? ''));
  if (!m) return null;
  const pc = (letter, acc) => (NOTES[letter.toUpperCase()] + (/[#♯]/.test(acc) ? 1 : /[b♭]/.test(acc) ? 11 : 0)) % 12;
  const rest = m[3].replace(/[()\s]/g, '').replace(/♭/g, 'b').replace(/♯/g, '#').replace(/Ø/g, 'ø');
  let quality = rest === '' ? 'maj' : null;
  for (const [spelling, q] of QUALITIES) if (quality === null && rest.startsWith(spelling)) quality = q;
  if (quality === null) return null;
  return { root: pc(m[1], m[2]), quality, bass: m[4] ? pc(m[4], m[5]) : null };
}

// Relative frets from the barre at the root fret.
const E_SHAPES = {
  maj: [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], maj7: [0, -1, 1, 1, 0, -1],
  sus4: [0, 2, 2, 2, 0, 0], '7sus4': [0, 2, 0, 2, 0, 0], 6: [0, 2, 2, 1, 2, 0], m6: [0, 2, 2, 0, 2, 0], 9: [0, 2, 0, 1, 0, 2],
  add9: [0, 2, 2, 1, 0, 2], 5: [0, 2, 2, -1, -1, -1], dim: [0, 1, 2, 0, -1, -1], dim7: [0, 1, 2, 0, 2, 0], m7b5: [0, 1, 2, 0, 3, 0],
  aug: [0, 3, 2, 1, 1, 0],
};
const A_SHAPES = {
  maj: [-1, 0, 2, 2, 2, 0], m: [-1, 0, 2, 2, 1, 0], 7: [-1, 0, 2, 0, 2, 0], m7: [-1, 0, 2, 0, 1, 0], maj7: [-1, 0, 2, 1, 2, 0],
  sus4: [-1, 0, 2, 2, 3, 0], sus2: [-1, 0, 2, 2, 0, 0], '7sus4': [-1, 0, 2, 0, 3, 0], 6: [-1, 0, 2, 2, 2, 2], m6: [-1, 0, 2, 2, 1, 2],
  9: [-1, 0, 2, 4, 2, 3], add9: [-1, 0, 2, 4, 2, 0], 5: [-1, 0, 2, 2, -1, -1], dim: [-1, 0, 1, 2, 1, -1], dim7: [-1, 0, 1, 2, 1, 2],
  m7b5: [-1, 0, 1, 0, 1, -1], aug: [-1, 0, 3, 2, 2, 1],
};
// Open chords that aren't simply an E or A shape at fret 0. Keyed by "root:quality".
const OPEN = {
  '0:maj': [-1, 3, 2, 0, 1, 0], '0:maj7': [-1, 3, 2, 0, 0, 0], '0:7': [-1, 3, 2, 3, 1, 0], '0:add9': [-1, 3, 2, 0, 3, 0],
  '2:maj': [-1, -1, 0, 2, 3, 2], '2:m': [-1, -1, 0, 2, 3, 1], '2:7': [-1, -1, 0, 2, 1, 2], '2:maj7': [-1, -1, 0, 2, 2, 2],
  '2:m7': [-1, -1, 0, 2, 1, 1], '2:sus4': [-1, -1, 0, 2, 3, 3], '2:sus2': [-1, -1, 0, 2, 3, 0], '2:5': [-1, -1, 0, 2, 3, -1],
  '7:maj': [3, 2, 0, 0, 0, 3], '7:7': [3, 2, 0, 0, 0, 1], '7:maj7': [3, 2, 0, 0, 0, 2], '7:6': [3, 2, 0, 0, 0, 0],
  '11:7': [-1, 2, 1, 2, 0, 2], '5:maj7': [-1, -1, 3, 2, 1, 0], '4:sus2': [0, 2, 4, 4, 0, 0],
};

/** Whether a tuning has standard guitar intervals (any key, e.g. E♭ standard), so the usual shapes apply. */
function shift(tuning) {
  if (tuning.length !== 6) return null;
  const d = tuning[0] - STANDARD[0];
  return tuning.every((p, i) => p - STANDARD[i] === d) ? d : null;
}

/**
 * A playable fingering for a chord name on a guitar tuning (low string first, MIDI pitches).
 * Returns { frets, firstFret, barre } or null when no shape is known (or the tuning isn't standard-shaped).
 */
export function chordShape(name, tuning = STANDARD) {
  const chord = parseChordName(name);
  const d = shift(tuning);
  if (!chord || d === null) return null;
  const root = ((chord.root - d) % 12 + 12) % 12; // shapes are relative to the tuning
  const open = d % 12 === 0 && OPEN[`${root}:${chord.quality}`];
  if (open) return withBass(finish(open, null), chord, tuning);
  const options = [];
  const e = E_SHAPES[chord.quality], a = A_SHAPES[chord.quality];
  if (e) options.push({ shape: e, fret: (root - 4 + 12) % 12 });
  if (a) options.push({ shape: a, fret: (root - 9 + 12) % 12 });
  if (!options.length) return null;
  const best = options.sort((x, y) => x.fret - y.fret)[0];
  const frets = best.shape.map(f => (f < 0 ? -1 : f + best.fret));
  return withBass(finish(frets, best.fret > 0 ? best.fret : null), chord, tuning);
}

/** Slash chords (D/A): put the bass note on the string below the shape when it is open or within reach. */
function withBass(shape, chord, tuning) {
  if (chord.bass === null) return shape;
  const lowest = shape.frets.findIndex(f => f >= 0);
  if (lowest < 0 || (tuning[lowest] + shape.frets[lowest]) % 12 === chord.bass) return shape;
  for (let s = lowest - 1; s >= 0; s--) {
    const fret = ((chord.bass - tuning[s]) % 12 + 12) % 12;
    const reach = fret === 0 || (fret >= shape.firstFret && fret <= shape.firstFret + 3);
    if (!reach) continue;
    const frets = [...shape.frets];
    frets[s] = fret;
    return { ...finish(frets, shape.barre), barre: shape.barre };
  }
  return shape;
}

function finish(frets, barre) {
  const fretted = frets.filter(f => f > 0);
  const max = Math.max(0, ...fretted);
  const firstFret = max <= 4 ? 1 : Math.min(...fretted);
  return { frets, firstFret, barre };
}

/** A diagram from a chord stored in a file (alphaTab Chord: strings[0] is the highest string). */
export function shapeFromChord(chord) {
  if (!chord?.strings?.length || chord.strings.every(f => f < 0)) return null;
  const frets = [...chord.strings].reverse();
  const barre = chord.barreFrets?.length ? chord.barreFrets[0] : null;
  const fretted = frets.filter(f => f > 0);
  const firstFret = chord.firstFret > 1 ? chord.firstFret : Math.max(0, ...fretted) <= 4 ? 1 : Math.min(...fretted);
  return { frets, firstFret, barre };
}

/** SVG chord diagram (strings vertical, low string on the left). Uses currentColor so it follows the theme. */
export function chordSvg(shape, { width = 64, frets: rows = 4, leftHanded = false } = {}) {
  const n = shape.frets.length;
  const padX = 10, top = 16, fretH = 13, gap = (width - padX * 2) / (n - 1);
  const height = top + rows * fretH + 6;
  const x = i => padX + (leftHanded ? n - 1 - i : i) * gap;
  const parts = [];
  // nut or first-fret label
  if (shape.firstFret <= 1) parts.push(`<rect x="${padX}" y="${top - 3}" width="${width - padX * 2}" height="3" fill="currentColor"/>`);
  else parts.push(`<text x="${leftHanded ? width - 2 : 2}" y="${top + fretH * 0.7}" font-size="9" text-anchor="${leftHanded ? 'end' : 'start'}" fill="currentColor">${shape.firstFret}</text>`);
  for (let r = 0; r <= rows; r++) parts.push(`<line x1="${padX}" x2="${width - padX}" y1="${top + r * fretH}" y2="${top + r * fretH}" stroke="currentColor" stroke-opacity=".55"/>`);
  for (let i = 0; i < n; i++) parts.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${top + rows * fretH}" stroke="currentColor" stroke-opacity=".55"/>`);
  const rowOf = f => f - Math.max(1, shape.firstFret) + 1; // fret row 1..rows
  if (shape.barre && rowOf(shape.barre) >= 1 && rowOf(shape.barre) <= rows) {
    const span = shape.frets.map((f, i) => (f === shape.barre ? i : -1)).filter(i => i >= 0);
    if (span.length > 1) {
      const y = top + (rowOf(shape.barre) - 0.5) * fretH;
      const [x1, x2] = [x(span[0]), x(span[span.length - 1])].sort((p, q) => p - q);
      parts.push(`<rect x="${x1 - 4}" y="${y - 4}" width="${x2 - x1 + 8}" height="8" rx="4" fill="var(--accent, currentColor)"/>`);
    }
  }
  shape.frets.forEach((f, i) => {
    if (f < 0) parts.push(`<text x="${x(i)}" y="${top - 6}" font-size="9" text-anchor="middle" fill="currentColor" fill-opacity=".7">×</text>`);
    else if (f === 0) parts.push(`<circle cx="${x(i)}" cy="${top - 8}" r="2.6" fill="none" stroke="currentColor"/>`);
    else {
      const row = rowOf(f);
      if (row >= 1 && row <= rows) parts.push(`<circle cx="${x(i)}" cy="${top + (row - 0.5) * fretH}" r="4.2" fill="var(--accent, currentColor)"/>`);
    }
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-hidden="true">${parts.join('')}</svg>`;
}
