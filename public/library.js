// Library: favourites, saved (offline) songs and recently opened songs, kept in IndexedDB,
// plus the list of open tabs. Pure helpers are exported for the unit tests; Library wraps the database.
//
// A record is { key, kind: 'songsterr' | 'file', title, artist, input, rev, fileName,
//   bytes (files: the original file, so it can be reopened), data (Songsterr: the fetched song, only when saved),
//   favorite, saved, openedAt, savedAt }.

export const RECENT_LIMIT = 30;
const newest = field => (a, b) => (b[field] || 0) - (a[field] || 0);

/** The three lists shown in the Library menu, newest first. */
export function libraryLists(records) {
  return {
    favorites: records.filter(r => r.favorite).sort(newest('openedAt')),
    saved: records.filter(r => r.saved).sort(newest('savedAt')),
    recent: records.filter(r => r.openedAt).sort(newest('openedAt')).slice(0, RECENT_LIMIT),
  };
}

/** Keys of records to forget: plain recents beyond the limit, unless favourite, saved or open in a tab. */
export function staleKeys(records, keep = new Set(), limit = RECENT_LIMIT) {
  return records.filter(r => !r.favorite && !r.saved && !keep.has(r.key))
    .sort(newest('openedAt')).slice(limit).map(r => r.key);
}

/** A record with its offline copy turned on or off. Songsterr data is only kept while saved; file bytes always are. */
export function withSaved(record, on, data = null) {
  const next = { ...record, saved: !!on, savedAt: on ? record.savedAt || Date.now() : undefined };
  if (record.kind === 'songsterr') next.data = on ? data ?? record.data : undefined;
  return next;
}

/** Whether a record can be opened: Songsterr songs need a link, files need their bytes. */
export function canOpen(record) {
  return record?.kind === 'songsterr' ? !!record.input : record?.kind === 'file' && !!record.bytes?.length;
}

const TAB_FIELDS = ['key', 'kind', 'input', 'rev', 'title', 'artist', 'selected', 'activeTrack', 'tick'];

/** Open tabs as stored in localStorage (empty tabs are left out). */
export function serializeTabs(tabs, activeId) {
  const kept = tabs.filter(t => t.key && t.kind);
  return {
    active: Math.max(0, kept.findIndex(t => t.id === activeId)),
    tabs: kept.map(t => Object.fromEntries(TAB_FIELDS.map(f => [f, t[f] ?? null]))),
  };
}

/** Stored tabs, dropping anything malformed. */
export function parseTabs(json) {
  let v;
  try { v = JSON.parse(json || '{}'); } catch { v = {}; }
  const tabs = (Array.isArray(v?.tabs) ? v.tabs : []).filter(t =>
    t && typeof t.key === 'string' && (t.kind === 'file' || (t.kind === 'songsterr' && typeof t.input === 'string')),
  ).map(t => ({
    ...t,
    selected: Array.isArray(t.selected) ? t.selected.filter(Number.isInteger) : null,
    activeTrack: Number.isInteger(t.activeTrack) ? t.activeTrack : 0,
    tick: Number.isFinite(t.tick) ? t.tick : 0,
  }));
  const active = Number.isInteger(v?.active) && v.active < tabs.length ? Math.max(0, v.active) : 0;
  return { tabs, active };
}

const done = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** Song records in IndexedDB. Falls back to memory (lost on reload) when IndexedDB is unavailable. */
export class Library {
  constructor(name = 'tabplayer') {
    this.memory = new Map();
    this.db = new Promise(resolve => {
      try {
        const open = indexedDB.open(name, 1);
        open.onupgradeneeded = () => open.result.createObjectStore('songs', { keyPath: 'key' });
        open.onsuccess = () => resolve(open.result);
        open.onerror = open.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  async run(mode, fn) {
    const db = await this.db;
    if (!db) return null;
    return done(fn(db.transaction('songs', mode).objectStore('songs')));
  }
  async all() {
    return (await this.db) ? this.run('readonly', s => s.getAll()) : [...this.memory.values()];
  }
  async get(key) {
    return (await this.db) ? this.run('readonly', s => s.get(key)) : this.memory.get(key);
  }
  async put(record) {
    const clean = Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined));
    if (await this.db) await this.run('readwrite', s => s.put(clean));
    else this.memory.set(clean.key, clean);
  }
  async delete(key) {
    if (await this.db) await this.run('readwrite', s => s.delete(key));
    else this.memory.delete(key);
  }
}
