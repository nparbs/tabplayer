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
