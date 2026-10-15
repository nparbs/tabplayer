// Plays a YouTube video as the audio source and keeps alphaTab's cursor in sync with it,
// using alphaTab's external media player mode and Songsterr's per-bar video points.
import { playbackBarOrder, videoSyncPoints } from './songsterr.js';

const POLL_MS = 40;
let apiPromise = null;

export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { apiPromise = null; reject(new Error('Could not load the YouTube player. Check your connection or ad blocker.')); };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export class YouTubeAudio {
  /**
   * @param at the alphaTab namespace
   * @param api the AlphaTabApi
   * @param host element the YouTube player is created in
   */
  constructor(at, api, host) {
    this.at = at;
    this.api = api;
    this.host = host;
    this.player = null;
    this.video = null;
    this.offsetMs = 0;
    this.active = false;
    this.timer = null;
    this.onError = () => {};
    this.onReady = () => {};
    const self = this;
    // The IExternalMediaHandler alphaTab drives (play/pause/seek/speed/volume).
    this.handler = {
      get backingTrackDuration() { return (self.player?.getDuration?.() || 0) * 1000; },
      get playbackRate() { return self.player?.getPlaybackRate?.() ?? 1; },
      set playbackRate(v) { self.player?.setPlaybackRate?.(v); },
      get masterVolume() { return (self.player?.getVolume?.() ?? 100) / 100; },
      set masterVolume(v) { self.player?.setVolume?.(Math.round(v * 100)); },
      seekTo(ms) { self.player?.seekTo?.(Math.max(0, ms / 1000), true); self._push(); },
      play() { self.player?.playVideo?.(); },
      pause() { self.player?.pauseVideo?.(); },
    };
  }

  /** Playback rates the video supports, as percentages. */
  get speeds() {
    const rates = this.player?.getAvailablePlaybackRates?.() || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    return rates.map(r => Math.round(r * 100));
  }

  /** Switches playback to the given video ({videoId, points}). */
  async start(video) {
    const YT = await loadYouTubeApi();
    this.video = video;
    if (!this.player) {
      await new Promise((resolve, reject) => {
        const el = document.createElement('div');
        this.host.replaceChildren(el);
        this.player = new YT.Player(el, {
          videoId: video.videoId,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
          events: {
            onReady: () => resolve(),
            onStateChange: e => this._stateChanged(e.data),
            onError: e => { const err = new Error(youTubeError(e.data)); this.onError(err); reject(err); },
          },
        });
      });
    } else {
      this.player.cueVideoById(video.videoId);
    }
    this._switchAlphaTab(true);
    this.applySync();
    this.active = true;
    this.onReady();
  }

  /** Back to the synthesizer. */
  stop() {
    if (!this.active) return;
    this.active = false;
    this._stopPolling();
    this.player?.pauseVideo?.();
    this._switchAlphaTab(false);
  }

  setOffset(ms) {
    this.offsetMs = ms;
    if (this.active) this.applySync();
  }

  /** (Re)builds sync points; call after the score or offset changes. */
  applySync() {
    const score = this.api.score;
    if (!score || !this.video) return;
    score.applyFlatSyncPoints(videoSyncPoints(playbackBarOrder(this.at, score), this.video.points, this.offsetMs));
    this.api.updateSyncPoints();
  }

  _switchAlphaTab(external) {
    const { api, at } = this;
    api.stop();
    api.settings.player.playerMode = external ? at.PlayerMode.EnabledExternalMedia : at.PlayerMode.EnabledSynthesizer;
    api.updateSettings();
    if (external) {
      api.player.output.handler = this.handler;
    } else if (!api.isReadyForPlayback) {
      api.loadSoundFont(api.settings.player.soundFont, false);
    }
    if (api.score) api.loadMidiForScore();
  }

  _stateChanged(state) {
    if (!this.active) return;
    const YTS = window.YT.PlayerState;
    const playing = this.api.playerState === this.at.synth.PlayerState.Playing;
    if (state === YTS.PLAYING) {
      this._startPolling();
      if (!playing) this.api.play();
    } else if (state === YTS.PAUSED || state === YTS.ENDED) {
      this._stopPolling();
      this._push();
      if (playing) this.api.pause();
    }
  }

  _push() {
    if (!this.active || !this.player?.getCurrentTime) return;
    this.api.player?.output?.updatePosition?.(this.player.getCurrentTime() * 1000);
  }
  _startPolling() {
    this._stopPolling();
    this.timer = setInterval(() => this._push(), POLL_MS);
  }
  _stopPolling() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

function youTubeError(code) {
  return {
    2: 'Invalid YouTube video id.',
    5: 'This video cannot be played in an HTML5 player.',
    100: 'The YouTube video was removed or made private.',
    101: 'The video owner does not allow it to be embedded.',
    150: 'The video owner does not allow it to be embedded.',
  }[code] || `YouTube error ${code}.`;
}
