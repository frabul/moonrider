import { BladeHitDetector, PunchHitDetector } from './HitDetector.js';
import { PUNCH_OFFSET, SWORD_OFFSET } from './beat-generator';

// Play sound and explode at reach to test sync.
const SYNC_TEST = !!AFRAME.utils.getUrlParameter('synctest');



const WEAPON_COLORS = { right: 'blue', left: 'red' };

const CLASSIC = 'classic';
const PUNCH = 'punch';
const RIDE = 'ride';

const SIZES = {
    [CLASSIC]: 0.48,
    [PUNCH]: 0.35,
    [RIDE]: 0.4
};

AFRAME.registerComponent('beat-system', {
    schema: {
        gameMode: { default: 'classic', oneOf: ['classic', 'punch', 'ride'] },
        hasVR: { default: false },
        inVR: { default: false },
        isLoading: { default: false },
        isPlaying: { default: false }
    },

    init: function () {
        this.beats = [];
        this.beatsToCheck = [];
        this.blades = [];
        this.fists = [];
        this.weapons = null;
        this.superCutIdx = 0;
        this.superCuts = document.querySelectorAll('.superCutFx');
        this.bladeEls = this.el.sceneEl.querySelectorAll('a-entity[blade]');
        this.curveFollowRig = document.getElementById('curveFollowRig');
        this.punchEls = this.el.sceneEl.querySelectorAll('a-entity[punch]');
        this.curveEl = document.getElementById('curve');
        this.size = SIZES[this.data.gameMode];
        this.supercurveFollow = null;
        this.beatEventsQueue = [];
    },

    play: function () {
        for (let i = 0; i < 2; i++) {
            this.blades.push(this.bladeEls[i].components.blade);
            this.fists.push(this.punchEls[i].components.punch);
        }

        this.supercurve = this.curveEl.components.supercurve;
        this.supercurveFollow = this.curveFollowRig.components['supercurve-follow'];
    },

    update: function (oldData) {
        this.size = SIZES[this.data.gameMode];

        if (oldData.isLoading && !this.data.isLoading) {
            this.updateBeatPositioning();
            this.weaponOffset = this.data.gameMode === CLASSIC ? SWORD_OFFSET : PUNCH_OFFSET;
            this.weaponOffset = this.weaponOffset * 1.5 / this.supercurve.curve.getLength();
        }

        if (oldData.gameMode !== this.data.gameMode) {
            this.weapons = this.data.gameMode === CLASSIC ? this.blades : this.fists;
        }
    },

    tick: function (t, dt) {
        // emit beat hits events
        // Delay these events into next frame to spread out the workload.
        if (this.beatEventsQueue.length > 0) {
            const evData = this.beatEventsQueue.shift();
            if (evData.good) {
                this.el.sceneEl.emit('beathit', evData, true);
            } else
                this.el.sceneEl.emit('beatwrong', evData, true);
        }
        // check for collisions
        if (!this.data.isPlaying || this.data.gameMode === RIDE) { return; }

        const beatsToCheck = this.beatsToCheck;
        const curve = this.supercurve.curve;
        const progress = this.supercurveFollow.songProgress;

        // Filter for beats that should be checked for collisions.
        beatsToCheck.length = 0;
        for (let i = 0; i < this.beats.length; i++) {
            const beat = this.beats[i];

            // Check if past the camera to return to pool.
            const returnDistance = beat.isMine() ? 0.25 : 1.25;
            if ((beat.el.object3D.position.z - returnDistance) > this.curveFollowRig.object3D.position.z) {
                beat.returnToPool();
                if (!beat.isMine())
                    this.el.sceneEl.emit('beatmiss', null, true);
                continue;
            }

            // Check beat is not already destroyed.
            if (beat.destroyed) { continue; }

            // Check if beat is close enough to be hit.
            const beatProgress = beat.songPosition - this.weaponOffset;
            if (progress < beatProgress) { continue; }


            // Check if beat should be filtered out due to not being in front.
            let inFront = true;
            for (let i = 0; i < beatsToCheck.length; i++) {
                if (beat.horizontalPosition === beatsToCheck[i].horizontalPosition &&
                    beat.verticalPosition === beatsToCheck[i].verticalPosition &&
                    beat.songPosition > beatsToCheck[i].songPosition) {
                    inFront = false;
                }
                if (!inFront) { break; }
            }
            if (inFront) {
                beatsToCheck.push(beat);
            }

        }

        // Update bounding boxes and velocities.
        this.weapons[0].tickBeatSystem(t, dt);
        this.weapons[1].tickBeatSystem(t, dt);

        // No beats to check means to collision to check.
        if (!beatsToCheck.length) { return; }

        // Check hits.
        for (let i = 0; i < beatsToCheck.length; i++) {
            // If ?synctest=true, auto-explode beat and play sound to easily test sync.
            if ((SYNC_TEST || !this.data.hasVR) && !beatsToCheck[i].isMine()) { // if (false) { //
                beatsToCheck[i].destroyBeat(this.weapons[0].el, Math.random() < 0.9);
                beatsToCheck[i].el.parentNode.components['beat-hit-sound'].playSound(beatsToCheck[i].el, beatsToCheck[i].cutDirection);

            } else {
                for (let j = 0; j < beatsToCheck[i].hitDetectors.length; j++) {
                    const hitDetector = beatsToCheck[i].hitDetectors[j];
                    if (hitDetector.IsHit(t)) {
                        this.processBeatHit(beatsToCheck[i], hitDetector)
                        break;
                    }
                }
            }
        }


    },

    processBeatHit: function (beat, hitDetector) {
        const data = beat.data;
        const weaponEl = hitDetector.blade.el;
        // if mine
        if (beat.isMine()) {
            beat.destroyBeat(weaponEl, false);
            this.el.sceneEl.emit('minehit', null, true);
            return;
        }
        const scoreData = hitDetector.hitData;
        // if it is a note
        if (scoreData.good) {
            // Haptics only for good hits.
            try {
                weaponEl.components.haptics__beat.pulse();
            } catch (err) {
                console.log(err);
            }

            beat.el.parentNode.components['beat-hit-sound'].playSound(beat.el, beat.cutDirection);
         

            // Super FX.
            if (scoreData.percent >= 98) {
                this.superCuts[this.superCutIdx].components.supercutfx.createSuperCut(
                    beat.el.object3D, beat.data.color);
                this.superCutIdx = (this.superCutIdx + 1) % this.superCuts.length;
            }

            this.beatEventsQueue.push(scoreData);
        } else {
            this.beatEventsQueue.push(scoreData);
            beat.wrongHit();
        }
        beat.destroyBeat(weaponEl, scoreData.good);
    },



    horizontalPositions: {},

    verticalPositions: {},

    /**
     * Update positioning between blocks, vertically and horizontally depending on
     * game mode, and the height of the user.
     *
     * Adjustment revolves primary around SIZES, and the hMargin multiply factor.
     */
    updateBeatPositioning: (function () {
        // Have punches be higher.
        const BOTTOM_HEIGHTS = {
            [CLASSIC]: 0.95,
            [RIDE]: 0.95,
            [PUNCH]: 1.20
        };

        const BOTTOM_HEIGHT_MIN = 0.4;
        const REFERENCE_HEIGHT = 1.6;

        return function () {
            const gameMode = this.data.gameMode;
            const horizontalPositions = this.horizontalPositions;
            const verticalPositions = this.verticalPositions;

            const heightOffset = this.el.sceneEl.camera.el.object3D.position.y - REFERENCE_HEIGHT;
            const size = SIZES[gameMode];

            // Horizontal margin based on size of blocks so they don't overlap, which a smidge
            // of extra margin.
            // For punch mode, we want a wider horizontal spread in punch range, but not vertical.
            const hMargin = gameMode === CLASSIC ? size : size * 1.2;
            horizontalPositions.left = -1.5 * hMargin;
            horizontalPositions.middleleft = -0.5 * hMargin;
            horizontalPositions.middle = hMargin;
            horizontalPositions.middleright = 0.5 * hMargin;
            horizontalPositions.right = 1.5 * hMargin;

            // Vertical margin based on size of blocks so they don't overlap.
            // And then overall shifted up and down based on user height (camera Y).
            // But not too low to go underneath the ground.
            const bottomHeight = BOTTOM_HEIGHTS[gameMode];
            const vMargin = size;
            verticalPositions.bottom = Math.max(
                BOTTOM_HEIGHT_MIN,
                bottomHeight + heightOffset);
            verticalPositions.middle = Math.max(
                BOTTOM_HEIGHT_MIN + vMargin,
                bottomHeight + vMargin + heightOffset);
            verticalPositions.top = Math.max(
                BOTTOM_HEIGHT_MIN + vMargin * 2,
                bottomHeight + (vMargin * 2) + heightOffset);
        };
    })(),

    registerBeat: function (beatComponent) {
        beatComponent.hitDetectors = this.weapons.map(weapon => {
            if (beatComponent.data.type === 'mine')
                var isWeaponCorrect = false;
            else
                var isWeaponCorrect = WEAPON_COLORS[weapon.el.dataset.hand] === beatComponent.data.color;
            // if weaopo is a blade
            if (this.data.gameMode === CLASSIC)
                return new BladeHitDetector(weapon, beatComponent, isWeaponCorrect);
            else
                return new PunchHitDetector(weapon, beatComponent, isWeaponCorrect);
        });
        this.beats.push(beatComponent);
    },

    unregisterBeat: function (beatComponent) {
        this.beats.splice(this.beats.indexOf(beatComponent), 1);
    }
});
