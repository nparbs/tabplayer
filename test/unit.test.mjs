// Offline tests: converter features on synthetic Songsterr JSON, video sync mapping,
// and server error handling with a mocked fetch.
// Usage: node --test test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as at from '@coderline/alphatab';
import {
  songsterrToScore, parseSongsterrUrl, tuningName, playbackBarOrder, videoSyncPoints, normalizeVideos,
  looksLikeSongsterrLink, songsterrUrl, normalizeSearchResults,
} from '../public/songsterr.js';
import { fetchSongsterr, fetchRevisions, searchSongs } from '../server.js';
import { songKey, clampRange, normalizeTrainer, trainerSpeed, parseStored, withLoop } from '../public/practice.js';
import { libraryLists, staleKeys, withSaved, canOpen, serializeTabs, parseTabs, draftKey, Library, RECENT_LIMIT } from '../public/library.js';

const M = at.model;
const note = (fret, string, extra = {}) => ({ fret, string, ...extra });
const beat = (notes, extra = {}) => ({ type: 4, duration: [1, 4], notes, ...extra });
const rest = (type = 1) => ({ type, rest: true, duration: [1, type], notes: [{ rest: true }] });
const bar = (beats, extra = {}) => ({ voices: [{ beats }], ...extra });
const fourBeats = (fret = 0) => [0, 1, 2, 3].map(() => beat([note(fret, 5)]));

function guitar(measures, extra = {}) {
  return { name: 'Guitar', instrumentId: 27, strings: 6, tuning: [64, 59, 55, 50, 45, 40], measures, ...extra };
}
function convert(tracks, metaTracks) {
  const meta = { title: 'T', artist: 'A', revisionId: 1, tracks: metaTracks || tracks.map(t => ({ instrumentId: t.instrumentId })) };
  return songsterrToScore(at, meta, tracks);
}
function midiOf(score) {
  const midi = new at.midi.MidiFile();
  new at.midi.MidiFileGenerator(score, new at.Settings(), new at.midi.AlphaSynthMidiFileHandler(midi)).generate();
  return midi;
}
const firstBeat = (score, track = 0, barIndex = 0) => score.tracks[track].staves[0].bars[barIndex].voices[0].beats[0];

test('parseSongsterrUrl', () => {
  assert.deepEqual(parseSongsterrUrl('269'), { songId: 269, trackIndex: null });
  assert.deepEqual(parseSongsterrUrl('https://www.songsterr.com/a/wsa/nirvana-smells-like-teen-spirit-tab-s269t2'), { songId: 269, trackIndex: 2 });
  assert.deepEqual(parseSongsterrUrl('https://www.songsterr.com/a/wsa/foo-tab-s27'), { songId: 27, trackIndex: null });
  assert.equal(parseSongsterrUrl('https://example.com/whatever'), null);
});

test('repeats from any track expand playback order', () => {
  const g = guitar([bar(fourBeats()), bar(fourBeats()), bar(fourBeats())]);
  const b = { ...guitar([bar(fourBeats(), { repeatStart: true }), bar(fourBeats(), { repeat: 3 }), bar(fourBeats())]), name: 'Bass' };
  const score = convert([g, b]);
  assert.equal(score.masterBars[0].isRepeatStart, true);
  assert.equal(score.masterBars[1].repeatCount, 3);
  assert.deepEqual(playbackBarOrder(at, score), [0, 1, 0, 1, 0, 1, 2]);
});

test('single-bar repeat like Songsterr song 12 (repeatStart + repeat on one bar)', () => {
  const score = convert([guitar([bar(fourBeats(), { repeatStart: true, repeat: 4 }), bar(fourBeats())])]);
  assert.deepEqual(playbackBarOrder(at, score), [0, 0, 0, 0, 1]);
});

test('alternate endings', () => {
  const score = convert([guitar([
    bar(fourBeats(), { repeatStart: true }),
    bar(fourBeats(), { alternateEnding: [1], repeat: 2 }),
    bar(fourBeats(), { alternateEnding: [2] }),
    bar(fourBeats()),
  ])]);
  assert.equal(score.masterBars[1].alternateEndings, 0b01);
  assert.equal(score.masterBars[2].alternateEndings, 0b10);
  assert.deepEqual(playbackBarOrder(at, score), [0, 1, 0, 2, 3]);
});

test('mid-song instrument changes become program changes', () => {
  const g = guitar([bar(fourBeats()), bar(fourBeats()), bar(fourBeats())], {
    sounds: [{ instrumentId: 27 }, { instrumentId: 30 }],
    trackAutomations: { trackSoundAutomations: [{ soundId: 1, measure: 1, position: 1920 }, { soundId: 0, measure: 2, position: 0 }] },
  });
  const score = convert([g]);
  const auto = score.tracks[0].staves[0].bars[1].voices[0].beats[2].automations.find(a => a.type === M.AutomationType.Instrument);
  assert.equal(auto?.value, 30);
  const programs = midiOf(score).events.filter(e => e instanceof at.midi.ProgramChangeEvent && e.channel === 0).map(e => [e.tick, e.program]);
  assert.deepEqual(programs.slice(-2), [[3840 + 1920, 30], [7680, 27]]);
});

test('tremolo picking, strokes, arpeggios, tap/slap/pop', () => {
  const score = convert([guitar([bar([
    beat([note(5, 2)], { tremolo: [1, 16] }),
    beat([note(5, 2), note(5, 3)], { upStroke: 1 }),
    beat([note(5, 2), note(5, 3)], { downStroke: 1 }),
    beat([note(5, 2), note(5, 3)], { arpeggio: { direction: 'up', duration: 240 } }),
  ]), bar([
    beat([note(5, 2)], { tremolo: [1, 32] }),
    beat([note(5, 2)], { tapping: true }),
    beat([note(5, 2)], { slapping: true }),
    beat([note(5, 2)], { popping: true }),
  ])])]);
  const b0 = score.tracks[0].staves[0].bars[0].voices[0].beats;
  const b1 = score.tracks[0].staves[0].bars[1].voices[0].beats;
  assert.equal(b0[0].tremoloSpeed, M.Duration.Sixteenth);
  assert.equal(b1[0].tremoloSpeed, M.Duration.ThirtySecond);
  assert.equal(b0[1].brushType, M.BrushType.BrushUp);
  assert.equal(b0[2].brushType, M.BrushType.BrushDown);
  assert.equal(b0[3].brushType, M.BrushType.ArpeggioUp);
  assert.equal(b0[3].brushDuration, 240);
  assert.deepEqual([b1[1].tap, b1[2].slap, b1[3].pop], [true, true, true]);
});

test('sustain pedal markers: press, re-press, release', () => {
  const score = convert([guitar([
    bar([beat([note(0, 0)], { sustainPedal: true }), beat([note(0, 0)]), beat([note(0, 0)], { sustainPedal: true }), beat([note(0, 0)])]),
    bar(fourBeats()),
    bar([beat([note(0, 0)]), beat([note(0, 0)], { sustainPedal: true }), beat([note(0, 0)]), beat([note(0, 0)])]),
    bar([beat([note(0, 0)], { sustainPedal: true }), beat([note(0, 0)]), beat([note(0, 0)]), beat([note(0, 0)])]),
  ], { instrumentId: 0 })]);
  const marks = bi => score.tracks[0].staves[0].bars[bi].sustainPedals.map(m => [M.SustainPedalMarkerType[m.pedalType], +m.ratioPosition.toFixed(3)]);
  assert.deepEqual(marks(0), [['Down', 0], ['Up', 0.499], ['Down', 0.5], ['Up', 1]]);
  assert.deepEqual(marks(1), []);
  assert.deepEqual(marks(2), [['Down', 0.25], ['Up', 1]]);
  assert.deepEqual(marks(3), [['Down', 0], ['Up', 1]]);
});

test('capo is applied to playback pitch, frets stay relative', () => {
  const score = convert([guitar([bar([beat([note(0, 5)]), beat([note(2, 0)]), rest(2)])], { capo: 7 })]);
  const staff = score.tracks[0].staves[0];
  assert.equal(staff.capo, 7);
  const [n0, n1] = staff.bars[0].voices[0].beats.slice(0, 2).map(b => b.notes[0]);
  assert.equal(n0.fret, 0);
  assert.equal(n0.realValue, 40 + 7);
  assert.equal(n1.realValue, 64 + 2 + 7);
});

test('tuning names', () => {
  assert.equal(tuningName(at, [64, 59, 55, 50, 45, 40]), 'Standard');
  assert.equal(tuningName(at, [64, 59, 55, 50, 45, 38]), 'Dropped D');
  assert.equal(tuningName(at, [43, 38, 33, 28]), 'Standard');
  assert.equal(tuningName(at, [62, 57, 55, 50, 45, 38]), 'Open Dsus4');
  assert.equal(tuningName(at, [65, 59, 55, 50, 45, 40]), 'E A D G B F');
  assert.equal(tuningName(at, [63, 58, 54, 49, 44, 37], true), 'Db Ab Db Gb Bb Eb');
  const score = convert([guitar([bar(fourBeats())], { tuning: [64, 59, 55, 50, 45, 38] })]);
  assert.equal(score.tracks[0].staves[0].tuningName, 'Dropped D');
});

test('bass and guitar are written an octave up, drums and keys are not', () => {
  const score = convert([
    guitar([bar(fourBeats())]),
    { name: 'Bass', instrumentId: 34, strings: 4, tuning: [43, 38, 33, 28], measures: [bar(fourBeats())] },
    { name: 'Piano', instrumentId: 0, strings: 6, measures: [bar(fourBeats())] },
    { name: 'Drums', instrumentId: 1024, measures: [bar([beat([note(36, 0)])])] },
  ]);
  assert.deepEqual(score.tracks.map(t => t.staves[0].displayTranspositionPitch), [-12, -12, 0, 0]);
  assert.equal(score.tracks[1].staves[0].bars[0].clef, M.Clef.F4);
});

test('drum articulations match Songsterr kit ids (GP7 ids)', () => {
  // id -> expected General MIDI note actually played
  const expected = { 35: 35, 36: 36, 38: 38, 42: 42, 44: 44, 46: 46, 49: 49, 51: 51, 57: 57, 91: 38, 92: 46, 93: 51, 97: 49, 98: 57, 99: 56 };
  const ids = Object.keys(expected).map(Number);
  const drums = { name: 'Drums', instrumentId: 1024, measures: ids.map(id => bar([{ type: 1, duration: [1, 1], notes: [note(id, 0)] }])) };
  const score = convert([drums]);
  const played = midiOf(score).events.filter(e => e instanceof at.midi.NoteOnEvent && e.channel === 9).map(e => e.noteKey);
  assert.deepEqual(played, ids.map(id => expected[id]));
});

test('triplet feel carries forward, fermata and trill', () => {
  const g = guitar([
    bar([beat([note(5, 2, { trill: { auxiliaryFret: 7, speed: 75 } })]), rest(4), rest(2)], { tripletFeel: '8th' }),
    bar(fourBeats()),
    bar(fourBeats(), { tripletFeel: 'off' }),
  ], { automations: { tempo: [{ measure: 0, position: 0, bpm: 100 }], fermata: [{ measure: 1, position: 960, type: 'long', length: 1 }] } });
  const score = convert([g]);
  assert.deepEqual(score.masterBars.map(m => m.tripletFeel), [M.TripletFeel.Triplet8th, M.TripletFeel.Triplet8th, M.TripletFeel.NoTripletFeel]);
  assert.equal(score.masterBars[1].fermata.get(960).type, M.FermataType.Long);
  const n = firstBeat(score).notes[0];
  assert.ok(n.isTrill);
  assert.equal(n.trillFret, 7);
});

test('converted score survives a GP7 export / import round trip', () => {
  const score = convert([guitar([bar(fourBeats(), { repeatStart: true }), bar(fourBeats(3), { repeat: 2 })], { capo: 2 })]);
  const bytes = new at.exporter.Gp7Exporter().export(score, new at.Settings());
  const back = at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
  assert.equal(back.masterBars.length, 2);
  assert.equal(back.masterBars[1].repeatCount, 2);
  assert.equal(back.tracks[0].staves[0].capo, 2);
});

test('videoSyncPoints maps played bars (with repeats) to video time', () => {
  const points = videoSyncPoints([0, 1, 0, 1, 2], [1, 2.5, 4, 5.5, 7], 100);
  assert.deepEqual(points, [
    { barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 1100 },
    { barIndex: 1, barOccurence: 0, barPosition: 0, millisecondOffset: 2600 },
    { barIndex: 0, barOccurence: 1, barPosition: 0, millisecondOffset: 4100 },
    { barIndex: 1, barOccurence: 1, barPosition: 0, millisecondOffset: 5600 },
    { barIndex: 2, barOccurence: 0, barPosition: 0, millisecondOffset: 7100 },
  ]);
  // Fewer points than bars: the rest is left to alphaTab's extrapolation.
  assert.equal(videoSyncPoints([0, 1, 2, 3], [0, 1]).length, 2);
});

test('sync points apply to the score and drive alphaTab time mapping', () => {
  const score = convert([guitar([bar(fourBeats()), bar(fourBeats()), bar(fourBeats())])]);
  const order = playbackBarOrder(at, score);
  // Video plays the 120 bpm song (2 s per bar) starting 3 s in, at half speed.
  score.applyFlatSyncPoints(videoSyncPoints(order, [3, 7, 11]));
  const sync = at.midi.MidiFileGenerator.generateSyncPoints(score);
  assert.deepEqual(sync.slice(0, 3).map(s => [s.synthTick, s.syncTime]), [[0, 3000], [3840, 7000], [7680, 11000]]);
});

test('normalizeVideos: original first, de-duplicated, labelled', () => {
  const metaTracks = [{ name: 'Singer | Vocals' }, { name: 'Kurt | Lead Guitar' }, { name: 'Drums' }];
  const v = normalizeVideos([
    { videoId: 'alt1', feature: 'alternative', status: 'done', points: [0, 1, 2] },
    { videoId: 'back', feature: 'backing', status: 'done', points: [0, 1], tracks: [2] },
    { videoId: 'orig', feature: null, status: 'done', points: [0.3, 2.1, 4] },
    { videoId: 'alt1', feature: 'alternative', status: 'done', points: [0, 1, 2] },
    { videoId: 'solo', feature: 'solo', status: 'done', points: [0, 1], tracks: [1] },
    { videoId: 'wip', feature: 'alternative', status: 'pending', points: [0, 1] },
    { videoId: 'nopoints', feature: 'alternative', status: 'done', points: null },
  ], metaTracks);
  assert.deepEqual(v.map(x => [x.videoId, x.label]), [
    ['orig', 'Original recording'],
    ['alt1', 'Alternative video 1'],
    ['back', 'Backing track (no Drums)'],
    ['solo', 'Isolated Lead Guitar'],
  ]);
});

// ---------- server with mocked Songsterr ----------
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function mockFetch(routes) {
  const calls = [];
  const impl = async url => {
    calls.push(url);
    for (const [pattern, res] of routes) if (url.includes(pattern)) return typeof res === 'function' ? res(url) : res;
    return json(404, {});
  };
  return { impl, calls };
}
const goodMeta = { songId: 5, revisionId: 77, image: 'img', title: 'S', hasPlayer: true, hasTracks: true, tracks: [{ name: 'G', instrumentId: 27 }] };

test('fetchSongsterr: loads a specific revision, tracks and videos', async () => {
  const { impl, calls } = mockFetch([
    ['/meta/5/77', json(200, goodMeta)],
    ['/77/img/0.json', json(200, { measures: [], newLyrics: [1] })],
    ['/video-points/5/77/list', json(200, [{ videoId: 'v', feature: null, status: 'done', points: [0, 1] }])],
  ]);
  const r = await fetchSongsterr('https://www.songsterr.com/a/wsa/x-tab-s5t0', { revision: '77', fetchImpl: impl });
  assert.ok(calls.some(u => u.endsWith('/api/meta/5/77')));
  assert.equal(r.tracks[0].newLyrics, undefined);
  assert.equal(r.trackIndex, 0);
  assert.equal(r.videos[0].label, 'Original recording');
});

test('fetchSongsterr: videos are optional', async () => {
  const { impl } = mockFetch([['/meta/5', json(200, goodMeta)], ['/0.json', json(200, { measures: [] })], ['/video-points/', () => { throw new Error('down'); }]]);
  const r = await fetchSongsterr('5', { fetchImpl: impl });
  assert.deepEqual(r.videos, []);
});

test('fetchSongsterr: clear error messages', async () => {
  const run = (routes, opts = {}) => fetchSongsterr('5', { fetchImpl: mockFetch(routes).impl, ...opts });
  await assert.rejects(run([]), { status: 404, message: /Song 5 was not found.*removed/ });
  await assert.rejects(run([], { revision: 9 }), { status: 404, message: /Revision 9 of song 5 was not found/ });
  await assert.rejects(run([['/meta/', () => { throw new TypeError('fetch failed'); }]]), { status: 502, message: /Could not reach Songsterr/ });
  await assert.rejects(run([['/meta/', json(500, {})]]), { status: 502, message: /HTTP 500/ });
  await assert.rejects(run([['/meta/', json(451, {})]]), { status: 403, message: /restricted/ });
  await assert.rejects(run([['/meta/', json(200, { ...goodMeta, hasPlayer: false })]]), { status: 422, message: /no playable tab/ });
  await assert.rejects(run([['/meta/', json(200, { ...goodMeta, isBlocked: true })]]), { status: 422, message: /rejected/ });
  await assert.rejects(run([['/meta/', json(200, { ...goodMeta, restriction: 'copyright' })], ['/0.json', json(403, {})]]),
    { status: 403, message: /Songsterr says: copyright/ });
  await assert.rejects(fetchSongsterr('not a url'), { status: 400 });
  await assert.rejects(run([], { revision: 'abc' }), { status: 400 });
});

test('fetchRevisions: trims and flags revisions', async () => {
  const { impl } = mockFetch([['/meta/5/revisions', json(200, [
    { revisionId: 3, createdAt: '2026-01-03', author: { name: 'Ann' }, description: 'fix', isOnModeration: true },
    { revisionId: 2, createdAt: '2026-01-02', person: 'Bob', isBlocked: true },
    { revisionId: 1, createdAt: '2026-01-01', author: { name: 'Cy' }, isDeleted: true },
  ])]]);
  const r = await fetchRevisions('5', { fetchImpl: impl });
  assert.deepEqual(r.map(x => [x.revisionId, x.author, x.status]), [[3, 'Ann', 'pending'], [2, 'Bob', 'rejected']]);
});

test('search helpers: link detection, URL building, result cleanup', () => {
  for (const s of ['269', 'https://www.songsterr.com/a/wsa/x-tab-s5', 'https://www.son', 'www.songsterr.com', 'songsterr.com/a']) assert.ok(looksLikeSongsterrLink(s), s);
  for (const s of ['nirvana', 'teen spirit', 'AC/DC back in black']) assert.ok(!looksLikeSongsterrLink(s), s);
  const url = songsterrUrl({ songId: 269, artist: 'Nirvana', title: 'Smells Like Teen Spirit' }, 3);
  assert.equal(url, 'https://www.songsterr.com/a/wsa/nirvana-smells-like-teen-spirit-tab-s269t3');
  assert.deepEqual(parseSongsterrUrl(url), { songId: 269, trackIndex: 3 });
  assert.deepEqual(parseSongsterrUrl(songsterrUrl({ songId: 7, artist: 'Beyoncé', title: "Don't Stop!" })), { songId: 7, trackIndex: null });
  assert.match(songsterrUrl({ songId: 7, artist: 'Beyoncé', title: "Don't Stop!" }), /beyonce-don-t-stop-tab-s7$/);
  const r = normalizeSearchResults([
    { songId: 1, artist: 'A', title: 'T', hasPlayer: true, tracks: [{}, {}], popularTrack: 1, popularTrackGuitar: 1, popularTrackDrum: 0 },
    { songId: 2, artist: 'B', title: 'Junk', hasPlayer: true, isJunk: true, tracks: [] },
    { songId: 3, artist: 'C', title: 'Chords only', hasPlayer: false, tracks: [] },
  ]);
  assert.deepEqual(r, [{ songId: 1, artist: 'A', title: 'T', trackCount: 2, tracks: { guitar: 1, bass: null, drums: 0 }, defaultTrack: 1 }]);
});

test('searchSongs: queries Songsterr and pages', async () => {
  const urls = [];
  const page = Array.from({ length: 20 }, (_, i) => ({ songId: i + 1, artist: 'A', title: `S${i}`, hasPlayer: true, isJunk: i === 0, tracks: [] }));
  const impl = async url => { urls.push(url); return json(200, page); };
  const r = await searchSongs('  teen spirit ', { from: 20, fetchImpl: impl });
  const q = new URL(urls[0]).searchParams;
  assert.equal(q.get('pattern'), 'teen spirit');
  assert.equal(q.get('from'), '20');
  assert.equal(r.songs.length, 19);
  assert.equal(r.next, 40);
  assert.equal(r.hasMore, true);
  await assert.rejects(searchSongs('a', { fetchImpl: impl }), { status: 400 });
  await assert.rejects(searchSongs('abc', { fetchImpl: async () => json(503, {}) }), { status: 502, message: /search failed/ });
});

// ---------- practice tools ----------

test('practice: song keys prefer the Songsterr id', () => {
  assert.equal(songKey({ songId: 269, title: 'Smells Like Teen Spirit' }), 'songsterr:269');
  assert.equal(songKey({ title: 'My Song', artist: 'Me' }), 'file:my song|me');
  assert.equal(songKey({}), null);
});

test('practice: bar ranges are clamped, ordered and validated', () => {
  assert.deepEqual(clampRange(5, 8, 40), { from: 5, to: 8 });
  assert.deepEqual(clampRange('9', '3', 40), { from: 3, to: 9 });
  assert.deepEqual(clampRange(0, 99, 40), { from: 1, to: 40 });
  assert.deepEqual(clampRange(7, '', 40), { from: 7, to: 7 });
  assert.equal(clampRange('', '', 40), null);
  assert.equal(clampRange('x', 4, 40), null);
  assert.equal(clampRange(1, 4, 0), null);
});

test('practice: speed trainer steps up per pass and stops at the top speed', () => {
  const t = { start: 60, step: 10, every: 2, max: 85 };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(p => trainerSpeed(t, p)), [60, 60, 70, 70, 80, 80, 85]);
  assert.deepEqual(normalizeTrainer({ start: 10, step: 0, every: '', max: 300 }), { start: 25, step: 1, every: 1, max: 200 });
  assert.deepEqual(normalizeTrainer({ start: 120, max: 90 }), { start: 120, step: 5, every: 1, max: 120 });
  assert.deepEqual(normalizeTrainer(), { start: 60, step: 5, every: 1, max: 100 });
});

test('practice: saved loops survive bad storage and stay bounded', () => {
  assert.deepEqual(parseStored('not json'), {});
  assert.deepEqual(parseStored('[1,2]'), {});
  assert.deepEqual(parseStored(null), {});
  let loops = withLoop({}, 'a', { from: 1, to: 4 });
  loops = withLoop(loops, 'b', { from: 2, to: 3 });
  assert.deepEqual(loops, { a: { from: 1, to: 4 }, b: { from: 2, to: 3 } });
  assert.deepEqual(withLoop(loops, 'a', null), { b: { from: 2, to: 3 } });
  for (let i = 0; i < 250; i++) loops = withLoop(loops, `k${i}`, { from: 1, to: 2 });
  assert.equal(Object.keys(loops).length, 200);
  assert.ok(loops.k249 && !loops.a, 'oldest entries are dropped first');
});

// ---------- library and tabs ----------

test('library: lists split favourites, saved and recent, newest first', () => {
  const records = [
    { key: 'a', openedAt: 1, favorite: true },
    { key: 'b', openedAt: 3, saved: true, savedAt: 5 },
    { key: 'c', openedAt: 2, saved: true, savedAt: 9 },
    { key: 'd', favorite: true }, // favourite taken off the recent list
  ];
  const { favorites, saved, recent } = libraryLists(records);
  assert.deepEqual(favorites.map(r => r.key), ['a', 'd']);
  assert.deepEqual(saved.map(r => r.key), ['c', 'b']);
  assert.deepEqual(recent.map(r => r.key), ['b', 'c', 'a']);
});

test('library: old recents are forgotten, but not favourites, saved songs or open tabs', () => {
  const records = Array.from({ length: RECENT_LIMIT + 5 }, (_, i) => ({ key: `r${i}`, openedAt: i }));
  records[0].favorite = true;
  records[1].saved = true;
  const stale = staleKeys(records, new Set(['r2']));
  assert.deepEqual(stale, ['r4', 'r3']); // 32 unprotected recents, so the oldest 2 go
  assert.deepEqual(staleKeys(records.slice(0, 5)), []);
});

test('library: saving keeps Songsterr data only while saved; files keep their bytes', () => {
  const song = { key: 'songsterr:1', kind: 'songsterr', input: '1' };
  const on = withSaved(song, true, { meta: {} });
  assert.equal(on.saved, true);
  assert.ok(on.savedAt > 0);
  assert.deepEqual(on.data, { meta: {} });
  const off = withSaved(on, false);
  assert.equal(off.saved, false);
  assert.equal(off.data, undefined);
  const file = { key: 'file:x|', kind: 'file', bytes: new Uint8Array([1]) };
  assert.equal(withSaved(withSaved(file, true), false).bytes.length, 1);
  assert.ok(canOpen(song) && canOpen(file));
  assert.ok(!canOpen({ kind: 'file' }) && !canOpen(undefined));
});

test('library: open tabs round-trip through storage; empty and malformed tabs are dropped', () => {
  const tabs = [
    { id: 1, key: null },
    { id: 2, key: 'songsterr:269', kind: 'songsterr', input: '269', rev: null, title: 'Teen Spirit', selected: [0, 2], activeTrack: 2, tick: 960, score: {} },
    { id: 3, key: 'file:a|b', kind: 'file', title: 'A', artist: 'B', selected: [0], activeTrack: 0, tick: 0, bytes: new Uint8Array(9) },
  ];
  const stored = serializeTabs(tabs, 3);
  assert.equal(stored.active, 1);
  assert.equal(stored.tabs.length, 2);
  assert.equal(stored.tabs[1].bytes, undefined); // file bytes live in the library, not localStorage
  const back = parseTabs(JSON.stringify(stored));
  assert.equal(back.active, 1);
  assert.deepEqual(back.tabs[0].selected, [0, 2]);
  assert.equal(back.tabs[0].tick, 960);
  assert.deepEqual(parseTabs('not json'), { tabs: [], active: 0 });
  assert.deepEqual(parseTabs(JSON.stringify({ tabs: [{ key: 'x', kind: 'songsterr' }, null], active: 4 })), { tabs: [], active: 0 });
});

test('library: an edited tab is remembered, with one draft per song and revision', () => {
  const tabs = [
    { id: 1, key: 'songsterr:269', kind: 'songsterr', input: '269', dirty: true },
    { id: 2, key: 'file:a|b', kind: 'file' },
  ];
  const back = parseTabs(JSON.stringify(serializeTabs(tabs, 1)));
  assert.equal(back.tabs[0].dirty, true);
  assert.equal(back.tabs[1].dirty, null);
  assert.equal(draftKey({ key: 'songsterr:269', rev: null }), 'songsterr:269|');
  assert.equal(draftKey(back.tabs[0]), draftKey(tabs[0]));
  assert.notEqual(draftKey({ key: 'songsterr:269', rev: 5 }), draftKey({ key: 'songsterr:269', rev: 6 }));
});

test('library: works from memory when IndexedDB is unavailable', async () => {
  const lib = new Library();
  await lib.put({ key: 'a', title: 'A', saved: undefined });
  assert.deepEqual(await lib.get('a'), { key: 'a', title: 'A' });
  assert.equal((await lib.all()).length, 1);
  await lib.delete('a');
  assert.equal(await lib.get('a'), undefined);
});

// ---------- chords ----------
import { parseChordName, chordShape, shapeFromChord, chordSvg } from '../public/chords.js';
import { beatsFromBars, firstBeatFrom, beatSeconds, countInPlan, encodeWav } from '../public/audio.js';

test('chords: names parse to root, quality and bass', () => {
  assert.deepEqual(parseChordName('F#m7'), { root: 6, quality: 'm7', bass: null });
  assert.deepEqual(parseChordName('Bbmaj7'), { root: 10, quality: 'maj7', bass: null });
  assert.deepEqual(parseChordName('C/G'), { root: 0, quality: 'maj', bass: 7 });
  assert.deepEqual(parseChordName('Asus2'), { root: 9, quality: 'sus2', bass: null });
  assert.deepEqual(parseChordName('E5'), { root: 4, quality: '5', bass: null });
  assert.equal(parseChordName('Am(add9)').quality, 'm'); // unknown extension: falls back to the base triad
  assert.equal(parseChordName('N.C.'), null);
  assert.equal(parseChordName('C#m7♭5').quality, 'm7b5');
  assert.equal(parseChordName('C#Ø').quality, 'm7b5');
  assert.equal(parseChordName('B♭').root, 10);
  assert.equal(parseChordName(''), null);
});

test('chords: open shapes, barre shapes, and only for standard-shaped tunings', () => {
  assert.deepEqual(chordShape('C').frets, [-1, 3, 2, 0, 1, 0]);
  assert.deepEqual(chordShape('Em').frets, [0, 2, 2, 0, 0, 0]);
  assert.deepEqual(chordShape('Am').frets, [-1, 0, 2, 2, 1, 0]);
  const f = chordShape('F');
  assert.deepEqual(f.frets, [1, 3, 3, 2, 1, 1]);
  assert.equal(f.barre, 1);
  const bm = chordShape('Bm'); // A shape at fret 2 is lower than E shape at fret 7
  assert.deepEqual(bm.frets, [-1, 2, 4, 4, 3, 2]);
  const cs = chordShape('C#m7');
  assert.ok(cs.firstFret >= 1 && cs.barre === 4);
  // Every shape sounds the right notes: check pitch classes against the chord.
  const tuning = [40, 45, 50, 55, 59, 64];
  for (const [name, pcs] of [['G', [7, 11, 2]], ['D7', [2, 6, 9, 0]], ['Ebmaj7', [3, 7, 10, 2]], ['F#m', [6, 9, 1]], ['Bdim', [11, 2, 5]]]) {
    const played = chordShape(name).frets.map((fret, i) => (fret < 0 ? null : (tuning[i] + fret) % 12)).filter(p => p !== null);
    assert.ok(played.every(p => pcs.includes(p)), `${name} plays ${played}`);
    assert.ok(played.includes(pcs[0]), `${name} has its root`);
  }
  // E-flat standard uses the same shapes a semitone lower; drop D gets none.
  assert.deepEqual(chordShape('Eb', tuning.map(p => p - 1)).frets, [0, 2, 2, 1, 0, 0]);
  assert.equal(chordShape('D', [38, 45, 50, 55, 59, 64]), null);
  assert.equal(chordShape('C', [28, 33, 38, 43]), null); // bass
  // Slash chords put the bass on the next string down when it is in reach.
  assert.deepEqual(chordShape('D/A').frets, [-1, 0, 0, 2, 3, 2]);
  assert.deepEqual(chordShape('C/G').frets, [3, 3, 2, 0, 1, 0]);
  assert.deepEqual(chordShape('G/B').frets, [3, 2, 0, 0, 0, 3]); // no string below the low E: shape unchanged

});

test('chords: file chords and SVG diagrams', () => {
  const shape = shapeFromChord({ strings: [0, 1, 0, 2, 3, -1], firstFret: 1, barreFrets: [] }); // C, high string first
  assert.deepEqual(shape.frets, [-1, 3, 2, 0, 1, 0]);
  assert.equal(shapeFromChord({ strings: [] }), null);
  const svg = chordSvg(chordShape('F'));
  assert.match(svg, /^<svg/);
  assert.equal((svg.match(/<circle/g) || []).length, 6); // every string fretted, three of them on the barre
  assert.match(svg, /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="8"/); // the barre
  assert.match(chordSvg(chordShape('C#m7')), />4<\/text>/); // first-fret label
  assert.match(chordSvg(chordShape('D')), />×</); // muted strings
});

// ---------- metronome, count-in, WAV ----------
test('audio: beats per bar follow the time signature, first beat accented', () => {
  const bar = (num, den) => ({ timeSignatureNumerator: num, timeSignatureDenominator: den });
  const beats = beatsFromBars([
    { start: 0, end: 3840, masterBar: bar(4, 4) },
    { start: 3840, end: 3840 + 2880, masterBar: bar(6, 8) },
  ]);
  assert.equal(beats.length, 4 + 6);
  assert.deepEqual(beats.slice(0, 5).map(b => b.tick), [0, 960, 1920, 2880, 3840]);
  assert.deepEqual(beats.filter(b => b.accent).map(b => b.tick), [0, 3840]);
  assert.equal(beats[5].tick - beats[4].tick, 480);
  assert.equal(firstBeatFrom(beats, 961), 2);
  assert.equal(firstBeatFrom(beats, 0), 0);
  assert.equal(firstBeatFrom(beats, 99999), beats.length);
  // A pickup bar shorter than its time signature only gets the beats that fit.
  assert.equal(beatsFromBars([{ start: 0, end: 960, masterBar: bar(4, 4) }]).length, 1);
});

test('audio: count-in plan', () => {
  assert.equal(beatSeconds(120), 0.5);
  assert.equal(beatSeconds(120, 8), 0.25);
  const plan = countInPlan({ bars: 2, numerator: 3, denominator: 4, tempo: 60 });
  assert.equal(plan.clicks.length, 6);
  assert.equal(plan.duration, 6);
  assert.deepEqual(plan.clicks.map(c => c.accent), [true, false, false, true, false, false]);
});

test('audio: WAV header and samples', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), { sampleRate: 22050, channels: 2 });
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 22050);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual([1, 2, 3, 4].map(i => view.getInt16(42 + i * 2, true)), [0, 32767, -32768, 16383]);
});

// ---------- your own YouTube video ----------
import { parseYouTubeId, barStartSeconds } from '../public/youtube.js';

test('youtube: video ids from every kind of link', () => {
  for (const link of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'youtu.be/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ?feature=share',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ',
  ]) assert.equal(parseYouTubeId(link), 'dQw4w9WgXcQ', link);
  for (const bad of ['', 'https://vimeo.com/123', 'https://www.youtube.com/watch?v=short', 'not a link']) assert.equal(parseYouTubeId(bad), null, bad);
});

test('youtube: bar start times follow the tab tempo, including changes', () => {
  const bar = (tempoAutomations = []) => ({ masterBar: { tempoAutomations } });
  const bars = [
    { start: 0, end: 3840, ...bar() },                                              // 4/4 at 120: 2 s
    { start: 3840, end: 7680, ...bar([{ ratioPosition: 0.5, value: 60 }]) },        // half at 120 (1 s), half at 60 (2 s)
    { start: 7680, end: 11520, ...bar() },                                          // stays at 60: 4 s
    { start: 0, end: 3840, ...bar([{ ratioPosition: 0, value: 120 }]) },            // a repeat back to 120
  ];
  assert.deepEqual(barStartSeconds(bars, 120), [0, 2, 5, 9]);
});

// ---------- editing ----------
import * as ed from '../public/editor.js';

function editable() {
  const b4 = () => [0, 1, 2, 3].map(() => beat([note(3, 5)])); // Songsterr string 5 = alphaTab string 1 (low E)
  return convert([guitar([bar(b4()), bar(b4()), bar(b4())])]);
}
const rebuild = score => at.model.JsonConverter.jsObjectToScore(at.model.JsonConverter.scoreToJsObject(score), new at.Settings());
const beatsOf = (score, b = 0) => score.tracks[0].staves[0].bars[b].voices[0].beats;
const sel0 = { track: 0, staff: 0, bar: 0, beat: 0, string: 1 };

test('edit: frets, new notes, clearing and rests', () => {
  let score = editable();
  assert.deepEqual(ed.setFret(at, score, sel0, 5), sel0);
  ed.setFret(at, score, { ...sel0, string: 3 }, 7); // a new note on the D string
  ed.makeRest(score, { ...sel0, beat: 1 });
  ed.clearNote(score, { ...sel0, beat: 2 });
  assert.equal(ed.clearNote(score, { ...sel0, beat: 2 }), null); // nothing left to clear
  assert.equal(ed.setFret(at, score, sel0, 31), null);
  score = rebuild(score);
  const b = beatsOf(score);
  assert.deepEqual(b[0].notes.map(n => [n.string, n.fret]).sort(), [[1, 5], [3, 7]]);
  assert.ok(b[1].isRest && b[2].isRest);
  assert.equal(b[0].notes.find(n => n.string === 3).realValue, 50 + 7);
});

test('edit: navigation crosses bars and stays in range', () => {
  const score = editable();
  assert.deepEqual(ed.moveBeat(score, { ...sel0, beat: 3 }, 1), { ...sel0, bar: 1, beat: 0 });
  assert.deepEqual(ed.moveBeat(score, { ...sel0, bar: 1 }, -1), { ...sel0, bar: 0, beat: 3 });
  assert.deepEqual(ed.moveBeat(score, sel0, -1), sel0);
  assert.equal(ed.moveString(score, { ...sel0, string: 6 }, 1).string, 6);
  assert.equal(ed.moveString(score, sel0, 1).string, 2);
  assert.deepEqual(ed.clampSelection(score, { track: 0, staff: 0, bar: 99, beat: 99, string: 99 }), { track: 0, staff: 0, bar: 2, beat: 3, string: 6 });
});

test('edit: durations, dots, inserting and deleting beats', () => {
  let score = editable();
  ed.changeDuration(score, sel0, -1); // shorter: quarter -> eighth
  ed.toggleDot(score, { ...sel0, beat: 1 });
  const s = ed.insertBeat(at, score, { ...sel0, beat: 2 });
  assert.equal(s.beat, 2);
  ed.deleteBeat(score, { ...sel0, beat: 4 });
  score = rebuild(score);
  const b = beatsOf(score);
  assert.deepEqual(b.map(x => [x.duration, x.dots, x.isRest]), [[8, 0, false], [4, 1, false], [4, 0, true], [4, 0, false]]);
  assert.deepEqual(b.map(x => x.playbackStart), [0, 480, 480 + 1440, 480 + 1440 + 960]);
  assert.equal(ed.changeDuration(score, { ...sel0 }, 1) && beatsOf(score)[0].duration, 4);
});

test('edit: techniques and ties survive a rebuild and a Guitar Pro round trip', () => {
  let score = editable();
  for (const id of ['hammer', 'palmMute', 'vibrato', 'bend', 'harmonic']) ed.toggleTechnique(at, score, sel0, id);
  ed.toggleTechnique(at, score, { ...sel0, beat: 2 }, 'slide');
  ed.setFret(at, score, { ...sel0, beat: 1 }, 9);
  assert.ok(ed.toggleTechnique(at, score, { ...sel0, beat: 1 }, 'tie'));
  score = rebuild(score);
  const b = beatsOf(score);
  const n0 = b[0].notes[0];
  assert.ok(n0.isHammerPullOrigin && n0.isPalmMute && n0.hasBend && n0.harmonicType === M.HarmonicType.Natural);
  assert.equal(n0.vibrato, M.VibratoType.Slight);
  assert.ok(b[1].notes[0].isTieDestination && b[1].notes[0].fret === 3, 'tie copies the fret');
  assert.equal(b[2].notes[0].slideOutType, M.SlideOutType.Shift);
  const re = at.importer.ScoreLoader.loadScoreFromBytes(new at.exporter.Gp7Exporter().export(score, new at.Settings()));
  const r0 = re.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
  assert.ok(r0.isHammerPullOrigin && r0.isPalmMute && r0.hasBend);
  // toggling again turns them off
  ed.toggleTechnique(at, score, sel0, 'bend');
  ed.toggleTechnique(at, score, sel0, 'hammer');
  score = rebuild(score);
  assert.ok(!beatsOf(score)[0].notes[0].hasBend && !beatsOf(score)[0].notes[0].isHammerPullOrigin);
});

test('edit: bars, time signatures, tempo and sections', () => {
  let score = editable();
  assert.deepEqual(ed.insertBar(at, score, sel0), { ...sel0, bar: 1 });
  ed.setTimeSignature(score, { ...sel0, bar: 1 }, 3, 4);
  ed.setTempo(at, score, { ...sel0, bar: 2 }, 140);
  ed.setSection(at, score, { ...sel0, bar: 2 }, 'Chorus');
  assert.equal(ed.setTimeSignature(score, sel0, 5, 3), null);
  score = rebuild(score);
  assert.equal(score.masterBars.length, 4);
  assert.equal(score.masterBars[1].timeSignatureNumerator, 3);
  assert.ok(beatsOf(score, 1)[0].isRest);
  assert.equal(score.masterBars[2].tempoAutomations[0].value, 140);
  assert.equal(score.masterBars[2].section.text, 'Chorus');
  // deleting a bar keeps its section and tempo on the next bar
  ed.deleteBar(score, { ...sel0, bar: 2 });
  score = rebuild(score);
  assert.equal(score.masterBars.length, 3);
  assert.equal(score.masterBars[2].section?.text, 'Chorus');
  assert.equal(score.masterBars[2].tempoAutomations[0].value, 140);
  const one = convert([guitar([bar(fourBeats())])]);
  assert.equal(ed.deleteBar(one, sel0), null);
});

test('edit: copy / paste bars through the JSON form', () => {
  const score = editable();
  ed.setFret(at, score, sel0, 12);
  const js = at.model.JsonConverter.scoreToJsObject(score);
  const copied = ed.cloneJs(ed.barJs(js, sel0));
  ed.putBarJs(js, { ...sel0, bar: 2 }, copied, { fresh: true });
  const pasted = at.model.JsonConverter.jsObjectToScore(js, new at.Settings());
  assert.equal(beatsOf(pasted, 2)[0].notes[0].fret, 12);
  assert.notEqual(beatsOf(pasted, 2)[0].id, beatsOf(pasted, 0)[0].id);
  assert.equal(beatsOf(pasted, 1)[0].notes[0].fret, 3);
});

test('edit: a hammer-on needs a next note on the same string', () => {
  const score = editable();
  const last = { ...sel0, bar: 2, beat: 3 };
  assert.equal(ed.toggleTechnique(at, score, last, 'hammer'), null); // nothing after the last note
  assert.equal(ed.toggleTechnique(at, score, { ...sel0, string: 2 }, 'hammer'), null); // no note on that string
  assert.ok(ed.toggleTechnique(at, score, sel0, 'hammer'));
  assert.ok(ed.toggleTechnique(at, score, sel0, 'hammer')); // turning it off is always allowed
});

test('edit: tunings, renaming, adding and removing tracks', () => {
  let score = editable();
  assert.equal(ed.setTuning(at, score, 0, ed.TUNINGS[1][1], 'Drop D'), true);
  assert.equal(ed.setTuning(at, score, 0, ed.TUNINGS[11][1]), null); // bass tuning has 4 strings
  assert.equal(ed.renameTrack(score, 0, 'Lead'), true);
  const i = ed.addTrack(at, score, 'bass');
  assert.equal(i, 1);
  score = rebuild(score);
  assert.deepEqual(score.tracks[0].staves[0].tuning, [64, 59, 55, 50, 45, 38]);
  assert.equal(score.tracks[0].staves[0].tuningName, 'Drop D');
  assert.equal(beatsOf(score)[0].notes[0].realValue, 38 + 3); // fret 3 on the dropped string
  assert.equal(score.tracks[0].name, 'Lead');
  const bass = score.tracks[1];
  assert.equal(bass.staves[0].tuning.length, 4);
  assert.equal(bass.staves[0].bars.length, score.masterBars.length);
  assert.notEqual(bass.playbackInfo.primaryChannel, score.tracks[0].playbackInfo.primaryChannel);
  assert.notEqual(bass.playbackInfo.primaryChannel, 9);
  // the new track can be edited and exported
  ed.setFret(at, score, { track: 1, staff: 0, bar: 0, beat: 0, string: 1 }, 5);
  score = rebuild(score);
  assert.equal(score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].realValue, 28 + 5);
  const re = at.importer.ScoreLoader.loadScoreFromBytes(new at.exporter.Gp7Exporter().export(score, new at.Settings()));
  assert.equal(re.tracks.length, 2);
  assert.ok(ed.removeTrack(score, 0));
  score = rebuild(score);
  assert.equal(score.tracks.length, 1);
  assert.equal(score.tracks[0].index, 0);
  assert.equal(ed.removeTrack(score, 0), null); // keep at least one track
});

test('edit: triplets, repeats and key signatures', () => {
  let score = editable();
  for (const b of [0, 1, 2]) ed.toggleTriplet(score, { ...sel0, beat: b });
  ed.toggleRepeatStart(score, { ...sel0, bar: 1 });
  ed.setRepeatEnd(score, { ...sel0, bar: 1 }, 3);
  assert.equal(ed.setRepeatEnd(score, sel0, 1), null);
  ed.setKeySignature(score, { ...sel0, bar: 1 }, 2); // D major from bar 2
  score = rebuild(score);
  const b = beatsOf(score);
  assert.equal(b[0].tupletNumerator, 3);
  assert.equal(b[1].playbackStart, 640); // a triplet quarter lasts 2/3 of 960
  assert.equal(b[3].playbackStart, 1920);
  assert.ok(score.masterBars[1].isRepeatStart);
  assert.equal(score.masterBars[1].repeatCount, 3);
  assert.deepEqual(playbackBarOrder(at, score), [0, 1, 1, 1, 2]);
  assert.deepEqual(score.tracks[0].staves[0].bars.map(x => x.keySignature), [0, 2, 2]);
  ed.toggleTriplet(score, sel0);
  score = rebuild(score);
  assert.equal(beatsOf(score)[0].tupletNumerator, -1);
});
