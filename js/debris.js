// Micrometeors that whip past the ship's hull at close range. Pure set
// dressing — no collisions, no gameplay weight — just speed sensation:
// a tube of tumbling rock and glowing shards recycled around the ship
// as it flies toward -Z.
import * as THREE from 'three';

const ROCK_COUNT = 200;
const SHARD_COUNT = 44;
const RADIAL_MIN = 45;
const RADIAL_MAX = 330;
const Z_BEHIND = 150;    // spawn window trailing the ship
const Z_AHEAD = 1500;    // spawn window leading the ship
const RESPAWN_BEHIND = 180;   // recycle once this far behind the ship
const RESPAWN_AHEAD_MIN = 1200;
const RESPAWN_AHEAD_SPREAD = 400;
const LATERAL_LIMIT = 600;   // recycle if the ship steers away this far
const DRIFT_SPEED = 25;    // +/- u/s per axis
const SPIN_MIN = 1;
const SPIN_MAX = 4;
const GLOW_BASE_OPACITY = 0.55;
const GLOW_PULSE_OPACITY = 1.0;
const GLOW_PULSE_DECAY = 0.3;    // seconds to decay a beat pulse

function randRange(lo, hi) {
	return lo + Math.random() * (hi - lo);
}

// Scatter a fresh position in the tube around (cx, cy) at the given z.
function scatterRadial(out, cx, cy, z) {
	const r = randRange(RADIAL_MIN, RADIAL_MAX);
	const a = Math.random() * Math.PI * 2;
	out.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
}

export class MicroDebris {
	constructor(scene) {
		// --- micro-rocks -------------------------------------------------
		const rockGeo = new THREE.TetrahedronGeometry(1, 0);
		const rockMat = new THREE.MeshStandardMaterial({
			color: 0x1a1232,
			flatShading: true,
			roughness: 0.9,
		});
		this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
		this.rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.rocks.frustumCulled = false;

		// --- glow shards --------------------------------------------------
		const shardGeo = new THREE.OctahedronGeometry(1, 0);
		this.shardMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: GLOW_BASE_OPACITY,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		this.shards = new THREE.InstancedMesh(shardGeo, this.shardMat, SHARD_COUNT);
		this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.shards.frustumCulled = false;

		scene.add(this.rocks);
		scene.add(this.shards);

		const total = ROCK_COUNT + SHARD_COUNT;
		// Per-item state, flat typed arrays shared across both groups. Index
		// layout: [0, ROCK_COUNT) are rocks, [ROCK_COUNT, total) are shards.
		this.posX = new Float32Array(total);
		this.posY = new Float32Array(total);
		this.posZ = new Float32Array(total);
		this.velX = new Float32Array(total);
		this.velY = new Float32Array(total);
		this.velZ = new Float32Array(total);
		this.scale = new Float32Array(total);
		this.spin = new Float32Array(total);
		this.axisX = new Float32Array(total);
		this.axisY = new Float32Array(total);
		this.axisZ = new Float32Array(total);
		this.quats = new Array(total);

		// Preallocated scratch objects — zero allocation in update().
		this._scratchV = new THREE.Vector3();
		this._scratchM = new THREE.Matrix4();
		this._scratchScale = new THREE.Vector3();
		this._spinQ = new THREE.Quaternion();
		this._spinAxis = new THREE.Vector3();
		const scratchColor = new THREE.Color(); // constructor-only, not touched by update()

		for (let i = 0; i < total; i++) {
			const isRock = i < ROCK_COUNT;
			scatterRadial(this._scratchV, 0, 0, randRange(-Z_AHEAD, Z_BEHIND));
			this.posX[i] = this._scratchV.x;
			this.posY[i] = this._scratchV.y;
			this.posZ[i] = this._scratchV.z;
			this.velX[i] = randRange(-DRIFT_SPEED, DRIFT_SPEED);
			this.velY[i] = randRange(-DRIFT_SPEED, DRIFT_SPEED);
			this.velZ[i] = randRange(-DRIFT_SPEED, DRIFT_SPEED);
			this.scale[i] = isRock ? randRange(0.7, 2.6) : randRange(0.4, 1.3);
			this.spin[i] = randRange(SPIN_MIN, SPIN_MAX) * (Math.random() < 0.5 ? -1 : 1);
			this._spinAxis.set(randRange(-1, 1), randRange(-1, 1), randRange(-1, 1)).normalize();
			this.axisX[i] = this._spinAxis.x;
			this.axisY[i] = this._spinAxis.y;
			this.axisZ[i] = this._spinAxis.z;
			this.quats[i] = new THREE.Quaternion().random();

			if (!isRock) {
				const shardIdx = i - ROCK_COUNT;
				scratchColor.set(Math.random() < 0.25 ? 0xff3864 : 0x2de2e6);
				this.shards.setColorAt(shardIdx, scratchColor);
			}
		}
		if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;

		this._pulse = 0; // decaying beat-pulse brightness, 0..1
	}

	beatPulse(strength = 1) {
		this._pulse = Math.min(1, Math.max(this._pulse, strength));
	}

	update(dt, shipPosition, speed) {
		const total = ROCK_COUNT + SHARD_COUNT;
		const sx = shipPosition.x;
		const sy = shipPosition.y;
		const sz = shipPosition.z;

		for (let i = 0; i < total; i++) {
			// Integrate drift.
			this.posX[i] += this.velX[i] * dt;
			this.posY[i] += this.velY[i] * dt;
			this.posZ[i] += this.velZ[i] * dt;

			// Recycle: fallen behind, or drifted too far laterally.
			const dx = this.posX[i] - sx;
			const dy = this.posY[i] - sy;
			const lateral = Math.sqrt(dx * dx + dy * dy);
			if (this.posZ[i] > sz + RESPAWN_BEHIND || lateral > LATERAL_LIMIT) {
				scatterRadial(this._scratchV, sx, sy, sz - RESPAWN_AHEAD_MIN - Math.random() * RESPAWN_AHEAD_SPREAD);
				this.posX[i] = this._scratchV.x;
				this.posY[i] = this._scratchV.y;
				this.posZ[i] = this._scratchV.z;
			}

			// Tumble: advance the per-item quaternion by spin * dt around its axis.
			this._spinAxis.set(this.axisX[i], this.axisY[i], this.axisZ[i]);
			this._spinQ.setFromAxisAngle(this._spinAxis, this.spin[i] * dt);
			this.quats[i].multiply(this._spinQ);

			// Compose matrix.
			this._scratchV.set(this.posX[i], this.posY[i], this.posZ[i]);
			const s = this.scale[i];
			this._scratchScale.set(s, s, s);
			this._scratchM.compose(this._scratchV, this.quats[i], this._scratchScale);

			if (i < ROCK_COUNT) {
				this.rocks.setMatrixAt(i, this._scratchM);
			} else {
				this.shards.setMatrixAt(i - ROCK_COUNT, this._scratchM);
			}
		}

		this.rocks.instanceMatrix.needsUpdate = true;
		this.shards.instanceMatrix.needsUpdate = true;

		// Decay the beat pulse and drive glow shard opacity from it.
		this._pulse = Math.max(0, this._pulse - dt / GLOW_PULSE_DECAY);
		this.shardMat.opacity = GLOW_BASE_OPACITY + this._pulse * (GLOW_PULSE_OPACITY - GLOW_BASE_OPACITY);

		// `speed` intentionally left unused beyond sensation cues above —
		// drift/tumble rates are constant so the whip-past feel scales
		// naturally with how fast the ship itself is closing the distance.
		void speed;
	}
}
