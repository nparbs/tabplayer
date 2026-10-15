import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSongsterrUrl, normalizeVideos, normalizeSearchResults } from './public/songsterr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
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

export const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/alphatab', express.static(path.join(__dirname, 'node_modules/@coderline/alphatab/dist')));

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
  app.listen(PORT, () => console.log(`TabPlayer running at http://localhost:${PORT}`));
}
