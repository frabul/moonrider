const speedMin = 5;
const speedMax = 25;
const ANGLE_DOT_MAX = 0; // ~15-degrees.
const ANGLE_DOT_MIN = 0.625; // ~50-degrees.
const DIST_FROM_CENTER_MAX = 0.5;
const DIST_FROM_CENTER_MIN = 0.05;
const minSliceRatio = 0.5;

const State = {
    NotReaching: 0,
    Reaching: 1,
    InsideBox: 2,
    Hit: 3
}

/// HitDetector is a class that checks if a blade hits ( or slices ) a beat
/// blade is a blade component, beat is beat component 
//// NB: assuming that the hit plane is alwas parallel to XY plane of the beat
export class BladeHitDetector {


    constructor(blade, beat, isGood, bladeTipExtension = 0.4, bladeHandleExtension = 0.1, bboxScaling = 1) {
        this.blade = blade;
        this.beat = beat;
        this.isGood = isGood;

        this.bladeTipExtension = bladeTipExtension;
        this.bladeHandleExtension = bladeHandleExtension;
        this.bboxScaling = bboxScaling;

        this.bbox = new THREE.Box2(
            beat.bbox.min.clone().multiplyScalar(this.bboxScaling),
            beat.bbox.max.clone().multiplyScalar(this.bboxScaling),
        );

        this.hitPlane = beat.hitPlane; // the plane for projecting blade pointer
        this.entryPoint = new THREE.Vector2(); // the point where the blade entered the beat
        this.exitPoint = new THREE.Vector2(); // the point where the blade exited the beat

        this.intersection = new THREE.Vector3(); // the intersection point of the blade with the plane of the beat
        this.lastIntersection = new THREE.Vector3(); // the intersection point of the blade with the plane of the beat
        // buffer variables
        this.bladeTip = new THREE.Vector3();
        this.bladeVector = new THREE.Vector3();  // it is tip - handle
        this.bladeHandle = new THREE.Vector3();
        this.bboxcenter = new THREE.Vector3();
        this.bladeLine = new THREE.Line3(this.bladeHandle, this.bladeTip);
        this.setState(State.NotReaching);
    }

    setState(state) {
        this.state = state;
    }

    IsHit(time) {
        // call the appropriate handler for the current state
        var ret = false
        switch (this.state) {
            case State.NotReaching:
                this.handleStateNotReaching();
                break;
            case State.Reaching:
                this.handleStateReaching(time);
                break;
            case State.InsideBox:
                this.handleStateInsideBox(time);
                break;
            case State.Hit:
                this.handleStateHit();
                break;
        }
        this.lastTime = time;
        return this.state == State.Hit;
        // todo check the case that the blade sliced the beat in one frame

    }

    handleStateNotReaching() {
        const bladeEntering = this.CheckBladeInside();
        if (bladeEntering) {
            if (this.goodHitIfDot()) {
                // bad hit in any case  except dot box because the blade intered by the tip
                this.badHit("Tip hit!");
            }
            this.setState(State.Hit);
            return true;
        } else if (this.reaching) {
            this.setState(State.Reaching);
        }
        return false;
    }

    handleStateReaching(time) {
        const bladeEntering = this.CheckBladeInside();
        if (bladeEntering) {
            // if this beat is not good then register hit as we just touch it
            if (!this.isGood) {
                this.badHit("Bad target hit!");
                this.setState(State.Hit);
                return true;
            } else {
                if (this.goodHitIfDot()) {
                    this.setState(State.Hit);
                    return true;
                }
                // the blade is entering! we require that the blade enters trough the left side of the box ( as the arrows points along X )
                // so fir calculate where the segment formed by  (intersection - lastIntersaction) and the left line of the bounding box wich is X = min.x
                if (this.lastIntersection.x < this.bbox.min.x && this.intersection.x > this.bbox.min.x) { // the tip is crossing left border
                    // impact x is left border...calculate y
                    const t = (this.bbox.min.x - this.lastIntersection.x) / (this.intersection.x - this.lastIntersection.x);
                    const y = this.lastIntersection.y + t * (this.intersection.y - this.lastIntersection.y);
                    // if y is inside the box then we are entering from right side
                    if (y < this.bbox.min.y && y > this.bbox.max.y) {
                        this.entryPoint.setState(this.bbox.min.x, y);
                        this.entryTime = (time + this.lastTime) / 2;
                        this.setState(State.InsideBox);
                        return true;
                    }
                }
                // we are not enterign right side
                this.badHit("Bad entry!");
                this.setState(State.Hit);
                return true;
            }
        } else if (!this.reaching) {
            this.setState(State.NotReaching);
        }
        return false;
    }

    handleStateInsideBox(time) {
        const bladeEntering = this.CheckBladeInside();
        // if the blde exited the we sliced at least a bit
        if (!bladeEntering) {
            // good hit, box was sliced ( for simplicity we assume as exit point the middle betwee last and current intersection)
            this.exitPoint.copy(this.intersection).add(this.lastIntersection).multiplyScalar(0.5);
            this.exitTime = (time + this.lastTime) / 2;
            this.validateSlice(); // verify the hit and calculate score
            this.setState(State.Hit);
            return true;
        }
        return false;
    }

    handleStateHit() {
        return true;
    }

    CheckBladeInside() {

        const bladeTip = this.bladeTip;
        const bladeHandle = this.bladeHandle;
        const beat = this.beat;

        bladeTip.copy(this.blade.bladeWorldPositions[0]);
        bladeHandle.copy(this.blade.bladeWorldPositions[1]);
        this.bladeVector.subVectors(bladeTip, bladeHandle);
        // extend the blade length to make it easier to hit 
        bladeTip.addScaledVector(this.bladeVector, this.bladeTipExtension);
        bladeHandle.addScaledVector(this.bladeVector, -this.bladeHandleExtension);

        this.reaching = false;
        this.bladeInside = false;
        // transform to beat space
        beat.el.object3D.worldToLocal(bladeTip);
        if (bladeTip.z > this.hitPlane.constant) // if the blade tip is in front the beat then it is not touching for sure
            return this.bladeInside;

        beat.el.object3D.worldToLocal(bladeHandle);
        if (bladeHandle.z < this.hitPlane.constant) // if the blade handle  is not in front of the beat then it is not touching for sure
            return this.bladeInside;

        this.reaching = true;

        // find the point where the blade pointer intersects the plane 
        this.lastIntersection.copy(this.intersection);
        this.hitPlane.intersectLine(this.bladeLine, this.intersection);

        // if bbox contains intersection then we have a hit
        if (this.bbox.containsPoint(this.intersection)) {
            this.bladeInside = true;
        }
        return this.bladeInside;
    }

    validateSlice() {
        //   we must still check correctness of the slash
        // assume that the required diretion is along x axis positive
        const direction = this.exitPoint.clone().sub(this.entryPoint);
        const slashSpeed = direction.length() / (this.exitTime - this.entryTime) * 1000;
        const sliceRatio = direction.x / (this.bbox.max.x - this.bbox.min.x);

        // check slice ratio
        if (sliceRatio < minSliceRatio) {
            this.badHit("Bad slice ratio!");
            return;
        }

        direction.normalize();
        const angleDot = direction.dot(new THREE.Vector2(1, 0));
        if (angleDot < ANGLE_DOT_MIN) {
            this.badHit("Bad angle!");
            return;
        }

        const boxHeight = this.bbox.max.y - this.bbox.min.y;
        const boxWidth = this.bbox.max.x - this.bbox.min.x;
        // get 50 points for hitting the box


        // max 50 points for accuracy
        const sliceLine = new THREE.Line3(this.entryPoint, this.exitPoint);
        const distFromCenter = sliceLine.closestPointToPoint(this.bboxcenter, false).distanceTo(this.bboxcenter) / boxWidth;
        let min = DIST_FROM_CENTER_MIN * boxHeight;
        let max = DIST_FROM_CENTER_MAX * boxHeight;
        var accuracyScore = remap(clamp(distFromCenter, min, max), min, max, 50, 0);

        // max 50 points for speed 
        var speedScore = remap(clamp(slashSpeed, speedMin, speedMax), speedMin, speedMax, 0, 50);

        // 50 score on direction.
        var angleScore = angleDot * 50;

        const score = 50 + speedScore + angleScore + accuracyScore;
        this.score = {
            good: true,
            score: score,
            percent: score / 200 * 100
        };
        console.log('Score: ' + score);
        return this.score;
    }
    badHit(reason) {
        this.hitData = { good: false };
        console.log(reason);
    }
    goodHitIfDot() {
        if (this.isGood && this.beat.isDot()) {
            this.hitData = { good: true, score: 200, percent: 100 };
            return true;
        }
        return false;
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
