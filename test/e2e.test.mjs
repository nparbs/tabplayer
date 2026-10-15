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

  await step('load Songsterr URL and render', async () => {
    await page.type('#url-input', 'https://www.songsterr.com/a/wsa/nirvana-smells-like-teen-spirit-tab-s269t2');
    await page.click('#load-form button');
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
