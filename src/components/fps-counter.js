const { timingSafeEqual } = require("crypto");

AFRAME.registerComponent('fps-counter', {
    schema: {
        interval: { default: 250 },
        enabled: { default: true }
    },

    init: function () {
        this.fps = 90;
        this.decay = 1 / this.data.interval;
        this.lastTimeSet = 0;
        this.updatePeriod = 250;
        this.data.enabled = AFRAME.utils.getUrlParameter('fps') !== ''  ;
    },

    tick: function (time, dt) {
        if (!this.data.enabled) {
            this.el.setAttribute('text', { "value": '' });
            return;
        }
        if (dt > 0) {

            const instantFps = 1000 / dt;
            this.fps = this.fps + (instantFps - this.fps) * this.decay;
        }
        // apply exponential moving average to instant FPS
        this.frames++;
        if (time - this.lastTimeSet > this.updatePeriod) {
            this.lastTimeSet = time;
            this.el.setAttribute('text', { "value": `FPS: ${this.fps.toFixed(2)}` });

        }
    }
});
