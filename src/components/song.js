const { functions } = require('firebase');
const utils = require('../utils');

const GAME_OVER_LENGTH = 3.5;
const ONCE = { once: true };
const BASE_VOLUME = 0.5;

let skipDebug = AFRAME.utils.getUrlParameter('skip');
if (!!skipDebug) {
  skipDebug = parseInt(skipDebug) / 1000;
} else {
  skipDebug = 0;
}

/**
 * Active challenge song / audio.
 *
 * Order of song init in conjuction with beat-generator:
 *
 * 1. previewStartTime is playing
 * 2. songloadfinish
 * 3. beat-generator preloading
 * 4. preloaded beats generated
 * 5. beat-generator preloading finish
 * 6. startAudio / songStartTime is set
 * 7. beat-generator continues off song current time
 */
AFRAME.registerComponent('song', {
  schema: {
    audio: { type: 'string' }, // Blob URL.
    analyserEl: { type: 'selector', default: '#audioAnalyser' },
    challengeId: { default: '' },
    isBeatsPreloaded: { default: false },
    isGameOver: { default: false },
    isLoading: { default: false },
    isPlaying: { default: false },
    isVictory: { default: false },
    duration: { type: 'number' }
  },

  init: function () {
    this.analyserSetter = { buffer: true };
    this.audioAnalyser = this.data.analyserEl.components.audioanalyser;
    this.context = this.audioAnalyser.context;
    this.isAudioPlaying = false;
    this.songStartTime = 0;

    this.onSongComplete = this.onSongComplete.bind(this);

    // Base volume.
    this.audioAnalyser.gainNode.gain.value = BASE_VOLUME;

    this.el.addEventListener('wallhitstart', this.onWallHitStart.bind(this));
    this.el.addEventListener('wallhitend', this.onWallHitEnd.bind(this));

    this.el.sceneEl.addEventListener('loadSong', () => {
      this.el.sceneEl.emit('songprocessstart', null, false);
      setTimeout(() => {
        this.el.sceneEl.emit('songprocessfinish', null, false);
      }, 50);
    });
    //this.el.sceneEl.addEventListener('gamemenurestart', this.startSong.bind(this));
    this.el.sceneEl.addEventListener('startSong', this.startSong.bind(this));

    if (process.env.NODE_ENV !== 'production') {
      this.el.addEventListener('victoryfake', () => {
        this.source.onended = null;
        this.source.stop();
        this.source.disconnect();
        this.onSongComplete();
      });
    }
  },

  update: function (oldData) {
    const data = this.data;
    // Game over, slow down audio, and then stop.
    if (!oldData.isGameOver && data.isGameOver) {
      this.onGameOver();
      return;
    }

    if (oldData.isGameOver && !data.isGameOver) {
      this.audioAnalyser.gainNode.value = BASE_VOLUME;
    }

    // On victory screen, play song in background.
    if (!oldData.isVictory && data.isVictory) {
      this.data.analyserEl.addEventListener('audioanalyserbuffersource', evt => {
        this.audioAnalyser.resumeContext();
        const gain = this.audioAnalyser.gainNode.gain;
        gain.cancelScheduledValues(0);
        gain.setValueAtTime(0.05, 0);
        this.source = evt.detail;
        this.source.start();
        this.el.emit('victory');
      }, ONCE);
      this.audioAnalyser.refreshSource();
      return;
    }

    if (oldData.challengeId && !data.challengeId) {
      this.stopAudio();
      return;
    }

    // Pause / stop.
    if (oldData.isPlaying && !data.isPlaying) {
      this.audioAnalyser.suspendContext();
      this.isAudioPlaying = false;
    }

    // Resume.
    if (!oldData.isPlaying && data.isPlaying && this.source) {
      this.audioAnalyser.resumeContext();
      this.isAudioPlaying = true;
    }
  },



  stopAudio: function () {
    console.log('Stopping song ' + this.data.audio);
    if (!this.source) {
      console.warn('[song] Tried to stopAudio, but not playing.');
      return;
    }
    this.source.onended = null;
    if (this.isAudioPlaying) { this.source.stop(); }
    this.source.disconnect();
    this.source = null;
    this.isAudioPlaying = false;
  },

  onSongComplete: function () {
    if (!this.data.isPlaying) { return; }
    this.el.emit('songcomplete');
  },

  onGameOver: function () {
    this.isAudioPlaying = false;

    // Playback rate.
    const playbackRate = this.source.playbackRate;
    playbackRate.setValueAtTime(playbackRate.value, this.context.currentTime);
    playbackRate.linearRampToValueAtTime(0, this.context.currentTime + GAME_OVER_LENGTH);

    // Gain.
    const gain = this.audioAnalyser.gainNode.gain;
    gain.setValueAtTime(gain.value, this.context.currentTime);
    gain.linearRampToValueAtTime(0, this.context.currentTime + GAME_OVER_LENGTH);

    setTimeout(() => {
      if (!this.data.isGameOver) { return; }
      this.stopAudio();
    }, 3500);
  },

  onWallHitStart: function () {
    const gain = this.audioAnalyser.gainNode.gain;
    gain.linearRampToValueAtTime(0.1, this.context.currentTime + 0.1);
  },

  onWallHitEnd: function () {
    const gain = this.audioAnalyser.gainNode.gain;
    gain.linearRampToValueAtTime(BASE_VOLUME, this.context.currentTime + 0.1);
  },


  getAudio: function () {
    const data = this.data;

    if (this.source) { this.stopAudio(); }
    console.log("Getting audio buffer " + data.audio);
    this.isAudioPlaying = false;
    return new Promise(resolve => {
      data.analyserEl.addEventListener('audioanalyserbuffersource', evt => {
        // Finished decoding.
        this.source = evt.detail;
        resolve(this.source);
      }, ONCE);
      if (this.loadedAudio == this.data.audio) {
        this.audioAnalyser.refreshSource();
      } else {
        this.analyserSetter.src = this.data.audio;
        data.analyserEl.setAttribute('audioanalyser', this.analyserSetter);
      }

    }).catch(console.error);
  },

  loadSong: function (onComplete = null) {
    console.log("Loading song " + this.data.audio);
    this.getAudio().then(source => {
      this.loadedAudio = this.data.audio;
      console.log("Song loaded " + this.loadedAudio);
      if (onComplete)
        onComplete();
    }).catch(console.error);
  },

  startPlayingSong: function () {
    if (this.isAudioPlaying) { return; }
    this.audioAnalyser.resumeContext();
    this.isAudioPlaying = true;
    // Restart, get new buffer source node and play.
    console.log('Starting playback ' + this.loadedAudio);
    this.songStartTime = this.context.currentTime;
    this.source.onended = this.onSongComplete;
    // Clear gain interpolation values from game over.
    const gain = this.audioAnalyser.gainNode.gain;
    gain.cancelScheduledValues(0);
    this.audioAnalyser.gainNode.gain.value = BASE_VOLUME;

    this.source.start(0, skipDebug || 0);
  },
  // starts ( or restarts ) the song
  startSong: function () { //startAudio onRestart
    if (this.isPlaying) {
      this.stopAudio();
      this.loadSong(() => { this.startPlayingSong(); });
    } else {
      this.startPlayingSong();
    }
  },

  getCurrentTime: function () {
    if (!this.isAudioPlaying) { return 0; }
    const dt = this.context.currentTime - this.songStartTime;
    return Math.min(dt, this.data.duration);
  },
  getCurrentProgress: function () {
    return this.getCurrentTime() / this.data.duration;
  },
  isAudioLoaded: function () {
    return this.loadedAudio === this.data.audio;
  }
});
