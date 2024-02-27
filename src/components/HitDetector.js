const speedMin = 5;
const speedMax = 25;
const ANGLE_DOT_MAX = 0; // ~15-degrees.
const ANGLE_DOT_MIN = 0.625; // ~50-degrees.
const DIST_FROM_CENTER_MAX = 0.5;
const DIST_FROM_CENTER_MIN = 0.05;
const minSliceRatio = 0.3;

const State = {
    NotReaching: 0,
    Reaching: 1,
    InsideBox: 2,
    Hit: 3
}
import * as THREE from 'three';
/// HitDetector is a class that checks if a blade hits ( or slices ) a beat
/// blade is a blade component, beat is beat component 
//// NB: assuming that the hit plane is alwas parallel to XY plane of the beat
export class BladeHitDetector {
    constructor(blade, beat, isGoodTarget) {
        this.blade = blade;
        this.beat = beat;
        this.isGood = isGoodTarget;

        if (isGoodTarget) {
            // easier to hit if is good
            this.bladeTipExtension = 0.5;
            this.bladeHandleExtension = 0.25;
            this.bboxScaling = 1.3;
        } else {
            this.bladeTipExtension = 0.1;
            this.bladeHandleExtension = 0.1;
            this.bboxScaling = 1.05;
        }

        this.bbox = new THREE.Box2(
            beat.bbox.min.clone().multiplyScalar(this.bboxScaling),
            beat.bbox.max.clone().multiplyScalar(this.bboxScaling),
        );

        this.hitPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -beat.bbox.max.z);  // it is a vertical plane that sits just behind the beat ; // the plane for projecting blade pointer
        this.entryPoint = new THREE.Vector2(); // the point where the blade entered the beat
        this.exitPoint = new THREE.Vector2(); // the point where the blade exited the beat

        this.intersection = new THREE.Vector3(); // the intersection point of the blade with the plane of the beat
        this.lastIntersection = new THREE.Vector3(); // the intersection point of the blade with the plane of the beat
        this.maxSliceAdvancementPoint = new THREE.Vector2(-10000, 0); // the point where the slice reached the maximum completion


        // buffer variables 
        this.bladeTip = new THREE.Vector3();
        this.bladeVector = new THREE.Vector3();
        this.bladeHandle = new THREE.Vector3();
        this.bboxcenter = new THREE.Vector3();

        this.bladeLine = new THREE.Line3(this.bladeHandle, this.bladeTip);
        this.setState(State.NotReaching);
    }

    setState(state) {
        this.state = state;
    }
    SetFurthestSlicePoint() {
        if (this.lastIntersection.x > this.maxSliceAdvancementPoint.x) {
            this.maxSliceAdvancementPoint.copy(this.lastIntersection);
        }
    }
    IsHit(time) {
        // call the appropriate handler for the current state
        var ret = false
        switch (this.state) {
            case State.NotReaching:
                this.handleStateNotReaching(time);
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

    handleStateNotReaching(time) {
        const bladeEntering = this.CheckBladeInside();
        if (bladeEntering) {
            if (!this.isGood) {
                this.badHit("Bad target hit!");
                this.setState(State.Hit);
            } if (this.goodHitIfDot()) { // if it is a dot then we register a good hit in any case 
                this.setState(State.Hit);
            } else {
                // blade is entering the box 
                this.entryPoint.copy(this.intersection); // maybe is better to interpolate the position of the blade from previous frame?
                this.entryTime = this.lastTime && ((time + this.lastTime) / 2) || time;   
                this.setState(State.InsideBox);
            }
        } else if (this.reaching) {
            this.setState(State.Reaching);
        }
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
                    if (y > this.bbox.min.y && y < this.bbox.max.y) {
                        this.entryPoint.set(this.bbox.min.x, y);
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
            // good hit, box was sliced  
            // for simplicity we assume as exit point the middle betwee last and current intersection
            // or the max slice advancement point if it is further
            this.exitPoint.copy(this.intersection).add(this.lastIntersection).multiplyScalar(0.5);
            if (this.exitPoint.x < this.maxSliceAdvancementPoint.x)
                this.exitPoint.copy(this.maxSliceAdvancementPoint);

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
        if (bladeTip.z > -this.hitPlane.constant) // if the blade tip is in front the beat then it is not touching for sure
            return this.bladeInside;

        beat.el.object3D.worldToLocal(bladeHandle);
        if (bladeHandle.z < -this.hitPlane.constant) // if the blade handle  is not in front of the beat then it is not touching for sure
            return this.bladeInside;

        this.reaching = true;

        // find the point where the blade pointer intersects the plane 
        // if bbox contains intersection then the blade intered the box
        this.lastIntersection.copy(this.intersection);
        if (this.hitPlane.intersectLine(this.bladeLine, this.intersection) && this.bbox.containsPoint(this.intersection)) {
            this.bladeInside = true;
            this.SetFurthestSlicePoint();
        }
        return this.bladeInside;
    }

    validateSlice() {
        //   we must still check correctness of the slash
        // assume that the required diretion is along x axis positive
        const direction = this.exitPoint.clone().sub(this.entryPoint);
        const slashSpeed = direction.length() / (this.exitTime - this.entryTime) * 1000;
        const sliceRatio = direction.x / (this.beat.bbox.max.x - this.beat.bbox.min.x); // how much of the (original) box was sliced

        // check slice ratio
        if (sliceRatio < minSliceRatio) {
            this.badHit("Bad slice ratio!");
            return;
        }
        // get 50 points for hitting the box and another 50 for completely slicing it
        const sliceRatioScore = remap(clamp(sliceRatio, minSliceRatio, 1), minSliceRatio, 1, 50, 100);
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
        const distFromCenter = distanceFromLine2D(this.bboxcenter, this.entryPoint, this.exitPoint) / boxHeight;
        let min = DIST_FROM_CENTER_MIN * boxHeight;
        let max = DIST_FROM_CENTER_MAX * boxHeight;
        const accuracyScore = remap(clamp(distFromCenter, min, max), min, max, 50, 0);

        // max 50 points for speed 
        const speedScore = remap(clamp(slashSpeed, speedMin, speedMax), speedMin, speedMax, 0, 50);

        // 50 score on direction.
        const angleScore = angleDot * 50;

        const totalScore = sliceRatioScore + speedScore + angleScore + accuracyScore;

        this.hitData = {
            good: true,
            score: round_3dec(totalScore),
            percent: round_3dec(totalScore / 250 * 100),
            speedScore: round_3dec(speedScore),
            angleScore: round_3dec(angleScore),
            accuracyScore: round_3dec(accuracyScore),
            slashSpeed: round_3dec(slashSpeed),
            angleDot: round_3dec(angleDot),
            sliceRatio: round_3dec(sliceRatio),
        };
        this.beat.el.sceneEl.emit('setHitsDebug', this.hitData);

        return this.hitData;
    }

    badHit(reason) {
        this.hitData = { good: false, reason: reason };
        this.beat.el.sceneEl.emit('setHitsDebug', this.hitData);
    }

    goodHitIfDot() {
        if (this.isGood && this.beat.isDot()) {
            this.hitData = { good: true, score: 250, percent: 100 };
            this.beat.el.sceneEl.emit('setHitsDebug', this.hitData);
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

function distanceFromLine2D(p, linePoint1, linePoint2) {
    const numerator = Math.abs((linePoint2.x - linePoint1.x) * (linePoint1.y - p.y) - (linePoint2.y - linePoint1.y) * (linePoint1.x - p.x));
    const denominator = Math.sqrt(Math.pow(linePoint2.x - linePoint1.x, 2) + Math.pow(linePoint2.y - linePoint1.y, 2));
    return numerator / denominator;

}

function round_3dec(value) {
    return Math.round(value * 1000) / 1000;
}