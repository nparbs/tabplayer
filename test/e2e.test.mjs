// Browser smoke test: starts the server, loads a Songsterr URL in headless Chrome,
// checks rendering, track switching, playback, GP export and file loading.
// Usage: node test/e2e.test.mjs   (set CHROME_PATH to override the browser)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from '../server.js';

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find(p => fs.existsSync(p));
if (!executablePath) { console.log('SKIP: no Chrome/Edge found (set CHROME_PATH)'); process.exit(0); }

const server = app.listen(0);
const port = server.address().port;
const args = ['--autoplay-policy=no-user-gesture-required'];
if (process.env.CI) args.push('--no-sandbox'); // GitHub's Linux runners can't use Chrome's sandbox
const browser = await puppeteer.launch({ executablePath, headless: true, args });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.stack}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', d => d.accept()); // e.g. the "leave with unsaved edits?" prompt

const results = [];
async function step(name, fn) {
  const n0 = errors.length;
  try { await fn(); results.push(`PASS ${name}`); }
  catch (e) { results.push(`FAIL ${name}: ${e.message}`); }
  if (process.env.E2E_DEBUG && errors.length > n0) results.push(`  ^ ${errors.length - n0} browser error(s) during this step`);
}
const shotDir = path.join(os.tmpdir(), 'tabplayer-e2e');
fs.mkdirSync(shotDir, { recursive: true });

try {
  await step('load page', async () => {
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
    if (!(await page.evaluate(() => !!window.alphaTab && !!window.tabPlayerApi))) throw new Error('alphaTab not initialised');
  });

  await step('tab-only by default, view settings persist', async () => {
    const view = () => page.evaluate(() => ({
      stave: document.getElementById('stave-profile').value,
      zoom: document.getElementById('zoom').value,
      rhythm: window.tabPlayerApi.settings.notation.rhythmMode,
      scale: window.tabPlayerApi.settings.display.scale,
    }));
    const first = await view();
    if (first.stave !== 'Tab' || first.rhythm !== 0 /* TabRhythmMode.Hidden */) throw new Error(`default ${JSON.stringify(first)}`);
    await page.select('#zoom', '1.2');
    await page.reload({ waitUntil: 'networkidle0' });
    const after = await view();
    if (after.stave !== 'Tab' || after.zoom !== '1.2' || after.scale !== 1.2) throw new Error(`after reload ${JSON.stringify(after)}`);
    await page.select('#zoom', '1');
  });

  await step('search finds songs and opens one with the keyboard', async () => {
    await page.keyboard.press('/');
    if (!(await page.evaluate(() => document.activeElement.id === 'url-input'))) throw new Error('/ did not focus search');
    await page.keyboard.type('plateau nirvana');
    await page.waitForFunction(() => document.querySelectorAll('.search-result').length > 0, { timeout: 30000 });
    const first = await page.$eval('.search-result .sr-title', e => e.textContent);
    if (!/plateau/i.test(first)) throw new Error(`first result: ${first}`);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('song-title').textContent === 'Plateau' && document.getElementById('overlay').classList.contains('hidden'), { timeout: 60000 });
    if (!(await page.$eval('#search-results', e => e.classList.contains('hidden')))) throw new Error('results still open');
    if (!/-tab-s\d+/.test(await page.$eval('#url-input', e => e.value))) throw new Error('input not set to the song URL');
    await page.$eval('#url-input', e => { e.value = ''; });
  });

  await step('load Songsterr URL and render', async () => {
    await page.type('#url-input', 'https://www.songsterr.com/a/wsa/nirvana-smells-like-teen-spirit-tab-s269t2');
    await page.click('#load-form button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#alphaTab svg').length > 0 && document.getElementById('overlay').classList.contains('hidden'), { timeout: 60000 });
    const info = await page.evaluate(() => ({
      title: document.getElementById('song-title').textContent,
      tracks: document.querySelectorAll('.track').length,
      active: [...document.querySelectorAll('.track.active')].map(li => li.dataset.index),
      svgs: document.querySelectorAll('#alphaTab svg').length,
    }));
    if (info.title !== 'Smells Like Teen Spirit') throw new Error(`title ${info.title}`);
    if (info.tracks < 2) throw new Error(`only ${info.tracks} tracks`);
    if (info.active.join() !== '2') throw new Error(`active track ${info.active}`);
    await page.screenshot({ path: path.join(shotDir, 'render.png') });
  });

  await step('switch track', async () => {
    await page.click('.track[data-index="6"] .track-name');
    await page.waitForFunction(() => document.querySelector('.track[data-index="6"]').classList.contains('active'), { timeout: 30000 });
  });

  await step('player ready and plays', async () => {
    await page.waitForFunction(() => !document.getElementById('play').disabled, { timeout: 60000 });
    await page.click('#play');
    await page.waitForFunction(() => window.tabPlayerApi.timePosition > 500, { timeout: 20000 });
    await page.click('#play');
  });

  await step('speed / loop / metronome controls', async () => {
    await page.keyboard.press('-');
    await page.click('#loop');
    await page.click('#metronome');
    const s = await page.evaluate(() => ({ speed: window.tabPlayerApi.playbackSpeed, loop: window.tabPlayerApi.isLooping, met: window.tabPlayerApi.metronomeVolume }));
    if (Math.abs(s.speed - 0.95) > 1e-6 || !s.loop || s.met !== 1) throw new Error(JSON.stringify(s));
  });

  await step('loop bars by number, saved per song, with the speed trainer', async () => {
    await page.click('#loop'); // the previous step left looping on
    await page.evaluate(() => { document.getElementById('loop-from').value = '3'; document.getElementById('loop-to').value = '2'; });
    await page.click('#loop-apply');
    const applied = await page.evaluate(() => ({
      from: document.getElementById('loop-from').value, to: document.getElementById('loop-to').value,
      range: window.tabPlayerApi.playbackRange, loop: window.tabPlayerApi.isLooping,
      saved: JSON.parse(localStorage.getItem('tabplayer.loops') || '{}'),
    }));
    if (applied.from !== '2' || applied.to !== '3' || !applied.range || !applied.loop) throw new Error(JSON.stringify(applied));
    if (!Object.values(applied.saved).some(r => r.from === 2 && r.to === 3)) throw new Error(`not saved: ${JSON.stringify(applied.saved)}`);

    // One bar at 150 %, +10 % per pass: a pass takes about a second.
    await page.evaluate(() => { document.getElementById('loop-to').value = '2'; });
    await page.click('#loop-apply');
    await page.click('#trainer-on');
    await page.evaluate(() => {
      for (const [id, v] of [['trainer-start', 150], ['trainer-step', 10], ['trainer-every', 1], ['trainer-max', 170]]) {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('change'));
      }
    });
    if (await page.evaluate(() => window.tabPlayerApi.playbackSpeed) !== 1.5) throw new Error('trainer did not set the start speed');
    await page.click('#play');
    await page.waitForFunction(() => window.tabPlayerApi.playbackSpeed >= 1.6, { timeout: 30000 });
    await page.click('#play');
    const info = await page.$eval('#trainer-info', e => e.textContent);
    if (!/Pass \d+ at 1[67]0%/.test(info)) throw new Error(`trainer info: ${info}`);

    await page.click('#trainer-on');
    await page.click('#loop-clear');
    const cleared = await page.evaluate(() => ({
      range: window.tabPlayerApi.playbackRange, loop: window.tabPlayerApi.isLooping,
      saved: Object.keys(JSON.parse(localStorage.getItem('tabplayer.loops') || '{}')).length,
    }));
    if (cleared.range || cleared.loop || cleared.saved !== 0) throw new Error(JSON.stringify(cleared));
    await page.evaluate(() => { const s = document.getElementById('speed'); s.value = 95; s.dispatchEvent(new Event('input')); });
    await page.click('#loop'); // leave looping on, as the earlier step did
  });

  await step('per-track instrument override and restore', async () => {
    const sel = '.track .track-sound select';
    const before = await page.$eval(sel, s => s.closest('.track').dataset.index);
    const orig = await page.evaluate(i => window.tabPlayerApi.score.tracks[i].playbackInfo.program, Number(before));
    await page.select(sel, '30');
    const after = await page.evaluate(i => window.tabPlayerApi.score.tracks[i].playbackInfo.program, Number(before));
    if (after !== 30) throw new Error(`program ${after}`);
    await page.waitForFunction(() => window.tabPlayerApi.isReadyForPlayback, { timeout: 20000 });
    await page.select(sel, '');
    const restored = await page.evaluate(i => window.tabPlayerApi.score.tracks[i].playbackInfo.program, Number(before));
    if (restored !== orig) throw new Error(`restored ${restored}, expected ${orig}`);
  });

  await step('switch to a larger soundfont and play', async () => {
    await page.select('#soundfont', 'fluid');
    await page.waitForFunction(() => /Ready · FluidR3|Could not load/.test(document.getElementById('status').textContent), { timeout: 180000 });
    const status = await page.$eval('#status', e => e.textContent);
    if (!status.includes('FluidR3')) throw new Error(status);
    await page.waitForFunction(() => !document.getElementById('play').disabled, { timeout: 30000 });
    const t0 = await page.evaluate(() => window.tabPlayerApi.timePosition);
    await page.click('#play');
    await page.waitForFunction(t => window.tabPlayerApi.timePosition > t + 300, { timeout: 20000 }, t0);
    await page.click('#play');
    await page.select('#soundfont', 'sonivox');
    await page.waitForFunction(() => /Ready · Sonivox/.test(document.getElementById('status').textContent), { timeout: 30000 });
  });

  await step('track details show tuning names', async () => {
    const subs = await page.$$eval('.track-sub', els => els.map(e => e.textContent));
    if (!subs.includes('Standard') || !subs.includes('Drums')) throw new Error(subs.join(' | '));
  });

  await step('tab-only view: tab for fretted tracks, notation for the rest', async () => {
    const flags = await page.evaluate(() => window.tabPlayerApi.score.tracks.map(t => [t.staves[0].showTablature, t.staves[0].showStandardNotation]));
    // 0 = vocals, 6 = bass, 7 = drums
    if (String(flags[0]) !== 'false,true' || String(flags[6]) !== 'true,false' || String(flags[7]) !== 'false,true') throw new Error(JSON.stringify(flags));
    await page.click('.track[data-index="0"] .track-name'); // a track without tab must still render
    await page.waitForFunction(() => document.querySelector('.track[data-index="0"]').classList.contains('active') && document.getElementById('overlay').classList.contains('hidden'), { timeout: 30000 });
    await page.click('.track[data-index="6"] .track-name');
    await page.waitForFunction(() => document.querySelector('.track[data-index="6"]').classList.contains('active') && document.getElementById('overlay').classList.contains('hidden'), { timeout: 30000 });
  });

  await step('revision list and YouTube sources offered', async () => {
    await page.waitForFunction(() => document.getElementById('revision').options.length > 1, { timeout: 30000 });
    const info = await page.evaluate(() => ({
      rowHidden: document.getElementById('revision-row').classList.contains('hidden'),
      selected: document.getElementById('revision').value,
      sources: [...document.getElementById('audio-source').options].map(o => o.textContent),
    }));
    if (info.rowHidden || !info.selected) throw new Error(JSON.stringify(info));
    if (!info.sources[1]?.includes('Original recording')) throw new Error(`sources: ${info.sources.slice(0, 3)}`);
  });

  await step('themes recolor the UI and the score', async () => {
    const read = () => page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      paper: getComputedStyle(document.getElementById('alphaTab')).backgroundColor,
      ink: window.tabPlayerApi.settings.display.resources.mainGlyphColor.rgba,
    }));
    await page.select('#theme', 'light');
    const light = await read();
    await page.select('#theme', 'dark');
    const dark = await read();
    if (light.theme !== 'light' || dark.theme !== 'dark') throw new Error(`${light.theme}/${dark.theme}`);
    if (light.paper === dark.paper || light.ink === dark.ink) throw new Error(JSON.stringify({ light, dark }));
    await page.waitForFunction(() => document.getElementById('overlay').classList.contains('hidden'), { timeout: 30000 });
    await page.screenshot({ path: path.join(shotDir, 'dark.png') });
    await page.keyboard.press('t');
    if ((await read()).theme !== 'light') throw new Error('T did not toggle theme');
    await page.select('#theme', 'system');
  });

  await step('YouTube audio plays in sync with the tab', async () => {
    if (await page.evaluate(() => window.tabPlayerApi.playerState === 1)) await page.click('#play');
    await page.evaluate(() => { window.tabPlayerApi.isLooping = false; });
    await page.select('#audio-source', '0');
    await page.waitForFunction(() => window.tabPlayerYouTube.active || document.getElementById('status').classList.contains('error'), { timeout: 45000 });
    const status = await page.$eval('#status', e => e.textContent);
    if (!(await page.evaluate(() => window.tabPlayerYouTube.active))) throw new Error(`YouTube did not start: ${status}`);
    // Seeking the tab to bar 20 must seek the video to Songsterr's timestamp for bar 20.
    const r = await page.evaluate(async () => {
      const api = window.tabPlayerApi, yt = window.tabPlayerYouTube;
      api.tickPosition = api.score.masterBars[20].start;
      await new Promise(res => setTimeout(res, 1500));
      return { video: yt.player.getCurrentTime(), expected: yt.video.points[20], metronomeDisabled: document.getElementById('metronome').disabled };
    });
    if (Math.abs(r.video - r.expected) > 0.6) throw new Error(`video at ${r.video}s, expected ~${r.expected}s`);
    if (!r.metronomeDisabled) throw new Error('metronome should be disabled with YouTube audio');
    await page.click('#play');
    const moved = await page.waitForFunction(() => {
      const yt = window.tabPlayerYouTube;
      return yt.player.getPlayerState() === 1 && yt.player.getCurrentTime() > yt.video.points[20] + 2 && window.tabPlayerApi.playerState === 1;
    }, { timeout: 30000 }).then(() => true, () => false);
    const playState = await page.evaluate(() => ({ yt: window.tabPlayerYouTube.player.getPlayerState(), status: document.getElementById('status').textContent }));
    if (!moved) throw new Error(`video did not play: ${JSON.stringify(playState)}`);
    // The cursor follows the video: bar under the cursor matches the video's bar.
    const sync = await page.evaluate(() => {
      const api = window.tabPlayerApi, yt = window.tabPlayerYouTube;
      const t = yt.player.getCurrentTime();
      const videoBar = yt.video.points.findLastIndex(p => p <= t);
      const tick = api.tickPosition;
      const tabBar = api.score.masterBars.findLastIndex(m => m.start <= tick);
      return { videoBar, tabBar };
    });
    if (Math.abs(sync.videoBar - sync.tabBar) > 1) throw new Error(JSON.stringify(sync));
    await page.click('#play');
    await page.screenshot({ path: path.join(shotDir, 'youtube.png') });
  });

  await step('back to synth audio', async () => {
    await page.select('#audio-source', 'synth');
    await page.waitForFunction(() => !window.tabPlayerYouTube.active && window.tabPlayerApi.isReadyForPlayback, { timeout: 60000 });
    const before = await page.evaluate(() => window.tabPlayerApi.timePosition);
    await page.click('#play');
    await page.waitForFunction(b => window.tabPlayerApi.timePosition > b + 500, { timeout: 20000 }, before);
    await page.click('#play');
    if (!(await page.$eval('#video-panel', e => e.classList.contains('hidden')))) throw new Error('video panel still visible');
  });

  await step('your own YouTube video, synced to the tab tempo', async () => {
    const videoId = await page.evaluate(() => window.tabPlayerYouTube.video?.videoId);
    await page.select('#audio-source', 'custom');
    if (await page.$eval('#custom-video', e => e.classList.contains('hidden'))) throw new Error('link form not shown');
    await page.type('#custom-video-url', `https://www.youtube.com/watch?v=${videoId}`);
    await page.click('#custom-video button[type=submit]');
    await page.waitForFunction(() => window.tabPlayerYouTube.active && window.tabPlayerYouTube.video?.custom, { timeout: 45000 });
    const info = await page.evaluate(() => ({
      points: window.tabPlayerYouTube.video.points.length,
      bars: window.tabPlayerApi.tickCache.masterBars.length,
      syncEnabled: !document.getElementById('custom-video-sync').disabled,
      saved: Object.values(JSON.parse(localStorage.getItem('tabplayer.customVideos') || '{}')).length,
    }));
    if (info.points !== info.bars || !info.syncEnabled || !info.saved) throw new Error(JSON.stringify(info));
    await page.click('#custom-video-sync');
    if (!/Synced/.test(await page.$eval('#status', e => e.textContent))) throw new Error('sync button did nothing');
    await page.select('#audio-source', 'synth');
    await page.waitForFunction(() => !window.tabPlayerYouTube.active && window.tabPlayerApi.isReadyForPlayback, { timeout: 60000 });
  });

  await step('load an older revision', async () => {
    const target = await page.evaluate(() => {
      const sel = document.getElementById('revision');
      const opt = [...sel.options].find(o => o.value !== sel.value && !/rejected|pending/.test(o.textContent));
      return opt?.value;
    });
    if (!target) throw new Error('no older revision to pick');
    await page.select('#revision', target);
    await page.waitForFunction(t => document.getElementById('status').textContent.includes(`revision ${t}`), { timeout: 60000 }, target);
    if (!page.url().includes(`rev=${target}`)) throw new Error(`url ${page.url()}`);
  });

  await step('clear error for a missing song', async () => {
    await page.$eval('#url-input', e => { e.value = ''; });
    await page.type('#url-input', '999999999');
    await page.click('#load-form button[type=submit]');
    await page.waitForFunction(() => document.getElementById('status').classList.contains('error'), { timeout: 30000 });
    const msg = await page.$eval('#status', e => e.textContent);
    if (!/not found/i.test(msg)) throw new Error(msg);
    // The 404 and the logged error are expected here.
    for (let i = errors.length - 1; i >= 0; i--) if (/404|999999999/.test(errors[i])) errors.splice(i, 1);
  });

  let gpBytes;
  await step('export .gp', async () => {
    gpBytes = await page.evaluate(() => {
      const a = window.tabPlayerApi;
      return Array.from(new window.alphaTab.exporter.Gp7Exporter().export(a.score, a.settings).slice(0, 4));
    });
    if (gpBytes[0] !== 0x50 || gpBytes[1] !== 0x4b) throw new Error('not a zip/GP7 file');
  });

  await step('open exported .gp file', async () => {
    const tmp = path.join(shotDir, 'roundtrip.gp');
    const bytes = await page.evaluate(() => {
      const a = window.tabPlayerApi;
      return Array.from(new window.alphaTab.exporter.Gp7Exporter().export(a.score, a.settings));
    });
    fs.writeFileSync(tmp, Buffer.from(bytes));
    const input = await page.$('#file-input');
    await input.uploadFile(tmp);
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Opened'), { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('overlay').classList.contains('hidden'), { timeout: 30000 });
    await page.screenshot({ path: path.join(shotDir, 'reopened.png') });
  });

  await step('transpose and capo per track and for the whole song', async () => {
    const i = await page.$eval('.track .capo', el => Number(el.closest('.track').dataset.index)); // a guitar or bass track
    const pitch = () => page.evaluate(i => {
      const s = window.tabPlayerApi.score.tracks[i].staves[0];
      return { tp: s.transpositionPitch, capo: s.capo, sub: document.querySelector(`.track[data-index="${i}"] .track-sub`).textContent, song: document.getElementById('song-transpose').value };
    }, i);
    const before = await pitch();
    await page.select(`.track[data-index="${i}"] .transpose`, '2');
    const up = await pitch();
    if (up.tp !== before.tp - 2) throw new Error(`transpose ${JSON.stringify([before, up])}`);
    await page.select('#song-transpose', '0');
    if ((await pitch()).tp !== before.tp) throw new Error('song transpose did not reset the track');
    await page.select(`.track[data-index="${i}"] .capo`, '3');
    const capo = await pitch();
    if (capo.capo !== 3 || !capo.sub.includes('Capo 3')) throw new Error(`capo ${JSON.stringify(capo)}`);
    await page.select(`.track[data-index="${i}"] .capo`, String(before.capo));
    await page.click(`.track[data-index="${i}"] .track-name`); // show it on the fretboard and in the chord panel
  });

  await step('chord diagrams for the track, click jumps to the chord', async () => {
    const withChords = await page.evaluate(() => window.tabPlayerApi.score.tracks.findIndex(t =>
      !t.staves[0].isPercussion && t.staves[0].bars.some(b => b.voices[0].beats.some(x => x.chord))));
    if (withChords >= 0) await page.click(`.track[data-index="${withChords}"] .track-name`);
    const info = await page.evaluate(() => ({
      shown: !document.getElementById('chords-section').classList.contains('hidden'),
      chords: document.querySelectorAll('#chord-panel .chord').length,
      diagrams: document.querySelectorAll('#chord-panel .chord svg').length,
      named: [...window.tabPlayerApi.score.tracks].some(t => t.staves[0].bars.some(b => b.voices[0].beats.some(x => x.chord))),
    }));
    if (!info.named) { results.push('  (no chord symbols in this song: chord panel not checked)'); return; }
    if (!info.shown || !info.chords) throw new Error(JSON.stringify(info));
    const tick0 = await page.evaluate(() => window.tabPlayerApi.tickPosition);
    await page.click('#chord-panel .chord:last-child');
    const tick1 = await page.evaluate(() => window.tabPlayerApi.tickPosition);
    if (tick1 === tick0) throw new Error('clicking a chord did not move the playhead');
  });

  await step('bottom panel: piano keyboard, left-handed, note names', async () => {
    for (const [sel, val] of [['#instrument-view', 'piano'], ['#note-labels', 'name']]) await page.select(sel, val);
    await page.click('#left-handed');
    await page.click('#all-notes');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tabplayer.view')));
    if (saved.instrument !== 'piano' || saved.noteLabels !== 'name' || !saved.leftHanded || !saved.allNotes) throw new Error(JSON.stringify(saved));
    await page.screenshot({ path: path.join(shotDir, 'piano.png') });
    await page.select('#instrument-view', 'fretboard');
    await page.screenshot({ path: path.join(shotDir, 'lefty-fretboard.png') });
    await page.select('#instrument-view', 'auto');
    await page.select('#note-labels', 'fret');
    await page.click('#left-handed');
    await page.click('#all-notes');
  });

  await step('metronome sounds and a two-bar count-in', async () => {
    await page.evaluate(() => {
      const c = window.tabPlayerClicker;
      c.count = 0;
      const play = c.play.bind(c);
      c.play = (...a) => { c.count++; return play(...a); };
    });
    if (await page.evaluate(() => window.tabPlayerApi.playerState === 1)) await page.click('#play');
    await page.evaluate(() => { window.tabPlayerApi.isLooping = false; window.tabPlayerApi.tickPosition = 0; });
    await page.select('#metro-sound', 'woodblock');
    if (!(await page.$eval('#metronome', b => b.classList.contains('on')))) await page.click('#metronome');
    if (await page.evaluate(() => window.tabPlayerApi.metronomeVolume) !== 0) throw new Error('synth metronome should be off with a custom sound');
    await page.click('#play');
    await new Promise(r => setTimeout(r, 2500));
    await page.click('#play');
    const metroClicks = await page.evaluate(() => window.tabPlayerClicker.count);
    if (metroClicks < 2) throw new Error(`only ${metroClicks} metronome clicks in 2.5 s`);
    await page.click('#metronome');
    await page.select('#metro-sound', 'synth');
    // Count-in: clicks first, then playback starts.
    await page.select('#count-in-bars', '2');
    await page.click('#count-in');
    await page.evaluate(() => { window.tabPlayerClicker.count = 0; });
    await page.click('#play');
    const during = await page.evaluate(() => ({ playing: window.tabPlayerApi.playerState === 1, clicks: window.tabPlayerClicker.count, status: document.getElementById('status').textContent }));
    if (during.playing || !/Count-in/.test(during.status) || during.clicks < 4) throw new Error(`count-in ${JSON.stringify(during)}`);
    await page.waitForFunction(() => window.tabPlayerApi.playerState === 1, { timeout: 15000 });
    await page.click('#play');
    await page.click('#count-in');
  });

  await step('export the looped bars as WAV', async () => {
    await page.evaluate(() => {
      window.__downloads = [];
      HTMLAnchorElement.prototype.click = function () {
        const name = this.download;
        fetch(this.href).then(r => r.arrayBuffer()).then(b => window.__downloads.push({ name, size: b.byteLength, head: String.fromCharCode(...new Uint8Array(b, 0, 4)) }));
      };
      document.getElementById('loop-from').value = '1';
      document.getElementById('loop-to').value = '2';
    });
    await page.click('#loop-apply');
    await page.click('#export-wav');
    await page.waitForFunction(() => window.__downloads.length > 0, { timeout: 60000 });
    const d = await page.evaluate(() => window.__downloads[0]);
    if (d.head !== 'RIFF' || !d.name.endsWith('.wav') || d.size < 44100 * 4) throw new Error(JSON.stringify(d));
    await page.click('#loop-clear');
  });

  await step('edit: frets, techniques, lengths, bars, undo / redo, tempo, save', async () => {
    const ctrl = async key => { await page.keyboard.down('Control'); await page.keyboard.press(key); await page.keyboard.up('Control'); };
    const shown = () => page.evaluate(() => {
      const api = window.tabPlayerApi, pos = document.getElementById('edit-pos').textContent;
      const m = /Bar (\d+)\/(\d+) · Beat (\d+)/.exec(pos);
      const [bar, , beat] = m ? [Number(m[1]) - 1, 0, Number(m[3]) - 1] : [0, 0, 0];
      const track = api.tracks.find(t => document.querySelector(`.track.active[data-index="${t.index}"]`)) ?? api.tracks[0];
      const b = track.staves[0].bars[bar]?.voices[0].beats[beat];
      return { pos, bars: api.score.masterBars.length, notes: b?.notes.map(n => [n.string, n.fret, n.isPalmMute]), duration: b?.duration, rest: b?.isRest };
    });
    const settle = () => page.waitForFunction(() => document.getElementById('overlay').classList.contains('hidden'), { timeout: 30000 })
      .then(() => new Promise(r => setTimeout(r, 400)));
    await page.click(`.track[data-index="${await page.$eval('.track .capo', el => el.closest('.track').dataset.index)}"] .track-name`);
    await settle();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('e');
    if (await page.$eval('#edit-bar', e => e.classList.contains('hidden'))) throw new Error('edit toolbar not shown');
    const bars0 = (await shown()).bars;
    await ctrl('Insert'); // a new, empty bar after the current one
    await settle();
    let now = await shown();
    if (now.bars !== bars0 + 1 || !now.rest) throw new Error(`insert bar ${JSON.stringify(now)}`);
    await page.keyboard.press('1'); await page.keyboard.press('2'); // fret 12 on the top string
    await settle();
    await page.keyboard.press('h'); // no next note to hammer on to: refused with a message
    if (!/next note/.test(await page.$eval('#status', e => e.textContent))) throw new Error('no hint for a lone hammer-on');
    await page.keyboard.press('p'); // palm mute
    await page.keyboard.press('-'); // whole -> half
    await settle();
    now = await shown();
    if (now.notes?.[0]?.[1] !== 12 || !now.notes[0][2] || now.duration !== 2) throw new Error(`typed ${JSON.stringify(now)}`);
    if (!(await page.$eval('#tabbar .tab.active', t => !!t.querySelector('.tab-dirty')))) throw new Error('tab not marked as edited');
    if (!(await page.$('.edit-cursor')) || !(await page.$('.edit-string'))) throw new Error('edit cursor not drawn');
    await ctrl('z'); await settle(); await ctrl('z'); await settle(); await ctrl('z'); await settle();
    now = await shown();
    if (!now.rest || now.bars !== bars0 + 1) throw new Error(`undo ${JSON.stringify(now)}`);
    await ctrl('y'); await settle();
    if ((await shown()).notes?.[0]?.[1] !== 12) throw new Error('redo did not bring the note back');
    // bar properties
    await page.$eval('#edit-tempo', el => { el.value = '150'; el.dispatchEvent(new Event('change')); });
    await settle();
    const tempo = await page.evaluate(() => {
      const bar = Number(/Bar (\d+)/.exec(document.getElementById('edit-pos').textContent)[1]) - 1;
      return window.tabPlayerApi.score.masterBars[bar].tempoAutomations[0]?.value;
    });
    if (tempo !== 150) throw new Error(`tempo ${tempo}`);
    await page.select('#edit-repeat', '2');
    await settle();
    await page.keyboard.press('u'); // triplet
    await settle();
    const bar = await page.evaluate(() => {
      const pos = document.getElementById('edit-pos').textContent;
      const i = Number(/Bar (\d+)/.exec(pos)[1]) - 1, beat = Number(/Beat (\d+)/.exec(pos)[1]) - 1;
      const api = window.tabPlayerApi;
      const track = api.score.tracks[[...document.querySelectorAll('.track')].findIndex(li => li.classList.contains('active'))];
      return { repeat: api.score.masterBars[i].repeatCount, tuplet: track.staves[0].bars[i].voices[0].beats[beat].tupletNumerator };
    });
    if (bar.repeat !== 2 || bar.tuplet !== 3) throw new Error(`repeat / triplet ${JSON.stringify(bar)}`);
    // clicking a note in the score selects it
    const pt = await page.evaluate(() => {
      const api = window.tabPlayerApi;
      const beat = api.tracks[0].staves[0].bars.flatMap(b => b.voices[0].beats).find(b => b.notes.length && b.voice.bar.index > 2);
      const bb = api.boundsLookup.findBeat(beat), r = document.getElementById('alphaTab').getBoundingClientRect();
      bb && document.getElementById('viewport').scrollTo(0, bb.visualBounds.y - 100);
      const r2 = document.getElementById('alphaTab').getBoundingClientRect();
      return bb && { x: r2.left + bb.visualBounds.x + 3, y: r2.top + bb.visualBounds.y + bb.visualBounds.h / 2, bar: beat.voice.bar.index + 1, beat: beat.index + 1 };
    });
    if (pt) {
      await page.mouse.click(pt.x, pt.y);
      const pos = (await shown()).pos;
      if (!pos.includes(`Bar ${pt.bar}/`) || !pos.includes(`Beat ${pt.beat}/`)) throw new Error(`click selected ${pos}, expected bar ${pt.bar} beat ${pt.beat}`);
    }
    // save: downloads a .gp and clears the edited mark
    const before = await page.evaluate(() => window.__downloads.length);
    await ctrl('s');
    await page.waitForFunction(n => window.__downloads.length > n, { timeout: 15000 }, before);
    const d = await page.evaluate(() => window.__downloads[window.__downloads.length - 1]);
    if (!d.name.endsWith('.gp') || d.head !== 'PK\u0003\u0004') throw new Error(JSON.stringify(d));
    if (await page.$eval('#tabbar .tab.active', t => !!t.querySelector('.tab-dirty'))) throw new Error('still marked as edited after saving');
    await page.keyboard.press('Escape');
    if (!(await page.$eval('#edit-bar', e => e.classList.contains('hidden')))) throw new Error('Esc did not stop editing');
  });

  await step('edit tracks: add, rename, retune, remove, undo', async () => {
    const settle = () => page.waitForFunction(() => document.getElementById('overlay').classList.contains('hidden'), { timeout: 30000 })
      .then(() => new Promise(r => setTimeout(r, 400)));
    const tracks = () => page.evaluate(() => window.tabPlayerApi.score.tracks.map(t => ({ name: t.name, tuning: t.staves[0].tuning.join(',') })));
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('e');
    const before = await tracks();
    await page.select('#edit-add-track', 'bass');
    await settle();
    let now = await tracks();
    if (now.length !== before.length + 1 || now[now.length - 1].tuning !== '43,38,33,28') throw new Error(`add ${JSON.stringify(now.slice(-1))}`);
    const added = now.length - 1;
    if (!(await page.$eval(`.track[data-index="${added}"]`, li => li.classList.contains('active')))) throw new Error('new track not shown');
    await page.$eval(`.track[data-index="${added}"] .track-rename`, el => { el.value = 'My bass'; el.dispatchEvent(new Event('change')); });
    await settle();
    await page.select(`.track[data-index="${added}"] .track-tuning`, await page.$eval(`.track[data-index="${added}"] .track-tuning`,
      sel => [...sel.options].find(o => o.textContent === 'Bass drop D').value));
    await settle();
    now = await tracks();
    if (now[added].name !== 'My bass' || now[added].tuning !== '43,38,33,26') throw new Error(`rename/retune ${JSON.stringify(now[added])}`);
    await page.click(`.track[data-index="${added}"] .track-remove`); // confirm() is accepted by the dialog handler
    await settle();
    if ((await tracks()).length !== before.length) throw new Error('remove did not remove the track');
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    await settle();
    now = await tracks();
    if (now.length !== before.length + 1 || now[added].name !== 'My bass') throw new Error(`undo remove ${JSON.stringify(now.slice(-1))}`);
    // put the song back as it was, then stop editing (keeps the later tab tests simple)
    for (let i = 0; i < 3; i++) { await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await settle(); }
    if ((await tracks()).length !== before.length) throw new Error('undo did not remove the added track');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { if (document.querySelector('#tabbar .tab.active .tab-dirty')) document.getElementById('export-gp').click(); });
  });

  await step('tabs: several songs open at once, switch keeps each song', async () => {
    const info = () => page.evaluate(() => ({
      tabs: [...document.querySelectorAll('#tabbar .tab')].map(t => t.querySelector('.tab-title').textContent),
      active: [...document.querySelectorAll('#tabbar .tab')].findIndex(t => t.classList.contains('active')),
      title: window.tabPlayerApi.score?.title,
    }));
    const before = await info();
    if (before.tabs.length < 2) throw new Error(`expected several tabs, got ${JSON.stringify(before)}`);
    await page.click('#tabbar .tab:first-child .tab-title');
    await page.waitForFunction(t => window.tabPlayerApi.score?.title !== t, { timeout: 30000 }, before.title);
    await page.waitForFunction(() => document.getElementById('overlay').classList.contains('hidden'), { timeout: 30000 });
    const after = await info();
    if (after.active !== 0 || after.title !== after.tabs[0]) throw new Error(`switch: ${JSON.stringify(after)}`);
    await page.click(`#tabbar .tab:nth-child(${before.active + 1}) .tab-title`);
    await page.waitForFunction(t => window.tabPlayerApi.score?.title === t, { timeout: 30000 }, before.title);
    // An empty tab shows the welcome screen; going back brings the song (and its track list) back.
    await page.click('#tabbar .tab-new');
    if (await page.evaluate(() => document.body.classList.contains('has-score') || !document.getElementById('play').disabled)) throw new Error('empty tab still shows a song');
    await page.click(`#tabbar div.tab:nth-of-type(${before.active + 1}) .tab-title`);
    await page.waitForFunction(() => document.body.classList.contains('has-score') && document.querySelectorAll('#track-list .track').length > 0, { timeout: 30000 });
    await page.click('#tabbar div.tab:last-of-type .tab-close'); // the empty tab
  });

  await step('favourite and save a song; library lists them', async () => {
    await page.click('#tabbar .tab:first-child .tab-title');
    await page.waitForFunction(() => document.body.classList.contains('has-score') && !document.getElementById('fav-toggle').disabled, { timeout: 30000 });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.querySelector('#tabbar .tab.active .tab-fav'), { timeout: 5000 });
    await page.click('#save-toggle');
    await page.waitForFunction(() => document.getElementById('save-toggle').classList.contains('on'), { timeout: 5000 });
    await page.click('#library-btn');
    const lists = await page.evaluate(() => Object.fromEntries(['favorites', 'saved', 'recent'].map(s =>
      [s, document.querySelectorAll(`#library-panel .lib-item[data-section="${s}"]`).length])));
    if (!lists.favorites || !lists.saved || lists.recent < 2) throw new Error(JSON.stringify(lists));
    const saved = await page.evaluate(() => new Promise(resolve => {
      const open = indexedDB.open('tabplayer');
      open.onsuccess = () => {
        const all = open.result.transaction('songs').objectStore('songs').getAll();
        all.onsuccess = () => resolve(all.result.filter(r => r.saved).map(r => ({ kind: r.kind, hasData: !!(r.data || r.bytes) })));
      };
    }));
    if (!saved.length || !saved.every(r => r.hasData)) throw new Error(`saved records ${JSON.stringify(saved)}`);
    await page.keyboard.press('Escape');
  });

  await step('open tabs come back after a reload; closing a tab', async () => {
    const count = () => page.$$eval('#tabbar .tab', t => t.length);
    const before = await count();
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.classList.contains('has-score'), { timeout: 60000 });
    if (await count() !== before) throw new Error(`had ${before} tabs, restored ${await count()}`);
    if (!(await page.$('#tabbar .tab.active .tab-fav'))) throw new Error('favourite star not restored');
    await page.click('#tabbar div.tab:last-of-type .tab-close');
    if (await count() !== before - 1) throw new Error('tab did not close');
  });

  await step('offline web app: installable, starts and plays with no server or network', async () => {
    const manifest = await page.evaluate(() => fetch('/manifest.webmanifest').then(r => r.json()));
    if (manifest.display !== 'standalone' || !manifest.icons.some(i => i.sizes === '512x512')) throw new Error('manifest incomplete');
    await page.waitForFunction(() => navigator.serviceWorker?.controller, { timeout: 30000 });
    const errorsBefore = errors.length;
    await page.setOfflineMode(true); // blocks the local server too, as if it weren't running
    try {
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => document.body.classList.contains('has-score') && window.tabPlayerApi.isReadyForPlayback, { timeout: 60000 });
      const info = await page.evaluate(() => ({ title: window.tabPlayerApi.score.title, offline: document.body.classList.contains('offline') }));
      if (!info.title) throw new Error('no song after an offline start');
      await page.click('#play');
      await page.waitForFunction(() => window.tabPlayerApi.timePosition > 300, { timeout: 20000 });
      await page.click('#play');
    } finally {
      await page.setOfflineMode(false);
      // Failed requests while offline (YouTube API, search) are expected.
      errors.splice(errorsBefore, errors.length - errorsBefore, ...errors.slice(errorsBefore).filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|youtube|net::/i.test(e)));
    }
  });

  await step('no browser errors', async () => {
    const real = errors.filter(e => !/AudioContext|autoplay/i.test(e));
    if (real.length) throw new Error(real.slice(0, 5).join(' | '));
  });
} finally {
  await browser.close();
  server.close();
}
console.log(results.join('\n'));
console.log(`screenshots: ${shotDir}`);
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
