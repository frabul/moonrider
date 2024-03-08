
const sliceRatioBottom = 0.5;
const sliceRatioTop = 1;
const angleDotBottom = 0.75;
const angleDotTop = 0.97;
const distFromCenterBottom = 0.25;
const distFromCenterTop = 0.095;
const slashSpeedBottom = 5;
const slashSpeedTop = 15;

const ANGLE_DOT_MIN = 0.625; // ~50-degrees.

const State = {
    NotReaching: 0,
    Reaching: 1,
    InsideBox: 2,
    Hit: 3
}

export class BladePositionData {
    constructor() {
        this.handle = new THREE.Vector3();
        this.tip = new THREE.Vector3();
        this.time = 0;
    }
}

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
            this.bboxScaling = 1.2;
        } else {
            this.bladeTipExtension = 0.1;
            this.bladeHandleExtension = 0.1;
            this.bboxScaling = 1.02;
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
        //this.bladeTip = new THREE.Vector3();
        //this.bladeHandle = new THREE.Vector3();
        this.lastBladeData = null;
        this.currentBladeData = new BladePositionData();
        this.artificialBladeDataCache = []; // blade data create by interpolating lastBladeData and currentBladeData
        for (let i = 0; i < 5; i++) {
            this.artificialBladeDataCache.push(new BladePositionData());
        }
        this.bladeVector = new THREE.Vector3();
        this.bboxcenter = new THREE.Vector3();


        this.bladeLine = new THREE.Line3();
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
        // this function is called every frame

        if (this.lastBladeData == null) {
            // if this is first time then we can use bladeWorldPositions[2] and bladeWorldPositions[3] as last frame data 
            this.lastBladeData = new BladePositionData();
            this.lastBladeData.handle.copy(this.blade.bladeWorldPositions[3]);
            this.lastBladeData.tip.copy(this.blade.bladeWorldPositions[2]);
            this.lastBladeData.time = time - 1000 / 90; // assume 90 fps
            this.beat.el.object3D.worldToLocal(this.lastBladeData.handle);
            this.beat.el.object3D.worldToLocal(this.lastBladeData.tip);
        }

        // transform current blade data to beat space
        this.currentBladeData.tip.copy(this.blade.bladeWorldPositions[0]);
        this.currentBladeData.handle.copy(this.blade.bladeWorldPositions[1]);
        this.currentBladeData.time = time;
        this.beat.el.object3D.worldToLocal(this.currentBladeData.tip);
        this.beat.el.object3D.worldToLocal(this.currentBladeData.handle);

        // if last swing is 'big' then let's syntetize more frames
        const lastSwingDistance = this.lastBladeData.tip.distanceTo(this.currentBladeData.tip);
        let artificialsCount = 0;

        if (this.lastBladeData.tip.distanceTo(this.currentBladeData.tip) > 0.3 * (this.bbox.max.x - this.bbox.min.x)) {
            // let's create some artificial frames to increse precision
            artificialsCount = Math.floor(lastSwingDistance / (0.3 * (this.bbox.max.x - this.bbox.min.x)));
            artificialsCount = Math.min(artificialsCount, this.artificialBladeDataCache.length);
            for (let i = 0; i < artificialsCount; i++) {
                const artificialBladeData = this.artificialBladeDataCache[i];
                const interpRatio = (i + 1) / (artificialsCount + 1);  // if they are 2 then we gate 1/3 and 2/3
                artificialBladeData.time = this.lastBladeData.time + interpRatio * (this.currentBladeData.time - this.lastBladeData.time);
                artificialBladeData.tip.lerpVectors(this.lastBladeData.tip, this.currentBladeData.tip, interpRatio);
                artificialBladeData.handle.lerpVectors(this.lastBladeData.handle, this.currentBladeData.handle, interpRatio);
            }
        }

        // process the artificial frames
        for (let i = 0; i < artificialsCount; i++) {
            this.processBladePosition(this.artificialBladeDataCache[i]);
        }
        this.processBladePosition(this.currentBladeData);

        this.lastBladeData = this.currentBladeData;
        return this.isHitDetected();
    }
    isHitDetected() {
        return this.state == State.Hit;
    }
    processBladePosition(bladeData) {
        // call the appropriate handler for the current state 
        switch (this.state) {
            case State.NotReaching:
                this.handleStateNotReaching(bladeData);
                break;
            case State.Reaching:
                this.handleStateReaching(bladeData);
                break;
            case State.InsideBox:
                this.handleStateInsideBox(bladeData);
                break;
            case State.Hit:
                this.handleStateHit(bladeData);
                break;
        }
        this.lastTime = bladeData.time;
    }

    handleStateNotReaching(bladeData) {
        const time = bladeData.time;
        const bladeEntering = this.CheckBladeInside(bladeData);
        if (bladeEntering) {
            if (!this.isGood) {
                this.badHit("Bad target hit!");
                this.setState(State.Hit);
            } else if (this.goodHitIfDot()) { // if it is a dot then we register a good hit in any case 
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

    handleStateReaching(bladeData) {
        const time = bladeData.time;
        const bladeEntering = this.CheckBladeInside(bladeData);
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

    handleStateInsideBox(bladeData) {
        const time = bladeData.time;
        const bladeEntering = this.CheckBladeInside(bladeData);
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

    CheckBladeInside(bladeData) {

        const bladeTip = bladeData.tip;
        const bladeHandle = bladeData.handle;
        const beat = this.beat;

        // extend the blade length to make it easier to hit 
        this.bladeVector.subVectors(bladeTip, bladeHandle);
        bladeTip.addScaledVector(this.bladeVector, this.bladeTipExtension);
        bladeHandle.addScaledVector(this.bladeVector, -this.bladeHandleExtension);

        this.reaching = false;
        this.bladeInside = false;
        // transform to beat space 
        if (bladeTip.z > -this.hitPlane.constant) // if the blade tip is in front the beat then it is not touching for sure
            return this.bladeInside;

        if (bladeHandle.z < -this.hitPlane.constant) // if the blade handle  is not in front of the beat then it is not touching for sure
            return this.bladeInside;

        this.reaching = true;

        // find the point where the blade pointer intersects the plane 
        // if bbox contains intersection then the blade intered the box
        this.lastIntersection.copy(this.intersection);
        this.bladeLine.set(bladeTip, bladeHandle);
        if (this.hitPlane.intersectLine(this.bladeLine, this.intersection) && this.bbox.containsPoint(this.intersection)) {
            this.bladeInside = true;
            this.SetFurthestSlicePoint();
        }
        return this.bladeInside;
    }

    validateSlice() {
        const boxHeight = this.bbox.max.y - this.bbox.min.y;
        const boxWidth = this.bbox.max.x - this.bbox.min.x;
        //   we must still check correctness of the slash
        // assume that the required diretion is along x axis positive
        const direction = this.exitPoint.clone().sub(this.entryPoint);
        const slashSpeed = direction.length() / (this.exitTime - this.entryTime) * 1000;
        const sliceRatio = direction.x / (this.beat.bbox.max.x - this.beat.bbox.min.x); // how much of the (original) box was sliced

        // 100 points for successful hit
        const baseScore = 100;
        // check slice ratio
        // 80 points for slice ratio
        if (sliceRatio < 0.2) {
            this.badHit("Bad slice ratio!");
            return;
        }
        const sliceRatioScore = clampAndRemap(sliceRatio, sliceRatioBottom, sliceRatioTop, 0, 80);

        // 20 score on direction 
        direction.normalize();
        const angleDot = direction.dot(new THREE.Vector2(1, 0));
        if (angleDot < ANGLE_DOT_MIN) {
            this.badHit("Bad angle!");
            return;
        }
        const angleScore = clampAndRemap(angleDot, angleDotBottom, angleDotTop, 0, 20);

        // max 50 points for accuracy  
        const distFromCenter = distanceFromLine2D(this.bboxcenter, this.entryPoint, this.exitPoint) / boxHeight;
        const accuracyScore = clampAndRemap(distFromCenter, distFromCenterTop, distFromCenterBottom, 50, 0);

        // max 50 points for speed 
        const speedScore = clampAndRemap(slashSpeed, slashSpeedBottom, slashSpeedTop, 0, 50);

        // total score (max 300)
        const totalScore = baseScore + sliceRatioScore + speedScore + angleScore + accuracyScore;

        const cappedScore = Math.min(totalScore, 250); // max 250 points for a hit
        this.hitData = {
            good: true,
            score: round_3dec(cappedScore),
            percent: round_3dec(cappedScore / 250 * 100),
            sliceRatioScore: round_3dec(sliceRatioScore),
            accuracyScore: round_3dec(accuracyScore),
            speedScore: round_3dec(speedScore),
            angleScore: round_3dec(angleScore),

            sliceRatio: round_3dec(sliceRatio),
            distFromCenter: round_3dec(distFromCenter),
            slashSpeed: round_3dec(slashSpeed),
            angleDot: round_3dec(angleDot),
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
            this.hitData = { good: true, score: score, percent: percent };
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

function clampAndRemap(value, min, max, low, high) {
    return remap(clamp(value, min, max), min, max, low, high);
}