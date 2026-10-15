// Fetches real Songsterr songs, converts them, exports GP7 and re-imports the result.
// Usage: node test/convert.test.mjs [songId ...]
import * as alphaTab from '@coderline/alphatab';
import { fetchSongsterr } from '../server.js';
import { songsterrToScore } from '../public/songsterr.js';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['27', '269', '37', '431'];
let failed = 0;
for (const id of ids) {
  try {
    const { meta, tracks } = await fetchSongsterr(id);
    const score = songsterrToScore(alphaTab, meta, tracks);
    const bytes = new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
    const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings());
    const notes = s => s.tracks.reduce((n, t) => n + t.staves[0].bars.reduce((a, b) => a + b.voices.reduce((c, v) => c + v.beats.reduce((d, bt) => d + bt.notes.length, 0), 0), 0), 0);
    const ok = back.masterBars.length === score.masterBars.length && back.tracks.length === score.tracks.length && notes(back) === notes(score);
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${id} ${meta.artist} - ${meta.title}: ${score.tracks.length} tracks, ${score.masterBars.length} bars, ${notes(score)} notes, tempo ${score.tempo}, gp ${bytes.length} bytes; reimport ${back.tracks.length}/${back.masterBars.length}/${notes(back)}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${id}: ${e.stack}`);
  }
}
process.exit(failed ? 1 : 0);
