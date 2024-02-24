const SUPER_SCORE_SPEED = 10;
const ANGLE_DOT_SUPER = 0.97; // ~15-degrees.
const ANGLE_DOT_MIN = 0.625; // ~50-degrees.
const DIST_FROM_CENTER_MAX = 0.5;
const DIST_FROM_CENTER_MIN = 0.05;


export class BladeHitDetector {
    /// HitDetector is a class that checks if a blade hits a beat
    /// blade is a blade component, beat is beat component 
    constructor(blade, beat, isGood) {
        this.blade = blade;
        this.beat = beat;
        this.isGood = isGood;
        this.reaching = [false, false]; // if the blade is reaching the plane of the beat in this frame and previous frame
        this.intersection = new THREE.Vector3(); // the intersection point of the blade with the plane of the beat
        this.bladeInside = false;
        this.HitDetected = false; // meaning that a bad hit or good slice is detected
        this.entryPoint = new THREE.Vector2(); // the point where the blade entered the beat
        this.exitPoint = new THREE.Vector2(); // the point where the blade exited the beat
        this.bbox = beat.bbox; // the bounding box of the beat
        // buffer variables
        this.bladeTip = new THREE.Vector3();
        this.bladeHandle = new THREE.Vector3();
    }

    IsHit(time) {
        if (this.HitDetected)
            return true;

        const bladeEntering = this.CheckBladeInside();
        if (!this.isGood && bladeEntering) {
            // if the beat is not good and the blade is inside then we don't need to check anything else
            // we can return early
            this.HitDetected = true;
            this.HitIsGood = false;
            return true;
        }

        if (!this.bladeInside) {
            if (bladeEntering) {
                if (!this.reaching[1]) {
                    // blade entered and reached the plane at the same time
                    // this is a bad hit since we touched it with the tip first ( not slash )
                    console.log('Hit by tip!');
                    this.HitDetected = true;
                    this.HitIsGood = false;
                } else {
                    // blade entered and was already reaching the plane
                    // this is a good hit since we touched it with the blade
                    console.log('Blade entered!');
                    this.entryPoint.copy(this.intersection);
                    this.bladeInside = true;
                    this.enteringTime = time;
                }
            }
        } else if (!bladeEntering) {
            if (this.reaching[0]) {
                // blade exited but still reaching the plane
                // this is a good slash since blade exited from other side 
                this.exitPoint.copy(this.intersection);
                console.log(this.entryPoint);
                console.log(this.exitPoint);

                this.HitDetected = true;
                // now we must check correctness of the slash
                // assume that the required diretion is along x axis positive
                const direction = this.exitPoint.clone().sub(this.entryPoint);
                const slashSpeed = direction.length() / (time - this.enteringTime) * 1000;
                direction.normalize();
                const angleDot = direction.dot(new THREE.Vector2(1, 0));
                if (angleDot > ANGLE_DOT_MIN) {
                    const middlePoint = this.entryPoint.clone().add(this.exitPoint).multiplyScalar(0.5);
                    const distFromCenter = middlePoint.sub(this.bbox.getCenter()).length();
                    this.score = this.CalcScore(slashSpeed, angleDot, distFromCenter);
                    this.HitIsGood = true;
                } else
                    this.HitIsGood = false;
                console.log('Slash detected! good: ' + this.HitIsGood);
            } else {
                // blade exited and not reaching the plane
                // this is a bad hit since we exited without cutting ( blade withdrawn )
                console.log('Bad hit!');
                this.HitDetected = true;
                this.HitIsGood = false;
            }
        }
        this.lastTime = time;
        return this.HitDetected;
        // todo check the case that the blade sliced the beat in one frame

    }

    CheckBladeInside() {
        const bladeTip = this.bladeTip;
        const bladeHandle = this.bladeHandle;
        const beat = this.beat;

        this.reaching[1] = this.reaching[0];
        this.reaching[0] = false;

        bladeTip.copy(this.blade.bladeWorldPositions[0]);
        bladeHandle.copy(this.blade.bladeWorldPositions[1]);
        // transform the blade tip and handle to this object space
        beat.el.object3D.worldToLocal(bladeTip);
        if (bladeTip.z > 0) // if the blade tip is in front the beat then it is not touching for sure
            return false;

        beat.el.object3D.worldToLocal(bladeHandle);
        if (bladeHandle.z < 0) // if the blade handle  is not in front of the beat then it is not touching for sure
            return false;

        this.reaching[0] = true;
        // find the point where the blade pointer intersects the plane 
        beat.hitPlane.intersectLine(new THREE.Line3(bladeHandle, bladeTip), this.intersection);

        // if bbox contains intersection then we have a hit
        if (this.bbox.containsPoint(this.intersection)) {
            return true;
        }
        return false;
    }


    CalcScore(slashSpeed, angleDot, distFromCenter) {
        // max 50 points for speed
        var speedScore = (slashSpeed / SUPER_SCORE_SPEED) * 30;

        if (slashSpeed <= SUPER_SCORE_SPEED) {
            speedScore = Math.min(speedScore, 30);
        } else {
            speedScore = remap(clamp(slashSpeed, 10, 25), 10, 25, 30, 50);
        }
        console.log('Speed score: ' + speedScore);

        // 50 score on direction.
        var angleScore = 0;
        if (this.beat.isDot()) {
            angleScore += 50;
        } else {
            angleScore += angleDot * 50;
        }
        console.log('Angle score: ' + angleScore);
        // 50 points for accuracy 
        let boxHeight = this.bbox.getSize().y;
        let min = DIST_FROM_CENTER_MIN * boxHeight;
        let max = DIST_FROM_CENTER_MAX * boxHeight;
        var accuracyScore = remap(clamp(distFromCenter, min, max), min, max, 50, 0);
        console.log('Accuracy score: ' + accuracyScore);
        const score = speedScore + angleScore + accuracyScore;
        this.score = {
            score: score,
            percent: score / 150
        };
        console.log('Score: ' + score);
        return this.score;
    }
    reset() {
        this.reaching = [false, false];
        this.bladeInside = false;
        this.HitDetected = false;
    }
}

export class PunchHitDetector {
    constructor(punch, beat, isGood) {
        this.punch = punch;
        this.beat = beat;
        this.isGood = isGood;
    }
    IsHit(time) {
        if (this.HitDetected)
            return true;

        var hitDetected = this.punch.checkCollision(this.beat);
        if (hitDetected) { 
            this.HitDetected = true;
            this.HitIsGood = true;
            // calc score 
            const base = 60; // Get 60% of the score just by hitting the beat.
            const SUPER_SCORE_SPEED = 1.5;
            const speed = this.punch.el.components.punch.speed;
            const speedScore = (speed / SUPER_SCORE_SPEED) * 40;

            let score;
            if (speed <= SUPER_SCORE_SPEED) {
                score = base + Math.min(speedScore, 40);
            } else {
                score = base + remap(clamp(speed, 1.5, 6), 1.5, 6, 40, 70);
            }

            const percent = score / (base + 70);
            this.score = { score: score, percent: percent };
        }
        return this.HitDetected;
    }
}

function remap(value, low1, high1, low2, high2) {
    return low2 + (high2 - low2) * (value - low1) / (high1 - low1);
}

function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
}
