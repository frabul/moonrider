import { SIZES } from './beat';

const HEIGHT = 2.5;
const CEILING_THICKNESS = 1.5;
class z_range {
  constructor(min, max) {
    this.min = min;
    this.max = max;
  }
  length() {
    return this.max - this.min;
  }

}
/**
 * Wall to dodge.
 */
AFRAME.registerComponent('wall', {
  dependencies: ['material'],

  init: function () {
    this.el.setObject3D('mesh', new THREE.Mesh());
    this.geometry = null;
    this.isCeiling = false;
    this.isRaycastable = false;
    this.localPosition = new THREE.Vector3();
    this.tick = AFRAME.utils.throttleTick(this.tick.bind(this), 1000);
    this.zrange = new z_range(-0.5, 0.5);
    this.isOnTheScene = false;

    // these need to be set after scene is loaded
    //setTimeout(() => {
      this.beatSystem = this.el.sceneEl.components['beat-system'];
      this.beatGenerator = this.el.sceneEl.components['beat-generator']; 
    //}, 50);

  },

  play: function () {
    console.log('wall played, name ' + this.el.wallName);
    this.el.object3D.visible = true;
  },

  enterTheScene: function () {
    console.log('wall entering scene: ' + this.el);
    this.el.play();
    this.el.components.animation__fadein.beginAnimation();
    this.el.components.animation__scalein.beginAnimation();
    this.isOnTheScene = true;
  },

  tick: function (time, timeDelta) {  
    const mapProgress = this.beatGenerator.getCurrentMapProgress();
    if (!this.isRaycastable && mapProgress + 0.01 >= this.mapPosition) {
      this.isRaycastable = true;
      this.el.setAttribute('data-wall-active', '');
      if (!this.isCeiling) {
        this.el.setAttribute('data-weapon-particles', '');
        this.el.setAttribute('raycastable-game', '');
      }
    }

    if (mapProgress >= this.backPosition + 0.01) {
      this.returnToPool();
    }
  },

  onGenerate: function (mapPosition, horizontalPosition, width, length, isCeiling, backPosition) {
    console.log('wall onGenerate, name ' + this.el.wallName);
    const el = this.el;
    this.isCeiling = isCeiling;
    this.backPosition = backPosition;
    this.mapPosition = mapPosition;
    this.setWallGeometry(mapPosition, horizontalPosition, width, length, isCeiling);
    el.getObject3D('mesh').material.uniforms.opacity.value = 0;
    el.object3D.position.y = -5;

  },

  /**
   * Curve wall along curve by mapping box geometry vertices along curve using.
   * supercurve.getPositionRelativeToTangent.
   */
  setWallGeometry: (function () {
    const modifiedVertexPos = new THREE.Vector3();
    const left = new THREE.Vector3();
    const right = new THREE.Vector3();

    return function (mapPosition, horizontalPosition, width, length, isCeiling) {
      const beatSystem = this.el.sceneEl.components['beat-system'];
      const supercurve = this.beatSystem.supercurve;

      const lengthPercent = length / supercurve.length;
      const startPercent = mapPosition;
      const endPercent = mapPosition + lengthPercent;

      const height = isCeiling ? CEILING_THICKNESS : HEIGHT;

      // Offset vectors to get the left / right vertex points to pass into curve helper.
      // Note that curve is upside down so the positions are reversed...normally, this would
      // read as `+ (width / 2) - 0.25`.
      const centerPosition = (-1 * beatSystem.horizontalPositions[horizontalPosition]) -
        (width / 2) + 0.25;
      left.x = centerPosition - (width / 2);
      right.x = centerPosition + (width / 2);

      // TODO: Reuse box.
      const geo = this.geometry = new THREE.BoxBufferGeometry(width, height, 1, 1, 1, Math.ceil(length / 1.5) + 1);
      const positions = geo.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        // Add half length (which will always be 1 / 2) for the box geometry offset.
        // Converts box Z from [-0.5, 0.5] to [0, 1] providing a percent.
        const vertexPercent = positions[i + 2] + 0.5;
        supercurve.getPositionRelativeToTangent(
          startPercent + (vertexPercent * (endPercent - startPercent)),
          positions[i] < 0 ? left : right,
          modifiedVertexPos);

        positions[i] = modifiedVertexPos.x;
        positions[i + 1] += modifiedVertexPos.y + height / 2;
        positions[i + 2] = modifiedVertexPos.z;

        // log error if any position is not a number
        if (isNaN(positions[i]) || isNaN(positions[i + 1]) || isNaN(positions[i + 2])) {
          console.error('position is NaN', positions[i], positions[i + 1], positions[i + 2]);
        }
      }

      // Notes are higher in punch so lower a tad.
      let ceilingHeight = beatSystem.verticalPositions.middle + beatSystem.size / 2;
      if (beatSystem.data.gameMode === 'punch') { ceilingHeight -= 0.1; }

      this.el.getObject3D('mesh').geometry = this.geometry;
      this.el.getObject3D('mesh').position.y = isCeiling ? ceilingHeight : 0.1;
    };
  })(),

  returnToPool: function () {
    console.log('returning wall to pool, name ' + this.el.wallName);
    if (this.geometry) {
      setTimeout(() => {
        console.log('disposing geometry');
        this.geometry.dispose();
        this.geometry = null;
        this.el.getObject3D('mesh').geometry = null;
      }, 20);
    }
    if (this.isOnTheScene == true) {
      console.log('wall returning to pool, name ' + this.el.wallName);
      this.isOnTheScene = false;
      this.el.object3D.visible = false;
      this.el.removeAttribute('data-weapon-particles');
      this.el.removeAttribute('data-wall-active');
      this.el.removeAttribute('raycastable-game');
      this.isCeiling = false;
      this.isRaycastable = false;
    }
    this.el.sceneEl.components.pool__wall.returnEntity(this.el);
  }
});
