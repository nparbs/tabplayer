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
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(`PASS ${name}`); }
  catch (e) { results.push(`FAIL ${name}: ${e.message}`); }
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
