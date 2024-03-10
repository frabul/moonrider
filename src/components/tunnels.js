const MIN_TIME = 3000;
const MAX_TIME = 10000;
const SPAWN_DISTANCE = 20; // in seconds

/**
 * Tunnel management.
 */
AFRAME.registerComponent('tunnels', {
  dependencies: ['pool_tunnels'],

  schema: {
    isPlaying: { default: false }
  },

  init: function () {
    this.addTunnel = this.addTunnel.bind(this);
    this.clearTunnels = this.clearTunnels.bind(this);
    this.timeout = 0;
    this.tunnels = [];

    this.tick = AFRAME.utils.throttleTick(this.tick.bind(this), 1000);

    this.el.addEventListener('cleargame', this.clearTunnels);
    this.el.addEventListener('gamemenuexit', this.clearTunnels);
    this.el.addEventListener('gamemenurestart', this.clearTunnels);
  },

  update: function (oldData) {
    if (!oldData.isPlaying && this.data.isPlaying) {
      this.beatGenerator = this.el.sceneEl.components['beat-generator'];
      this.requestTunnel();
    }
    if (oldData.isPlaying && !this.data.isPlaying && this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  },

  play: function () {
    this.pool = this.el.components.pool__tunnels;
  },

  requestTunnel: function () {
    this.timeout = setTimeout(
      this.addTunnel,
      Math.floor(MIN_TIME + Math.random() * MAX_TIME));
  },

  addTunnel: function () {
    const tunnel = this.pool.requestEntity();
    if (!tunnel) { return; }

    if (!this.templateGeometry) {
      const templateEl = document.getElementById('tunnelObjTemplate');
      if (templateEl && templateEl.getObject3D('mesh'))
        this.templateGeometry = templateEl.getObject3D('mesh').children[0].geometry;
    }
    if (!this.templateGeometry) { return; }
    if (!tunnel.getObject3D('mesh')) { tunnel.setObject3D('mesh', new THREE.Mesh()); }
    tunnel.getObject3D('mesh').geometry = this.templateGeometry;
    tunnel.setAttribute('render-order', 'tunnel');
    tunnel.object3D.visible = true;


    let mapPosition = this.beatGenerator.getCurrentMapProgress() + this.beatGenerator.mapTimeToMapProgress(SPAWN_DISTANCE);
    tunnel.mapPosition = mapPosition;
    if (mapPosition > 1) { mapPosition = 1; }
    this.beatGenerator.supercurve.getPointAt(mapPosition, tunnel.object3D.position);
    this.beatGenerator.supercurve.alignToCurve(mapPosition, tunnel.object3D);
    console.log('adding tunnel at ' + mapPosition);
    tunnel.play();
    this.tunnels.push(tunnel);
    this.requestTunnel();
  },

  clearTunnels: function () {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    for (let i = 0; i < this.tunnels.length; i++) {
      this.tunnels[i].object3D.visible = false;
      this.pool.returnEntity(this.tunnels[i]);
      console.log('returning tunnel');
    }
    this.tunnels.length = 0;
  },

  tick: function (time, delta) {
    if (this.tunnels.length == 0) { return; }

    const mapPosition = this.beatGenerator.getCurrentMapProgress();
    // Remove tunnels that went behind the player.
    for (let i = 0; i < this.tunnels.length; i++) {
      if (mapPosition * 1.01 > this.tunnels[i].mapPosition) {
        console.log('returning tunnel');
        const tunnel = this.tunnels.splice(i, 1)[0];
        tunnel.object3D.visible = false;
        this.pool.returnEntity(tunnel);
      } else {
        // They're z-ordered, the rest of tunnels are in front of the player.
        return;
      }
    }
  }
});
