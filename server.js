import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseSongsterrUrl, normalizeVideos, normalizeSearchResults } from './public/songsterr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1'; // set HOST=0.0.0.0 to use it from other devices
const UA = { 'User-Agent': 'Mozilla/5.0 (TabPlayer personal use)' };
const API = 'https://www.songsterr.com/api';
const CDN = 'https://dqsljvtekg760.cloudfront.net';

const fail = (message, status) => Object.assign(new Error(message), { status });

async function request(url, fetchImpl) {
  try {
    return await fetchImpl(url, { headers: UA });
  } catch {
    throw fail('Could not reach Songsterr. Check your internet connection and try again.', 502);
  }
}

/** Explains why Songsterr would not give us a playable tab, or returns null if it should work. */
export function restrictionMessage(meta) {
  if (meta.isBlocked) return 'This revision was rejected by Songsterr moderators. Pick another revision.';
  if (meta.hasPlayer === false || meta.hasTracks === false || !meta.tracks?.length) {
    return 'This song has no playable tab on Songsterr (it may be chords or lyrics only).';
  }
  return null;
}

/**
 * Fetches a song's meta data and all its track JSON.
 * @param input Songsterr URL or song id
 * @param opts.revision load this revision instead of the latest
 */
export async function fetchSongsterr(input, { revision = null, fetchImpl = fetch } = {}) {
  const parsed = parseSongsterrUrl(input);
  if (!parsed) throw fail('Not a Songsterr URL or song id', 400);
  const rev = revision != null && revision !== '' ? Number(revision) : null;
  if (rev !== null && !Number.isInteger(rev)) throw fail('Invalid revision id', 400);

  const metaRes = await request(`${API}/meta/${parsed.songId}${rev ? `/${rev}` : ''}`, fetchImpl);
  if (metaRes.status === 404) {
    throw fail(rev
      ? `Revision ${rev} of song ${parsed.songId} was not found on Songsterr.`
      : `Song ${parsed.songId} was not found on Songsterr. It may have been removed, or the link is wrong.`, 404);
  }
  if (metaRes.status === 403 || metaRes.status === 451) {
    throw fail('Songsterr does not allow access to this song (it may be restricted by the rights holder).', 403);
  }
  if (!metaRes.ok) throw fail(`Songsterr is not responding properly (HTTP ${metaRes.status}). Try again later.`, 502);
  const meta = await metaRes.json();
  const why = restrictionMessage(meta);
  if (why) throw fail(why, 422);

  const [tracks, videos] = await Promise.all([
    Promise.all(meta.tracks.map(async (_, i) => {
      const r = await request(`${CDN}/${meta.songId}/${meta.revisionId}/${meta.image}/${i}.json`, fetchImpl);
      if (r.status === 403 || r.status === 404) {
        const reason = meta.restriction ? ` (Songsterr says: ${meta.restriction})` : '';
        throw fail(`Songsterr would not serve the tab data for this song${reason}. It may be restricted or removed.`, 403);
      }
      if (!r.ok) throw fail(`Track ${i + 1} could not be downloaded (HTTP ${r.status}).`, 502);
      const t = await r.json();
      delete t.newLyrics; // not used by the player
      return t;
    })),
    fetchVideos(meta, fetchImpl),
  ]);
  return { meta, tracks, trackIndex: parsed.trackIndex, videos };
}

/** YouTube videos with per-bar timing for a revision. Never throws: videos are optional. */
export async function fetchVideos(meta, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${API}/video-points/${meta.songId}/${meta.revisionId}/list`, { headers: UA });
    if (!r.ok) return [];
    return normalizeVideos(await r.json(), meta.tracks);
  } catch {
    return [];
  }
}

export async function fetchRevisions(input, { fetchImpl = fetch } = {}) {
  const parsed = parseSongsterrUrl(input);
  if (!parsed) throw fail('Not a Songsterr URL or song id', 400);
  const r = await request(`${API}/meta/${parsed.songId}/revisions`, fetchImpl);
  if (r.status === 404) throw fail(`Song ${parsed.songId} was not found on Songsterr.`, 404);
  if (!r.ok) throw fail(`Could not load the revision list (HTTP ${r.status}).`, 502);
  const list = await r.json();
  return (Array.isArray(list) ? list : [])
    .filter(x => !x.isDeleted)
    .map(x => ({
      revisionId: x.revisionId,
      createdAt: x.createdAt,
      author: x.author?.name || x.person || '',
      description: x.description || '',
      tracksCount: x.tracksCount,
      status: x.isBlocked ? 'rejected' : x.isOnModeration ? 'pending' : 'ok',
    }));
}

export async function searchSongs(query, { from = 0, size = 20, fetchImpl = fetch } = {}) {
  const q = String(query ?? '').trim();
  if (q.length < 2) throw fail('Type at least 2 characters to search', 400);
  const params = new URLSearchParams({ pattern: q.slice(0, 200), size: String(Math.min(50, Math.max(1, size | 0))) });
  if (from > 0) params.set('from', String(from | 0));
  const r = await request(`${API}/songs?${params}`, fetchImpl);
  if (!r.ok) throw fail(`Songsterr search failed (HTTP ${r.status}). Try again later.`, 502);
  const raw = await r.json();
  const count = Array.isArray(raw) ? raw.length : 0;
  return { songs: normalizeSearchResults(raw), next: from + count, hasMore: count >= Number(params.get('size')) };
}

// Larger General MIDI soundfonts, downloaded on first use and cached on disk.
export const SOUNDFONTS = {
  generaluser: { file: 'GeneralUser-GS.sf2', url: 'https://github.com/mrbumpy409/GeneralUser-GS/raw/main/GeneralUser-GS.sf2' },
  musescore: { file: 'MuseScore_General.sf3', url: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3' },
  fluid: { file: 'FluidR3Mono_GM.sf3', url: 'https://github.com/musescore/MuseScore/raw/2.3.2/share/sound/FluidR3Mono_GM.sf3' },
};
const SOUNDFONT_DIR = process.env.TABPLAYER_SOUNDFONT_DIR || path.join(__dirname, 'cache', 'soundfonts');
const downloading = new Set();

/** Streams a soundfont to the client; on the first request it is downloaded and saved at the same time. */
async function serveSoundFont(req, res, fetchImpl = fetch) {
  const sf = SOUNDFONTS[req.params.id];
  if (!sf) return res.status(404).json({ error: 'Unknown soundfont' });
  const file = path.join(SOUNDFONT_DIR, sf.file);
  if (fs.existsSync(file)) return res.sendFile(file, { maxAge: '30d' });

  let upstream;
  try {
    upstream = await fetchImpl(sf.url, { headers: UA });
  } catch {
    return res.status(502).json({ error: 'Could not download the soundfont. Check your internet connection.' });
  }
  if (!upstream.ok || !upstream.body) return res.status(502).json({ error: `Soundfont download failed (HTTP ${upstream.status}).` });

  const length = upstream.headers.get('content-length');
  res.set('Content-Type', 'application/octet-stream');
  if (length) res.set('Content-Length', length);
  const body = Readable.fromWeb(upstream.body);
  body.pipe(res);

  // Only one request writes the cache file; others just stream through.
  if (downloading.has(sf.file)) {
    res.on('close', () => { if (!res.writableFinished) body.destroy(); });
    return;
  }
  downloading.add(sf.file);
  fs.mkdirSync(SOUNDFONT_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.part`;
  const out = fs.createWriteStream(tmp);
  body.pipe(out);
  const cleanup = () => { downloading.delete(sf.file); fs.rm(tmp, { force: true }, () => {}); };
  body.on('error', () => { out.destroy(); res.destroy(); cleanup(); });
  out.on('error', cleanup);
  out.on('finish', () => {
    if (length && fs.statSync(tmp).size !== Number(length)) return cleanup();
    fs.rename(tmp, file, err => { downloading.delete(sf.file); if (err) cleanup(); });
  });
}

export const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/alphatab', express.static(path.join(__dirname, 'node_modules/@coderline/alphatab/dist')));

app.get('/api/soundfont/:id', (req, res) => serveSoundFont(req, res));

app.get('/api/songsterr', async (req, res) => {
  try {
    res.json(await fetchSongsterr(req.query.url, { revision: req.query.rev }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/songsterr/search', async (req, res) => {
  try {
    res.json(await searchSongs(req.query.q, { from: Number(req.query.from) || 0 }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/songsterr/revisions', async (req, res) => {
  try {
    res.json(await fetchRevisions(req.query.url));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, HOST, () => console.log(`TabPlayer running at http://localhost:${PORT}`));
}
