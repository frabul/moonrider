/**
 * Blade, swing, strokes.
 */
AFRAME.registerComponent('blade', {
  schema: {
    enabled: {default: false}
  },

  init: function () {
    const el = this.el;
    const data = this.data;

    this.bladeHandle = el.querySelector('.bladeHandleHelper').object3D;
    this.bladeTip = el.querySelector('.bladeTipHelper').object3D;  
  
    this.bladeWorldPositions = [
      new THREE.Vector3(), // Current frame tip.
      new THREE.Vector3(), // Current frame handle.
      new THREE.Vector3(), // Last frame tip.
      new THREE.Vector3(), // Last frame handle.
    ];

    this.bladeEl = this.el.querySelector('.blade');
  },

  update: function (oldData) {
    if (!oldData.enabled && this.data.enabled) {
      this.bladeEl.emit('drawblade');
    }
  },

  tickBeatSystem: function (time, delta) {
    if (!this.data.enabled) { return; }
    this.updateVelocity(delta);
  },

  updateVelocity: function (delta) { 
    const bladeWorldPositions = this.bladeWorldPositions;
    
    /*
    if (this.el.closest('#rightHand')) {
      this.createDebugCube(this.bladeHandle.getWorldPosition(new THREE.Vector3()), 0xFF0000)
      this.createDebugCube(this.blade.getWorldPosition(new THREE.Vector3()), 0x00FF00)
    }
    */

    // Previous frame.
    bladeWorldPositions[2].copy(bladeWorldPositions[0]);
    bladeWorldPositions[3].copy(bladeWorldPositions[1]);

    // Current frame.
    this.bladeTip.getWorldPosition(bladeWorldPositions[0]);
    this.bladeHandle.getWorldPosition(bladeWorldPositions[1]);
    
  },


  createDebugCube: function (v, color) {
    const geo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color: color, side: THREE.DoubleSide}));
    mesh.position.copy(v);
    this.el.sceneEl.object3D.add(mesh);
  }
});
