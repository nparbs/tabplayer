// Renders public/icon.svg to the PNG icons used by the web app manifest and the desktop app.
// Usage: node scripts/make-icons.mjs   (needs Chrome or Edge; set CHROME_PATH to override)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'public/icon.svg'), 'utf8');
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(p => fs.existsSync(p));
if (!executablePath) throw new Error('No Chrome/Edge found (set CHROME_PATH)');

// [file, size, padding]: "maskable" icons keep the artwork inside the safe zone (Android crops to a circle).
const outputs = [
  ['public/icons/icon-192.png', 192, 0],
  ['public/icons/icon-512.png', 512, 0],
  ['public/icons/maskable-512.png', 512, 0.12],
  ['public/icons/apple-touch-icon.png', 180, 0],
  ['build/icon.png', 512, 0],
];
const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
for (const [file, size, pad] of outputs) {
  await page.setViewport({ width: size, height: size });
  const inset = Math.round(size * pad);
  const bg = pad ? '#1f2228' : 'transparent';
  await page.setContent(`<body style="margin:0;background:${bg}"><div style="padding:${inset}px;width:${size - inset * 2}px;height:${size - inset * 2}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`);
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  await page.screenshot({ path: path.join(root, file), omitBackground: !pad, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', file);
}
await browser.close();
