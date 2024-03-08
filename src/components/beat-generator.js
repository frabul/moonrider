import utils from '../utils';

let skipDebug = AFRAME.utils.getUrlParameter('skip') || 0;
skipDebug = parseInt(skipDebug, 10);

const DEBUG_MINES = AFRAME.utils.getUrlParameter('debugmines');
const beatForwardTime = parseInt(AFRAME.utils.getUrlParameter('beatforwardtime'), 10);
// Beats arrive at sword stroke distance synced with the music.
export const BEAT_ANTICIPATION_TIME = 1.1;
export const BEAT_PRELOAD_TIME = 1.1;
export const PUNCH_OFFSET = 0.5;
export const SWORD_OFFSET = 1.5;

// How far out to load beats (ms).
const isMobile = AFRAME.utils.device.isMobile();

var BEAT_FORWARD_TIME = isMobile ? 2000 : 3500;
if (beatForwardTime && !isNaN(beatForwardTime))
  BEAT_FORWARD_TIME = beatForwardTime;
const WALL_FORWARD_TIME = isMobile ? 7500 : 10000;

/**
 * Load beat data (all the beats and such).
 */
AFRAME.registerComponent('beat-generator', {
  dependencies: ['stage-colors'],

  schema: {
    gameMode: { type: 'string' }, // classic, punch, ride. 
    has3DOFVR: { default: false },
    isPlaying: { default: false },
    isLoading: { default: false },
    songDuration: { type: 'number' }, // Seconds.
    speed: { type: 'number' }
  },

  orientationsHumanized: [
    'up',
    'down',
    'left',
    'right',
    'upleft',
    'upright',
    'downleft',
    'downright'
  ],

  horizontalPositions: [-0.75, -0.25, 0.25, 0.75],

  horizontalPositionsHumanized: {
    0: 'left',
    1: 'middleleft',
    2: 'middleright',
    3: 'right'
  },

  positionHumanized: {
    topLeft: { layer: 2, index: 0 },
    topCenterLeft: { layer: 2, index: 1 },
    topCenterRight: { layer: 2, index: 2 },
    topRight: { layer: 2, index: 3 },

    middleLeft: { layer: 1, index: 0 },
    middleCenterLeft: { layer: 1, index: 1 },
    middleCenterRight: { layer: 1, index: 2 },
    middleRight: { layer: 1, index: 3 },

    bottomLeft: { layer: 0, index: 0 },
    bottomCenterLeft: { layer: 0, index: 1 },
    bottomCenterRight: { layer: 0, index: 2 },
    bottomRight: { layer: 0, index: 3 }
  },

  verticalPositionsHumanized: {
    0: 'bottom',
    1: 'middle',
    2: 'top'
  },

  init: function () {
    this.audioAnalyserEl = document.getElementById('audioanalyser');
    this.beatContainer = document.getElementById('beatContainer');

    this.beatData = null;
    this.beatDataProcessed = false;
    this.preloadTime = 0;
    this.songTime = undefined;
    this.bpm = undefined;
    this.curve = null;
    this.curveEl = document.getElementById('curve');
    this.curveFollowRigEl = document.getElementById('curveFollowRig');
    this.tube = document.getElementById('tube');
    this.index = { events: 0, notes: 0, obstacles: 0 };
    this.wallContainer = document.getElementById('wallContainer');

    this.leftStageLasers = document.getElementById('leftStageLasers');
    this.rightStageLasers = document.getElementById('rightStageLasers');
    this.stageColors = this.el.components['stage-colors'];

    this.el.addEventListener('cleargame', this.onClearGame.bind(this));
    this.el.sceneEl.addEventListener('loadMap', this.onLoadMap.bind(this));

    this.wallsCache = {};
    /*
      // For debugging: generate beats on key space press.
      document.addEventListener('keydown', ev => {
        if (ev.keyCode === 32) {
          this.generateBeat({
            _cutDirection: 1,
            _lineIndex: (Math.random()*3)|0,
            _lineLayer: 1,
            _time: Math.floor(this.el.components.song.getCurrentTime() * 1.4 + 3),
            _type: (Math.random() * 2) | 0
          })
        }
      })
    */
  },

  play: function () {
    this.playerHeight = document.querySelector('[player-height]').components['player-height'];
  },

  update: function (oldData) {
    const data = this.data;
  },

  setIndexAtTime: function (time) {
    const msPerBeat = 1000 * 60 / this.beatData._beatsPerMinute;
    const events = this.beatData._events;
    const notes = this.beatData._notes;
    const obstacles = this.beatData._obstacles;
    time = time / msPerBeat; // convert time to beat time
    for (let i = 0; events[i]._time < time; i++) {
      this.index.events = i;
    }
    for (let i = 0; notes[i]._time < time; i++) {
      this.index.notes = i;
    }
    for (let i = 0; obstacles[i]._time < time; i++) {
      this.index.obstacles = i;
    }
  },

  /**
   * Load the beat data into the game.
   */
  processBeats: function () {
    // if there is version and first character is 3, convert to 2.xx
    if (this.beatData.version && this.beatData.version.charAt(0) === '3') {
      this.beatData = convertBeatData_320_to_2xx(this.beatData);
    }
    // Reset variables used during playback.
    // Beats spawn ahead of the song and get to the user in sync with the music.
    this.songTime = 0;
    this.preloadTime = 0;
    this.beatData._events.sort(lessThan);
    this.beatData._obstacles.sort(lessThan);
    this.beatData._notes.sort(lessThan);
    this.bpm = this.beatData._beatsPerMinute;

    // Performance: Remove all obstacles if there are more than 256 (often used with Noodle Extensions)
    if (this.beatData._obstacles.length > 256) {
      this.beatData._obstacles = [];
    }

    // Some events have negative time stamp to initialize the stage.
    const events = this.beatData._events;
    if (events.length && events[0]._time < 0) {
      for (let i = 0; events[i]._time < 0; i++) {
        this.generateEvent(events[i]);
      }
    }

    const obstacles = this.beatData._obstacles;
    for (let i = 0; i < obstacles.length; ++i) {
      let wallInfo = obstacles[i];
      wallInfo._duration = 2.5;
      wallInfo._lineIndex = (i % 2) * 3;
      wallInfo._time = Math.floor(i / 2) * 3;
      wallInfo._type = 0;
      wallInfo._width = 1;
    }


    this.beatDataProcessed = true;
    console.log('[beat-generator] Finished processing beat data.');
  },

  /**
   * Generate beats and stuff according to timestamp.
   */
  tick: function (time, delta) {
    if (!this.data.isPlaying || !this.beatData || !this.readyToStart) { return; }

    let songTime;
    const song = this.el.components.song;
    if (this.preloadTime === undefined) {
      if (!song.isAudioPlaying) { return; }
      // Get current song time.
      songTime = song.getCurrentTime() * 1000 + skipDebug;
    } else {
      // Song is not playing and is preloading beats, use maintained beat time.
      songTime = this.preloadTime;
    }

    const bpm = this.beatData._beatsPerMinute;
    const msPerBeat = 1000 * 60 / this.beatData._beatsPerMinute;

    // Load in stuff scheduled between the last timestamp and current timestamp.
    // Beats.
    const notes = this.beatData._notes;
    for (let i = this.index.notes; i < notes.length; ++i) {
      if (songTime + BEAT_FORWARD_TIME > notes[i]._time * msPerBeat) {
        //this.generateBeat(notes[i]);
        this.index.notes++;
      } else {
        break; // notes are sorted by time, so we can break early
      }
    }

    if (this.data.gameMode !== 'ride') {
      // Walls.
      const obstacles = this.beatData._obstacles;
      for (let i = this.index.obstacles; i < obstacles.length; ++i) {
        if (songTime + WALL_FORWARD_TIME >= obstacles[i]._time * msPerBeat) {
          const wallEl = this.wallsCache[i];
          wallEl.components.wall.enterTheScene();
          this.index.obstacles++;
        } else {
          break; // obstacles are sorted by time, so we can break early
        }
      }
    }

    // Stage events.
    const events = this.beatData._events;
    for (let i = this.index.events; i < events.length; ++i) {
      if (songTime >= events[i]._time * msPerBeat) {
        //this.generateEvent(events[i]);
        this.index.events++;
      } else {
        break; // events are sorted by time, so we can break early
      }
    }

    if (this.preloadTime === undefined) { return; }

    if (this.preloadTime >= BEAT_PRELOAD_TIME * 1000) {
      // Finished preload.
      this.el.sceneEl.emit('beatloaderpreloadfinish', null, false);
      this.preloadTime = undefined;
    } else {
      // Continue preload.
      this.preloadTime += delta;
    }
  },

  generateBeat: function (noteInfo, index) {
    const data = this.data;

    if (DEBUG_MINES) { noteInfo._type = 3; }

    let color;
    let type = noteInfo._cutDirection === 8 ? 'dot' : 'arrow';
    if (noteInfo._type === 0) {
      color = 'red';
    } else if (noteInfo._type === 1) {
      color = 'blue';
    } else {
      type = 'mine';
      color = undefined;
    }

    if (data.has3DOFVR &&
      data.gameMode !== 'viewer' &&
      data.gameMode !== 'ride' &&
      color === 'red') {
      return;
    }

    if (AFRAME.utils.getUrlParameter('dot') || data.gameMode === 'punch') { type = 'dot'; }

    const beatEl = this.requestBeat(type, color);
    if (!beatEl) { return; }

    // Entity was just created.
    if (!beatEl.components.beat && !beatEl.components.plume) {
      setTimeout(() => {
        this.setupBeat(beatEl, noteInfo);
      });
    } else {
      this.setupBeat(beatEl, noteInfo);
    }
  },

  setupBeat: function (beatEl, noteInfo) {
    const data = this.data;

    // Apply sword offset. Blocks arrive on beat in front of the user.
    const cutDirection = this.orientationsHumanized[noteInfo._cutDirection];
    const horizontalPosition = this.horizontalPositionsHumanized[noteInfo._lineIndex] || 'left';
    const verticalPosition = this.verticalPositionsHumanized[noteInfo._lineLayer] || 'middle';

    // Factor in sword offset and beat anticipation time (percentage).
    const weaponOffset = this.data.gameMode === 'classic' ? SWORD_OFFSET : PUNCH_OFFSET;
    const positionOffset =
      ((weaponOffset / data.speed) + BEAT_ANTICIPATION_TIME) /
      data.songDuration;

    // Song position is from 0 to 1 along the curve (percentage).
    const durationMs = data.songDuration * 1000;
    const msPerBeat = 1000 * 60 / this.beatData._beatsPerMinute;
    const songPosition = ((noteInfo._time * msPerBeat) / durationMs) + positionOffset;

    // Set render order (back to front so decreasing render order as index increases).
    const renderOrder = this.el.systems['render-order'].order.beats + 1 - songPosition;

    if (data.gameMode === 'ride') {
      beatEl.components.plume.onGenerate(songPosition, horizontalPosition, verticalPosition,
        this.playerHeight.beatOffset);
      beatEl.setAttribute('render-order', renderOrder);
    } else {
      beatEl.components.beat.onGenerate(songPosition, horizontalPosition, verticalPosition,
        cutDirection, this.playerHeight.beatOffset);
      beatEl.components.beat.blockEl.object3D.renderOrder = renderOrder;
    }
    beatEl.play();
  },

  generateWall: function (wallInfo, name) {
    const data = this.data;
    const wallEl = this.el.sceneEl.components.pool__wall.requestEntity();

    if (!wallEl) { return; }

    wallEl.wallName = name;
    // Entity was just created.
    if (!wallEl.components.wall) {
      setTimeout(() => {
        this.setupWall(wallEl, wallInfo);
      });
    } else {
      this.setupWall(wallEl, wallInfo);
    }
    return wallEl;
  },

  setupWall: function (wallEl, wallInfo) {
    const data = this.data;

    if (data.has3DOFVR && data.gameMode !== 'viewer') { return; }

    const durationSeconds = 60 * (wallInfo._duration / this.bpm);
    const horizontalPosition = this.horizontalPositionsHumanized[wallInfo._lineIndex] || 'none';
    const isCeiling = wallInfo._type === 1;
    const length = durationSeconds * data.speed;
    const width = wallInfo._width / 2; // We want half the reported width.

    // Factor in beat anticipation time (percentage).
    const positionOffset = (BEAT_ANTICIPATION_TIME) / data.songDuration;

    // Song position is from 0 to 1 along the curve (percentage).
    const durationMs = data.songDuration * 1000;
    const msPerBeat = 1000 * 60 / this.beatData._beatsPerMinute;
    const songPosition = (wallInfo._time * msPerBeat) / durationMs + positionOffset;

    const lengthPercent = length / this.curveEl.components.supercurve.length;
    wallEl.components.wall.onGenerate(songPosition, horizontalPosition, width, length,
      isCeiling, songPosition + lengthPercent);

    // Set render order (back to front so decreasing render order as index increases).
    // For walls, set as the back end of the wall.
    wallEl.object3D.renderOrder = this.el.systems['render-order'].order.beats + 1 -
      (songPosition + lengthPercent);
  },

  generateEvent: function (event) {
    switch (event._type) {
      case 0:
        this.stageColors.setColor('bg', event._value);
        //this.stageColors.setColorInstant('moon', event._value);
        break;
      case 1:
        //this.stageColors.setColorInstant('stars', event._value);
        break;
      case 2:
        //this.stageColors.setColor('curveeven', event._value);
        break;
      case 3:
        //this.stageColors.setColor('curveodd', event._value);
        break;
      case 4:
        //this.stageColors.setColor('floor', event._value);
        break;
      case 8:
        this.tube.emit('pulse', null, false);
        break;
      case 9:
        this.tube.emit('pulse', null, false);
        break;
      case 12:
        //this.stageColors.setColor('leftglow', event._value);
        break;
      case 13:
        //this.stageColors.setColor('rightglow', event._value);
        break;
    }
  },

  requestBeat: function (type, color) {
    let beatPoolName = 'pool__beat-' + type;
    if (this.data.gameMode === 'ride') {
      beatPoolName = 'pool__plume-' + type;
    }
    if (type !== 'mine' && color) { beatPoolName += '-' + color; }
    const pool = this.el.sceneEl.components[beatPoolName];
    if (!pool) {
      console.warn('Pool ' + beatPoolName + ' unavailable');
      return;
    }
    return pool.requestEntity();
  },

  onLoadMap: function (eventtData) {
    // must do it with some delay because we need to beat-system to be ready first
    setTimeout(() => {
      this.index.events = 0;
      this.index.notes = 0;
      this.index.obstacles = 0;

      this.beatData = eventtData.detail;
      this.processBeats();
      // if skipDebug is set then we need to set index according to the time
      this.setIndexAtTime(skipDebug);
      this.onRestart();
    }, 10);
  },
  /**
   * Restart by returning all beats to pool.
   */
  onClearGame: function () {
    console.log("Clearing game");
    this.preloadTime = 0;
    this.index.events = 0;
    this.index.notes = 0;
    this.index.obstacles = 0;
    this.readyToStart = false;
    for (let i = 0; i < this.beatContainer.children.length; i++) {
      const child = this.beatContainer.children[i];
      child.object3D.position.set(0, 0, -9999);
      if (child.components.beat) { child.components.beat.returnToPool(); }
    }

    // iterate all walls in wallsCache and retrun them to pool
    const keys = Object.keys(this.wallsCache);
    for (let i = 0; i < keys.length; i++) {
      const wallEl = this.wallsCache[keys[i]];
      wallEl.object3D.position.set(0, -9999, 0);
      if (wallEl.components.wall)
        wallEl.components.wall.returnToPool();
    }
    this.wallsCache = {};
    this.gameCleared = true;

  },

  restartGame: function () {
    this.gameCleared = false;
    const data = this.data;
    // Generate curve based on song duration.
    this.curveEl.components.supercurve.generateCurve(data.speed * data.songDuration);
    this.curve = this.curveEl.components.supercurve.curve;
    if (this.wallsCache.length > 0)
      console.warn("wallsCache not empty on restart");
    this.wallsCache = {};
    setTimeout(() => {
      const obstacles = this.beatData._obstacles;
      for (let i = 0; i < obstacles.length; ++i) {
        const wall = this.generateWall(obstacles[i], "wall_" + i);
        this.wallsCache[i] = wall;
      }

      this.readyToStart = true;
      this.el.sceneEl.emit('beatGeneratorReady');
    });
  },
  /**
   * Regenerate.
   */
  onRestart: function () {
    console.log("onRestart called");
    if (!this.gameCleared) {
      console.warn("Game not cleared on restart");
      this.onClearGame();
      // in this case we must wait that game is cleared before we can restart
      setTimeout(() => {
        this.restartGame();
      }, 70);
    } else {
      this.restartGame();
    }
  }
});

function lessThan(a, b) { return a._time - b._time; }

function convertBeatData_320_to_2xx(beatData) {
  const newBeatData = {
    _version: '3.2.2',
    _beatsPerMinute: beatData._beatsPerMinute,
    _events: [],
    _notes: [],
    _obstacles: []
  };
  // ignore bmpEvents
  // ingore rotationEvents
  // convert notes
  newBeatData._notes = beatData.colorNotes.map(note => {
    return {
      _time: note.b,
      _lineIndex: note.x,
      _lineLayer: note.y,
      _type: note.c, // 0 = red, 1 = blue 
      _cutDirection: note.d
    };
  });
  // convert bombs ( add to notes )
  for (const bomb of beatData.bombNotes) {
    newBeatData._notes.push({
      _time: bomb.b,
      _lineIndex: bomb.x,
      _lineLayer: bomb.y,
      _type: 3, // 3 = bomb 
    });
  }
  // sort notes by time ascending
  newBeatData._notes.sort((a, b) => a._time - b._time);
  // convert obstacles
  newBeatData._obstacles = beatData.obstacles.map(obstacle => {
    return {
      _time: obstacle.b,
      _lineIndex: obstacle.x,
      _lineLayer: obstacle.y,
      _type: obstacle._type,
      _duration: obstacle.d,
      _width: obstacle.w,
      _height: obstacle.h
    };
  });

  return newBeatData;
}