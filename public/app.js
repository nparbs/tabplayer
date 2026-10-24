import { songsterrToScore, parseSongsterrUrl, tuningName, looksLikeSongsterrLink, songsterrUrl } from './songsterr.js';
import { YouTubeAudio, parseYouTubeId, barStartSeconds } from './youtube.js';
import { songKey, clampRange, normalizeTrainer, trainerSpeed, parseStored, withLoop } from './practice.js';
import { Library, libraryLists, staleKeys, withSaved, canOpen, serializeTabs, parseTabs } from './library.js';
import { chordShape, shapeFromChord, chordSvg } from './chords.js';
import { Clicker, CLICK_SOUNDS, beatsFromBars, firstBeatFrom, countInPlan, encodeWav } from './audio.js';
import {
  techniques, target, clampSelection, moveBeat, moveBar, moveString, setFret, clearNote, makeRest, toggleTechnique,
  setDuration, changeDuration, toggleDot, insertBeat, deleteBeat, insertBar, deleteBar, setTimeSignature, setTempo,
  setSection, cloneJs, barJs, putBarJs, MAX_FRET, TUNINGS, setTuning, renameTrack, addTrack, removeTrack,
  toggleTriplet, toggleRepeatStart, setRepeatEnd, setKeySignature,
} from './editor.js';

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
  instrumentView: $('instrument-view'), noteLabels: $('note-labels'), allNotes: $('all-notes'), leftHanded: $('left-handed'),
  multiTrack: $('multi-track'),
  overlay: $('overlay'), overlayText: $('overlay-text'), viewport: $('viewport'), welcome: $('welcome'),
  fretboard: $('fretboard'),
  soundFont: $('soundfont'),
  accentSwatches: $('accent-swatches'), uiScale: $('ui-scale'), density: $('density'), resetAppearance: $('reset-appearance'),
  sidebarResizer: $('sidebar-resizer'), fretResizer: $('fret-resizer'),
  videoPanel: $('video-panel'), videoTitle: $('video-title'), ytHost: $('yt-host'),
  syncEarlier: $('sync-earlier'), syncLater: $('sync-later'), syncOffset: $('sync-offset'),
  videoSize: $('video-size'), videoClose: $('video-close'),
  customVideo: $('custom-video'), customVideoUrl: $('custom-video-url'), customVideoSync: $('custom-video-sync'),
  play: $('play'), stop: $('stop'), seek: $('seek'), barInfo: $('bar-info'),
  timeCurrent: $('time-current'), timeTotal: $('time-total'),
  loop: $('loop'), metronome: $('metronome'), countIn: $('count-in'), audioSource: $('audio-source'),
  speed: $('speed'), speedValue: $('speed-value'), volume: $('master-volume'), status: $('status'),
  loopFrom: $('loop-from'), loopTo: $('loop-to'), loopSetA: $('loop-set-a'), loopSetB: $('loop-set-b'),
  loopApply: $('loop-apply'), loopClear: $('loop-clear'),
  trainerOn: $('trainer-on'), trainerStart: $('trainer-start'), trainerStep: $('trainer-step'),
  trainerEvery: $('trainer-every'), trainerMax: $('trainer-max'), trainerInfo: $('trainer-info'),
  tabbar: $('tabbar'), libraryBtn: $('library-btn'), libraryPanel: $('library-panel'), welcomeLibrary: $('welcome-library'),
  songTranspose: $('song-transpose'), exportWav: $('export-wav'),
  editToggle: $('edit-toggle'), editBar: $('edit-bar'), editTechniques: $('edit-techniques'), editPos: $('edit-pos'),
  editDone: $('edit-done'), editTempo: $('edit-tempo'), editTsNum: $('edit-ts-num'), editTsDen: $('edit-ts-den'),
  editSection: $('edit-section'), editAddTrack: $('edit-add-track'), installApp: $('install-app'), editKey: $('edit-key'), editRepeat: $('edit-repeat'),
  chordsSection: $('chords-section'), chordPanel: $('chord-panel'), chordsCount: $('chords-count'),
  metroSound: $('metro-sound'), metroVolume: $('metro-volume'), metroAccent: $('metro-accent'), countInBars: $('count-in-bars'),
  songActions: $('song-actions'), favToggle: $('fav-toggle'), saveToggle: $('save-toggle'),
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
  restore: null,       // tab being shown, whose active track and mixer scoreLoaded puts back
};

// Open songs. One alphaTab instance shows the active tab; the others keep their parsed score in memory.
// A tab: { id, key, kind, input, rev, fileName, bytes, title, artist, score, raw (fetched Songsterr data),
//   songsterr, videos, selected, activeTrack, tick, mixer, loading, loadingText, error, restoring, closed }
const tabs = { list: [], active: null, seq: 0 };
const library = new Library();
const lib = { records: new Map() }; // in-memory copy of the library, for drawing lists synchronously

const store = {
  get(k, fallback) { try { return localStorage.getItem(`tabplayer.${k}`) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(`tabplayer.${k}`, v); } catch { /* storage unavailable */ } },
};

// View settings are remembered for every song (and shared between browser tabs).
const VIEW_DEFAULTS = {
  staveProfile: 'Tab', layoutMode: 'Page', zoom: '1', multiTrack: false,
  instrument: 'auto', noteLabels: 'fret', allNotes: false, leftHanded: false,
};
function loadView() {
  let saved = {};
  try { saved = JSON.parse(store.get('view', '{}')) || {}; } catch { /* corrupt: use defaults */ }
  if (saved.fretboard === false && !saved.instrument) saved.instrument = 'off'; // older "Fretboard" checkbox
  const view = { ...VIEW_DEFAULTS, ...saved };
  if (![...ui.instrumentView.options].some(o => o.value === view.instrument)) view.instrument = VIEW_DEFAULTS.instrument;
  if (![...ui.noteLabels.options].some(o => o.value === view.noteLabels)) view.noteLabels = VIEW_DEFAULTS.noteLabels;
  if (at.StaveProfile[view.staveProfile] === undefined) view.staveProfile = VIEW_DEFAULTS.staveProfile;
  if (at.LayoutMode[view.layoutMode] === undefined) view.layoutMode = VIEW_DEFAULTS.layoutMode;
  if (![...ui.zoom.options].some(o => o.value === String(view.zoom))) view.zoom = VIEW_DEFAULTS.zoom;
  return view;
}
function saveView() {
  store.set('view', JSON.stringify({
    staveProfile: ui.staveProfile.value, layoutMode: ui.layoutMode.value, zoom: ui.zoom.value,
    multiTrack: ui.multiTrack.checked, instrument: ui.instrumentView.value,
    noteLabels: ui.noteLabels.value, allNotes: ui.allNotes.checked, leftHanded: ui.leftHanded.checked,
  }));
}
function showViewControls(view) {
  ui.staveProfile.value = view.staveProfile;
  ui.layoutMode.value = view.layoutMode;
  ui.zoom.value = String(view.zoom);
  ui.multiTrack.checked = !!view.multiTrack;
  ui.instrumentView.value = view.instrument;
  ui.noteLabels.value = view.noteLabels;
  ui.allNotes.checked = !!view.allNotes;
  ui.leftHanded.checked = !!view.leftHanded;
  document.body.classList.toggle('at-horizontal', view.layoutMode === 'Horizontal');
  showInstrumentPanel();
}
function showInstrumentPanel() {
  const off = ui.instrumentView.value === 'off';
  ui.fretboard.classList.toggle('hidden', off);
  document.body.classList.toggle('no-fretboard', off);
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

// ---------- sounds ----------
// Sonivox ships with alphaTab; the rest are fetched (and cached) by the server on first use.
const SOUNDFONTS = {
  sonivox: { name: 'Sonivox', url: abs('/alphatab/soundfont/sonivox.sf2') },
  generaluser: { name: 'GeneralUser GS', url: abs('/api/soundfont/generaluser') },
  musescore: { name: 'MuseScore General', url: abs('/api/soundfont/musescore') },
  fluid: { name: 'FluidR3 Mono', url: abs('/api/soundfont/fluid') },
};
const sound = { id: SOUNDFONTS[store.get('soundfont')] ? store.get('soundfont') : 'sonivox', pending: null };
sound.pending = sound.id;

// General MIDI program names, for the per-track instrument picker.
const GM_FAMILIES = [
  ['Piano', 'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet'],
  ['Chromatic Percussion', 'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer'],
  ['Organ', 'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion'],
  ['Guitar', 'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)', 'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics'],
  ['Bass', 'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2'],
  ['Strings', 'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani'],
  ['Ensemble', 'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit'],
  ['Brass', 'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2'],
  ['Reed', 'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet'],
  ['Pipe', 'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina'],
  ['Synth Lead', 'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)', 'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)'],
  ['Synth Pad', 'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)', 'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)'],
  ['Synth Effects', 'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)', 'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)'],
  ['Ethnic', 'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai'],
  ['Percussive', 'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal'],
  ['Sound Effects', 'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'],
];
const gmName = program => GM_FAMILIES[program >> 3]?.[(program & 7) + 1] ?? `Program ${program}`;
// The song's own instrument (and mid-song instrument changes) per track, so an override can be undone.
const originalSound = new WeakMap();

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
    soundFont: SOUNDFONTS[sound.id].url,
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
  if (tracks.length) { state.rendering = true; api.renderTracks(tracks); }
}
function setControlsEnabled(on) {
  for (const el of [ui.exportGp, ui.exportMidi, ui.exportWav, ui.print, ui.editToggle]) el.disabled = !on;
}
function setPlayerEnabled(on) {
  on = on && !!state.score; // an empty tab has nothing to play, even though alphaTab still holds the last song
  for (const el of [ui.play, ui.stop, ui.seek, ui.loop]) el.disabled = !on;
  // The metronome comes from the synthesizer's timing, so it is silent with YouTube audio. The count-in is ours.
  ui.metronome.disabled = !on || youtube.active;
  ui.countIn.disabled = !on;
  const loopOn = on && !!state.score;
  for (const el of [ui.loopFrom, ui.loopTo, ui.loopSetA, ui.loopSetB, ui.loopApply, ui.loopClear]) el.disabled = !loopOn;
  // The trainer counts loop passes reported by the synthesizer, so it needs synth audio too.
  ui.trainerOn.disabled = !loopOn || youtube.active;
  if (youtube.active && ui.trainerOn.checked) { ui.trainerOn.checked = false; trainerChanged(); }
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
  if (state.score) { state.rendering = true; api.render(); }
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
// Loads run in the background: if the user switches tabs meanwhile, the song is kept on its tab
// and shown when that tab is picked again.
function beginLoad(tab, text) {
  Object.assign(tab, { loading: true, loadingText: text, error: '' });
  if (tab === activeTab()) showOverlay(text);
  renderTabs();
}
function failLoad(tab, message) {
  tab.loading = false;
  tab.restoring = false;
  tab.error = message;
  if (tab === activeTab()) {
    hideOverlay();
    setStatus(message, true);
    if (!tab.score) showEmpty(tab);
  }
  renderTabs();
}
function finishLoad(tab, score, message) {
  Object.assign(tab, {
    score, loading: false, error: '', restoring: false,
    title: score.title || tab.fileName || 'Untitled', artist: score.artist || '',
  });
  renderTabs();
  saveTabs();
  if (tab === activeTab()) { showTab(tab); setStatus(message); }
  rememberOpened(tab);
}

async function fetchSongsterrData(input, revision) {
  const q = new URLSearchParams({ url: input });
  if (revision) q.set('rev', revision);
  const res = await fetch(`/api/songsterr?${q}`);
  const data = await res.json().catch(() => ({ error: `Server error (HTTP ${res.status})` }));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

/**
 * Loads a Songsterr song into a tab (a new one unless the current tab is empty).
 * Uses the saved offline copy when asked to, or when Songsterr cannot be reached.
 */
async function loadSongsterr(input, revision = null, { tab = targetTab(), useSaved = false } = {}) {
  const parsed = parseSongsterrUrl(input);
  if (!parsed) { setStatus('That does not look like a Songsterr URL or song id.', true); return; }
  const key = songKey({ songId: parsed.songId });
  beginLoad(tab, revision ? `Fetching revision ${revision} from Songsterr…` : 'Fetching from Songsterr…');
  try {
    const saved = (await library.get(key))?.data;
    const savedFits = saved && (!revision || String(saved.meta.revisionId) === String(revision));
    let data, offline = false;
    if (useSaved && savedFits) {
      data = saved; offline = true;
    } else {
      try {
        data = await fetchSongsterrData(input, revision);
      } catch (e) {
        // Fall back to the offline copy only when Songsterr (or our server) is unreachable, not for "song removed".
        if (!savedFits || (e.status && e.status < 500)) throw e;
        data = saved; offline = true;
      }
    }
    if (tab.closed) return;
    if (tab === activeTab()) showOverlay('Converting tab…');
    const score = songsterrToScore(at, data.meta, data.tracks);
    let track = parsed.trackIndex ?? data.trackIndex ?? data.meta.popularTrack ?? data.meta.defaultTrack ?? 0;
    if (!score.tracks[track]) track = 0;
    const latestRevisionId = data.meta.latestRevisionId ?? data.meta.revisionId;
    const isLatest = !revision || data.meta.revisionId === latestRevisionId;
    keepView(tab, score, [track]);
    Object.assign(tab, {
      kind: 'songsterr', key, input, rev: isLatest ? null : data.meta.revisionId, raw: data, bytes: null,
      songsterr: { input, songId: data.meta.songId, revisionId: data.meta.revisionId, latestRevisionId },
      videos: data.videos || [],
    });
    finishLoad(tab, score, offline
      ? `Opened your saved copy (revision ${data.meta.revisionId})${useSaved ? '' : ': Songsterr could not be reached'}`
      : `Loaded from Songsterr (revision ${data.meta.revisionId}${isLatest ? ', latest' : ''})`);
  } catch (e) {
    console.error(e);
    failLoad(tab, `Could not load: ${e.message}`);
  }
}

async function loadFile(file, tab = targetTab()) {
  beginLoad(tab, `Opening ${file.name}…`);
  loadBytes(tab, new Uint8Array(await file.arrayBuffer()), file.name);
}

function loadBytes(tab, bytes, fileName) {
  try {
    const score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, api.settings);
    if (tab.closed) return;
    keepView(tab, score, [0]);
    Object.assign(tab, {
      kind: 'file', key: songKey({ title: score.title || fileName, artist: score.artist }), fileName, bytes,
      input: null, rev: null, raw: null, songsterr: null, videos: [],
    });
    finishLoad(tab, score, `Opened ${fileName}`);
  } catch (e) {
    failLoad(tab, `Could not open ${fileName}: ${e.message || 'unsupported file'}`);
  }
}

/** A restored tab keeps its tracks and position; a fresh load starts from `tracks`. */
function keepView(tab, score, tracks) {
  const fits = tab.restoring && tab.selected?.length && tab.selected.every(i => score.tracks[i]);
  if (fits) return;
  Object.assign(tab, { selected: tracks, activeTrack: tracks[0], tick: 0, mixer: null });
}

// ---------- tabs ----------
const activeTab = () => tabs.list.find(t => t.id === tabs.active) ?? null;
const isEmptyTab = t => !t.score && !t.loading && !t.key;

function newTab(init = {}) {
  const tab = {
    id: ++tabs.seq, key: null, kind: null, title: '', artist: '', score: null, songsterr: null, videos: [],
    selected: null, activeTrack: 0, tick: 0, mixer: null, loading: false, error: '', ...init,
  };
  tabs.list.push(tab);
  return tab;
}

/** Where a newly opened song goes: the current tab if it is empty, else a new tab. */
function targetTab() {
  const current = activeTab();
  if (current && isEmptyTab(current)) return current;
  const tab = newTab();
  activateTab(tab);
  return tab;
}

/** Remembers the active tab's tracks, position and mixer before another tab takes over the player. */
function stashTab(tab) {
  if (!tab?.score || state.score !== tab.score) return;
  tab.selected = [...state.selected];
  tab.activeTrack = state.activeTrack;
  tab.tick = api.tickPosition;
  tab.mixer = readMixer();
}

function activateTab(tab) {
  if (!tab) return;
  const current = activeTab();
  if (current === tab && (tab.score ? state.score === tab.score : !tab.key || tab.loading)) return;
  stashTab(current);
  tabs.active = tab.id;
  renderTabs();
  saveTabs();
  showTab(tab);
}

/** Puts a tab's song into the player (or the welcome screen for an empty tab). */
function showTab(tab) {
  // alphaTab's render worker reports layout for the score it was drawing; swapping the score mid-render
  // makes it apply that to the new one and throw. So wait for the current render to finish.
  if (state.rendering && tab.score) {
    state.queuedTab = tab;
    clearTimeout(state.queueTimer);
    state.queueTimer = setTimeout(() => { state.rendering = false; showQueuedTab(); }, 5000); // in case a render never reports back
    return;
  }
  if (api.isReadyForPlayback) api.stop();
  stopYouTube();
  forgetSelection();
  api.playbackRange = null;
  api.isLooping = toggle(ui.loop, false);
  state.songsterr = tab.songsterr;
  state.videos = tab.videos || [];
  buildAudioSources();
  if (!tab.score) {
    showEmpty(tab);
    if (tab.loading) showOverlay(tab.loadingText);
    else if (tab.key) loadTab(tab); // restored from last visit, or retrying one that failed
    return;
  }
  showOverlay('Rendering…');
  state.restore = tab;
  // alphaTab only reports renderStarted once the worker picks the job up, so mark it busy now.
  state.rendering = true;
  // renderScore builds the track list and generates the MIDI synchronously, so the position and mixer
  // can be put back straight after (the synth worker handles the messages in order).
  // It skips scoreLoaded when alphaTab still holds this score (back from an empty tab), so run that here.
  const reshow = api.score === tab.score;
  api.renderScore(tab.score, tab.selected?.length ? tab.selected : [0]);
  if (reshow) onScoreLoaded(tab.score);
  state.restore = null;
  if (tab.tick) {
    api.tickPosition = tab.tick;
    const bar = tab.score.masterBars.find(mb => mb.start <= tab.tick && tab.tick < mb.start + mb.calculateDuration());
    if (bar) showBar(bar);
  }
  reapplyMixer();
  setUrlParams(tab.kind === 'songsterr' ? { url: tab.input, rev: tab.rev } : { url: null, rev: null });
  if (document.activeElement !== ui.url) ui.url.value = tab.kind === 'songsterr' ? tab.input : '';
  if (tab.songsterr) loadRevisions();
  else ui.revisionRow.classList.add('hidden');
  if (store.get('audio') === 'youtube' && state.videos.length) selectAudioSource('0');
  else if (store.get('audio') === 'custom' && customVideos()[currentSongKey()]) startCustomVideo();
}

function showQueuedTab() {
  const tab = state.queuedTab;
  state.queuedTab = null;
  clearTimeout(state.queueTimer);
  if (tab && tab === activeTab()) showTab(tab);
}

/** Opens a tab restored from the last visit, the first time it is shown. */
async function loadTab(tab) {
  if (tab.kind === 'songsterr') { loadSongsterr(tab.input, tab.rev, { tab }); return; }
  const record = await library.get(tab.key);
  if (tab.closed) return;
  if (canOpen(record)) loadBytes(tab, record.bytes, record.fileName || tab.title);
  else failLoad(tab, `${tab.title || 'This file'} is no longer in your library. Open the file again.`);
}

function showEmpty(tab) {
  state.score = null;
  state.activeBeats = [];
  document.body.classList.remove('has-score');
  ui.title.textContent = tab?.title || 'No song loaded';
  ui.artist.textContent = tab?.error || tab?.artist || 'Load a Songsterr URL or open a file';
  ui.tracks.innerHTML = '';
  ui.revisionRow.classList.add('hidden');
  ui.barInfo.textContent = '';
  ui.timeCurrent.textContent = ui.timeTotal.textContent = '0:00';
  ui.seek.value = 0;
  if (!tab?.loading) ui.url.value = '';
  document.title = 'TabPlayer';
  setControlsEnabled(false);
  setPlayerEnabled(false);
  setUrlParams({ url: null, rev: null });
  ui.songTranspose.value = '0';
  setEditMode(false);
  updateSongActions();
  drawFretboard();
  renderChords();
}

function closeTab(tab) {
  const i = tabs.list.indexOf(tab);
  if (i < 0) return;
  tab.closed = true;
  tabs.list.splice(i, 1);
  if (tabs.active === tab.id) {
    tabs.active = null;
    activateTab(tabs.list[Math.min(i, tabs.list.length - 1)] ?? newTab());
  } else {
    renderTabs();
    saveTabs();
  }
}

function cycleTab(delta) {
  const i = tabs.list.indexOf(activeTab());
  if (tabs.list.length > 1) activateTab(tabs.list[(i + delta + tabs.list.length) % tabs.list.length]);
}

function saveTabs() {
  store.set('tabs', JSON.stringify(serializeTabs(tabs.list, tabs.active)));
}

function renderTabs() {
  ui.tabbar.innerHTML = tabs.list.map(t => {
    const fav = t.key && lib.records.get(t.key)?.favorite;
    const name = t.loading && !t.title ? 'Loading…' : t.title || 'New tab';
    const tip = [t.title, t.artist].filter(Boolean).join(' – ') || name;
    return `<div class="tab${t.id === tabs.active ? ' active' : ''}${t.loading ? ' loading' : ''}${t.error && !t.score ? ' failed' : ''}"
        role="tab" aria-selected="${t.id === tabs.active}" tabindex="${t.id === tabs.active ? 0 : -1}" data-id="${t.id}" title="${escapeHtml(tip)}">
      ${fav ? '<span class="tab-fav" aria-label="Favourite">★</span>' : ''}<span class="tab-title">${escapeHtml(name)}</span>${t.dirty ? '<span class="tab-dirty" title="Unsaved edits">•</span>' : ''}
      <button type="button" class="tab-close" title="Close tab (Alt+W)" aria-label="Close ${escapeHtml(name)}">×</button>
    </div>`;
  }).join('') + '<button type="button" class="tab-new" title="New tab" aria-label="New tab">+</button>';
}

ui.tabbar.addEventListener('click', e => {
  if (e.target.closest('.tab-new')) { activateTab(newTab()); return; }
  const el = e.target.closest('.tab');
  const tab = el && tabs.list.find(t => t.id === Number(el.dataset.id));
  if (!tab) return;
  if (e.target.closest('.tab-close')) closeTab(tab);
  else activateTab(tab);
});
ui.tabbar.addEventListener('auxclick', e => {
  const el = e.button === 1 && e.target.closest('.tab');
  const tab = el && tabs.list.find(t => t.id === Number(el.dataset.id));
  if (tab) { e.preventDefault(); closeTab(tab); }
});
ui.tabbar.addEventListener('keydown', e => {
  if (!e.target.classList.contains('tab')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    cycleTab(e.key === 'ArrowLeft' ? -1 : 1);
    ui.tabbar.querySelector('.tab.active')?.focus();
  } else if (e.key === 'Delete') {
    closeTab(tabs.list.find(t => t.id === Number(e.target.dataset.id)));
  }
});

// ---------- library: favourites, saved, recent ----------
async function refreshLibrary() {
  lib.records = new Map((await library.all()).map(r => [r.key, r]));
  renderLibrary();
  renderTabs();
  updateSongActions();
}

async function updateRecord(key, change) {
  const record = await library.get(key);
  if (!record) return null;
  const next = change(record);
  await library.put(next);
  return next;
}

/** Adds the tab's song to Recent (and refreshes a saved Songsterr copy with what was just fetched). */
async function rememberOpened(tab) {
  if (!tab.key) return;
  try {
    const old = (await library.get(tab.key)) || {};
    const fresh = tab.kind === 'songsterr' && old.saved && !tab.rev ? tab.raw : old.data;
    await library.put({
      ...old, key: tab.key, kind: tab.kind, title: tab.title, artist: tab.artist,
      input: tab.input ?? undefined, rev: tab.rev ?? undefined, fileName: tab.fileName ?? undefined,
      bytes: tab.kind === 'file' ? tab.bytes : undefined, data: tab.kind === 'songsterr' ? fresh : undefined,
      openedAt: Date.now(),
    });
    const keep = new Set(tabs.list.map(t => t.key).filter(Boolean));
    for (const key of staleKeys(await library.all(), keep)) await library.delete(key);
  } catch (e) {
    console.warn('library', e);
  }
  refreshLibrary();
}

async function toggleFavorite(key = activeTab()?.key) {
  if (!key) return;
  const r = await updateRecord(key, rec => ({ ...rec, favorite: !rec.favorite }));
  if (r) setStatus(r.favorite ? `Added ${r.title} to favourites` : `Removed ${r.title} from favourites`);
  refreshLibrary();
}

async function toggleSaved(key = activeTab()?.key) {
  if (!key) return;
  const tab = tabs.list.find(t => t.key === key);
  const r = await updateRecord(key, rec => withSaved(rec, !rec.saved, tab?.raw));
  if (r) setStatus(r.saved ? `Saved ${r.title}: it now opens without an internet connection` : `Removed the saved copy of ${r.title}`);
  refreshLibrary();
}

/** Takes a song off the Recent list (and out of the library entirely unless it is a favourite or saved). */
async function forgetRecent(key) {
  const r = await library.get(key);
  if (!r) return;
  if (r.favorite || r.saved || tabs.list.some(t => t.key === key)) await library.put({ ...r, openedAt: undefined });
  else await library.delete(key);
  refreshLibrary();
}

function openFromLibrary(key, fromSaved = false) {
  const open = tabs.list.find(t => t.key === key);
  if (open) { activateTab(open); return; }
  const r = lib.records.get(key);
  if (!canOpen(r)) { setStatus('This song can no longer be opened from the library.', true); return; }
  if (r.kind === 'songsterr') loadSongsterr(r.input, r.rev ?? null, { useSaved: fromSaved || !navigator.onLine });
  else { const tab = targetTab(); beginLoad(tab, `Opening ${r.fileName || r.title}…`); loadBytes(tab, r.bytes, r.fileName || r.title); }
}

function libraryItem(r, section) {
  const badges = [r.kind === 'file' ? 'File' : '', r.saved ? 'Offline' : '', r.rev ? `Rev ${r.rev}` : ''].filter(Boolean);
  const remove = section === 'saved' ? ['Remove saved copy', '🗑'] : section === 'recent' ? ['Remove from recent', '×'] : null;
  return `<div class="lib-item" data-key="${escapeHtml(r.key)}" data-section="${section}" role="button" tabindex="0">
    <button type="button" class="lib-star${r.favorite ? ' on' : ''}" aria-pressed="${!!r.favorite}"
      title="${r.favorite ? 'Remove from favourites' : 'Add to favourites'}">${r.favorite ? '★' : '☆'}</button>
    <div class="lib-text">
      <div class="lib-title">${escapeHtml(r.title || r.fileName || 'Untitled')}</div>
      <div class="lib-sub">${escapeHtml(r.artist || '')}${badges.map(b => `<span class="badge">${escapeHtml(b)}</span>`).join('')}</div>
    </div>
    ${remove ? `<button type="button" class="lib-remove" title="${remove[0]}" aria-label="${remove[0]}">${remove[1]}</button>` : ''}
  </div>`;
}

function librarySection(title, records, section, empty, limit = Infinity) {
  const items = records.slice(0, limit).map(r => libraryItem(r, section)).join('');
  return `<section class="lib-section"><h4>${title}${records.length ? ` <span class="muted">${records.length}</span>` : ''}</h4>
    ${items || `<p class="lib-empty">${empty}</p>`}</section>`;
}

function renderLibrary() {
  const { favorites, saved, recent } = libraryLists([...lib.records.values()]);
  ui.libraryPanel.innerHTML =
    librarySection('★ Favourites', favorites, 'favorites', 'Star a song (F) to keep it here.') +
    librarySection('💾 Saved', saved, 'saved', 'Saved songs open without an internet connection.') +
    librarySection('🕘 Recent', recent, 'recent', 'Songs you open show up here.');
  ui.welcomeLibrary.innerHTML = favorites.length || recent.length
    ? `<div class="welcome-lists">${favorites.length ? librarySection('★ Favourites', favorites, 'favorites', '', 6) : ''}
        ${recent.length ? librarySection('🕘 Recent', recent, 'recent', '', 6) : ''}</div>`
    : '';
}

function updateSongActions() {
  const tab = activeTab();
  const r = tab?.score && tab.key ? lib.records.get(tab.key) : null;
  ui.songActions.classList.toggle('hidden', !tab?.score);
  ui.favToggle.textContent = r?.favorite ? '★ Favourite' : '☆ Favourite';
  ui.favToggle.classList.toggle('on', !!r?.favorite);
  ui.favToggle.setAttribute('aria-pressed', String(!!r?.favorite));
  ui.favToggle.title = r?.favorite ? 'Remove from favourites (F)' : 'Add to favourites (F)';
  ui.saveToggle.textContent = r?.saved ? '💾 Saved' : '💾 Save';
  ui.saveToggle.classList.toggle('on', !!r?.saved);
  ui.saveToggle.setAttribute('aria-pressed', String(!!r?.saved));
  ui.saveToggle.title = r?.saved ? 'Saved in this browser. Click to remove the saved copy.' : 'Keep a copy in this browser so the song opens offline';
  for (const b of [ui.favToggle, ui.saveToggle]) b.disabled = !r;
}

function openLibrary(open = ui.libraryPanel.classList.contains('hidden')) {
  ui.libraryPanel.classList.toggle('hidden', !open);
  ui.libraryBtn.setAttribute('aria-expanded', String(open));
  if (open) ui.libraryPanel.querySelector('.lib-item')?.focus();
}

function onLibraryClick(e) {
  const item = e.target.closest('.lib-item');
  if (!item) return;
  const { key, section } = item.dataset;
  if (e.target.closest('.lib-star')) { toggleFavorite(key); return; }
  if (e.target.closest('.lib-remove')) { if (section === 'saved') toggleSaved(key); else forgetRecent(key); return; }
  openLibrary(false);
  openFromLibrary(key, section === 'saved');
}
for (const host of [ui.libraryPanel, ui.welcomeLibrary]) {
  host.addEventListener('click', onLibraryClick);
  host.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('lib-item')) { e.preventDefault(); onLibraryClick(e); }
    if (e.key === 'Escape') { openLibrary(false); ui.libraryBtn.focus(); }
  });
}
ui.libraryBtn.addEventListener('click', () => openLibrary());
document.addEventListener('mousedown', e => { if (!e.target.closest('.library-box')) openLibrary(false); });
ui.favToggle.addEventListener('click', () => toggleFavorite());
ui.saveToggle.addEventListener('click', () => toggleSaved());

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
  const hasSong = !!activeTab()?.score;
  ui.audioSource.innerHTML = '<option value="synth">Synth (MIDI)</option>' +
    state.videos.map((v, i) => `<option value="${i}">▶ YouTube: ${escapeHtml(v.label)}</option>`).join('') +
    (hasSong ? '<option value="custom">▶ Your own YouTube video…</option>' : '');
  ui.audioSource.value = 'synth';
  ui.audioSource.disabled = !hasSong;
  ui.audioSource.title = state.videos.length
    ? 'Play the synthesizer or the song\'s YouTube video'
    : 'Play the synthesizer, or follow any YouTube video (synced to the tab\'s tempo)';
}

async function selectAudioSource(value) {
  ui.audioSource.value = value;
  if (value === 'synth') {
    stopYouTube();
    store.set('audio', 'synth');
    setStatus('Audio: synthesizer');
    return;
  }
  if (value === 'custom') { startCustomVideo(); return; }
  const video = state.videos[Number(value)];
  if (!video) return;
  store.set('audio', 'youtube');
  ui.customVideo.classList.add('hidden');
  playVideo(video);
}

async function playVideo(video) {
  ui.videoPanel.classList.remove('hidden');
  ui.videoTitle.textContent = video.label;
  document.body.classList.add('yt-mode');
  setStatus('Loading YouTube player…');
  try {
    await youtube.start(video);
    setSpeed(Number(ui.speed.value));
    setPlayerEnabled(true);
    ui.customVideoSync.disabled = !video.custom;
    if (!video.custom) setStatus(`Audio: ${video.label} (YouTube). Press play.`);
    else if (video.start) setStatus(`Audio: your video, song starting at ${fmtTime(video.start * 1000)}. Press play.`);
    else setStatus('Play the video and press "⏱ Song starts now" when the first bar begins.');
  } catch (e) {
    stopYouTube();
    setStatus(e.message, true);
  }
}

// ---------- your own YouTube video ----------
// Any video can be followed: bar times come from the tab's tempo, lined up with "Song starts now"
// (and the ± nudge). Works best with recordings that keep the tab's tempo, like lessons or backing tracks.
const customVideos = () => parseStored(store.get('customVideos'));
function saveCustomVideo(videoId, start) {
  const key = currentSongKey();
  if (!key) return;
  const all = customVideos();
  delete all[key];
  all[key] = { videoId, start };
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete all[k];
  store.set('customVideos', JSON.stringify(all));
}
function customPoints(start) {
  return barStartSeconds(api.tickCache?.masterBars ?? [], state.score?.tempo).map(t => start + t);
}
function startCustomVideo(link = null) {
  const key = currentSongKey();
  const saved = key ? customVideos()[key] : null;
  const videoId = parseYouTubeId(link ?? saved?.videoId ?? '');
  ui.audioSource.value = 'custom';
  ui.customVideo.classList.remove('hidden');
  if (link !== null && !videoId) { setStatus('That does not look like a YouTube link.', true); return; }
  if (!videoId) {
    if (youtube.active) youtube.stop();
    ui.videoPanel.classList.remove('hidden');
    ui.videoTitle.textContent = 'Your own YouTube video';
    ui.customVideoSync.disabled = true;
    document.body.classList.remove('yt-mode'); // still on the synth until a video loads
    setPlayerEnabled(api.isReadyForPlayback);
    ui.customVideoUrl.focus();
    setStatus('Paste a YouTube link for this song.');
    return;
  }
  store.set('audio', 'custom');
  ui.customVideoUrl.value = `https://youtu.be/${videoId}`;
  const start = saved?.videoId === videoId ? saved.start : 0;
  saveCustomVideo(videoId, start);
  playVideo({ videoId, label: 'Your video', points: customPoints(start), custom: true, start });
}
ui.customVideo.addEventListener('submit', e => { e.preventDefault(); startCustomVideo(ui.customVideoUrl.value); });
ui.customVideoSync.addEventListener('click', () => {
  const video = youtube.video;
  if (!youtube.active || !video?.custom || !youtube.player?.getCurrentTime) return;
  video.start = Math.max(0, youtube.player.getCurrentTime() - youtube.offsetMs / 1000);
  video.points = customPoints(video.start);
  youtube.applySync();
  saveCustomVideo(video.videoId, video.start);
  setStatus(`Synced: the song starts at ${fmtTime(video.start * 1000)} in the video. Use −/+ to fine-tune.`);
});

function stopYouTube() {
  youtube.stop();
  ui.audioSource.value = 'synth';
  ui.videoPanel.classList.add('hidden');
  ui.customVideo.classList.add('hidden');
  document.body.classList.remove('yt-mode');
  setPlayerEnabled(api.isReadyForPlayback);
}

function setSyncOffset(ms) {
  ui.syncOffset.textContent = `${ms > 0 ? '+' : ''}${ms} ms`;
  youtube.setOffset(ms);
}

// ---------- tracks sidebar ----------
const isVocal = track => /vocal|voice|vox/i.test(track.name);
function trackIcon(track) {
  const staff = track.staves[0];
  if (staff.isPercussion) return '🥁';
  if (isVocal(track)) return '🎤';
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
      </div>
      ${track.staves[0].isPercussion ? '' : `<div class="track-sound"><select title="Instrument sound (synth audio only)" aria-label="Instrument sound">${programOptions(track)}</select></div>
      <div class="track-pitch">
        <label title="Transpose this track in semitones (playback and notation; the tab stays the same)">Transpose
          <select class="transpose">${transposeOptions()}</select></label>
        ${isStringedStaff(track.staves[0]) && !isVocal(track) ? `<label title="Capo fret: raises everything played on the tab">Capo
          <select class="capo">${capoOptions(track.staves[0])}</select></label>` : ''}
      </div>`}
      <div class="track-edit">
        <input class="track-rename" type="text" value="${escapeHtml(track.name)}" aria-label="Track name" title="Rename the track">
        ${isStringedStaff(track.staves[0]) && !isVocal(track) ? `<select class="track-tuning" title="Tuning (frets stay, pitches change)" aria-label="Tuning">${tuningOptions(track.staves[0])}</select>` : ''}
        <button type="button" class="track-remove" title="Remove this track"${state.score.tracks.length <= 1 ? ' disabled' : ''}>🗑</button>
      </div>`;
    li.addEventListener('click', e => {
      if (e.target.closest('.track-controls, .track-sound, .track-pitch, .track-edit')) return;
      if (ui.multiTrack.checked) {
        if (state.selected.has(i) && state.selected.size > 1) state.selected.delete(i);
        else state.selected.add(i);
      } else {
        state.selected = new Set([i]);
      }
      state.activeTrack = i;
      renderSelected();
      renderChords();
      if (edit.on) moveSel(clampSelection(state.score, { ...edit.sel, track: i, staff: 0 }));
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
    li.querySelector('.track-sound select')?.addEventListener('change', e => {
      setTrackProgram(track, e.target.value === '' ? null : Number(e.target.value));
      e.target.classList.toggle('changed', e.target.value !== '');
      li.querySelector('.track-icon').textContent = trackIcon(track);
    });
    li.querySelector('.transpose')?.addEventListener('change', e => setTrackPitch([track], { transpose: Number(e.target.value) }));
    li.querySelector('.track-rename').addEventListener('change', e => editTrack(i, s => renameTrack(s, i, e.target.value), `Renamed to ${e.target.value.trim()}`));
    li.querySelector('.track-rename').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
    li.querySelector('.track-tuning')?.addEventListener('change', e => {
      const [name, tuning] = TUNINGS[Number(e.target.value)] ?? [];
      if (tuning) editTrack(i, s => setTuning(at, s, i, tuning, name), `${track.name}: ${name} tuning`);
    });
    li.querySelector('.track-remove').addEventListener('click', () => {
      if (confirm(`Remove the track "${track.name}"? You can undo this.`)) {
        editTrack(i, s => removeTrack(s, i), `Removed ${track.name}`, { removed: i });
      }
    });
    li.querySelector('.capo')?.addEventListener('change', e => setTrackPitch([track], { capo: Number(e.target.value) }));
    ui.tracks.appendChild(li);
  });
  refreshTrackPitch();
}

// ---------- transpose and capo ----------
// Both live on the score model (staff.transpositionPitch, staff.capo), so each tab keeps its own.
const originalPitch = new WeakMap(); // staff -> the song's own { transpose, capo }
function pitchInfo(staff) {
  if (!originalPitch.has(staff)) originalPitch.set(staff, { transpose: staff.transpositionPitch, capo: staff.capo });
  return originalPitch.get(staff);
}
// alphaTab subtracts transpositionPitch from every note, so a negative value sounds higher.
const userTranspose = track => pitchInfo(track.staves[0]).transpose - track.staves[0].transpositionPitch;
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
function transposeOptions() {
  let html = '';
  for (let n = 12; n >= -12; n--) html += `<option value="${n}">${signed(n)}</option>`;
  return html;
}
function capoOptions(staff) {
  const song = pitchInfo(staff).capo;
  let html = '';
  for (let f = 0; f <= 12; f++) html += `<option value="${f}">${f === 0 ? 'None' : f}${f === song && song > 0 ? ' (song)' : ''}</option>`;
  return html;
}

/** Changes transpose (semitones from the original) and/or capo for tracks, then regenerates the audio. */
function setTrackPitch(tracks, { transpose = null, capo = null }) {
  for (const track of tracks) {
    if (track.staves[0].isPercussion) continue;
    for (const staff of track.staves) {
      const orig = pitchInfo(staff);
      if (transpose !== null) staff.transpositionPitch = orig.transpose - transpose;
      if (capo !== null && isStringedStaff(staff)) staff.capo = capo;
    }
    pianoRanges.delete(track);
  }
  reloadMidi();
  if (state.score) { state.rendering = true; api.render(); } // notation and capo label
  refreshTrackPitch();
  drawFretboard();
  renderChords();
  const t = tracks.length === 1 ? tracks[0] : null;
  const what = transpose !== null ? `transposed ${signed(transpose)}` : `capo ${capo || 'off'}`;
  setStatus(t ? `${t.name}: ${what}` : `All tracks ${what}`);
}

/** Shows the current transpose / capo in the track cards and the song-wide transpose picker. */
function refreshTrackPitch() {
  if (!state.score) return;
  for (const li of ui.tracks.children) {
    const track = state.score.tracks[Number(li.dataset.index)];
    const t = li.querySelector('.transpose'), c = li.querySelector('.capo');
    if (t) { t.value = String(userTranspose(track)); t.classList.toggle('changed', userTranspose(track) !== 0); }
    if (c) { c.value = String(track.staves[0].capo); c.classList.toggle('changed', track.staves[0].capo !== pitchInfo(track.staves[0]).capo); }
    li.querySelector('.track-sub').textContent = trackDetails(track);
  }
  const values = new Set(state.score.tracks.filter(t => !t.staves[0].isPercussion).map(userTranspose));
  ui.songTranspose.value = values.size === 1 ? String([...values][0]) : 'mixed';
}

function reloadMidi() {
  if (api.playerState === at.synth.PlayerState.Playing) api.pause();
  const tick = api.tickPosition;
  api.loadMidiForScore();
  api.tickPosition = tick;
  reapplyMixer();
}
function programOptions(track) {
  const original = originalSound.get(track)?.program ?? track.playbackInfo.program;
  const groups = GM_FAMILIES.map(([family, ...names], f) => `<optgroup label="${family}">${
    names.map((n, i) => `<option value="${f * 8 + i}">${escapeHtml(n)}</option>`).join('')}</optgroup>`);
  // Guitar and bass first: that is what people swap most.
  const order = [3, 4, ...GM_FAMILIES.keys()].filter((f, i, a) => a.indexOf(f) === i);
  return `<option value="">Song default: ${escapeHtml(gmName(original))}</option>${order.map(f => groups[f]).join('')}`;
}

/** Plays a track with another General MIDI instrument, or restores the song's own sounds (program = null). */
function setTrackProgram(track, program) {
  if (!originalSound.has(track)) {
    const changes = [];
    for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
      for (const a of beat.automations) if (a.type === at.model.AutomationType.Instrument) changes.push([beat, a]);
    }
    originalSound.set(track, { program: track.playbackInfo.program, changes });
  }
  const orig = originalSound.get(track);
  for (const [beat, a] of orig.changes) {
    const i = beat.automations.indexOf(a);
    if (program === null && i < 0) beat.automations.push(a);
    if (program !== null && i >= 0) beat.automations.splice(i, 1);
  }
  track.playbackInfo.program = program ?? orig.program;
  reloadMidi();
  setStatus(`${track.name}: ${gmName(track.playbackInfo.program)}`);
}

// A tab's mixer as shown in the track cards, so it can be put back when the tab is shown again.
function readMixer() {
  return [...ui.tracks.children].map(li => ({
    mute: li.querySelector('.mute').classList.contains('on'),
    solo: li.querySelector('.solo').classList.contains('on'),
    volume: li.querySelector('input[type=range]').value,
    program: li.querySelector('.track-sound select')?.value ?? '',
  }));
}
function applyMixer(mixer) {
  [...ui.tracks.children].forEach((li, i) => {
    const m = mixer[i];
    if (!m) return;
    li.querySelector('.mute').classList.toggle('on', m.mute);
    li.querySelector('.solo').classList.toggle('on', m.solo);
    li.querySelector('input[type=range]').value = m.volume;
    const select = li.querySelector('.track-sound select');
    if (select) { select.value = m.program; select.classList.toggle('changed', m.program !== ''); }
  });
}

// Regenerating the MIDI resets the synth channels, so push the mixer settings again.
function reapplyMixer() {
  for (const li of ui.tracks.children) {
    const track = state.score.tracks[Number(li.dataset.index)];
    const vol = Number(li.querySelector('input[type=range]').value);
    api.changeTrackMute([track], li.querySelector('.mute').classList.contains('on'));
    api.changeTrackSolo([track], li.querySelector('.solo').classList.contains('on'));
    api.changeTrackVolume([track], vol / Math.max(1, track.playbackInfo.volume));
  }
}

function loadSoundFontChoice(id) {
  if (!SOUNDFONTS[id]) id = 'sonivox';
  ui.soundFont.value = id;
  if (id === sound.id && !sound.pending) return;
  if (api.playerState === at.synth.PlayerState.Playing) api.pause();
  sound.id = id;
  sound.pending = id;
  store.set('soundfont', id);
  setStatus(`Loading ${SOUNDFONTS[id].name}…`);
  api.loadSoundFont(SOUNDFONTS[id].url, false);
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

// ---------- practice: loop by bar number, speed trainer ----------
const practice = { passes: 0, trainer: normalizeTrainer(parseStored(store.get('trainer'))) };

function currentSongKey() {
  return songKey({ songId: state.songsterr?.songId, title: state.score?.title, artist: state.score?.artist });
}
function restoreLoopInputs() {
  const count = state.score?.masterBars.length ?? 0;
  for (const el of [ui.loopFrom, ui.loopTo]) { el.max = count; el.value = ''; }
  const key = currentSongKey();
  const saved = key ? parseStored(store.get('loops'))[key] : null;
  const range = saved && clampRange(saved.from, saved.to, count);
  if (range) {
    ui.loopFrom.value = range.from;
    ui.loopTo.value = range.to;
    if (!edit.on) setStatus(`Saved loop for this song: bars ${range.from}–${range.to}. Click "Loop these bars" to use it.`);
  }
}
function loopBeats(range) {
  // Any rendered track works: alphaTab maps the beats to playback ticks (including repeats).
  const bars = api.tracks[0]?.staves[0]?.bars;
  const first = bars?.[range.from - 1]?.voices[0]?.beats[0];
  const lastBeats = bars?.[range.to - 1]?.voices[0]?.beats;
  return first && lastBeats?.length ? [first, lastBeats[lastBeats.length - 1]] : null;
}
function applyLoopBars() {
  const range = clampRange(ui.loopFrom.value, ui.loopTo.value, state.score?.masterBars.length);
  if (!range) { setStatus('Enter the first and last bar to loop.', true); return; }
  const beats = loopBeats(range);
  if (!beats) { setStatus('Could not find those bars in the shown track.', true); return; }
  ui.loopFrom.value = range.from;
  ui.loopTo.value = range.to;
  api.highlightPlaybackRange(beats[0], beats[1]);
  api.applyPlaybackRangeFromHighlight(); // also moves the playhead to the loop start
  if (!api.playbackRange) {
    // alphaTab drops the range when start and end are the same beat (a one-bar loop over a bar
    // holding a single beat), so build it from the bar's length.
    const start = api.tickPosition;
    api.playbackRange = { startTick: start, endTick: start + state.score.masterBars[range.from - 1].calculateDuration() - 50 };
  }
  api.isLooping = toggle(ui.loop, true);
  practice.passes = 0;
  if (ui.trainerOn.checked) setSpeed(practice.trainer.start);
  const key = currentSongKey();
  if (key) store.set('loops', JSON.stringify(withLoop(parseStored(store.get('loops')), key, range)));
  setStatus(`Looping bars ${range.from}–${range.to}${ui.trainerOn.checked ? ` from ${practice.trainer.start}%` : ''}.`);
}
/**
 * Removes the playback-range highlight for good. alphaTab's clearPlaybackRangeHighlight() only hides it and
 * re-applies the remembered beats after every render, which brings it back (or throws once they belong to
 * another song), so the remembered selection is cleared too.
 */
function forgetSelection() {
  api.clearPlaybackRangeHighlight();
  api._selectionStart = api._selectionEnd = undefined;
}
function clearLoop() {
  forgetSelection();
  api.playbackRange = null;
  api.isLooping = toggle(ui.loop, false);
  ui.loopFrom.value = ui.loopTo.value = '';
  const key = currentSongKey();
  if (key) store.set('loops', JSON.stringify(withLoop(parseStored(store.get('loops')), key, null)));
  setStatus('Loop cleared.');
}
function showTrainer() {
  const t = practice.trainer;
  ui.trainerStart.value = t.start; ui.trainerStep.value = t.step; ui.trainerEvery.value = t.every; ui.trainerMax.value = t.max;
  for (const el of [ui.trainerStart, ui.trainerStep, ui.trainerEvery, ui.trainerMax]) el.disabled = !ui.trainerOn.checked;
}
function trainerChanged() {
  practice.trainer = normalizeTrainer({ start: ui.trainerStart.value, step: ui.trainerStep.value,
    every: ui.trainerEvery.value, max: ui.trainerMax.value });
  store.set('trainer', JSON.stringify(practice.trainer));
  practice.passes = 0;
  showTrainer();
  if (ui.trainerOn.checked) {
    const t = practice.trainer;
    setSpeed(t.start);
    if (!api.isLooping) api.isLooping = toggle(ui.loop, true);
    ui.trainerInfo.textContent = `Pass 1 at ${t.start}%, then +${t.step}% every ${t.every > 1 ? `${t.every} passes` : 'pass'} up to ${t.max}%.`;
  } else {
    ui.trainerInfo.textContent = 'Speeds up each time the loop comes round. Uses the synth, not YouTube audio.';
  }
}
function onLoopPass() {
  if (!ui.trainerOn.checked || !api.isLooping) return;
  practice.passes += 1;
  const pct = trainerSpeed(practice.trainer, practice.passes);
  setSpeed(pct);
  ui.trainerInfo.textContent = `Pass ${practice.passes + 1} at ${pct}%${pct >= practice.trainer.max ? ' (top speed)' : ''}.`;
}

// ---------- chord diagrams ----------
// Chords of the fretboard track, in order of first appearance, with every beat they are played on.
const chordLists = new WeakMap();
function trackChords(staff) {
  if (chordLists.has(staff)) return chordLists.get(staff);
  const byName = new Map();
  for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
    const chord = beat.chord;
    if (!chord?.name) continue;
    if (!byName.has(chord.name)) byName.set(chord.name, { name: chord.name, chord, beats: [] });
    byName.get(chord.name).beats.push(beat);
  }
  const list = [...byName.values()];
  chordLists.set(staff, list);
  return list;
}

function renderChords() {
  const staff = state.score?.tracks[state.activeTrack]?.staves[0];
  const chords = staff && !staff.isPercussion ? trackChords(staff) : [];
  ui.chordsSection.classList.toggle('hidden', !chords.length);
  state.chords = chords;
  if (!chords.length) { ui.chordPanel.innerHTML = ''; return; }
  ui.chordsCount.textContent = chords.length;
  const tuning = [...staff.tuning].reverse(); // alphaTab lists the highest string first
  ui.chordPanel.innerHTML = chords.map((c, i) => {
    const shape = isStringedStaff(staff) ? shapeFromChord(c.chord) ?? chordShape(c.name, tuning) : null;
    return `<button type="button" class="chord" data-i="${i}" title="${escapeHtml(c.name)}: played ${c.beats.length} time${c.beats.length === 1 ? '' : 's'}. Click to jump to it.">
      <span class="chord-name">${escapeHtml(c.name)}</span>
      ${shape ? chordSvg(shape, { leftHanded: ui.leftHanded.checked }) : '<span class="chord-none">no diagram</span>'}
    </button>`;
  }).join('');
  state.currentChord = null;
}

/** Highlights the chord sounding at a beat: the last chord symbol at or before it on the fretboard track. */
function highlightChord(beat) {
  if (!state.chords?.length || !beat) return;
  const staff = state.score.tracks[state.activeTrack].staves[0];
  const barIndex = beat.voice.bar.index;
  let name = null;
  for (let b = barIndex; b >= Math.max(0, barIndex - 32) && !name; b--) {
    const beats = staff.bars[b]?.voices[0]?.beats ?? [];
    for (let i = beats.length - 1; i >= 0; i--) {
      if (b === barIndex && beats[i].playbackStart > beat.playbackStart) continue;
      if (beats[i].chord?.name) { name = beats[i].chord.name; break; }
    }
  }
  if (name === state.currentChord) return;
  state.currentChord = name;
  for (const el of ui.chordPanel.children) el.classList.toggle('active', state.chords[Number(el.dataset.i)]?.name === name);
}

ui.chordPanel.addEventListener('click', e => {
  const el = e.target.closest('.chord');
  const chord = el && state.chords[Number(el.dataset.i)];
  if (!chord || !api.tickCache) return;
  // Jump to the next time this chord is played (wrapping round to the first).
  const ticks = chord.beats.map(b => api.tickCache.getBeatStart(b)).filter(t => t >= 0).sort((a, b) => a - b);
  if (!ticks.length) return;
  const now = api.tickPosition;
  const target = ticks.find(t => t > now + 10) ?? ticks[0];
  api.tickPosition = target;
  const bar = chord.beats.find(b => api.tickCache.getBeatStart(b) === target)?.voice.bar.masterBar;
  if (bar) showBar(bar);
  setStatus(`${chord.name}: bar ${(bar?.index ?? 0) + 1}`);
});

// ---------- metronome and count-in ----------
// "Synth" uses alphaTab's own metronome; the other sounds are scheduled here from the playback position.
// The count-in is always ours: any length, an accented first beat, and it works with YouTube audio too.
const clicker = new Clicker();
window.tabPlayerClicker = clicker; // handy for debugging (and the browser test)
const METRO_DEFAULTS = { sound: 'synth', volume: 50, accent: true, countInBars: 1 };
function loadMetro() {
  const m = { ...METRO_DEFAULTS, ...parseStored(store.get('metronome')) };
  if (m.sound !== 'synth' && !CLICK_SOUNDS[m.sound]) m.sound = METRO_DEFAULTS.sound;
  m.volume = Math.max(0, Math.min(100, Number(m.volume) || 0));
  m.countInBars = [1, 2].includes(Number(m.countInBars)) ? Number(m.countInBars) : 1;
  m.accent = m.accent !== false;
  return m;
}
let metro = loadMetro();
const metroRun = { beats: [], lastTick: -1, prevTick: -1, wrapUntil: null };
const LOOKAHEAD_SEC = 0.35;

const metronomeOn = () => ui.metronome.classList.contains('on');
const countInOn = () => ui.countIn.classList.contains('on');
const clickVolume = () => (metro.volume / 50) * 0.8;
const clickSound = () => (metro.sound === 'synth' ? 'woodblock' : metro.sound);

function showMetro() {
  ui.metroSound.value = metro.sound;
  ui.metroVolume.value = metro.volume;
  ui.metroAccent.checked = metro.accent;
  ui.metroAccent.disabled = metro.sound === 'synth';
  ui.countInBars.value = String(metro.countInBars);
}
function metroChanged() {
  metro = { sound: ui.metroSound.value, volume: Number(ui.metroVolume.value), accent: ui.metroAccent.checked, countInBars: Number(ui.countInBars.value) };
  store.set('metronome', JSON.stringify(metro));
  showMetro();
  applyMetronome();
}
function applyMetronome() {
  api.metronomeVolume = metronomeOn() && metro.sound === 'synth' ? metro.volume / 50 : 0;
  metroRun.lastTick = metroRun.prevTick = -1;
  metroRun.wrapUntil = null;
}
function clickAt(beat, when) {
  clicker.play(when, { sound: metro.sound, accent: metro.accent && beat.accent, volume: clickVolume() });
}

/** Schedules our metronome clicks a little ahead of the playback position (called on every position update). */
function scheduleClicks(e) {
  if (!metronomeOn() || metro.sound === 'synth' || youtube.active) return;
  if (api.playerState !== at.synth.PlayerState.Playing || !metroRun.beats.length) return;
  const beats = metroRun.beats;
  const perSec = ((e.modifiedTempo || 120) / 60) * 960; // ticks per second, speed included
  const tick = e.currentTick;
  const now = clicker.now;
  if (e.isSeek || tick < metroRun.prevTick - 5) {
    // Jumped (seek, or the loop came round): carry on from what was already scheduled past the loop start.
    metroRun.lastTick = metroRun.wrapUntil ?? tick - 1;
    metroRun.wrapUntil = null;
  }
  metroRun.prevTick = tick;
  const horizon = tick + perSec * LOOKAHEAD_SEC;
  const range = api.isLooping ? api.playbackRange : null;
  const end = range ? Math.min(horizon, range.endTick) : horizon;
  for (let i = firstBeatFrom(beats, metroRun.lastTick + 1); i < beats.length && beats[i].tick <= end; i++) {
    if (beats[i].tick >= tick - perSec * 0.02) clickAt(beats[i], now + Math.max(0, beats[i].tick - tick) / perSec);
    metroRun.lastTick = beats[i].tick;
  }
  if (range && horizon > range.endTick) {
    const offset = (range.endTick - tick) / perSec;
    const limit = range.startTick + (horizon - range.endTick);
    const from = metroRun.wrapUntil ?? range.startTick - 1;
    for (let i = firstBeatFrom(beats, from + 1); i < beats.length && beats[i].tick <= limit; i++) {
      clickAt(beats[i], now + offset + (beats[i].tick - range.startTick) / perSec);
      metroRun.wrapUntil = beats[i].tick;
    }
  }
}

/** Tempo (BPM) in effect at a master bar. */
function tempoAt(masterBar) {
  for (let mb = masterBar; mb; mb = mb.previousMasterBar) {
    const auto = mb.tempoAutomations?.[0];
    if (auto) return auto.value;
  }
  return state.score?.tempo || 120;
}

let countIn = null;
/** Play / pause, with our count-in first when it is switched on. */
function playPause() {
  if (countIn) { stopCountIn(); return; }
  if (api.playerState === at.synth.PlayerState.Playing || !countInOn() || !state.score) { api.playPause(); return; }
  const mb = state.score.masterBars[state.currentBar ?? 0] ?? state.score.masterBars[0];
  const plan = countInPlan({
    bars: metro.countInBars, numerator: mb.timeSignatureNumerator, denominator: mb.timeSignatureDenominator,
    tempo: tempoAt(mb) * api.playbackSpeed,
  });
  const start = clicker.now + 0.06;
  for (const c of plan.clicks) clicker.play(start + c.at, { sound: clickSound(), accent: c.accent, volume: clickVolume() });
  ui.play.classList.add('counting');
  setStatus(`Count-in: ${metro.countInBars} bar${metro.countInBars > 1 ? 's' : ''}…`);
  countIn = {
    timer: setTimeout(() => { countIn = null; ui.play.classList.remove('counting'); api.play(); }, (0.06 + plan.duration) * 1000),
  };
}
function stopCountIn() {
  if (!countIn) return;
  clearTimeout(countIn.timer);
  countIn = null;
  ui.play.classList.remove('counting');
  clicker.silence();
  setStatus('Count-in cancelled');
}

ui.metroSound.addEventListener('change', metroChanged);
ui.metroVolume.addEventListener('input', metroChanged);
ui.metroAccent.addEventListener('change', metroChanged);
ui.countInBars.addEventListener('change', metroChanged);
api.midiLoad.on(() => {
  metroRun.beats = beatsFromBars(api.tickCache?.masterBars ?? []);
  applyMetronome();
});

// ---------- export audio (WAV) ----------
let exporting = null;
async function exportWav() {
  if (!state.score || exporting) return;
  if (api.playerState === at.synth.PlayerState.Playing) api.pause();
  stopCountIn();
  const opts = new at.synth.AudioExportOptions();
  opts.masterVolume = api.masterVolume;
  opts.metronomeVolume = 0;
  opts.useSyncPoints = false;
  // The synth's live mixer isn't used by the exporter, so pass mute / solo / volume from the track cards.
  const cards = [...ui.tracks.children];
  const anySolo = cards.some(li => li.querySelector('.solo').classList.contains('on'));
  opts.trackVolume = new Map(cards.map(li => {
    const track = state.score.tracks[Number(li.dataset.index)];
    const muted = li.querySelector('.mute').classList.contains('on') || (anySolo && !li.querySelector('.solo').classList.contains('on'));
    return [track.index, muted ? 0 : Number(li.querySelector('input[type=range]').value) / Math.max(1, track.playbackInfo.volume)];
  }));
  const range = api.isLooping && api.playbackRange ? api.playbackRange : null;
  if (range) opts.playbackRange = range;
  exporting = { cancelled: false };
  showOverlay('Rendering audio… (click to cancel)');
  let exporter;
  try {
    exporter = await api.exportAudio(opts);
    const chunks = [];
    let length = 0;
    for (;;) {
      if (exporting.cancelled) throw new Error('cancelled');
      const chunk = await exporter.render(1000);
      if (!chunk) break;
      chunks.push(chunk.samples.slice());
      length += chunk.samples.length;
      ui.overlayText.textContent = `Rendering audio… ${Math.round((chunk.currentTime / Math.max(1, chunk.endTime)) * 100)}% (click to cancel)`;
    }
    const samples = new Float32Array(length);
    let at0 = 0;
    for (const c of chunks) { samples.set(c, at0); at0 += c.length; }
    const bars = range ? ` (bars ${ui.loopFrom.value || '?'}-${ui.loopTo.value || '?'})` : '';
    download(encodeWav(samples, { sampleRate: opts.sampleRate, channels: 2 }), `${safeName()}${bars}.wav`, 'audio/wav');
    setStatus(`Saved ${Math.round(samples.length / 2 / opts.sampleRate)} s of audio${range ? ' (the looped bars)' : ''}`);
  } catch (e) {
    setStatus(e.message === 'cancelled' ? 'Audio export cancelled' : `Audio export failed: ${e.message}`, e.message !== 'cancelled');
  } finally {
    exporter?.destroy();
    exporting = null;
    hideOverlay();
  }
}
ui.exportWav.addEventListener('click', exportWav);
ui.overlay.addEventListener('click', () => { if (exporting) exporting.cancelled = true; });

// ---------- edit mode ----------
// Edits work on a copy of the tab's score, which is then rebuilt through alphaTab's JSON form and re-rendered.
// Undo keeps the bar before / after for edits inside one bar, and the whole score for structural edits.
const toJs = score => at.model.JsonConverter.scoreToJsObject(score);
const fromJs = js => at.model.JsonConverter.jsObjectToScore(js, api.settings);
const TECHNIQUES = techniques(at);
const TECH_BUTTONS = [...Object.entries(TECHNIQUES), ['tie', { label: 'Tie to the previous note', short: 'Tie', key: 't' }]];
const UNDO_LIMIT = 100, FULL_SNAPSHOTS = 12;
const edit = { on: false, sel: null, clipboard: null, digit: null };
const editCursor = Object.assign(document.createElement('div'), { className: 'edit-cursor' });
const editString = Object.assign(document.createElement('div'), { className: 'edit-string' });

ui.editTechniques.innerHTML = TECH_BUTTONS.map(([id, t]) =>
  `<button type="button" data-tech="${id}" title="${escapeHtml(t.label)} (${t.key.toUpperCase()})">${escapeHtml(t.short)}</button>`).join('');

function setEditMode(on) {
  const tab = activeTab();
  on = on && !!tab?.score;
  if (on === edit.on) return;
  edit.on = on;
  document.body.classList.toggle('editing', on);
  ui.editBar.classList.toggle('hidden', !on);
  ui.editToggle.classList.toggle('on', on);
  ui.editToggle.setAttribute('aria-pressed', String(on));
  if (on) {
    if (api.playerState === at.synth.PlayerState.Playing) api.pause();
    const staff = state.score.tracks[state.activeTrack].staves[0];
    edit.sel = clampSelection(state.score, {
      track: state.activeTrack, staff: 0, bar: state.currentBar ?? 0, beat: 0, string: staff.tuning.length || 1,
    });
    edit.tab = tabs.active;
    setStatus('Editing: click a note or use the arrow keys, then type fret numbers. Esc when done.');
  } else {
    editCursor.remove();
    editString.remove();
    setStatus(tab?.dirty ? 'Edits kept in this tab. Save .gp to keep them for good.' : 'Stopped editing.');
  }
  relayout();
  updateEditUi();
}

/** Runs an edit: fn(workingScore, selection) mutates the copy and returns the new selection (null = no change). */
function applyEdit(scope, fn, label = '', unchanged = '', tracks = null) {
  const tab = activeTab();
  if (!edit.on || !tab?.score) return;
  const sel = edit.sel;
  const before = toJs(tab.score);
  const work = fromJs(before);
  const next = fn(work, { ...sel });
  if (!next) { setStatus(unchanged || (label ? `${label}: nothing to change here` : 'Nothing to change here'), !!unchanged); return; }
  const after = toJs(work);
  pushUndo(tab, scope === 'bar'
    ? { scope, sel, next, before: cloneJs(barJs(before, sel)), after: cloneJs(barJs(after, sel)) }
    : { scope, sel, next, before, after });
  commitEdit(tab, fromJs(after), next, tracks);
  if (label) setStatus(label);
}

/** Track-level edits (rename, tuning, add, remove) from the track cards or the toolbar. */
function editTrack(trackIndex, fn, label, tracks = null) {
  if (!edit.on) return;
  applyEdit('score', (s, sel) => {
    const result = fn(s);
    if (result === null) return null;
    const track = tracks?.added !== undefined ? tracks.added : tracks?.removed !== undefined ? Math.max(0, trackIndex - 1) : trackIndex;
    return { ...sel, track: Math.min(track, s.tracks.length - 1), staff: 0, beat: tracks ? 0 : sel.beat };
  }, label, '', tracks);
}
function tuningOptions(staff) {
  const n = staff.tuning.length;
  const current = TUNINGS.findIndex(([, t]) => t.length === n && t.every((p, i) => p === staff.tuning[i]));
  const opts = TUNINGS.map(([name, t], i) => (t.length === n ? `<option value="${i}"${i === current ? ' selected' : ''}>${escapeHtml(name)}</option>` : '')).join('');
  return current < 0 ? `<option value="" selected>${escapeHtml(trackDetails({ staves: [staff] }).split(' · ')[0])}</option>${opts}` : opts;
}

function pushUndo(tab, entry) {
  tab.undo ??= [];
  tab.undo.push(entry);
  tab.redo = [];
  // Whole-score snapshots are big: keep only the latest few (and drop older history with them).
  while (tab.undo.length > UNDO_LIMIT || tab.undo.filter(e => e.scope === 'score').length > FULL_SNAPSHOTS) tab.undo.shift();
}

function undoRedo(dir) {
  const tab = activeTab();
  const from = dir < 0 ? tab?.undo : tab?.redo;
  const entry = from?.pop();
  if (!entry) { setStatus(dir < 0 ? 'Nothing to undo' : 'Nothing to redo'); return; }
  (dir < 0 ? (tab.redo ??= []) : tab.undo).push(entry);
  const which = dir < 0 ? 'before' : 'after';
  const js = entry.scope === 'bar' ? putBarJs(toJs(tab.score), entry.sel, entry[which]) : entry[which];
  const score = fromJs(js);
  const changed = score.tracks.length !== tab.score.tracks.length;
  // A track came back or went away: keep the view valid (mixer settings reset).
  commitEdit(tab, score, dir < 0 ? entry.sel : entry.next, changed ? { removed: Infinity } : null);
  setStatus(dir < 0 ? 'Undone' : 'Redone');
}

function copyBar() {
  const tab = activeTab();
  if (!edit.on || !tab?.score) return;
  const { staff } = editTarget(tab.score);
  edit.clipboard = { bar: cloneJs(barJs(toJs(tab.score), edit.sel)), strings: staff.tuning.length, from: edit.sel.bar + 1 };
  setStatus(`Copied bar ${edit.sel.bar + 1}`);
  updateEditUi();
}
function pasteBar() {
  const tab = activeTab();
  const clip = edit.clipboard;
  if (!edit.on || !tab?.score || !clip) return;
  if (editTarget(tab.score).staff.tuning.length !== clip.strings) { setStatus('Paste into a track with the same number of strings.', true); return; }
  const sel = edit.sel;
  const before = toJs(tab.score);
  const beforeBar = cloneJs(barJs(before, sel));
  const js = putBarJs(before, sel, clip.bar, { fresh: true });
  pushUndo(tab, { scope: 'bar', sel, next: { ...sel, beat: 0 }, before: beforeBar, after: cloneJs(barJs(js, sel)) });
  commitEdit(tab, fromJs(js), { ...sel, beat: 0 });
  setStatus(`Pasted bar ${clip.from} over bar ${sel.bar + 1}`);
}

/** Puts an edited score into the tab and re-renders it, keeping tracks, position and mixer. */
function commitEdit(tab, score, sel, tracks = null) {
  carryScoreState(tab.score, score, tracks);
  stashTab(tab);
  remapTabTracks(tab, score, tracks);
  tab.score = score;
  tab.raw = null; // the fetched Songsterr data no longer matches what is shown
  tab.dirty = true;
  edit.sel = clampSelection(score, sel);
  edit.digit = edit.digit && { ...edit.digit, sel: edit.sel };
  renderTabs();
  renderEditedTab();
  updateEditUi();
}

/** Old track index -> new one after a track was added or removed (null = gone). */
function trackMap(tracks) {
  if (tracks?.removed !== undefined) return t => (t === tracks.removed ? null : t > tracks.removed ? t - 1 : t);
  return t => t;
}

/** Keeps the tab's shown tracks, fretboard track and mixer pointing at the same tracks. */
function remapTabTracks(tab, score, tracks) {
  const map = trackMap(tracks);
  const n = score.tracks.length;
  let selected = (tab.selected ?? []).map(map).filter(t => t !== null && t < n);
  if (tracks?.added !== undefined) selected = ui.multiTrack.checked ? [...new Set([...selected, tracks.added])] : [tracks.added];
  tab.selected = selected.length ? selected : [0];
  const active = map(tab.activeTrack ?? 0);
  tab.activeTrack = tracks?.added !== undefined ? tracks.added : active !== null && active < n ? active : tab.selected[0];
  state.activeTrack = tab.activeTrack;
  if (tab.mixer) {
    const mixer = tab.mixer.filter((_, t) => map(t) !== null);
    if (tracks?.added !== undefined) mixer.push({ mute: false, solo: false, volume: score.tracks[tracks.added].playbackInfo.volume, program: '' });
    tab.mixer = mixer.length === n ? mixer : null;
  }
}

// The rebuilt score has new staff objects: carry over what app.js remembers per staff.
function carryScoreState(from, to, tracks = null) {
  if (!from || !to) return;
  const map = trackMap(tracks);
  from.tracks.forEach((track, t) => track.staves.forEach((staff, s) => {
    const next = map(t) === null ? null : to.tracks[map(t)]?.staves[s];
    if (!next) return;
    if (originalStaffFlags.has(staff)) originalStaffFlags.set(next, originalStaffFlags.get(staff));
    if (originalPitch.has(staff)) originalPitch.set(next, originalPitch.get(staff));
  }));
  from.tracks.forEach((track, t) => {
    const orig = originalSound.get(track);
    const next = map(t) === null ? null : to.tracks[map(t)];
    if (orig && next) originalSound.set(next, { program: orig.program, changes: [] });
  });
}

function renderEditedTab() {
  const tab = activeTab();
  if (!tab?.score) return;
  if (state.rendering) { state.editRenderPending = true; return; } // see showTab: never swap the score mid-render
  state.editRenderPending = false;
  if (api.playerState === at.synth.PlayerState.Playing) api.pause();
  state.restore = tab;
  state.rendering = true;
  api.renderScore(tab.score, tab.selected?.length ? tab.selected : [0]);
  state.restore = null;
  api.tickPosition = tab.tick;
  reapplyMixer();
}

const editTarget = (score = activeTab()?.score) => target(score, edit.sel);
// alphaTab's worker leaves BarBounds.bar unset, but each beat's bounds still know their bar.
const boundsBar = b => b.bar ?? b.beats[0]?.beat?.voice.bar ?? null;

/** Selects the beat (and string) under a click in the score. */
function selectAt(clientX, clientY) {
  const lookup = api.boundsLookup;
  const tab = activeTab();
  if (!lookup || api.score !== tab?.score) return false;
  const box = $('alphaTab').getBoundingClientRect();
  const x = clientX - box.left, y = clientY - box.top;
  const inside = (b, pad = 0) => b && x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
  for (const system of lookup.staffSystems) for (const mb of system.bars) {
    if (!inside(mb.realBounds, 2)) continue;
    const hit = mb.bars.find(b => inside(b.realBounds, 6));
    if (!hit?.beats.length) continue;
    const near = hit.beats.reduce((best, bb) => {
      const d = Math.abs(bb.realBounds.x + Math.min(bb.realBounds.w, 20) / 2 - x);
      return d < best.d ? { bb, d } : best;
    }, { bb: null, d: Infinity }).bb;
    const beat = near?.beat;
    if (!beat || beat.voice.index !== 0) return false;
    const staff = beat.voice.bar.staff;
    let string = staff.track.index === edit.sel.track ? edit.sel.string : staff.tuning.length || 1;
    const tabBox = tabStaffBounds(beat.voice.bar);
    if (tabBox && hit === tabBox.barBounds) string = stringAtY(staff, tabBox.box, y);
    edit.sel = clampSelection(tab.score, { track: staff.track.index, staff: staff.index, bar: beat.voice.bar.index, beat: beat.index, string });
    if (state.activeTrack !== staff.track.index) { state.activeTrack = staff.track.index; updateTrackHighlight(); drawFretboard(); renderChords(); }
    edit.digit = null;
    updateEditUi();
    return true;
  }
  return false;
}

/** The tab staff's layout box for a bar (null when the tab isn't shown). */
function tabStaffBounds(bar) {
  if (!isStringedStaff(bar.staff) || !bar.staff.showTablature) return null;
  for (const system of api.boundsLookup?.staffSystems ?? []) for (const mb of system.bars) {
    const mine = mb.bars.filter(b => boundsBar(b) === bar);
    if (mine.length) return { barBounds: mine[mine.length - 1], box: mine[mine.length - 1].visualBounds };
  }
  return null;
}
// Tab lines are evenly spaced across the staff box, highest string at the top.
const stringY = (staff, box, s) => box.y + (staff.tuning.length - s) * (box.h / Math.max(1, staff.tuning.length - 1));
const stringAtY = (staff, box, y) => Math.round(staff.tuning.length - (y - box.y) / (box.h / Math.max(1, staff.tuning.length - 1)));

function drawEditCursor() {
  const tab = activeTab();
  if (!edit.on || !tab?.score || api.score !== tab.score || !api.boundsLookup) { editCursor.remove(); editString.remove(); return; }
  const { beat, bar, staff } = target(api.score, edit.sel);
  const bb = beat && api.boundsLookup.findBeat(beat);
  if (!bb) { editCursor.remove(); editString.remove(); return; }
  let top = Infinity, bottom = -Infinity;
  for (const system of api.boundsLookup.staffSystems) for (const mb of system.bars) for (const b of mb.bars) {
    if (boundsBar(b) !== bar) continue;
    top = Math.min(top, b.visualBounds.y);
    bottom = Math.max(bottom, b.visualBounds.y + b.visualBounds.h);
  }
  if (!Number.isFinite(top)) { top = bb.visualBounds.y; bottom = top + bb.visualBounds.h; }
  const host = $('alphaTab');
  const x = bb.visualBounds.x - 5, w = Math.max(bb.visualBounds.w, 10) + 10;
  Object.assign(editCursor.style, { left: `${x}px`, top: `${top - 8}px`, width: `${w}px`, height: `${bottom - top + 16}px` });
  if (editCursor.parentElement !== host) host.appendChild(editCursor);
  const tabBox = tabStaffBounds(bar);
  if (tabBox) {
    const y = stringY(staff, tabBox.box, edit.sel.string);
    Object.assign(editString.style, { left: `${x}px`, top: `${y - 7}px`, width: `${w}px` });
    if (editString.parentElement !== host) host.appendChild(editString);
  } else {
    editString.remove();
  }
  // Keep it on screen.
  const view = ui.viewport.getBoundingClientRect(), c = editCursor.getBoundingClientRect();
  if (c.top < view.top + 10 || c.bottom > view.bottom - 10 || c.left < view.left || c.right > view.right) {
    editCursor.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function updateEditUi() {
  const tab = activeTab();
  ui.editToggle.disabled = !tab?.score;
  if (!edit.on || !tab?.score) return;
  const { track, staff, beat, note } = editTarget(tab.score);
  const mb = tab.score.masterBars[edit.sel.bar];
  const stringed = isStringedStaff(staff);
  const gpString = stringed ? staff.tuning.length - edit.sel.string + 1 : 0; // Guitar Pro numbers strings from the top
  const openName = stringed ? NOTE_NAMES[staff.tuning[gpString - 1] % 12] : '';
  drawFretboard();
  ui.editPos.textContent = `${track.name.split('|')[0].trim()} · Bar ${edit.sel.bar + 1}/${tab.score.masterBars.length} · Beat ${edit.sel.beat + 1}/${beat?.voice.beats.length ?? 0}` +
    (stringed ? ` · String ${gpString} (${openName})${note ? ` · fret ${note.fret}` : ''}` : ' · (no tab: lengths and rests only)');
  for (const b of ui.editBar.querySelectorAll('[data-duration]')) b.classList.toggle('on', beat?.duration === Number(b.dataset.duration));
  ui.editBar.querySelector('[data-edit="dot"]').classList.toggle('on', !!beat?.dots);
  ui.editBar.querySelector('[data-edit="triplet"]').classList.toggle('on', beat?.tupletNumerator === 3);
  ui.editBar.querySelector('[data-edit="repeatStart"]').classList.toggle('on', !!mb.isRepeatStart);
  ui.editRepeat.value = String([0, 2, 3, 4].includes(mb.repeatCount) ? mb.repeatCount : 0);
  ui.editKey.value = String(tab.score.tracks[edit.sel.track].staves[0].bars[edit.sel.bar]?.keySignature ?? 0);
  ui.editBar.querySelector('[data-edit="rest"]').classList.toggle('on', !!beat?.isRest);
  for (const b of ui.editTechniques.children) {
    const id = b.dataset.tech;
    b.disabled = !note;
    b.classList.toggle('on', !!note && (id === 'tie' ? note.isTieDestination : TECHNIQUES[id].get(note)));
  }
  ui.editBar.querySelector('[data-edit="undo"]').disabled = !tab.undo?.length;
  ui.editBar.querySelector('[data-edit="redo"]').disabled = !tab.redo?.length;
  ui.editBar.querySelector('[data-edit="paste"]').disabled = !edit.clipboard;
  ui.editBar.querySelector('[data-edit="deleteBar"]').disabled = tab.score.masterBars.length <= 1;
  if (document.activeElement !== ui.editTempo) {
    ui.editTempo.value = mb.tempoAutomations?.[0] && mb.tempoAutomations[0].ratioPosition === 0 ? Math.round(mb.tempoAutomations[0].value) : '';
    ui.editTempo.placeholder = String(Math.round(tempoAt(mb)));
  }
  if (document.activeElement !== ui.editTsNum) ui.editTsNum.value = mb.timeSignatureNumerator;
  ui.editTsDen.value = String(mb.timeSignatureDenominator);
  if (document.activeElement !== ui.editSection) ui.editSection.value = mb.section?.text ?? '';
  drawEditCursor();
}

function typeFret(digit) {
  const pending = edit.digit;
  const same = pending && Date.now() - pending.time < 900 && pending.sel.bar === edit.sel.bar &&
    pending.sel.beat === edit.sel.beat && pending.sel.string === edit.sel.string;
  const two = same ? pending.digit * 10 + digit : null;
  const undo = () => activeTab().undo ?? [];
  if (two !== null && two <= MAX_FRET) {
    edit.digit = null;
    applyEdit('bar', (s, sel) => setFret(at, s, sel, two));
    // One undo step for both digits: fold this edit into the first digit's.
    if (undo().length === pending.undoLength + 1) {
      const second = undo().pop(), first = undo()[undo().length - 1];
      first.after = second.after;
      first.next = second.next;
    }
  } else {
    applyEdit('bar', (s, sel) => setFret(at, s, sel, digit));
    edit.digit = digit <= Math.floor(MAX_FRET / 10) ? { digit, time: Date.now(), sel: edit.sel, undoLength: undo().length } : null;
  }
}

const EDIT_ACTIONS = {
  dot: () => applyEdit('bar', (s, sel) => toggleDot(s, sel)),
  triplet: () => applyEdit('bar', (s, sel) => toggleTriplet(s, sel)),
  repeatStart: () => applyEdit('score', (s, sel) => toggleRepeatStart(s, sel), 'Repeat start toggled'),
  rest: () => applyEdit('bar', (s, sel) => makeRest(s, sel), 'Rest'),
  insertBeat: () => applyEdit('bar', (s, sel) => insertBeat(at, s, sel), 'Beat inserted'),
  deleteBeat: () => applyEdit('bar', (s, sel) => deleteBeat(s, sel), 'Beat deleted'),
  insertBar: () => applyEdit('score', (s, sel) => insertBar(at, s, sel), 'Bar inserted'),
  deleteBar: () => applyEdit('score', (s, sel) => deleteBar(s, sel), 'Bar deleted'),
  copy: copyBar,
  paste: pasteBar,
  undo: () => undoRedo(-1),
  redo: () => undoRedo(1),
};

function moveSel(next) {
  edit.sel = next;
  edit.digit = null;
  updateEditUi();
}

/** Keys while editing. Returns true when the key was used. */
function handleEditKey(e) {
  const tab = activeTab();
  if (!edit.on || !tab?.score) return false;
  const score = tab.score;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (ctrl) {
    const lower = k.toLowerCase();
    if (lower === 'z' && !e.shiftKey) EDIT_ACTIONS.undo();
    else if (lower === 'y' || (lower === 'z' && e.shiftKey)) EDIT_ACTIONS.redo();
    else if (lower === 'c') copyBar();
    else if (lower === 'v') pasteBar();
    else if (lower === 's') ui.exportGp.click();
    else if (k === 'ArrowLeft' || k === 'ArrowRight') moveSel(moveBar(score, edit.sel, k === 'ArrowLeft' ? -1 : 1));
    else if (k === 'Insert') EDIT_ACTIONS.insertBar();
    else if (k === 'Delete' && e.shiftKey) EDIT_ACTIONS.deleteBar();
    else if (k === 'Delete' || k === 'Backspace') EDIT_ACTIONS.deleteBeat();
    else return false;
    e.preventDefault();
    return true;
  }
  if (e.altKey) return false;
  if (/^[0-9]$/.test(k)) typeFret(Number(k));
  else if (k === 'ArrowLeft' || k === 'ArrowRight') moveSel(moveBeat(score, edit.sel, k === 'ArrowLeft' ? -1 : 1));
  else if (k === 'ArrowUp' || k === 'ArrowDown') moveSel(moveString(score, edit.sel, k === 'ArrowUp' ? 1 : -1));
  else if (k === 'Home') moveSel({ ...edit.sel, beat: 0 });
  else if (k === 'End') moveSel(clampSelection(score, { ...edit.sel, beat: 999 }));
  else if (k === 'Delete' || k === 'Backspace') {
    if (e.shiftKey) EDIT_ACTIONS.deleteBeat();
    else applyEdit('bar', (s, sel) => clearNote(s, sel));
  } else if (k === 'Insert' || k === 'i' || k === 'I') EDIT_ACTIONS.insertBeat();
  else if (k === '+' || k === '=') applyEdit('bar', (s, sel) => changeDuration(s, sel, 1));
  else if (k === '-' || k === '_') applyEdit('bar', (s, sel) => changeDuration(s, sel, -1));
  else if (k === '.') EDIT_ACTIONS.dot();
  else if (k === 'u' || k === 'U') EDIT_ACTIONS.triplet();
  else if (k === 'r' || k === 'R') EDIT_ACTIONS.rest();
  else if (k === 'Escape') setEditMode(false);
  else {
    const tech = TECH_BUTTONS.find(([, t]) => t.key === k.toLowerCase());
    if (!tech) return k !== ' '; // Space still plays; swallow other letters so they don't trigger player shortcuts
    toggleTech(tech[0]);
  }
  e.preventDefault();
  return true;
}

function toggleTech(id) {
  const label = id === 'tie' ? 'Tie' : TECHNIQUES[id].label;
  const why = id === 'hammer' ? 'A hammer-on / pull-off needs a next note on the same string.'
    : id === 'tie' ? 'A tie needs a note on the same string just before.' : '';
  applyEdit('bar', (s, sel) => toggleTechnique(at, s, sel, id), label, editTarget()?.note ? why : '');
}

ui.editToggle.addEventListener('click', () => setEditMode(!edit.on));
ui.editDone.addEventListener('click', () => setEditMode(false));
ui.editBar.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.duration) applyEdit('bar', (s, sel) => setDuration(s, sel, Number(b.dataset.duration)));
  else if (b.dataset.tech) toggleTech(b.dataset.tech);
  else EDIT_ACTIONS[b.dataset.edit]?.();
});
ui.editAddTrack.addEventListener('change', () => {
  const kind = ui.editAddTrack.value;
  ui.editAddTrack.value = '';
  const tab = activeTab();
  if (!kind || !tab?.score) return;
  const index = tab.score.tracks.length;
  editTrack(index, s => addTrack(at, s, kind), `Added a ${kind === 'bass' ? 'bass' : 'guitar'} track`, { added: index });
});
ui.editTempo.addEventListener('change', () => {
  const v = ui.editTempo.value.trim();
  applyEdit('score', (s, sel) => setTempo(at, s, sel, v === '' ? null : Number(v)), v ? `Tempo ${v} from bar ${edit.sel.bar + 1}` : 'Tempo change removed');
});
for (const el of [ui.editTsNum, ui.editTsDen]) el.addEventListener('change', () => {
  applyEdit('score', (s, sel) => setTimeSignature(s, sel, ui.editTsNum.value, ui.editTsDen.value), `Time signature ${ui.editTsNum.value}/${ui.editTsDen.value}`);
});
ui.editKey.addEventListener('change', () => {
  const name = ui.editKey.selectedOptions[0].textContent;
  applyEdit('score', (s, sel) => setKeySignature(s, sel, Number(ui.editKey.value)), `Key of ${name} from bar ${edit.sel.bar + 1}`);
});
ui.editRepeat.addEventListener('change', () => {
  const n = Number(ui.editRepeat.value);
  applyEdit('score', (s, sel) => setRepeatEnd(s, sel, n), n ? `Repeat ends at bar ${edit.sel.bar + 1}, played ${n} times` : 'Repeat end removed');
});
ui.editSection.addEventListener('change', () => {
  applyEdit('score', (s, sel) => setSection(at, s, sel, ui.editSection.value), ui.editSection.value.trim() ? `Section "${ui.editSection.value.trim()}"` : 'Section removed');
});
for (const el of [ui.editTempo, ui.editTsNum, ui.editSection]) {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); if (e.key === 'Escape') { el.blur(); updateEditUi(); } });
}
// Clicks in the score pick the note to edit (alphaTab still moves the playhead there).
$('alphaTab').addEventListener('mousedown', e => { if (edit.on && e.button === 0) selectAt(e.clientX, e.clientY); });
window.addEventListener('beforeunload', e => {
  if (tabs.list.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- fretboard ----------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isStringedStaff = staff => staff && !staff.isPercussion && staff.tuning.length > 0;

/** The instrument drawn under the score: fretboard for stringed tracks, piano for the rest (in Auto). */
function instrumentFor(staff) {
  const mode = ui.instrumentView.value;
  if (mode === 'piano') return 'piano';
  return isStringedStaff(staff) ? 'fretboard' : 'piano';
}

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
  ctx.textAlign = 'left';

  const track = state.score?.tracks[state.activeTrack];
  const staff = track?.staves[0];
  const message = text => { ctx.fillStyle = v('--fret-text'); ctx.font = '13px system-ui'; ctx.fillText(text, 16, h / 2); };
  if (!staff) { message('No track selected'); return; }
  if (staff.isPercussion) { message('Drum track: no fretboard or keyboard'); return; }
  // While editing (and not playing), show the selected beat so you can see the shape you are entering.
  const editing = edit.on && api.playerState !== at.synth.PlayerState.Playing && activeTab()?.score === state.score;
  const notes = editing
    ? (target(state.score, edit.sel).beat?.notes ?? [])
    : state.activeBeats.filter(beat => beat.voice.bar.staff.track.index === state.activeTrack).flatMap(beat => beat.notes);
  if (instrumentFor(staff) === 'piano') drawPiano(ctx, w, h, v, track, notes);
  else drawNeck(ctx, w, h, v, staff, notes);
}

function drawNeck(ctx, w, h, v, staff, notes) {
  const strings = staff.tuning.length;
  const frets = 24;
  const lefty = ui.leftHanded.checked;
  const padL = 34, padR = 12, padT = 14, padB = 18;
  const fw = (w - padL - padR) / (frets + 1);
  const sh = (h - padT - padB) / Math.max(1, strings - 1);
  const X = x => (lefty ? w - x : x); // mirrored for left-handed players
  const fretX = f => X(padL + f * fw);
  const mid = f => X(padL + f * fw - fw / 2); // centre of the space behind fret f
  const capo = staff.capo || 0;

  // board
  ctx.fillStyle = v('--fret-wood');
  ctx.fillRect(Math.min(X(padL), X(padL + fw * frets)), padT - 6, fw * frets, h - padT - padB + 12);
  // inlays
  ctx.fillStyle = '#d8cdb8';
  for (const f of [3, 5, 7, 9, 15, 17, 19, 21]) dot(ctx, mid(f), padT + (h - padT - padB) / 2, 4);
  for (const f of [12, 24]) {
    dot(ctx, mid(f), padT + sh * (strings - 1) * 0.3, 4);
    dot(ctx, mid(f), padT + sh * (strings - 1) * 0.7, 4);
  }
  // frets and fret numbers
  ctx.textAlign = 'center';
  for (let f = 0; f <= frets; f++) {
    ctx.strokeStyle = f === 0 ? '#eee' : '#9a9a9a';
    ctx.lineWidth = f === 0 ? 4 : 1.5;
    ctx.beginPath(); ctx.moveTo(fretX(f), padT - 6); ctx.lineTo(fretX(f), h - padB + 6); ctx.stroke();
    if (f > 0 && [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(f)) {
      ctx.fillStyle = v('--fret-text'); ctx.font = '10px system-ui';
      ctx.fillText(f, mid(f), h - 4);
    }
  }
  if (capo > 0) {
    ctx.fillStyle = 'rgba(30, 30, 30, .85)';
    ctx.fillRect(mid(capo) - 4, padT - 8, 8, h - padT - padB + 16);
  }
  // strings (the highest is drawn at the top) + tuning labels
  const stringY = s => padT + (strings - s) * sh; // s: alphaTab string number, 1 = lowest
  for (let i = 0; i < strings; i++) {
    const y = padT + i * sh;
    ctx.strokeStyle = '#c9c2b0'; ctx.lineWidth = 1 + (i / strings) * 1.6;
    ctx.beginPath(); ctx.moveTo(X(padL), y); ctx.lineTo(X(w - padR), y); ctx.stroke();
    ctx.fillStyle = v('--fret-text'); ctx.font = '11px system-ui';
    ctx.fillText(NOTE_NAMES[staff.tuning[i] % 12], X(14), y + 4);
  }
  // note names over the whole neck (naturals brighter)
  if (ui.allNotes.checked) {
    ctx.font = '9px system-ui';
    ctx.fillStyle = v('--fret-text');
    for (let s = 1; s <= strings; s++) {
      const open = staff.tuning[strings - s];
      for (let f = capo + 1; f <= frets; f++) { // open strings are already labelled at the nut
        const name = NOTE_NAMES[(open + f) % 12];
        ctx.globalAlpha = name.length === 1 ? 0.85 : 0.45;
        ctx.fillText(name, mid(f), stringY(s) - 3);
      }
    }
    ctx.globalAlpha = 1;
  }
  // active notes (frets are relative to the capo)
  const names = ui.noteLabels.value === 'name';
  for (const note of notes) {
    if (!note.isStringed) continue;
    const fret = note.fret + capo;
    const y = stringY(note.string);
    const x = fret === 0 ? X(padL - 12) : mid(fret);
    ctx.fillStyle = note.isDead ? '#888' : v('--fret-note');
    dot(ctx, x, y, Math.min(11, sh * 0.48));
    ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 11px system-ui';
    const label = note.isDead ? 'x' : names ? NOTE_NAMES[(note.stringTuning + note.fret) % 12] : note.fret;
    ctx.fillText(label, x, y + 4);
  }
}

// Keyboard range per track: its lowest to highest note, widened to whole octaves (at least three).
const pianoRanges = new WeakMap();
function pianoRange(track) {
  if (pianoRanges.has(track)) return pianoRanges.get(track);
  let lo = 127, hi = 0;
  for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
    for (const note of beat.notes) {
      const p = note.realValue;
      if (p > 0) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
    }
  }
  if (lo > hi) { lo = 48; hi = 83; }
  lo = Math.floor(lo / 12) * 12;
  hi = Math.ceil((hi + 1) / 12) * 12 - 1;
  while (hi - lo < 35) { if (lo >= 12) lo -= 12; else hi += 12; }
  const range = { lo, hi };
  pianoRanges.set(track, range);
  return range;
}

function drawPiano(ctx, w, h, v, track, notes) {
  const { lo, hi } = pianoRange(track);
  const black = p => [1, 3, 6, 8, 10].includes(p % 12);
  const whites = [];
  for (let p = lo; p <= hi; p++) if (!black(p)) whites.push(p);
  const pad = 8, top = 6, kh = h - top - 6;
  const kw = (w - pad * 2) / whites.length;
  const whiteX = new Map(whites.map((p, i) => [p, pad + i * kw]));
  const playing = new Set(notes.map(n => n.realValue).filter(p => p >= lo && p <= hi));
  const names = ui.noteLabels.value === 'name' || ui.allNotes.checked;
  ctx.textAlign = 'center';
  for (const p of whites) {
    const x = whiteX.get(p);
    ctx.fillStyle = playing.has(p) ? v('--fret-note') : '#f4f1ea';
    ctx.fillRect(x + 0.5, top, kw - 1, kh);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top, kw - 1, kh);
    if (p % 12 === 0 || names || playing.has(p)) {
      ctx.fillStyle = '#333';
      ctx.font = `${p % 12 === 0 ? 'bold ' : ''}${Math.round(Math.min(11, kw * 0.55))}px system-ui`;
      ctx.fillText(p % 12 === 0 ? `C${p / 12 - 1}` : NOTE_NAMES[p % 12], x + kw / 2, top + kh - 6);
    }
  }
  for (let p = lo; p <= hi; p++) {
    if (!black(p) || !whiteX.has(p - 1)) continue;
    ctx.fillStyle = playing.has(p) ? v('--fret-note') : '#1d1d1d';
    ctx.fillRect(whiteX.get(p - 1) + kw * 0.68, top, kw * 0.64, kh * 0.62);
  }
}

function dot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

// ---------- alphaTab events ----------
api.renderStarted.on(() => { state.rendering = true; showOverlay('Rendering…'); });
api.renderFinished.on(() => { hideOverlay(); updateTrackHighlight(); });
// Layout info for clicks and the cursor comes last; only then is it safe to swap the score (see showTab).
api.postRenderFinished.on(() => {
  state.rendering = false;
  if (state.queuedTab) showQueuedTab();
  else if (state.editRenderPending) renderEditedTab();
  drawEditCursor();
});
function onScoreLoaded(score) {
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
  const restore = state.restore?.score === score ? state.restore : null;
  state.activeTrack = restore && state.selected.has(restore.activeTrack) ? restore.activeTrack : api.tracks[0]?.index ?? 0;
  if (restore?.mixer) applyMixer(restore.mixer);
  updateTrackHighlight();
  updateSongActions();
  setControlsEnabled(true);
  showBar(score.masterBars[0]);
  drawFretboard();
  renderChords();
  restoreLoopInputs();
  setPlayerEnabled(api.isReadyForPlayback);
  if (edit.on) {
    if (edit.tab !== tabs.active) edit.sel = clampSelection(score, { track: state.activeTrack, staff: 0, bar: 0, beat: 0, string: 99 });
    edit.tab = tabs.active;
    updateEditUi();
  }
}
api.scoreLoaded.on(onScoreLoaded);
api.soundFontLoad.on(e => {
  const name = SOUNDFONTS[sound.pending || sound.id].name;
  setStatus(e.total > 0
    ? `Loading ${name}… ${Math.round((e.loaded / e.total) * 100)}% of ${Math.round(e.total / 1e6)} MB`
    : `Loading ${name}…`);
});
api.soundFontLoaded.on(() => {
  sound.pending = null;
  if (!youtube.active) setStatus(`Ready · ${SOUNDFONTS[sound.id].name} sounds`);
  if (state.score) reapplyMixer();
});
api.error.on(e => {
  // A larger soundfont failed to download: fall back to the built-in one.
  if (sound.pending && sound.pending !== 'sonivox') {
    const name = SOUNDFONTS[sound.pending].name;
    loadSoundFontChoice('sonivox');
    setStatus(`Could not load ${name} (${e?.message || 'download failed'}). Using Sonivox.`, true);
  }
});
api.playerReady.on(() => { setPlayerEnabled(true); if (!youtube.active) setStatus(`Ready · ${SOUNDFONTS[sound.id].name} sounds`); });
api.playerStateChanged.on(e => {
  const playing = e.state === at.synth.PlayerState.Playing;
  ui.play.textContent = playing ? '⏸' : '▶';
});
api.playerPositionChanged.on(e => {
  if (!state.score) return; // the last song stopping after an empty tab was opened
  state.endTime = e.endTime;
  ui.timeCurrent.textContent = fmtTime(e.currentTime);
  ui.timeTotal.textContent = fmtTime(e.endTime);
  if (!state.seeking && e.endTime > 0) ui.seek.value = Math.round((e.currentTime / e.endTime) * 1000);
  scheduleClicks(e);
});
api.activeBeatsChanged.on(e => { state.activeBeats = e.activeBeats; drawFretboard(); });
api.playedBeatChanged.on(beat => { showBar(beat?.voice.bar.masterBar); highlightChord(beat); });
api.playbackRangeChanged?.on(e => {
  if (e.playbackRange && !api.isLooping) setStatus('Selection set. Press L to loop it.');
});
api.playerFinished.on(onLoopPass); // fires each time a loop comes round, before playback jumps back

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
  if (state.songsterr) loadSongsterr(state.songsterr.input, ui.revision.value, { tab: activeTab() });
});

ui.exportGp.addEventListener('click', () => {
  try {
    applyNotation(api.score, 'Default'); // export the song's own notation flags, not the current view
    let bytes;
    try { bytes = new at.exporter.Gp7Exporter().export(api.score, api.settings); }
    finally { applyNotation(api.score, ui.staveProfile.value); }
    download(bytes, `${safeName()}.gp`, 'application/octet-stream');
    const tab = activeTab();
    if (tab?.dirty) { tab.dirty = false; renderTabs(); setStatus(`Saved your edits as ${safeName()}.gp`); }
  } catch (e) { setStatus(`Export failed: ${e.message}`, true); }
});
ui.exportMidi.addEventListener('click', () => api.downloadMidi());
ui.print.addEventListener('click', () => api.print());

ui.play.addEventListener('click', playPause);
ui.stop.addEventListener('click', () => { stopCountIn(); api.stop(); });
ui.seek.addEventListener('input', () => { state.seeking = true; });
ui.seek.addEventListener('change', () => {
  api.timePosition = (Number(ui.seek.value) / 1000) * state.endTime;
  state.seeking = false;
});
function toggle(btn, on) { btn.classList.toggle('on', on); return on; }
ui.loop.addEventListener('click', () => { api.isLooping = toggle(ui.loop, !api.isLooping); });
ui.metronome.addEventListener('click', () => { toggle(ui.metronome, !metronomeOn()); applyMetronome(); });
ui.countIn.addEventListener('click', () => { toggle(ui.countIn, !countInOn()); if (!countInOn()) stopCountIn(); });
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
ui.loopApply.addEventListener('click', applyLoopBars);
ui.loopClear.addEventListener('click', clearLoop);
ui.loopSetA.addEventListener('click', () => {
  ui.loopFrom.value = (state.currentBar ?? 0) + 1;
  if (!ui.loopTo.value || Number(ui.loopTo.value) < Number(ui.loopFrom.value)) ui.loopTo.value = ui.loopFrom.value;
});
ui.loopSetB.addEventListener('click', () => {
  ui.loopTo.value = (state.currentBar ?? 0) + 1;
  if (!ui.loopFrom.value) ui.loopFrom.value = ui.loopTo.value;
});
for (const el of [ui.loopFrom, ui.loopTo]) el.addEventListener('keydown', e => { if (e.key === 'Enter') applyLoopBars(); });
ui.trainerOn.addEventListener('change', trainerChanged);
for (const el of [ui.trainerStart, ui.trainerStep, ui.trainerEvery, ui.trainerMax]) el.addEventListener('change', trainerChanged);
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
  if (state.score) { state.rendering = true; api.render(); }
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
    renderChords();
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
ui.instrumentView.addEventListener('change', () => { showInstrumentPanel(); saveView(); relayout(); });
for (const el of [ui.noteLabels, ui.allNotes, ui.leftHanded]) {
  el.addEventListener('change', () => { saveView(); drawFretboard(); renderChords(); });
}
ui.multiTrack.addEventListener('change', () => {
  saveView();
  if (!ui.multiTrack.checked && state.score) { state.selected = new Set([state.activeTrack]); renderSelected(); }
});
window.addEventListener('resize', drawFretboard);

document.addEventListener('keydown', e => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyW') { e.preventDefault(); closeTab(activeTab()); return; }
  if (!e.target.matches('input, select, textarea') && handleEditKey(e)) return;
  if (e.target.matches('input[type=text], input[type=number], select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); ui.url.focus(); ui.url.select(); return; }
  if (e.key === 't' || e.key === 'T') { ui.themeToggle.click(); return; }
  if (e.key === 'b' || e.key === 'B') { openLibrary(); return; }
  if (e.key === 'e' || e.key === 'E') { if (!ui.editToggle.disabled) setEditMode(true); return; }
  if (e.key === 'f' || e.key === 'F') { toggleFavorite(); return; }
  if (e.key === '[' || e.key === ']') { cycleTab(e.key === '[' ? -1 : 1); return; }
  if ((!api.isReadyForPlayback || !state.score) && e.key !== 'Escape') return;
  switch (e.key) {
    case ' ': e.preventDefault(); playPause(); break;
    case 'Escape': stopCountIn(); api.stop(); break;
    case 'l': case 'L': ui.loop.click(); break;
    case 'm': case 'M': if (!ui.metronome.disabled) ui.metronome.click(); break;
    case 'c': case 'C': if (!ui.countIn.disabled) ui.countIn.click(); break;
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
ui.soundFont.value = sound.id;
showTrainer();
showMetro();
ui.songTranspose.innerHTML = '<option value="mixed" disabled hidden>Mixed</option>' + transposeOptions();
ui.songTranspose.value = '0';
ui.songTranspose.addEventListener('change', () => {
  if (state.score) setTrackPitch(state.score.tracks, { transpose: Number(ui.songTranspose.value) });
});
ui.soundFont.addEventListener('change', () => loadSoundFontChoice(ui.soundFont.value));

// ---------- offline web app and desktop app ----------
// The service worker caches the app, alphaTab and fetched songs so TabPlayer starts without the server.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/sw.js').catch(e => console.warn('service worker', e));
}
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  ui.installApp.classList.remove('hidden');
});
ui.installApp.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  ui.installApp.classList.add('hidden');
  if (outcome === 'accepted') setStatus('TabPlayer installed. It works offline with your saved songs and files.');
});
window.addEventListener('appinstalled', () => ui.installApp.classList.add('hidden'));
function showConnection() {
  document.body.classList.toggle('offline', !navigator.onLine);
  if (!navigator.onLine) setStatus('Offline: saved songs, recently opened songs and files still work. Search needs a connection.');
}
window.addEventListener('online', () => { showConnection(); setStatus('Back online'); });
window.addEventListener('offline', showConnection);

/** Opens files handed over by the system (installed web app's file handler, or the desktop app). */
function openHandedFile(name, bytes) {
  const tab = targetTab();
  beginLoad(tab, `Opening ${name}…`);
  loadBytes(tab, bytes, name);
}
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async params => {
    for (const handle of params.files ?? []) {
      const file = await handle.getFile();
      openHandedFile(file.name, new Uint8Array(await file.arrayBuffer()));
    }
  });
}

// Reopen last visit's tabs. Only the active one loads now; the rest load when picked.
window.addEventListener('pagehide', () => { stashTab(activeTab()); saveTabs(); });
const restored = parseTabs(store.get('tabs'));
for (const t of restored.tabs) newTab({ ...t, restoring: true });
const params = new URLSearchParams(location.search);
const initial = params.get('url');
const initialKey = initial && parseSongsterrUrl(initial) && songKey({ songId: parseSongsterrUrl(initial).songId });
const linked = initialKey && tabs.list.find(t => t.key === initialKey && String(t.rev ?? '') === (params.get('rev') ?? ''));
renderTabs();
refreshLibrary();
if (initial && !linked) {
  ui.url.value = initial;
  const tab = newTab();
  activateTab(tab);
  loadSongsterr(initial, params.get('rev'), { tab });
} else {
  activateTab(linked || tabs.list[restored.active] || newTab());
}
showConnection();
// Desktop app (Electron): files opened from Explorer or File > Open arrive here.
if (window.tabplayerDesktop) {
  document.body.classList.add('desktop');
  window.tabplayerDesktop.onOpenFile(({ name, bytes }) => openHandedFile(name, new Uint8Array(bytes)));
}
