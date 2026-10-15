import { songsterrToScore, parseSongsterrUrl } from './songsterr.js';

const at = window.alphaTab;
const $ = id => document.getElementById(id);
const abs = p => new URL(p, location.href).href;

const ui = {
  form: $('load-form'), url: $('url-input'), file: $('file-input'),
  exportGp: $('export-gp'), exportMidi: $('export-midi'), print: $('print'),
  title: $('song-title'), artist: $('song-artist'), tracks: $('track-list'),
  staveProfile: $('stave-profile'), layoutMode: $('layout-mode'), zoom: $('zoom'),
  showFretboard: $('show-fretboard'), multiTrack: $('multi-track'),
  overlay: $('overlay'), overlayText: $('overlay-text'), viewport: $('viewport'),
  fretboard: $('fretboard'),
  play: $('play'), stop: $('stop'), seek: $('seek'),
  timeCurrent: $('time-current'), timeTotal: $('time-total'),
  loop: $('loop'), metronome: $('metronome'), countIn: $('count-in'),
  speed: $('speed'), speedValue: $('speed-value'), volume: $('master-volume'), status: $('status'),
};

const state = {
  score: null,
  selected: new Set(), // track indexes being rendered
  activeTrack: 0,      // track shown on the fretboard
  endTime: 0,
  activeBeats: [],
  seeking: false,
};

const api = new at.AlphaTabApi($('alphaTab'), {
  core: {
    fontDirectory: abs('/alphatab/font/'),
    scriptFile: abs('/alphatab/alphaTab.js'),
  },
  display: { scale: 1, layoutMode: at.LayoutMode.Page, staveProfile: at.StaveProfile.Default },
  player: {
    playerMode: at.PlayerMode.EnabledSynthesizer,
    soundFont: abs('/alphatab/soundfont/sonivox.sf2'),
    scrollElement: ui.viewport,
    enableCursor: true,
    enableAnimatedBeatCursor: true,
    enableUserInteraction: true,
    scrollOffsetY: -40,
  },
  notation: { elements: { scoreWordsAndMusic: false } },
});
window.tabPlayerApi = api; // handy for debugging in DevTools

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
  for (const el of [ui.play, ui.stop, ui.seek, ui.loop, ui.metronome, ui.countIn]) el.disabled = !on;
}

// ---------- loading ----------
async function loadSongsterr(input) {
  const parsed = parseSongsterrUrl(input);
  if (!parsed) { setStatus('That does not look like a Songsterr URL or song id.', true); return; }
  showOverlay('Fetching from Songsterr…');
  try {
    const res = await fetch(`/api/songsterr?url=${encodeURIComponent(input)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    showOverlay('Converting tab…');
    const score = songsterrToScore(at, data.meta, data.tracks);
    let track = data.trackIndex ?? data.meta.popularTrack ?? data.meta.defaultTrack ?? 0;
    if (!score.tracks[track]) track = 0;
    api.renderScore(score, [track]);
    const u = new URL(location.href);
    u.searchParams.set('url', input);
    history.replaceState(null, '', u);
    setStatus(`Loaded from Songsterr (revision ${data.meta.revisionId})`);
  } catch (e) {
    hideOverlay();
    setStatus(`Could not load: ${e.message}`, true);
    console.error(e);
  }
}

async function loadFile(file) {
  showOverlay(`Opening ${file.name}…`);
  try {
    const ok = api.load(new Uint8Array(await file.arrayBuffer()));
    if (!ok) throw new Error('Unsupported file');
    const u = new URL(location.href);
    u.searchParams.delete('url');
    history.replaceState(null, '', u);
    setStatus(`Opened ${file.name}`);
  } catch (e) {
    hideOverlay();
    setStatus(`Could not open ${file.name}: ${e.message}`, true);
  }
}

// ---------- tracks sidebar ----------
function buildTrackList() {
  ui.tracks.innerHTML = '';
  state.score.tracks.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'track';
    li.dataset.index = i;
    const tuning = track.staves[0].isPercussion ? 'Drums' : track.staves[0].tuningName || `${track.staves[0].tuning.length} strings`;
    li.innerHTML = `
      <div class="track-name" title="${escapeHtml(track.name)}">${escapeHtml(track.name)}</div>
      <div class="track-sub">${escapeHtml(tuning)}</div>
      <div class="track-controls">
        <button class="mute" title="Mute">M</button>
        <button class="solo" title="Solo">S</button>
        <input type="range" min="0" max="16" value="${track.playbackInfo.volume}" title="Volume">
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
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- fretboard ----------
function drawFretboard() {
  const canvas = ui.fretboard;
  if (canvas.classList.contains('hidden')) return;
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
    ctx.fillStyle = '#9aa1ad'; ctx.font = '13px system-ui';
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
  ctx.fillStyle = '#3b2a1c';
  ctx.fillRect(fretX(1) - fw, padT - 6, fw * frets + fw, h - padT - padB + 12);
  // inlays
  ctx.fillStyle = '#d8cdb8';
  for (const f of [3, 5, 7, 9, 15, 17, 19, 21]) dot(ctx, fretX(f) - fw / 2, padT + (h - padT - padB) / 2, 4);
  for (const f of [12, 24]) {
    dot(ctx, fretX(f) - fw / 2, padT + sh * (strings - 1) * 0.3, 4);
    dot(ctx, fretX(f) - fw / 2, padT + sh * (strings - 1) * 0.7, 4);
  }
  // frets
  for (let f = 0; f <= frets; f++) {
    ctx.strokeStyle = f === 0 ? '#eee' : '#9a9a9a';
    ctx.lineWidth = f === 0 ? 4 : 1.5;
    ctx.beginPath(); ctx.moveTo(fretX(f), padT - 6); ctx.lineTo(fretX(f), h - padB + 6); ctx.stroke();
    if (f > 0 && [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(f)) {
      ctx.fillStyle = '#9aa1ad'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(f, fretX(f) - fw / 2, h - 4);
    }
  }
  // strings (string 1 = lowest, drawn at the bottom) + tuning labels
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (let i = 0; i < strings; i++) {
    const y = padT + i * sh;
    ctx.strokeStyle = '#c9c2b0'; ctx.lineWidth = 1 + (i / strings) * 1.6;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillStyle = '#e6e8ec'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(names[staff.tuning[i] % 12], 14, y + 4);
  }
  // active notes
  for (const beat of state.activeBeats) {
    if (beat.voice.bar.staff.track.index !== state.activeTrack) continue;
    for (const note of beat.notes) {
      if (!note.isStringed) continue;
      const y = padT + (strings - note.string) * sh;
      const x = note.fret === 0 ? padL - 12 : fretX(note.fret) - fw / 2;
      ctx.fillStyle = note.isDead ? '#888' : '#f0a030';
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
  state.activeBeats = [];
  ui.title.textContent = score.title || 'Untitled';
  ui.artist.textContent = score.artist || '';
  document.title = `${score.title || 'Untitled'} – TabPlayer`;
  buildTrackList();
  state.selected = new Set(api.tracks.map(t => t.index));
  state.activeTrack = api.tracks[0]?.index ?? 0;
  updateTrackHighlight();
  setControlsEnabled(true);
  drawFretboard();
});
api.soundFontLoad.on(e => setStatus(`Loading sounds… ${Math.round((e.loaded / e.total) * 100)}%`));
api.playerReady.on(() => { setPlayerEnabled(true); setStatus('Ready'); });
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
api.playbackRangeChanged?.on(e => {
  if (e.playbackRange && !api.isLooping) setStatus('Selection set. Press L to loop it.');
});

// ---------- UI events ----------
ui.form.addEventListener('submit', e => { e.preventDefault(); if (ui.url.value.trim()) loadSongsterr(ui.url.value.trim()); });
ui.file.addEventListener('change', () => { if (ui.file.files[0]) loadFile(ui.file.files[0]); ui.file.value = ''; });
ui.viewport.addEventListener('dragover', e => e.preventDefault());
ui.viewport.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

ui.exportGp.addEventListener('click', () => {
  try {
    const bytes = new at.exporter.Gp7Exporter().export(api.score, api.settings);
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
  ui.speed.value = pct;
  ui.speedValue.textContent = `${pct}%`;
  api.playbackSpeed = pct / 100;
}
ui.speed.addEventListener('input', () => setSpeed(Number(ui.speed.value)));
ui.volume.addEventListener('input', () => { api.masterVolume = Number(ui.volume.value) / 100; });

ui.staveProfile.addEventListener('change', () => {
  api.settings.display.staveProfile = at.StaveProfile[ui.staveProfile.value];
  api.updateSettings(); api.render();
});
ui.layoutMode.addEventListener('change', () => {
  api.settings.display.layoutMode = at.LayoutMode[ui.layoutMode.value];
  document.body.classList.toggle('at-horizontal', ui.layoutMode.value === 'Horizontal');
  api.updateSettings(); api.render();
});
ui.zoom.addEventListener('change', () => {
  api.settings.display.scale = Number(ui.zoom.value);
  api.updateSettings(); api.render();
});
ui.showFretboard.addEventListener('change', () => {
  ui.fretboard.classList.toggle('hidden', !ui.showFretboard.checked);
  drawFretboard();
});
ui.multiTrack.addEventListener('change', () => {
  if (!ui.multiTrack.checked && state.score) { state.selected = new Set([state.activeTrack]); renderSelected(); }
});
window.addEventListener('resize', drawFretboard);

document.addEventListener('keydown', e => {
  if (e.target.matches('input[type=text], select')) return;
  if (!api.isReadyForPlayback && e.key !== 'Escape') return;
  switch (e.key) {
    case ' ': e.preventDefault(); api.playPause(); break;
    case 'Escape': api.stop(); break;
    case 'l': case 'L': ui.loop.click(); break;
    case 'm': case 'M': ui.metronome.click(); break;
    case '+': case '=': setSpeed(Number(ui.speed.value) + 5); break;
    case '-': case '_': setSpeed(Number(ui.speed.value) - 5); break;
  }
});

api.masterVolume = 0.8;
api.metronomeVolume = 0;
api.countInVolume = 0;
drawFretboard();

const initial = new URLSearchParams(location.search).get('url');
if (initial) { ui.url.value = initial; loadSongsterr(initial); }
