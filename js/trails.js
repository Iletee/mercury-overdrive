// PS2-era contrails: flat ribbon trails with a hard additive fade — the
// SSX/Ace-Combat look, deliberately low-fi. One pooled BufferGeometry holds
// every ribbon; each is a ring buffer of recent positions extruded into a
// camera-ish-facing strip that tapers and fades toward the tail.

import * as THREE from 'three';

const TRAILS = 26;
const POINTS = 10;        // history samples per ribbon — short enough that
                          // the tail visibly ENDS instead of trailing off
const SAMPLE_DT = 0.032;  // seconds between samples — quantized, like the era
const VERTS_PER = POINTS * 2;

export class TrailSystem {
	constructor(scene) {
		const vertCount = TRAILS * VERTS_PER;
		this._positions = new Float32Array(vertCount * 3);
		this._colors = new Float32Array(vertCount * 3);

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(this._positions, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('color', new THREE.BufferAttribute(this._colors, 3).setUsage(THREE.DynamicDrawUsage));

		// two triangles per segment, per trail
		const idx = [];
		for (let t = 0; t < TRAILS; t++) {
			const base = t * VERTS_PER;
			for (let p = 0; p < POINTS - 1; p++) {
				const a = base + p * 2, b = a + 1, c = a + 2, d = a + 3;
				idx.push(a, b, c, b, d, c);
			}
		}
		geo.setIndex(idx);

		this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
			vertexColors: true, transparent: true, opacity: 0.35,
			blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
		}));
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 3;
		scene.add(this.mesh);

		this._pool = [];
		for (let i = 0; i < TRAILS; i++) {
			this._pool.push({
				slot: i, used: false,
				pts: new Float32Array(POINTS * 3),
				count: 0,        // valid samples so far
				sampleT: 0,
				color: new THREE.Color(),
				width: 3,
			});
		}
		this._v = new THREE.Vector3();
		this._side = new THREE.Vector3();
		this._seg = new THREE.Vector3();
		this._toCam = new THREE.Vector3();
	}

	acquire(colorHex, width = 3) {
		const t = this._pool.find((x) => !x.used);
		if (!t) return null;
		t.used = true;
		t.count = 0;
		t.sampleT = 0;
		t.color.setHex(colorHex);
		t.width = width;
		return t;
	}

	release(t) {
		if (!t) return;
		t.used = false;
		t.count = 0;
		// collapse the ribbon so it vanishes instead of freezing mid-air
		const base = t.slot * VERTS_PER * 3;
		this._positions.fill(0, base, base + VERTS_PER * 3);
		this._colors.fill(0, base, base + VERTS_PER * 3);
		this._dirty = true;
	}

	// feed the emitter's current position; samples are taken on a fixed
	// cadence so the ribbon has that chunky fixed-step PS2 read
	push(t, pos, dt) {
		if (!t || !t.used) return;
		t.sampleT -= dt;
		if (t.sampleT > 0 && t.count > 1) {
			// keep the head glued to the emitter between samples
			t.pts[0] = pos.x; t.pts[1] = pos.y; t.pts[2] = pos.z;
			return;
		}
		t.sampleT = SAMPLE_DT;
		// shift history back one slot
		t.pts.copyWithin(3, 0, (POINTS - 1) * 3);
		t.pts[0] = pos.x; t.pts[1] = pos.y; t.pts[2] = pos.z;
		t.count = Math.min(POINTS, t.count + 1);
	}

	update(camera) {
		const camPos = camera.position;
		for (const t of this._pool) {
			if (!t.used || t.count < 2) continue;
			const base = t.slot * VERTS_PER * 3;
			for (let p = 0; p < POINTS; p++) {
				const i3 = p * 3;
				const px = t.pts[i3], py = t.pts[i3 + 1], pz = t.pts[i3 + 2];
				const valid = p < t.count;
				// segment direction (toward the next older sample)
				const q3 = Math.min(p + 1, t.count - 1) * 3;
				this._seg.set(t.pts[q3] - px, t.pts[q3 + 1] - py, t.pts[q3 + 2] - pz);
				this._toCam.set(camPos.x - px, camPos.y - py, camPos.z - pz);
				this._side.crossVectors(this._seg, this._toCam);
				const len = this._side.length();
				if (len > 1e-4) this._side.multiplyScalar(1 / len);
				else this._side.set(1, 0, 0);
				const fade = valid ? (1 - p / (POINTS - 1)) : 0;
				const w = t.width * fade;
				const o = base + p * 6;
				this._positions[o] = px + this._side.x * w;
				this._positions[o + 1] = py + this._side.y * w;
				this._positions[o + 2] = pz + this._side.z * w;
				this._positions[o + 3] = px - this._side.x * w;
				this._positions[o + 4] = py - this._side.y * w;
				this._positions[o + 5] = pz - this._side.z * w;
				const cf = fade * fade; // hard falloff — the era's signature
				this._colors[o] = t.color.r * cf;
				this._colors[o + 1] = t.color.g * cf;
				this._colors[o + 2] = t.color.b * cf;
				this._colors[o + 3] = t.color.r * cf;
				this._colors[o + 4] = t.color.g * cf;
				this._colors[o + 5] = t.color.b * cf;
			}
			this._dirty = true;
		}
		if (this._dirty) {
			this.mesh.geometry.attributes.position.needsUpdate = true;
			this.mesh.geometry.attributes.color.needsUpdate = true;
			this._dirty = false;
		}
	}

	reset() {
		for (const t of this._pool) if (t.used) this.release(t);
	}
}
