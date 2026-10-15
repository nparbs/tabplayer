// Fetches real Songsterr songs, converts them, exports GP7 and re-imports the result.
// Also checks that played bars (repeats expanded) line up with Songsterr's YouTube sync points,
// and that an older revision can be loaded.
// Usage: node test/convert.test.mjs [songId ...]
import * as alphaTab from '@coderline/alphatab';
import { fetchSongsterr } from '../server.js';
import { songsterrToScore, playbackBarOrder } from '../public/songsterr.js';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['27', '269', '37', '431', '12', '447'];
let failed = 0;
const notes = s => s.tracks.reduce((n, t) => n + t.staves[0].bars.reduce((a, b) => a + b.voices.reduce((c, v) => c + v.beats.reduce((d, bt) => d + bt.notes.length, 0), 0), 0), 0);

function check(label, fn) {
  try {
    const msg = fn();
    console.log(`OK   ${label}${msg ? `: ${msg}` : ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${label}: ${e.stack || e}`);
  }
}

for (const id of ids) {
  let data;
  try {
    data = await fetchSongsterr(id);
  } catch (e) {
    failed++;
    console.log(`FAIL ${id}: ${e.stack}`);
    continue;
  }
  const { meta, tracks, videos } = data;
  let score;
  check(`${id} ${meta.artist} - ${meta.title}`, () => {
    score = songsterrToScore(alphaTab, meta, tracks);
    const bytes = new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
    const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings());
    const ok = back.masterBars.length === score.masterBars.length && back.tracks.length === score.tracks.length && notes(back) === notes(score);
    const summary = `${score.tracks.length} tracks, ${score.masterBars.length} bars, ${notes(score)} notes, tempo ${score.tempo}, gp ${bytes.length} bytes; reimport ${back.tracks.length}/${back.masterBars.length}/${notes(back)}`;
    if (!ok) throw new Error(summary);
    return summary;
  });
  if (!score) continue;
  const original = videos.find(v => v.feature === 'original') || videos[0];
  if (original) {
    check(`${id} video sync`, () => {
      const played = playbackBarOrder(alphaTab, score).length;
      const msg = `${played} played bars, ${original.points.length} points (${original.label}, ${videos.length} videos)`;
      if (Math.abs(played - original.points.length) > 2) throw new Error(msg);
      return msg;
    });
  }
}

const OLD_SONG = '269';
try {
  const latest = await fetchSongsterr(OLD_SONG);
  const prev = latest.meta.prevRevisionId;
  const old = await fetchSongsterr(OLD_SONG, { revision: prev });
  check(`${OLD_SONG} older revision ${prev}`, () => {
    if (old.meta.revisionId !== prev) throw new Error(`got revision ${old.meta.revisionId}`);
    const score = songsterrToScore(alphaTab, old.meta, old.tracks);
    return `${score.tracks.length} tracks, ${score.masterBars.length} bars`;
  });
} catch (e) {
  failed++;
  console.log(`FAIL older revision: ${e.stack}`);
}

process.exit(failed ? 1 : 0);
