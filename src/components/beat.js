
const WARMUP_TIME = 2000;
const WARMUP_ROTATION_CHANGE = 2 * Math.PI;

const elasticEasing = getElasticEasing(1.33, 0.5);


const ONCE = { once: true };
const DESTROY_TIME = 1000;



const MINE = 'mine';
const BEAT = 'beat';
const DOT = 'dot';
const CLASSIC = 'classic';
const PUNCH = 'punch';
const RIDE = 'ride';



const MODELS = {
  arrowblue: 'blueBeatObjTemplate',
  arrowred: 'redBeatObjTemplate',
  dotblue: 'dotBlueObjTemplate',
  dotred: 'dotRedObjTemplate',
  mine: 'mineObjTemplate'
};

const WEAPON_COLORS = { right: 'blue', left: 'red' };

const ROTATIONS = {
  right: 0,
  upright: 45,
  up: 90,
  upleft: 135,
  left: 180,
  downleft: 225,
  down: 270,
  downright: 315
};

const SIZES = {
  [CLASSIC]: 0.48,
  [PUNCH]: 0.35,
  [RIDE]: 0.4
};


/**
 * Bears, beats, Battlestar Galactica.
 * Create beat from pool, collision detection, movement, scoring.
 */
AFRAME.registerComponent('beat', {
  schema: {
    color: { default: 'red', oneOf: ['red', 'blue'] },
    debug: { default: false },
    type: { default: 'arrow', oneOf: ['arrow', DOT, MINE] }
  },

  init: function () {
    this.bbox = null;
    this.beatSystem = this.el.sceneEl.components['beat-system'];
    this.broken = null;
    this.brokenPoolName = undefined;
    this.destroyed = false;
    this.poolName = undefined;
    this.returnToPoolTimer = DESTROY_TIME;
    this.warmupTime = 0;;
    this.curveEl = document.getElementById('curve');
    this.curveFollowRig = document.getElementById('curveFollowRig');
    this.mineParticles = document.getElementById('mineParticles');
    this.rigContainer = document.getElementById('rigContainer');
    this.verticalPositions = this.beatSystem.verticalPositions;



    this.explodeEventDetail = {
      beatDirection: '',
      color: this.data.color,
      correctHit: false,
      direction: new THREE.Vector3(),
      gameMode: '',
      position: new THREE.Vector3(),
      rotation: new THREE.Euler()
    };

    this.blockEl = document.createElement('a-entity');
    this.blockEl.setAttribute('mixin', 'beatBlock');
    this.el.appendChild(this.blockEl);
    this.initMesh();


    if (this.data.type === MINE) {
      this.poolName = 'pool__beat-mine';
    } else {
      this.poolName = `pool__beat-${this.data.type}-${this.data.color}`;
    }
  },

  tick: function (time, timeDelta) {
    const el = this.el;
    const data = this.data;
 
    if (this.destroyed) {
      this.returnToPoolTimer -= timeDelta;
      if (this.returnToPoolTimer <= 0) { this.returnToPool(); }
      return;
    }

    // Warmup animation.
    if (this.warmupTime < WARMUP_TIME) {
      const progress = elasticEasing(this.warmupTime / WARMUP_TIME);
      el.object3D.rotation.y = this.rotationStart + (progress * this.rotationChange);
      el.object3D.position.y = this.positionStart + (progress * this.positionChange);
      this.warmupTime += timeDelta;
    }


  },

  /**
   * Called when summoned by beat-generator.
   * Called after updatePosition.
   */
  onGenerate: function (songPosition, horizontalPosition, verticalPosition, cutDirection, heightOffset) {
    const data = this.data;
    const el = this.el;
    // Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
    const FACTOR = 1 / 0.29;
    const size = SIZES[this.beatSystem.data.gameMode] * FACTOR;
    this.blockEl.object3D.scale.set(size, size, size);

    cutDirection = cutDirection || 'down';
    this.cutDirection = cutDirection;
    this.horizontalPosition = horizontalPosition;
    this.verticalPosition = verticalPosition;
    this.songPosition = songPosition;

    if (!this.blockEl) {
      console.warn('Unable to generate beat. blockEl was undefined.');
      return;
    }

    this.blockEl.object3D.visible = true;
    this.destroyed = false;
    el.object3D.visible = true;

    this.warmupTime = 0;

    // Set position.
    const supercurve = this.curveEl.components.supercurve;
    supercurve.getPointAt(songPosition, el.object3D.position);
    supercurve.alignToCurve(songPosition, el.object3D);
    el.object3D.position.x += this.beatSystem.horizontalPositions[horizontalPosition];

    if (data.type !== DOT) {
      el.object3D.rotation.z = THREE.Math.degToRad(ROTATIONS[cutDirection]);
    }

    // Set up rotation warmup.
    this.rotationStart = el.object3D.rotation.y;
    this.rotationChange = WARMUP_ROTATION_CHANGE;
    if (Math.random > 0.5) { this.rotationChange *= -1; }

    // Set up position warmup.
    const offset = 0.5;
    el.object3D.position.y -= offset;
    this.positionStart = el.object3D.position.y;
    this.positionChange = this.verticalPositions[verticalPosition] + offset + heightOffset;

    this.beatSystem.registerBeat(this);
  },

  /**
   * Set geometry and maybe material.
   */
  initMesh: function () {
    const blockEl = this.blockEl;
    const el = this.el;
    const type = this.data.type;

    setObjModelFromTemplate(
      blockEl,
      MODELS[type !== 'mine' ? `${type}${this.data.color}` : type]);

    blockEl.setAttribute('materials', 'name', 'beat');
    const mesh = blockEl.getObject3D('mesh');
    mesh.geometry.computeBoundingBox();

    this.bbox = mesh.geometry.boundingBox;

    if (this.data.type === 'mine') {
        this.bbox.set(this.bbox.min.multiplyScalar(0.5), this.bbox.max.multiplyScalar(0.5));
    }

    // for debug add a-plane to this entity
    //var plane = document.createElement('a-plane');
    //plane.object3D.scale.set(this.bbox.max.x - this.bbox.min.x, this.bbox.max.y - this.bbox.min.y, 1);
    //this.el.appendChild(plane);
  },

  destroyBeat: function (weaponEl, correctHit) {
    const data = this.data;
    const explodeEventDetail = this.explodeEventDetail;
    const rig = this.rigContainer.object3D;

    this.blockEl.object3D.visible = false;

    this.destroyed = true;
    this.returnToPoolTimer = DESTROY_TIME;

    explodeEventDetail.beatDirection = this.cutDirection;
    explodeEventDetail.color = this.data.color;
    explodeEventDetail.correctHit = correctHit;
    explodeEventDetail.gameMode = this.beatSystem.data.gameMode;
    explodeEventDetail.position.copy(this.el.object3D.position);
    rig.worldToLocal(explodeEventDetail.position);

    let brokenPoolName;
    if (this.data.type === MINE) {
      brokenPoolName = 'pool__beat-broken-mine';
    } else {
      const mode = this.beatSystem.data.gameMode === CLASSIC ? 'beat' : PUNCH;
      brokenPoolName = `pool__${mode}-broken-${this.data.color}`;
      if (this.data.type === DOT) {
        brokenPoolName += '-dot';
      }
    }

    this.broken = this.el.sceneEl.components[brokenPoolName].requestEntity();
    if (this.broken) {
      this.broken.emit('explode', this.explodeEventDetail, false);
    }

    if (this.beatSystem.data.gameMode === CLASSIC && correctHit) {
      weaponEl.components.trail.pulse();
    }
  },
  isDot: function () {
    return this.data.type === DOT;
  },
  isMine: function () {
    return this.data.type === MINE;
  },
  isArrow: function () {
    return this.data.type === BEAT;
  },

  /**
   * Check if need to return to pool.
   */
  returnToPool: function () {
    this.beatSystem.unregisterBeat(this);
    this.el.object3D.position.set(0, 0, -9999);
    this.el.object3D.visible = false;
    this.el.sceneEl.components[this.poolName].returnEntity(this.el);
  },
});

/**
 * Load OBJ from already parsed and loaded OBJ template.
 */
const geometries = {};
function setObjModelFromTemplate(el, templateId) {
  // Load into cache.
  if (!geometries[templateId]) {
    const templateEl = document.getElementById(templateId);
    if (templateEl.getObject3D('mesh')) {
      // Set cache.
      geometries[templateId] = templateEl.getObject3D('mesh').children[0].geometry;
    } else {
      // Wait.
      templateEl.addEventListener('object3dset', evt => {
        if (evt.detail.type !== 'mesh') { return; }
        setObjModelFromTemplate(el, templateId);
      }, ONCE);
      return;
    }
  }

  // Set geometry.
  if (geometries[templateId]) {
    if (!el.getObject3D('mesh')) { el.setObject3D('mesh', new THREE.Mesh()); }
    el.getObject3D('mesh').geometry = geometries[templateId];
  }
}

function getElasticEasing(a, p) {
  return t => 1 - elastic(a, p)(1 - t);
}

function elastic(amplitude, period) {
  function minMax(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  const a = minMax(amplitude || 1, 1, 10);
  const p = minMax(period || 0.5, .1, 2);
  return t => {
    return (t === 0 || t === 1)
      ? t
      : -a * Math.pow(2, 10 * (t - 1)) *
      Math.sin((((t - 1) - (p / (Math.PI * 2) *
        Math.asin(1 / a))) * (Math.PI * 2)) / p);
  };
}

function remap(value, low1, high1, low2, high2) {
  return low2 + (high2 - low2) * (value - low1) / (high1 - low1);
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}
