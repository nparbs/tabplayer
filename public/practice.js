// Practice tools: loops by bar number (saved per song) and the speed trainer.
// Pure helpers; app.js wires them to alphaTab and the sidebar.

export const TRAINER_DEFAULTS = { start: 60, step: 5, every: 1, max: 100 };
const SPEED_MIN = 25, SPEED_MAX = 200;

/** Key a song's saved loop is stored under: the Songsterr id, else title and artist. */
export function songKey({ songId, title, artist } = {}) {
  if (songId) return `songsterr:${songId}`;
  const name = `${title || ''}|${artist || ''}`.trim().toLowerCase();
  return name === '|' ? null : `file:${name}`;
}

/** A 1-based, inclusive bar range clamped to the song (swapped if given backwards). Null if invalid. */
export function clampRange(from, to, barCount) {
  from = Math.trunc(Number(from));
  to = Math.trunc(Number(to || from));
  if (!barCount || !Number.isFinite(from) || !Number.isFinite(to) || from < 1 && to < 1) return null;
  if (from > to) [from, to] = [to, from];
  from = Math.max(1, Math.min(barCount, from));
  to = Math.max(1, Math.min(barCount, to));
  return { from, to };
}

/** Trainer settings with sane bounds: speeds within the player's 25–200 %, max never below start. */
export function normalizeTrainer(t = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
  const start = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(num(t.start, TRAINER_DEFAULTS.start))));
  const max = Math.max(start, Math.min(SPEED_MAX, Math.round(num(t.max, TRAINER_DEFAULTS.max))));
  const step = Math.max(1, Math.min(50, Math.round(num(t.step, TRAINER_DEFAULTS.step))));
  const every = Math.max(1, Math.min(20, Math.round(num(t.every, TRAINER_DEFAULTS.every))));
  return { start, step, every, max };
}

/** Speed (%) for the pass after `passes` complete loops. */
export function trainerSpeed(trainer, passes) {
  const t = normalizeTrainer(trainer);
  return Math.min(t.max, t.start + Math.floor(passes / t.every) * t.step);
}

/** A JSON object from storage, such as saved loops ({ [songKey]: { from, to } }). Bad JSON gives {}. */
export function parseStored(json) {
  try {
    const v = JSON.parse(json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Returns a new map with `range` saved for `key` (or removed when range is null). Keeps the newest 200. */
export function withLoop(loops, key, range) {
  const next = { ...loops };
  delete next[key];
  if (range) next[key] = { from: range.from, to: range.to };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete next[k];
  return next;
}
