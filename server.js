import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSongsterrUrl } from './public/songsterr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const UA = { 'User-Agent': 'Mozilla/5.0 (TabPlayer personal use)' };
const CDN = 'https://dqsljvtekg760.cloudfront.net';

export async function fetchSongsterr(input) {
  const parsed = parseSongsterrUrl(input);
  if (!parsed) throw Object.assign(new Error('Not a Songsterr URL or song id'), { status: 400 });
  const metaRes = await fetch(`https://www.songsterr.com/api/meta/${parsed.songId}`, { headers: UA });
  if (!metaRes.ok) throw Object.assign(new Error(`Songsterr meta request failed (${metaRes.status})`), { status: 502 });
  const meta = await metaRes.json();
  const tracks = await Promise.all(meta.tracks.map(async (_, i) => {
    const r = await fetch(`${CDN}/${meta.songId}/${meta.revisionId}/${meta.image}/${i}.json`, { headers: UA });
    if (!r.ok) throw Object.assign(new Error(`Track ${i} request failed (${r.status})`), { status: 502 });
    const t = await r.json();
    delete t.newLyrics; // not used by the player
    return t;
  }));
  return { meta, tracks, trackIndex: parsed.trackIndex };
}

export const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/alphatab', express.static(path.join(__dirname, 'node_modules/@coderline/alphatab/dist')));

app.get('/api/songsterr', async (req, res) => {
  try {
    res.json(await fetchSongsterr(req.query.url));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => console.log(`TabPlayer running at http://localhost:${PORT}`));
}
