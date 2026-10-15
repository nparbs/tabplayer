import { songsterrToScore, parseSongsterrUrl, tuningName, looksLikeSongsterrLink, songsterrUrl } from './songsterr.js';
import { YouTubeAudio } from './youtube.js';

const at = window.alphaTab;
const $ = id => document.getElementById(id);
const abs = p => new URL(p, location.href).href;

const ui = {
  form: $('load-form'), url: $('url-input'), results: $('search-results'), file: $('file-input'),
  exportGp: $('export-gp'), exportMidi: $('export-midi'), print: $('print'),
  title: $('song-title'), artist: $('song-artist'), tracks: $('track-list'),
  revisionRow: $('revision-row'), revision: $('revision'),
  staveProfile: $('stave-profile'), layoutMode: $('layout-mode'), zoom: $('zoom'), theme: $('theme'),
  themeToggle: $('theme-toggle'), toggleSidebar: $('toggle-sidebar'),
  showFretboard: $('show-fretboard'), multiTrack: $('multi-track'),
  overlay: $('overlay'), overlayText: $('overlay-text'), viewport: $('viewport'), welcome: $('welcome'),
  fretboard: $('fretboard'),
  accentSwatches: $('accent-swatches'), uiScale: $('ui-scale'), density: $('density'), resetAppearance: $('reset-appearance'),
  sidebarResizer: $('sidebar-resizer'), fretResizer: $('fret-resizer'),
  videoPanel: $('video-panel'), videoTitle: $('video-title'), ytHost: $('yt-host'),
  syncEarlier: $('sync-earlier'), syncLater: $('sync-later'), syncOffset: $('sync-offset'),
  videoSize: $('video-size'), videoClose: $('video-close'),
  play: $('play'), stop: $('stop'), seek: $('seek'), barInfo: $('bar-info'),
  timeCurrent: $('time-current'), timeTotal: $('time-total'),
  loop: $('loop'), metronome: $('metronome'), countIn: $('count-in'), audioSource: $('audio-source'),
  speed: $('speed'), speedValue: $('speed-value'), volume: $('master-volume'), status: $('status'),
};

const state = {
  score: null,
  selected: new Set(), // track indexes being rendered
  activeTrack: 0,      // track shown on the fretboard
  endTime: 0,
  activeBeats: [],
  seeking: false,
  songsterr: null,     // { input, songId, revisionId, latestRevisionId } for Songsterr songs
  revisionsFor: null,  // song id the revision list was loaded for
  videos: [],          // Songsterr YouTube videos with sync points
};

const store = {
  get(k, fallback) { try { return localStorage.getItem(`tabplayer.${k}`) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(`tabplayer.${k}`, v); } catch { /* storage unavailable */ } },
};

// View settings are remembered for every song (and shared between browser tabs).
const VIEW_DEFAULTS = { staveProfile: 'Tab', layoutMode: 'Page', zoom: '1', fretboard: true, multiTrack: false };
function loadView() {
  let saved = {};
  try { saved = JSON.parse(store.get('view', '{}')) || {}; } catch { /* corrupt: use defaults */ }
  const view = { ...VIEW_DEFAULTS, ...saved };
  if (at.StaveProfile[view.staveProfile] === undefined) view.staveProfile = VIEW_DEFAULTS.staveProfile;
  if (at.LayoutMode[view.layoutMode] === undefined) view.layoutMode = VIEW_DEFAULTS.layoutMode;
  if (![...ui.zoom.options].some(o => o.value === String(view.zoom))) view.zoom = VIEW_DEFAULTS.zoom;
  return view;
}
function saveView() {
  store.set('view', JSON.stringify({
    staveProfile: ui.staveProfile.value, layoutMode: ui.layoutMode.value, zoom: ui.zoom.value,
    fretboard: ui.showFretboard.checked, multiTrack: ui.multiTrack.checked,
  }));
}
function showViewControls(view) {
  ui.staveProfile.value = view.staveProfile;
  ui.layoutMode.value = view.layoutMode;
  ui.zoom.value = String(view.zoom);
  ui.showFretboard.checked = !!view.fretboard;
  ui.multiTrack.checked = !!view.multiTrack;
  document.body.classList.toggle('at-horizontal', view.layoutMode === 'Horizontal');
  ui.fretboard.classList.toggle('hidden', !view.fretboard);
  document.body.classList.toggle('no-fretboard', !view.fretboard);
}
function rhythmModeFor(notation) {
  if (notation === 'Tab') return at.TabRhythmMode.Hidden;
  if (notation === 'TabMixed') return at.TabRhythmMode.ShowWithBars;
  return at.TabRhythmMode.Automatic;
}
// alphaTab's global "Tab" profile breaks on tracks without tablature (vocals, drums, keys),
// so tab-only is applied per staff: staves with tab hide standard notation, others keep it.
const originalStaffFlags = new WeakMap();
function applyNotation(score, notation) {
  if (!score) return;
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      if (!originalStaffFlags.has(staff)) {
        originalStaffFlags.set(staff, { tab: staff.showTablature, score: staff.showStandardNotation });
      }
      const orig = originalStaffFlags.get(staff);
      const hasTab = orig.tab && !staff.isPercussion && staff.tuning.length > 0;
      if (notation === 'Tab' || notation === 'TabMixed') {
        staff.showTablature = hasTab;
        staff.showStandardNotation = !hasTab;
      } else if (notation === 'Score') {
        staff.showTablature = false;
        staff.showStandardNotation = true;
      } else {
        staff.showTablature = orig.tab;
        staff.showStandardNotation = orig.score || !orig.tab;
      }
    }
  }
}
const initialView = loadView();
showViewControls(initialView);

const api = new at.AlphaTabApi($('alphaTab'), {
  core: {
    fontDirectory: abs('/alphatab/font/'),
    scriptFile: abs('/alphatab/alphaTab.js'),
  },
  display: {
    scale: Number(initialView.zoom),
    layoutMode: at.LayoutMode[initialView.layoutMode],
    // Notation is applied per staff (see applyNotation), so the global profile stays Default.
    staveProfile: at.StaveProfile.Default,
  },
  player: {
    playerMode: at.PlayerMode.EnabledSynthesizer,
    soundFont: abs('/alphatab/soundfont/sonivox.sf2'),
    scrollElement: ui.viewport,
    enableCursor: true,
    enableAnimatedBeatCursor: true,
    enableUserInteraction: true,
    scrollOffsetY: -40,
  },
  notation: { elements: { scoreWordsAndMusic: false }, rhythmMode: rhythmModeFor(initialView.staveProfile) },
});
window.tabPlayerApi = api; // handy for debugging in DevTools

const youtube = new YouTubeAudio(at, api, ui.ytHost);
window.tabPlayerYouTube = youtube;

// ---------- helpers ----------
function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle('error', isError);
}
function showOverlay(text) { ui.overlayText.textContent = text; ui.overlay.classList.remove('hidden'); }
function hideOverlay() { ui.overlay.classList.add('hidden'); }
function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeName() {
  const s = state.score;
  return `${s?.artist ? s.artist + ' - ' : ''}${s?.title || 'tab'}`.replace(/[\\/:*?"<>|]+/g, '_');
}
function renderSelected() {
  const tracks = [...state.selected].sort((a, b) => a - b).map(i => state.score.tracks[i]);
  if (tracks.length) api.renderTracks(tracks);
}
function setControlsEnabled(on) {
  for (const el of [ui.exportGp, ui.exportMidi, ui.print]) el.disabled = !on;
}
function setPlayerEnabled(on) {
  for (const el of [ui.play, ui.stop, ui.seek, ui.loop]) el.disabled = !on;
  // The metronome and count-in come from the synthesizer, so they are silent with YouTube audio.
  for (const el of [ui.metronome, ui.countIn]) el.disabled = !on || youtube.active;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function setUrlParams(params) {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') u.searchParams.delete(k);
    else u.searchParams.set(k, v);
  }
  history.replaceState(null, '', u);
}

// ---------- themes ----------
function resolveTheme(name) {
  if (name !== 'system') return name;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(name, persist = true) {
  ui.theme.value = name;
  document.documentElement.dataset.theme = resolveTheme(name);
  if (persist) store.set('theme', name);
  applyAccent();
  const css = getComputedStyle(document.documentElement);
  const color = v => at.model.Color.fromJson(css.getPropertyValue(v).trim());
  const r = api.settings.display.resources;
  r.mainGlyphColor = color('--ink');
  r.secondaryGlyphColor = color('--ink-2');
  r.scoreInfoColor = color('--ink');
  r.staffLineColor = color('--staff');
  r.barSeparatorColor = color('--staff');
  r.barNumberColor = color('--bar-number');
  api.updateSettings();
  if (state.score) api.render();
  drawFretboard();
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (ui.theme.value === 'system') applyTheme('system', false);
});

// ---------- appearance: accent, UI size, density, panel sizes ----------
const ACCENTS = ['#f0a030', '#e5484d', '#e2557f', '#b48cff', '#3fa7ff', '#22b8cf', '#30a46c', '#a3c93a'];
const APPEARANCE_DEFAULTS = { accent: '', scale: '1', density: 'comfortable', sidebarW: 290, fretH: 150 };
function loadAppearance() {
  try { return { ...APPEARANCE_DEFAULTS, ...JSON.parse(store.get('appearance', '{}')) }; } catch { return { ...APPEARANCE_DEFAULTS }; }
}
let appearance = loadAppearance();
function saveAppearance() { store.set('appearance', JSON.stringify(appearance)); }

// Pick black or white text for a given accent background.
function onColor(hex) {
  const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1b1b1b' : '#ffffff';
}
function applyAccent() {
  const root = document.documentElement.style;
  for (const v of ['--accent', '--on-accent', '--fret-note']) root.removeProperty(v);
  if (appearance.accent) {
    root.setProperty('--accent', appearance.accent);
    root.setProperty('--fret-note', appearance.accent);
    root.setProperty('--on-accent', onColor(appearance.accent));
  }
  for (const b of ui.accentSwatches.children) b.setAttribute('aria-checked', String(b.dataset.color === appearance.accent));
}
function applyAppearance() {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', appearance.scale);
  root.style.setProperty('--sidebar-w', `${appearance.sidebarW}px`);
  root.style.setProperty('--fret-h', `${appearance.fretH}px`);
  root.dataset.density = appearance.density;
  ui.uiScale.value = appearance.scale;
  ui.density.value = appearance.density;
  applyAccent();
  drawFretboard();
}
// Layout changed size: let alphaTab re-flow and redraw the fretboard.
const relayout = () => window.dispatchEvent(new Event('resize'));

for (const color of ['', ...ACCENTS]) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = color ? 'swatch' : 'swatch auto';
  b.dataset.color = color;
  b.setAttribute('role', 'radio');
  b.title = color ? `Accent ${color}` : 'Theme default';
  if (color) b.style.setProperty('--c', color);
  b.addEventListener('click', () => { appearance.accent = color; saveAppearance(); applyTheme(ui.theme.value, false); });
  ui.accentSwatches.append(b);
}
ui.uiScale.addEventListener('change', () => { appearance.scale = ui.uiScale.value; saveAppearance(); applyAppearance(); relayout(); });
ui.density.addEventListener('change', () => { appearance.density = ui.density.value; saveAppearance(); applyAppearance(); relayout(); });
ui.resetAppearance.addEventListener('click', () => {
  appearance = { ...APPEARANCE_DEFAULTS };
  saveAppearance();
  applyTheme(ui.theme.value, false);
  applyAppearance();
  relayout();
});

// Drag handles for the sidebar width and fretboard height (also keyboard-adjustable).
function makeResizer(handle, { axis, key, min, max, fromPointer }) {
  const set = px => {
    appearance[key] = Math.round(Math.min(max(), Math.max(min, px)));
    document.documentElement.style.setProperty(key === 'sidebarW' ? '--sidebar-w' : '--fret-h', `${appearance[key]}px`);
    if (key === 'fretH') drawFretboard();
  };
  const finish = () => { saveAppearance(); relayout(); };
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('active');
    document.body.classList.add('resizing', `resizing-${axis}`);
    const move = ev => set(fromPointer(ev));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.classList.remove('active');
      document.body.classList.remove('resizing', `resizing-${axis}`);
      finish();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
  handle.addEventListener('dblclick', () => { set(APPEARANCE_DEFAULTS[key]); finish(); });
  handle.addEventListener('keydown', e => {
    const grow = axis === 'x' ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowUp: 1, ArrowDown: -1 };
    if (!(e.key in grow)) return;
    e.preventDefault();
    e.stopPropagation();
    set(appearance[key] + grow[e.key] * 20);
    finish();
  });
}
makeResizer(ui.sidebarResizer, {
  axis: 'x', key: 'sidebarW', min: 200, max: () => Math.min(560, window.innerWidth * 0.5),
  fromPointer: e => e.clientX - $('sidebar').getBoundingClientRect().left,
});
makeResizer(ui.fretResizer, {
  axis: 'y', key: 'fretH', min: 80, max: () => Math.max(120, window.innerHeight * 0.45),
  fromPointer: e => ui.fretboard.getBoundingClientRect().bottom - e.clientY,
});
$('sidebar').addEventListener('transitionend', e => { if (e.propertyName === 'width' && e.target.id === 'sidebar') relayout(); });

// ---------- loading ----------
async function loadSongsterr(input, revision = null) {
  const parsed = parseSongsterrUrl(input);
  if (!parsed) { setStatus('That does not look like a Songsterr URL or song id.', true); return; }
  showOverlay(revision ? `Fetching revision ${revision} from Songsterr…` : 'Fetching from Songsterr…');
  try {
    const q = new URLSearchParams({ url: input });
    if (revision) q.set('rev', revision);
    const res = await fetch(`/api/songsterr?${q}`);
    const data = await res.json().catch(() => ({ error: `Server error (HTTP ${res.status})` }));
    if (!res.ok) throw new Error(data.error || res.statusText);
    showOverlay('Converting tab…');
    const score = songsterrToScore(at, data.meta, data.tracks);
    let track = data.trackIndex ?? data.meta.popularTrack ?? data.meta.defaultTrack ?? 0;
    if (!score.tracks[track]) track = 0;
    stopYouTube();
    state.songsterr = {
      input, songId: data.meta.songId, revisionId: data.meta.revisionId,
      latestRevisionId: data.meta.latestRevisionId ?? data.meta.revisionId,
    };
    state.videos = data.videos || [];
    api.renderScore(score, [track]);
    const isLatest = !revision || data.meta.revisionId === state.songsterr.latestRevisionId;
    setUrlParams({ url: input, rev: isLatest ? null : data.meta.revisionId });
    setStatus(`Loaded from Songsterr (revision ${data.meta.revisionId}${isLatest ? ', latest' : ''})`);
    buildAudioSources();
    loadRevisions();
    if (store.get('audio') === 'youtube' && state.videos.length) selectAudioSource('0');
  } catch (e) {
    hideOverlay();
    setStatus(`Could not load: ${e.message}`, true);
    console.error(e);
  }
}

async function loadFile(file) {
  showOverlay(`Opening ${file.name}…`);
  try {
    stopYouTube();
    const ok = api.load(new Uint8Array(await file.arrayBuffer()));
    if (!ok) throw new Error('Unsupported file');
    state.songsterr = null;
    state.videos = [];
    buildAudioSources();
    ui.revisionRow.classList.add('hidden');
    setUrlParams({ url: null, rev: null });
    setStatus(`Opened ${file.name}`);
  } catch (e) {
    hideOverlay();
    setStatus(`Could not open ${file.name}: ${e.message}`, true);
  }
}

// ---------- song search ----------
const search = { query: '', songs: [], active: -1, next: 0, hasMore: false, timer: null, seq: 0, error: '' };

function openSearch() { ui.results.classList.remove('hidden'); ui.url.setAttribute('aria-expanded', 'true'); }
function closeSearch() {
  ui.results.classList.add('hidden');
  ui.url.setAttribute('aria-expanded', 'false');
  ui.url.removeAttribute('aria-activedescendant');
  search.active = -1;
}

async function runSearch(query, append = false) {
  const seq = ++search.seq;
  if (!append) Object.assign(search, { query, songs: [], active: -1, next: 0, hasMore: false });
  search.error = '';
  renderSearch(append ? 'Loading more…' : 'Searching…');
  try {
    const res = await fetch(`/api/songsterr/search?q=${encodeURIComponent(query)}&from=${search.next}`);
    const data = await res.json().catch(() => ({ error: `Server error (HTTP ${res.status})` }));
    if (seq !== search.seq) return; // a newer search started
    if (!res.ok) throw new Error(data.error || res.statusText);
    search.songs.push(...data.songs);
    search.next = data.next;
    search.hasMore = data.hasMore;
  } catch (e) {
    if (seq !== search.seq) return;
    search.error = e.message;
  }
  renderSearch();
}

function highlight(text, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const lower = text.toLowerCase();
  const marks = new Array(text.length).fill(false);
  for (const t of terms) for (let i = lower.indexOf(t); i >= 0; i = lower.indexOf(t, i + 1)) marks.fill(true, i, i + t.length);
  let html = '', open = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] !== open) { html += marks[i] ? '<mark>' : '</mark>'; open = marks[i]; }
    html += escapeHtml(text[i]);
  }
  return open ? html + '</mark>' : html;
}

function renderSearch(message = '') {
  const rows = search.songs.map((s, i) => {
    const btn = (kind, label, title) => s.tracks[kind] != null ? `<button type="button" data-track="${kind}" title="${title}">${label}</button>` : '';
    return `<div class="search-result${i === search.active ? ' active' : ''}" role="option" id="sr-${i}" data-i="${i}" aria-selected="${i === search.active}">
      <div class="sr-text">
        <div class="sr-title">${highlight(s.title, search.query)}</div>
        <div class="sr-artist">${highlight(s.artist, search.query)}${s.trackCount ? ` · ${s.trackCount} track${s.trackCount === 1 ? '' : 's'}` : ''}</div>
      </div>
      <div class="sr-tracks">${btn('guitar', '🎸', 'Open the guitar track')}${btn('bass', 'Bass', 'Open the bass track')}${btn('drums', '🥁', 'Open the drum track')}</div>
    </div>`;
  });
  let foot = '';
  if (message) foot = `<div class="search-msg">${escapeHtml(message)}</div>`;
  else if (search.error) foot = `<div class="search-msg error">${escapeHtml(search.error)}</div>`;
  else if (!search.songs.length) foot = `<div class="search-msg">No songs found for “${escapeHtml(search.query)}”.</div>`;
  else if (search.hasMore) foot = '<button type="button" class="search-more">More results</button>';
  ui.results.innerHTML = rows.join('') + foot;
  openSearch();
}

function setActive(i) {
  search.active = i;
  for (const row of ui.results.querySelectorAll('.search-result')) {
    const on = Number(row.dataset.i) === i;
    row.classList.toggle('active', on);
    row.setAttribute('aria-selected', on);
    if (on) row.scrollIntoView({ block: 'nearest' });
  }
  ui.url.setAttribute('aria-activedescendant', `sr-${i}`);
}

function openResult(i, kind = null) {
  const song = search.songs[i];
  if (!song) return;
  const url = songsterrUrl(song, kind ? song.tracks[kind] : null);
  ui.url.value = url;
  closeSearch();
  ui.url.blur();
  loadSongsterr(url);
}

ui.url.addEventListener('input', () => {
  clearTimeout(search.timer);
  const q = ui.url.value.trim();
  if (q.length < 2 || looksLikeSongsterrLink(q)) { search.seq++; closeSearch(); return; }
  search.timer = setTimeout(() => runSearch(q), 250);
});
ui.url.addEventListener('keydown', e => {
  const open = !ui.results.classList.contains('hidden') && search.songs.length > 0;
  if (e.key === 'ArrowDown' && open) { e.preventDefault(); setActive(Math.min(search.songs.length - 1, search.active + 1)); }
  else if (e.key === 'ArrowUp' && open) { e.preventDefault(); setActive(Math.max(0, search.active - 1)); }
  else if (e.key === 'Escape') {
    if (!ui.results.classList.contains('hidden')) closeSearch();
    else ui.url.blur();
  }
});
ui.url.addEventListener('focus', () => {
  if (search.songs.length && ui.url.value.trim() === search.query) renderSearch();
});
document.addEventListener('mousedown', e => { if (!e.target.closest('.search-box')) closeSearch(); });
ui.results.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the input
ui.results.addEventListener('click', e => {
  if (e.target.closest('.search-more')) { runSearch(search.query, true); return; }
  const row = e.target.closest('.search-result');
  if (row) openResult(Number(row.dataset.i), e.target.closest('[data-track]')?.dataset.track);
});

// ---------- Songsterr revisions ----------
async function loadRevisions() {
  const s = state.songsterr;
  if (!s) return;
  ui.revisionRow.classList.remove('hidden');
  if (state.revisionsFor !== s.songId) {
    ui.revision.innerHTML = `<option value="${s.revisionId}">Revision ${s.revisionId}</option>`;
    try {
      const res = await fetch(`/api/songsterr/revisions?url=${encodeURIComponent(s.songId)}`);
      if (!res.ok) throw new Error((await res.json()).error);
      const list = await res.json();
      if (state.songsterr?.songId !== s.songId) return; // another song was loaded meanwhile
      state.revisionsFor = s.songId;
      ui.revision.innerHTML = list.map(r => {
        const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '';
        const flags = r.revisionId === s.latestRevisionId ? ' (current)' : r.status === 'rejected' ? ' (rejected)' : r.status === 'pending' ? ' (pending review)' : '';
        const desc = r.description ? ` – ${r.description.slice(0, 60)}` : '';
        return `<option value="${r.revisionId}" title="${escapeHtml(r.description)}">${escapeHtml(`${date} · ${r.author}${flags}${desc}`)}</option>`;
      }).join('');
    } catch (e) {
      console.warn('revisions', e);
    }
  }
  const current = String(state.songsterr.revisionId);
  if (![...ui.revision.options].some(o => o.value === current)) {
    ui.revision.insertAdjacentHTML('afterbegin', `<option value="${current}">Revision ${current}</option>`);
  }
  ui.revision.value = current;
}

// ---------- audio source (synth or YouTube) ----------
function buildAudioSources() {
  ui.audioSource.innerHTML = '<option value="synth">Synth (MIDI)</option>' +
    state.videos.map((v, i) => `<option value="${i}">▶ YouTube: ${escapeHtml(v.label)}</option>`).join('');
  ui.audioSource.value = 'synth';
  ui.audioSource.disabled = !state.videos.length;
  ui.audioSource.title = state.videos.length
    ? 'Play the synthesizer or the song\'s YouTube video'
    : 'YouTube audio is available for Songsterr songs that have synced videos';
}

async function selectAudioSource(value) {
  ui.audioSource.value = value;
  if (value === 'synth') {
    stopYouTube();
    store.set('audio', 'synth');
    setStatus('Audio: synthesizer');
    return;
  }
  const video = state.videos[Number(value)];
  if (!video) return;
  store.set('audio', 'youtube');
  ui.videoPanel.classList.remove('hidden');
  ui.videoTitle.textContent = video.label;
  document.body.classList.add('yt-mode');
  setStatus('Loading YouTube player…');
  try {
    await youtube.start(video);
    setSpeed(Number(ui.speed.value));
    setPlayerEnabled(true);
    setStatus(`Audio: ${video.label} (YouTube). Press play.`);
  } catch (e) {
    stopYouTube();
    setStatus(e.message, true);
  }
}

function stopYouTube() {
  youtube.stop();
  ui.audioSource.value = 'synth';
  ui.videoPanel.classList.add('hidden');
  document.body.classList.remove('yt-mode');
  setPlayerEnabled(api.isReadyForPlayback);
}

function setSyncOffset(ms) {
  ui.syncOffset.textContent = `${ms > 0 ? '+' : ''}${ms} ms`;
  youtube.setOffset(ms);
}

// ---------- tracks sidebar ----------
function trackIcon(track) {
  const staff = track.staves[0];
  if (staff.isPercussion) return '🥁';
  if (/vocal|voice|vox/i.test(track.name)) return '🎤';
  const p = track.playbackInfo.program;
  if (p >= 24 && p <= 39) return '🎸';
  if (p <= 7) return '🎹';
  if (p >= 40 && p <= 51) return '🎻';
  if (p >= 56 && p <= 63) return '🎺';
  if (p >= 64 && p <= 79) return '🎷';
  return '🎵';
}
function trackDetails(track) {
  const staff = track.staves[0];
  if (staff.isPercussion) return 'Drums';
  const parts = [staff.tuningName || tuningName(at, staff.tuning) || `${staff.tuning.length} strings`];
  if (staff.capo) parts.push(`Capo ${staff.capo}`);
  return parts.join(' · ');
}
function buildTrackList() {
  ui.tracks.innerHTML = '';
  state.score.tracks.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'track';
    li.dataset.index = i;
    li.innerHTML = `
      <div class="track-head"><span class="track-icon">${trackIcon(track)}</span>
        <div class="track-name" title="${escapeHtml(track.name)}">${escapeHtml(track.name)}</div></div>
      <div class="track-sub">${escapeHtml(trackDetails(track))}</div>
      <div class="track-controls" title="Mixer (synth audio only)">
        <button class="mute" title="Mute">M</button>
        <button class="solo" title="Solo">S</button>
        <input type="range" min="0" max="16" value="${track.playbackInfo.volume}" title="Volume" aria-label="Track volume">
      </div>`;
    li.addEventListener('click', e => {
      if (e.target.closest('.track-controls')) return;
      if (ui.multiTrack.checked) {
        if (state.selected.has(i) && state.selected.size > 1) state.selected.delete(i);
        else state.selected.add(i);
      } else {
        state.selected = new Set([i]);
      }
      state.activeTrack = i;
      renderSelected();
    });
    const mute = li.querySelector('.mute'), solo = li.querySelector('.solo');
    mute.addEventListener('click', () => {
      const on = !mute.classList.contains('on');
      mute.classList.toggle('on', on);
      api.changeTrackMute([track], on);
    });
    solo.addEventListener('click', () => {
      const on = !solo.classList.contains('on');
      solo.classList.toggle('on', on);
      api.changeTrackSolo([track], on);
    });
    li.querySelector('input').addEventListener('input', e => {
      api.changeTrackVolume([track], Number(e.target.value) / Math.max(1, track.playbackInfo.volume));
    });
    ui.tracks.appendChild(li);
  });
}
function updateTrackHighlight() {
  for (const li of ui.tracks.children) li.classList.toggle('active', state.selected.has(Number(li.dataset.index)));
}

// ---------- bar / section readout ----------
function showBar(masterBar) {
  if (!masterBar || !state.score) { ui.barInfo.textContent = ''; return; }
  let section = '';
  for (let mb = masterBar; mb; mb = mb.previousMasterBar) {
    if (mb.section) { section = mb.section.text; break; }
  }
  ui.barInfo.textContent = `Bar ${masterBar.index + 1}/${state.score.masterBars.length}${section ? ` · ${section}` : ''}`;
  state.currentBar = masterBar.index;
}
function jumpBar(delta) {
  const bars = state.score?.masterBars;
  if (!bars?.length) return;
  const target = bars[Math.max(0, Math.min(bars.length - 1, (state.currentBar ?? 0) + delta))];
  api.tickPosition = target.start;
  showBar(target);
}

// ---------- fretboard ----------
function drawFretboard() {
  const canvas = ui.fretboard;
  if (canvas.classList.contains('hidden')) return;
  const css = getComputedStyle(document.documentElement);
  const v = name => css.getPropertyValue(name).trim();
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const track = state.score?.tracks[state.activeTrack];
  const staff = track?.staves[0];
  if (!staff || staff.isPercussion || !staff.tuning.length) {
    ctx.fillStyle = v('--fret-text'); ctx.font = '13px system-ui';
    ctx.fillText(staff?.isPercussion ? 'Drum track: no fretboard' : 'No stringed track selected', 16, h / 2);
    return;
  }
  const strings = staff.tuning.length;
  const frets = 24;
  const padL = 34, padR = 12, padT = 14, padB = 18;
  const fw = (w - padL - padR) / (frets + 1);
  const sh = (h - padT - padB) / (strings - 1);
  const fretX = f => padL + f * fw;

  // board
  ctx.fillStyle = v('--fret-wood');
  ctx.fillRect(fretX(1) - fw, padT - 6, fw * frets + fw, h - padT - padB + 12);
  // inlays
  ctx.fillStyle = '#d8cdb8';
  for (const f of [3, 5, 7, 9, 15, 17, 19, 21]) dot(ctx, fretX(f) - fw / 2, padT + (h - padT - padB) / 2, 4);
  for (const f of [12, 24]) {
    dot(ctx, fretX(f) - fw / 2, padT + sh * (strings - 1) * 0.3, 4);
    dot(ctx, fretX(f) - fw / 2, padT + sh * (strings - 1) * 0.7, 4);
  }
  // frets (capo drawn as a bar)
  for (let f = 0; f <= frets; f++) {
    ctx.strokeStyle = f === 0 ? '#eee' : '#9a9a9a';
    ctx.lineWidth = f === 0 ? 4 : 1.5;
    ctx.beginPath(); ctx.moveTo(fretX(f), padT - 6); ctx.lineTo(fretX(f), h - padB + 6); ctx.stroke();
    if (f > 0 && [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(f)) {
      ctx.fillStyle = v('--fret-text'); ctx.font = '10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(f, fretX(f) - fw / 2, h - 4);
    }
  }
  if (staff.capo > 0) {
    ctx.fillStyle = 'rgba(30, 30, 30, .85)';
    ctx.fillRect(fretX(staff.capo) - fw / 2 - 4, padT - 8, 8, h - padT - padB + 16);
  }
  // strings (string 1 = lowest, drawn at the bottom) + tuning labels
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (let i = 0; i < strings; i++) {
    const y = padT + i * sh;
    ctx.strokeStyle = '#c9c2b0'; ctx.lineWidth = 1 + (i / strings) * 1.6;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillStyle = v('--fret-text'); ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(names[staff.tuning[i] % 12], 14, y + 4);
  }
  // active notes (frets are relative to the capo)
  for (const beat of state.activeBeats) {
    if (beat.voice.bar.staff.track.index !== state.activeTrack) continue;
    for (const note of beat.notes) {
      if (!note.isStringed) continue;
      const fret = note.fret + (staff.capo || 0);
      const y = padT + (strings - note.string) * sh;
      const x = fret === 0 ? padL - 12 : fretX(fret) - fw / 2;
      ctx.fillStyle = note.isDead ? '#888' : v('--fret-note');
      dot(ctx, x, y, Math.min(11, sh * 0.48));
      ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(note.isDead ? 'x' : note.fret, x, y + 4);
    }
  }
}
function dot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

// ---------- alphaTab events ----------
api.renderStarted.on(() => showOverlay('Rendering…'));
api.renderFinished.on(() => { hideOverlay(); updateTrackHighlight(); });
api.scoreLoaded.on(score => {
  state.score = score;
  applyNotation(score, ui.staveProfile.value);
  state.activeBeats = [];
  state.currentBar = 0;
  document.body.classList.add('has-score');
  ui.title.textContent = score.title || 'Untitled';
  ui.artist.textContent = score.artist || '';
  document.title = `${score.title || 'Untitled'} – TabPlayer`;
  buildTrackList();
  state.selected = new Set(api.tracks.map(t => t.index));
  state.activeTrack = api.tracks[0]?.index ?? 0;
  updateTrackHighlight();
  setControlsEnabled(true);
  showBar(score.masterBars[0]);
  drawFretboard();
});
api.soundFontLoad.on(e => setStatus(`Loading sounds… ${Math.round((e.loaded / e.total) * 100)}%`));
api.playerReady.on(() => { setPlayerEnabled(true); if (!youtube.active) setStatus('Ready'); });
api.playerStateChanged.on(e => {
  const playing = e.state === at.synth.PlayerState.Playing;
  ui.play.textContent = playing ? '⏸' : '▶';
});
api.playerPositionChanged.on(e => {
  state.endTime = e.endTime;
  ui.timeCurrent.textContent = fmtTime(e.currentTime);
  ui.timeTotal.textContent = fmtTime(e.endTime);
  if (!state.seeking && e.endTime > 0) ui.seek.value = Math.round((e.currentTime / e.endTime) * 1000);
});
api.activeBeatsChanged.on(e => { state.activeBeats = e.activeBeats; drawFretboard(); });
api.playedBeatChanged.on(beat => showBar(beat?.voice.bar.masterBar));
api.playbackRangeChanged?.on(e => {
  if (e.playbackRange && !api.isLooping) setStatus('Selection set. Press L to loop it.');
});

// ---------- UI events ----------
ui.form.addEventListener('submit', e => {
  e.preventDefault();
  const q = ui.url.value.trim();
  if (!q) return;
  const listOpen = !ui.results.classList.contains('hidden') && search.songs.length > 0;
  if (listOpen && search.active >= 0) { openResult(search.active); return; }
  if (looksLikeSongsterrLink(q) || parseSongsterrUrl(q)) { closeSearch(); loadSongsterr(q); return; }
  // Plain text: Enter opens the top hit once results for this query are showing.
  clearTimeout(search.timer);
  if (listOpen && search.query === q) openResult(0);
  else runSearch(q);
});
ui.file.addEventListener('change', () => { if (ui.file.files[0]) loadFile(ui.file.files[0]); ui.file.value = ''; });
ui.viewport.addEventListener('dragover', e => { e.preventDefault(); ui.viewport.classList.add('drag-over'); });
ui.viewport.addEventListener('dragleave', () => ui.viewport.classList.remove('drag-over'));
ui.viewport.addEventListener('drop', e => {
  e.preventDefault();
  ui.viewport.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});
ui.welcome.addEventListener('click', e => {
  const btn = e.target.closest('[data-song]');
  if (!btn) return;
  ui.url.value = btn.dataset.song;
  loadSongsterr(btn.dataset.song);
});
ui.revision.addEventListener('change', () => {
  if (state.songsterr) loadSongsterr(state.songsterr.input, ui.revision.value);
});

ui.exportGp.addEventListener('click', () => {
  try {
    applyNotation(api.score, 'Default'); // export the song's own notation flags, not the current view
    let bytes;
    try { bytes = new at.exporter.Gp7Exporter().export(api.score, api.settings); }
    finally { applyNotation(api.score, ui.staveProfile.value); }
    download(bytes, `${safeName()}.gp`, 'application/octet-stream');
  } catch (e) { setStatus(`Export failed: ${e.message}`, true); }
});
ui.exportMidi.addEventListener('click', () => api.downloadMidi());
ui.print.addEventListener('click', () => api.print());

ui.play.addEventListener('click', () => api.playPause());
ui.stop.addEventListener('click', () => api.stop());
ui.seek.addEventListener('input', () => { state.seeking = true; });
ui.seek.addEventListener('change', () => {
  api.timePosition = (Number(ui.seek.value) / 1000) * state.endTime;
  state.seeking = false;
});
function toggle(btn, on) { btn.classList.toggle('on', on); return on; }
ui.loop.addEventListener('click', () => { api.isLooping = toggle(ui.loop, !api.isLooping); });
ui.metronome.addEventListener('click', () => { api.metronomeVolume = toggle(ui.metronome, api.metronomeVolume === 0) ? 1 : 0; });
ui.countIn.addEventListener('click', () => { api.countInVolume = toggle(ui.countIn, api.countInVolume === 0) ? 1 : 0; });
function setSpeed(pct) {
  pct = Math.max(25, Math.min(200, pct));
  if (youtube.active) {
    // YouTube only supports a few fixed rates: snap to the nearest one.
    pct = youtube.speeds.reduce((best, s) => (Math.abs(s - pct) < Math.abs(best - pct) ? s : best), 100);
  }
  ui.speed.value = pct;
  ui.speedValue.textContent = `${pct}%`;
  api.playbackSpeed = pct / 100;
}
ui.speed.addEventListener('input', () => setSpeed(Number(ui.speed.value)));
ui.volume.addEventListener('input', () => { api.masterVolume = Number(ui.volume.value) / 100; });
ui.audioSource.addEventListener('change', () => selectAudioSource(ui.audioSource.value));
ui.videoClose.addEventListener('click', () => selectAudioSource('synth'));
ui.videoSize.addEventListener('click', () => ui.videoPanel.classList.toggle('large'));
ui.syncEarlier.addEventListener('click', () => setSyncOffset(youtube.offsetMs - 50));
ui.syncLater.addEventListener('click', () => setSyncOffset(youtube.offsetMs + 50));
youtube.onError = e => setStatus(e.message, true);

function applyScoreView() {
  const d = api.settings.display;
  api.settings.notation.rhythmMode = rhythmModeFor(ui.staveProfile.value);
  applyNotation(state.score, ui.staveProfile.value);
  d.layoutMode = at.LayoutMode[ui.layoutMode.value];
  d.scale = Number(ui.zoom.value);
  document.body.classList.toggle('at-horizontal', ui.layoutMode.value === 'Horizontal');
  api.updateSettings();
  if (state.score) api.render();
}
for (const el of [ui.staveProfile, ui.layoutMode, ui.zoom]) {
  el.addEventListener('change', () => { applyScoreView(); saveView(); });
}
// Another browser tab changed the view or theme: follow it.
window.addEventListener('storage', e => {
  if (e.key === 'tabplayer.view') {
    showViewControls(loadView());
    applyScoreView();
    if (!ui.multiTrack.checked && state.score && state.selected.size > 1) { state.selected = new Set([state.activeTrack]); renderSelected(); }
    drawFretboard();
  } else if (e.key === 'tabplayer.theme' && e.newValue) {
    applyTheme(e.newValue, false);
  } else if (e.key === 'tabplayer.appearance') {
    appearance = loadAppearance();
    applyAppearance();
    relayout();
  }
});
ui.theme.addEventListener('change', () => applyTheme(ui.theme.value));
ui.themeToggle.addEventListener('click', () => {
  const dark = !['light', 'sepia', 'rose'].includes(document.documentElement.dataset.theme);
  applyTheme(dark ? 'light' : 'dark');
});
ui.toggleSidebar.addEventListener('click', () => {
  if (matchMedia('(max-width: 900px)').matches) document.body.classList.toggle('sidebar-open');
  else document.body.classList.toggle('sidebar-collapsed');
});
ui.showFretboard.addEventListener('change', () => {
  ui.fretboard.classList.toggle('hidden', !ui.showFretboard.checked);
  document.body.classList.toggle('no-fretboard', !ui.showFretboard.checked);
  saveView();
  drawFretboard();
});
ui.multiTrack.addEventListener('change', () => {
  saveView();
  if (!ui.multiTrack.checked && state.score) { state.selected = new Set([state.activeTrack]); renderSelected(); }
});
window.addEventListener('resize', drawFretboard);

document.addEventListener('keydown', e => {
  if (e.target.matches('input[type=text], select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); ui.url.focus(); ui.url.select(); return; }
  if (e.key === 't' || e.key === 'T') { ui.themeToggle.click(); return; }
  if (!api.isReadyForPlayback && e.key !== 'Escape') return;
  switch (e.key) {
    case ' ': e.preventDefault(); api.playPause(); break;
    case 'Escape': api.stop(); break;
    case 'l': case 'L': ui.loop.click(); break;
    case 'm': case 'M': if (!ui.metronome.disabled) ui.metronome.click(); break;
    case '+': case '=': setSpeed(Number(ui.speed.value) + (youtube.active ? 25 : 5)); break;
    case '-': case '_': setSpeed(Number(ui.speed.value) - (youtube.active ? 25 : 5)); break;
    case 'ArrowLeft': e.preventDefault(); jumpBar(-1); break;
    case 'ArrowRight': e.preventDefault(); jumpBar(1); break;
  }
});

api.masterVolume = 0.8;
api.metronomeVolume = 0;
api.countInVolume = 0;
applyTheme(store.get('theme', 'system'), false);
applyAppearance();

const params = new URLSearchParams(location.search);
const initial = params.get('url');
if (initial) { ui.url.value = initial; loadSongsterr(initial, params.get('rev')); }
