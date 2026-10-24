// Service worker: lets TabPlayer start and play without the server or a connection.
// - App code: network first (so changes show up straight away), cached copy when offline.
// - alphaTab (player, fonts, built-in soundfont) and downloaded soundfonts: cache first.
// - Songsterr songs: network first, the last fetched copy when offline. Search needs the network.
// Saved songs and opened files live in IndexedDB (library.js), so they work offline too.

const VERSION = 'v1';
const SHELL = `tabplayer-shell-${VERSION}`;
const ASSETS = 'tabplayer-assets';
const SONGS = 'tabplayer-songs';
const SONG_LIMIT = 60;

const SHELL_FILES = [
  '/', '/style.css', '/app.js', '/songsterr.js', '/youtube.js', '/practice.js', '/library.js', '/chords.js',
  '/audio.js', '/editor.js', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png',
];
const ASSET_FILES = [
  '/alphatab/alphaTab.js', '/alphatab/font/Bravura.woff2', '/alphatab/font/Bravura.woff', '/alphatab/soundfont/sonivox.sf2',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(SHELL_FILES);
    const assets = await caches.open(ASSETS);
    await Promise.all(ASSET_FILES.map(async url => { if (!(await assets.match(url))) await assets.add(url); }));
    await self.skipWaiting(); // app code is network-first, so a new worker can take over right away
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('tabplayer-shell-') && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // YouTube etc. go straight through
  const p = url.pathname;
  if (p === '/api/songsterr/search') return; // live results only
  if (p.startsWith('/alphatab/') || p.startsWith('/api/soundfont/')) {
    event.respondWith(cacheFirst(req, ASSETS));
  } else if (p === '/api/songsterr' || p === '/api/songsterr/revisions') {
    event.respondWith(networkFirst(req, SONGS, { limit: SONG_LIMIT }));
  } else if (!p.startsWith('/api/')) {
    event.respondWith(networkFirst(req, SHELL, { navigation: req.mode === 'navigate' }));
  }
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, name, { navigation = false, limit = 0 } = {}) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) {
      // Page loads are stored as "/" whatever the query string (?url=...), so any of them works offline.
      await cache.put(navigation ? '/' : req, res.clone());
      if (limit) trim(cache, limit);
    }
    return res;
  } catch (e) {
    const hit = await cache.match(navigation ? '/' : req, { ignoreSearch: navigation });
    if (hit) return hit;
    if (name === SONGS) {
      return new Response(JSON.stringify({ error: 'You are offline and this song has not been opened on this device before.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}
