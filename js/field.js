// The meteorite gauntlet: perpetually generated ahead of the ship, recycled
// behind it, but finite — a fixed seeded course ending at the finish gate.
// Rocks are InstancedMesh (3 shape variants, one draw call each) with a
// fresnel rim-glow injected into the standard material for the Tron look.

import * as THREE from 'three';
import { Colors, CONFIG } from './store.js';

function mulberry32(a) {
	return function () {
		a |= 0; a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function makeRockGeometry(seed, jag) {
	const geo = new THREE.IcosahedronGeometry(1, 1);
	const rng = mulberry32(seed);
	const pos = geo.attributes.position;
	// displace matching vertices consistently: hash by rounded position
	const seen = new Map();
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
		let m = seen.get(key);
		if (m === undefined) { m = 1 + (rng() - 0.45) * jag; seen.set(key, m); }
		v.multiplyScalar(m);
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	geo.computeVertexNormals();
	return geo;
}

const VARIANTS = 3;
const CAP_PER_VARIANT = 520;

export class AsteroidField {
	constructor(scene) {
		this.scene = scene;
		this.uniforms = { uBeat: { value: 0 } };

		this.meshes = [];
		this.freeSlots = [];
		for (let i = 0; i < VARIANTS; i++) {
			const geo = makeRockGeometry(CONFIG.seed * 13 + i * 101, 0.55 + i * 0.25);
			const mat = new THREE.MeshStandardMaterial({
				color: 0x171030, roughness: 0.9, metalness: 0.15, flatShading: true,
			});
			const rim = new THREE.Color(i === 1 ? Colors.pink : Colors.cyan).multiplyScalar(0.9);
			mat.onBeforeCompile = (shader) => {
				shader.uniforms.uBeat = this.uniforms.uBeat;
				shader.uniforms.uRim = { value: rim };
				shader.fragmentShader = shader.fragmentShader
					.replace('#include <emissivemap_fragment>', `
						#include <emissivemap_fragment>
						{
							vec3 rimViewDir = normalize(vViewPosition);
							float fres = pow(1.0 - clamp(dot(normalize(normal), rimViewDir), 0.0, 1.0), 2.6);
							totalEmissiveRadiance += uRim * fres * (0.5 + 1.1 * uBeat);
						}
					`);
				shader.fragmentShader = 'uniform float uBeat;\nuniform vec3 uRim;\n' + shader.fragmentShader;
			};
			const mesh = new THREE.InstancedMesh(geo, mat, CAP_PER_VARIANT);
			mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			mesh.frustumCulled = false;
			// park all instances at scale 0
			const zero = new THREE.Matrix4().makeScale(0, 0, 0);
			for (let s = 0; s < CAP_PER_VARIANT; s++) mesh.setMatrixAt(s, zero);
			mesh.instanceMatrix.needsUpdate = true;
			scene.add(mesh);
			this.meshes.push(mesh);
			this.freeSlots.push(Array.from({ length: CAP_PER_VARIANT }, (_, s) => s));
		}

		this.chunks = new Map(); // chunkIndex -> record[]
		this.records = new Set();

		this._m = new THREE.Matrix4();
		this._q = new THREE.Quaternion();
		this._s = new THREE.Vector3();
		this._v = new THREE.Vector3();
		this._n = new THREE.Vector3();

		this._buildGate();
	}

	_buildGate() {
		this.gate = new THREE.Group();
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(340, 16, 12, 64),
			new THREE.MeshBasicMaterial({ color: Colors.cyan })
		);
		const ring2 = new THREE.Mesh(
			new THREE.TorusGeometry(400, 5, 8, 64),
			new THREE.MeshBasicMaterial({ color: Colors.pink })
		);
		const halo = new THREE.Mesh(
			new THREE.CircleGeometry(340, 64),
			new THREE.MeshBasicMaterial({
				color: Colors.cyan, transparent: true, opacity: 0.1,
				blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
			})
		);
		this.gate.add(ring, ring2, halo);
		this.gate.position.set(0, 0, -CONFIG.courseLength - 200);
		this.scene.add(this.gate);
		this._gateRing = ring;
	}

	_spawnChunk(index) {
		const rng = mulberry32(CONFIG.seed ^ (index * 2654435761));
		const D = CONFIG.chunkDepth;
		const z0 = -index * D;
		const frac = Math.min(1, (index * D) / CONFIG.courseLength);
		if (frac >= 1) { this.chunks.set(index, []); return; } // clear space past the gate

		const records = [];
		const count = Math.round(13 + 27 * Math.sin(Math.min(1, frac * 1.15) * Math.PI * 0.5) * (0.75 + 0.5 * rng()));
		for (let i = 0; i < count; i++) {
			const roll = rng();
			let r;
			if (roll > 0.97) r = 220 + rng() * 340;        // rare giants inside the corridor
			else if (roll > 0.8) r = 60 + rng() * 90;      // mid rocks
			else r = 9 + rng() * 38;                        // shootable debris
			records.push(this._spawn(rng,
				(rng() * 2 - 1) * 1500,
				(rng() * 2 - 1) * 950,
				z0 - rng() * D, r));
		}
		// backdrop monoliths: kilometre-class, parked outside the flight corridor
		for (let i = 0; i < 2; i++) {
			const side = rng() > 0.5 ? 1 : -1;
			records.push(this._spawn(rng,
				side * (2400 + rng() * 2600),
				(rng() * 2 - 1) * 2200,
				z0 - rng() * D,
				500 + rng() * 900));
		}
		this.chunks.set(index, records.filter(Boolean));
	}

	_spawn(rng, x, y, z, r) {
		const variant = Math.floor(rng() * VARIANTS);
		const slot = this.freeSlots[variant].pop();
		if (slot === undefined) return null;
		const rec = {
			variant, slot, r,
			pos: new THREE.Vector3(x, y, z),
			quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.28, rng() * 6.28, rng() * 6.28)),
			axis: new THREE.Vector3().randomDirection(),
			spin: (rng() - 0.5) * (r > 200 ? 0.05 : 0.5),
			hp: r <= 45 ? 2 : Infinity,
			alive: true,
		};
		this.records.add(rec);
		return rec;
	}

	_despawn(rec) {
		if (!rec.alive) return;
		rec.alive = false;
		this.records.delete(rec);
		this._m.makeScale(0, 0, 0);
		this.meshes[rec.variant].setMatrixAt(rec.slot, this._m);
		this.freeSlots[rec.variant].push(rec.slot);
	}

	update(dt, shipZ) {
		const D = CONFIG.chunkDepth;
		const shipChunk = Math.max(0, Math.floor(-shipZ / D));

		for (let i = Math.max(0, shipChunk - 1); i <= shipChunk + CONFIG.chunksAhead; i++) {
			if (!this.chunks.has(i)) this._spawnChunk(i);
		}
		for (const [index, records] of this.chunks) {
			if (index < shipChunk - 1) {
				for (const rec of records) this._despawn(rec);
				this.chunks.delete(index);
			}
		}

		// tumble + write matrices
		for (const rec of this.records) {
			this._q.setFromAxisAngle(rec.axis, rec.spin * dt);
			rec.quat.premultiply(this._q);
			this._s.setScalar(rec.r);
			this._m.compose(rec.pos, rec.quat, this._s);
			this.meshes[rec.variant].setMatrixAt(rec.slot, this._m);
		}
		for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;

		this.uniforms.uBeat.value = Math.max(0, this.uniforms.uBeat.value - dt * 4);
		this.gate.rotation.z += dt * 0.4;
		this._gateRing.scale.setScalar(1 + this.uniforms.uBeat.value * 0.03);
	}

	// sphere vs field — used for ship collision. Returns {record, normal, depth} or null.
	collideSphere(center, radius) {
		for (const rec of this.records) {
			if (Math.abs(rec.pos.z - center.z) > rec.r + radius + 50) continue;
			const d = this._v.copy(center).sub(rec.pos).length();
			const hitDist = rec.r * 0.82 + radius; // rocks are jagged; forgive the silhouette a bit
			if (d < hitDist) {
				this._n.copy(center).sub(rec.pos).normalize();
				return { record: rec, normal: this._n, depth: hitDist - d };
			}
		}
		return null;
	}

	// segment vs field — used for bolts. Returns {record, point} or null.
	segmentHit(p0, p1, radius = 2) {
		const zMin = Math.min(p0.z, p1.z), zMax = Math.max(p0.z, p1.z);
		for (const rec of this.records) {
			if (rec.pos.z < zMin - rec.r || rec.pos.z > zMax + rec.r) continue;
			// closest point on segment to sphere centre
			const ax = p0.x, ay = p0.y, az = p0.z;
			const abx = p1.x - ax, aby = p1.y - ay, abz = p1.z - az;
			const abLen2 = abx * abx + aby * aby + abz * abz;
			let t = 0;
			if (abLen2 > 0) {
				t = ((rec.pos.x - ax) * abx + (rec.pos.y - ay) * aby + (rec.pos.z - az) * abz) / abLen2;
				t = Math.max(0, Math.min(1, t));
			}
			const cx = ax + abx * t - rec.pos.x;
			const cy = ay + aby * t - rec.pos.y;
			const cz = az + abz * t - rec.pos.z;
			const hitDist = rec.r * 0.82 + radius;
			if (cx * cx + cy * cy + cz * cz < hitDist * hitDist) {
				this._v.set(ax + abx * t, ay + aby * t, az + abz * t);
				return { record: rec, point: this._v };
			}
		}
		return null;
	}

	// returns true if the rock was destroyed (small rocks only)
	damage(rec, n = 1) {
		rec.hp -= n;
		if (rec.hp <= 0) {
			this._despawn(rec);
			for (const records of this.chunks.values()) {
				const i = records.indexOf(rec);
				if (i >= 0) { records.splice(i, 1); break; }
			}
			return true;
		}
		return false;
	}

	beatPulse(strength = 1) {
		this.uniforms.uBeat.value = strength;
	}

	reset() {
		for (const rec of [...this.records]) this._despawn(rec);
		this.chunks.clear();
	}
}
