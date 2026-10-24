// Desktop app smoke test: starts the Electron app with a .gp file on the command line (as Explorer does
// for a file association), connects over the DevTools protocol and checks the song opens and plays.
// Usage: npm run test:desktop   (downloads the Electron binary on first run)
//        TABPLAYER_EXE="dist/win-unpacked/TabPlayer.exe" npm run test:desktop   tests the packaged app instead
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as at from '@coderline/alphatab';
import { songsterrToScore } from '../public/songsterr.js';

const root = path.join(import.meta.dirname, '..');
const packaged = process.env.TABPLAYER_EXE ? path.resolve(process.env.TABPLAYER_EXE) : null;
if (!packaged) execFileSync(process.execPath, [path.join(root, 'node_modules/electron/install.js')], { stdio: 'inherit' });
const electronPath = packaged ?? (await import('electron')).default;

// A small song to open.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tabplayer-desktop-'));
const beats = [0, 1, 2, 3].map(i => ({ type: 4, duration: [1, 4], notes: [{ fret: i * 2, string: 5 }] }));
const track = { name: 'Guitar', instrumentId: 27, strings: 6, tuning: [64, 59, 55, 50, 45, 40], measures: [{ voices: [{ beats }] }, { voices: [{ beats }] }] };
const score = songsterrToScore(at, { title: 'Desktop Test Song', artist: 'TabPlayer', revisionId: 1, tracks: [{ instrumentId: 27 }] }, [track]);
const gpFile = path.join(work, 'desktop-test.gp');
fs.writeFileSync(gpFile, new at.exporter.Gp7Exporter().export(score, new at.Settings()));

const port = 9300 + Math.floor(Math.random() * 500);
const env = { ...process.env, TABPLAYER_USER_DATA: path.join(work, 'profile'), ELECTRON_ENABLE_LOGGING: '1' };
delete env.ELECTRON_RUN_AS_NODE; // set when started from an editor's extension host; it would run main.mjs as plain Node
const child = spawn(electronPath, [...(packaged ? [] : [root]), `--remote-debugging-port=${port}`, gpFile], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', d => { log += d; });
child.stderr.on('data', d => { log += d; });

const results = [];
const errors = [];
async function step(name, fn) {
  try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); }
}
let browser;
try {
  let page;
  await step('app starts and shows the player', async () => {
    for (let i = 0; i < 60 && !browser; i++) {
      try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }); }
      catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (!browser) throw new Error(`could not connect to Electron\n${log}`);
    for (let i = 0; i < 60 && !page; i++) {
      page = (await browser.pages()).find(p => /^http:\/\/127\.0\.0\.1:\d+\//.test(p.url()));
      if (!page) await new Promise(r => setTimeout(r, 500));
    }
    if (!page) throw new Error('no app window');
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => !!window.tabPlayerApi && !!window.tabplayerDesktop, { timeout: 30000 });
    if (!(await page.evaluate(() => document.body.classList.contains('desktop')))) throw new Error('desktop mode not detected');
  });
  await step('a .gp file on the command line opens in a tab', async () => {
    await page.waitForFunction(() => window.tabPlayerApi.score?.title === 'Desktop Test Song', { timeout: 30000 });
    const tabs = await page.$$eval('#tabbar .tab .tab-title', t => t.map(x => x.textContent));
    if (!tabs.includes('Desktop Test Song')) throw new Error(`tabs: ${tabs}`);
  });
  await step('plays with the built-in soundfont', async () => {
    await page.waitForFunction(() => window.tabPlayerApi.isReadyForPlayback, { timeout: 60000 });
    await page.click('#play');
    await page.waitForFunction(() => window.tabPlayerApi.timePosition > 300, { timeout: 20000 });
    await page.click('#play');
  });
  await step('install button hidden in the desktop app', async () => {
    if (await page.$eval('#install-app', b => getComputedStyle(b).display !== 'none')) throw new Error('install button visible');
  });
  await step('no page errors', async () => { if (errors.length) throw new Error(errors.join(' | ')); });
} finally {
  await browser?.disconnect();
  child.kill();
  await new Promise(r => setTimeout(r, 1000));
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(results.join('\n'));
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
