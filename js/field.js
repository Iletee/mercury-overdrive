// The meteorite gauntlet: perpetually generated ahead of the ship, recycled
// behind it, but finite — a fixed seeded course ending at the finish gate.
// Rocks are InstancedMesh (3 shape variants, one draw call each) with a
// fresnel rim-glow injected into the standard material for the Tron look.

import * as THREE from 'three';
import { Colors, CONFIG } from './store.js';

function smoothstep(edge0, edge1, x) {
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

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
			// rocks wear desaturated steel-violet rims — saturated neon is
			// reserved for threats and interactables so enemies read instantly
			const ROCK_RIMS = [0x574a8f, 0x8f4a72, 0x4a5c8f];
			const rim = new THREE.Color(ROCK_RIMS[i]).multiplyScalar(0.85);
			mat.onBeforeCompile = (shader) => {
				shader.uniforms.uBeat = this.uniforms.uBeat;
				shader.uniforms.uRim = { value: rim };
				shader.fragmentShader = shader.fragmentShader
					.replace('#include <emissivemap_fragment>', `
						#include <emissivemap_fragment>
						{
							vec3 rimViewDir = normalize(vViewPosition);
							float fres = pow(1.0 - clamp(dot(normalize(normal), rimViewDir), 0.0, 1.0), 2.6);
							totalEmissiveRadiance += uRim * fres * (0.62 + 0.32 * uBeat);
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
		this.physics = null;     // attached by main; owns simulated rocks

		this._m = new THREE.Matrix4();
		this._q = new THREE.Quaternion();
		this._s = new THREE.Vector3();
		this._v = new THREE.Vector3();
		this._n = new THREE.Vector3();

		this._buildGate();
		this._buildRouteRings();
	}

	// Corridor clearance at course-distance p — narrows through squeeze zones
	corridorRadiusAt(p) {
		let r = CONFIG.corridorRadius;
		for (const s of CONFIG.squeezes) {
			const t = smoothstep(s.start, s.start + 900, p) * smoothstep(s.end, s.end - 900, p);
			r = Math.min(r, CONFIG.corridorRadius + (CONFIG.squeezeRadius - CONFIG.corridorRadius) * t);
		}
		return r;
	}

	_inSqueeze(p) {
		for (const s of CONFIG.squeezes) if (p > s.start && p < s.end) return true;
		return false;
	}

	// Route centerlines at course-distance p (p = -z, 0..courseLength).
	// One snaking corridor, splitting into two around each fork. When split,
	// index 0 is the right/pink branch, index 1 the left/cyan branch.
	routeCenters(p) {
		// the route snakes, but straightens out at the start and at the gate
		const amp = smoothstep(0, 3000, p) * smoothstep(CONFIG.courseLength, CONFIG.courseLength - 4000, p);
		const baseX = Math.sin(p * 0.00022) * 420 * amp;
		const baseY = Math.sin(p * 0.00035 + 1.3) * 300 * amp;
		let split = 0;
		for (const f of CONFIG.forks) {
			const t = smoothstep(f.start, f.start + CONFIG.forkBlend, p) *
				smoothstep(f.end, f.end - CONFIG.forkBlend, p);
			if (t > split) split = t;
		}
		if (split <= 0.02) return [{ x: baseX, y: baseY }];
		const off = CONFIG.forkSpread * split;
		return [
			{ x: baseX + off, y: baseY + 120 * split },
			{ x: baseX - off, y: baseY - 120 * split },
		];
	}

	_buildRouteRings() {
		// rings are collectible: grouped by course distance (a fork has two
		// rings at the same p — flying through either one counts)
		this.ringGroups = [];
		this._nextRingGroup = 0;
		const transforms = [];
		for (let p = 1200; p < CONFIG.courseLength - 800; p += CONFIG.routeRingSpacing) {
			const centers = this.routeCenters(p);
			const group = { p, rings: [] };
			centers.forEach((c, i) => {
				const split = centers.length > 1;
				const colorHex = split ? (i === 0 ? Colors.pink : Colors.cyan) : Colors.cyan;
				group.rings.push({ idx: transforms.length, x: c.x, y: c.y, colorHex, dim: !split });
				transforms.push({ x: c.x, y: c.y, z: -p, colorHex, dim: !split });
			});
			this.ringGroups.push(group);
		}
		const geo = new THREE.TorusGeometry(180, 3.5, 6, 40);
		this._ringMat = new THREE.MeshBasicMaterial({
			color: 0xffffff, transparent: true, opacity: 0.4,
			blending: THREE.AdditiveBlending, depthWrite: false,
		});
		const rings = new THREE.InstancedMesh(geo, this._ringMat, transforms.length);
		const m = new THREE.Matrix4();
		const col = new THREE.Color();
		transforms.forEach((t, i) => {
			m.makeTranslation(t.x, t.y, t.z);
			rings.setMatrixAt(i, m);
			col.setHex(t.colorHex);
			if (t.dim) col.multiplyScalar(0.55);
			rings.setColorAt(i, col);
		});
		rings.instanceColor.needsUpdate = true;
		rings.frustumCulled = false;
		this._ringMesh = rings;
		this._ringColor = new THREE.Color();
		this.scene.add(rings);
	}

	// Call once per frame with the ship's previous/current z and lateral
	// position. Returns {type:'hit', x, y, p} when the ship threads a ring,
	// {type:'miss'} when it sails past a ring group, else null.
	checkRings(prevZ, z, x, y) {
		const prevP = -prevZ, p = -z;
		let result = null;
		while (this._nextRingGroup < this.ringGroups.length &&
			this.ringGroups[this._nextRingGroup].p <= p) {
			const g = this.ringGroups[this._nextRingGroup];
			this._nextRingGroup += 1;
			if (g.p <= prevP) continue;
			let hit = null;
			for (const r of g.rings) {
				if (Math.hypot(x - r.x, y - r.y) <= 200) { hit = r; break; }
			}
			if (hit) {
				this._ringColor.setHex(0xffffff);
				this._ringMesh.setColorAt(hit.idx, this._ringColor);
				this._ringMesh.instanceColor.needsUpdate = true;
				result = { type: 'hit', x: hit.x, y: hit.y, p: g.p };
			} else {
				result = { type: 'miss' };
			}
		}
		return result;
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
		this._gateHalo = halo;
	}

	// The gate sits dark behind the Architect and lights when it falls.
	setGateLit(on) {
		this._gateRing.material.color.setHex(on ? Colors.white : Colors.cyan);
		this._gateHalo.material.opacity = on ? 0.35 : 0.1;
		this._gateHalo.material.color.setHex(on ? Colors.cyan : Colors.cyan);
	}

	_spawnChunk(index) {
		const rng = mulberry32(CONFIG.seed ^ (index * 2654435761));
		const D = CONFIG.chunkDepth;
		const z0 = -index * D;
		const frac = Math.min(1, (index * D) / CONFIG.courseLength);
		if (frac >= 1) { this.chunks.set(index, []); return; } // clear space past the gate
		// the boss arena is swept clean — dodging is about the Architect, not rocks
		if (index * D >= CONFIG.bossStartZ) { this.chunks.set(index, []); return; }

		const records = [];
		let count = Math.round(18 + 34 * Math.sin(Math.min(1, frac * 1.15) * Math.PI * 0.5) * (0.75 + 0.5 * rng()));
		if (this._inSqueeze(index * D + D / 2)) count = Math.round(count * 1.55); // squeeze = dense
		for (let i = 0; i < count; i++) {
			const roll = rng();
			let r;
			if (roll > 0.97) r = 220 + rng() * 340;        // rare giants inside the field
			else if (roll > 0.8) r = 60 + rng() * 90;      // mid rocks
			else r = 9 + rng() * 38;                        // shootable debris
			const z = z0 - rng() * D;
			let x = (rng() * 2 - 1) * 1700;
			let y = (rng() * 2 - 1) * 1050;
			// carve the flyable corridors: push rocks out of every route lane
			const centers = this.routeCenters(-z);
			const lane = this.corridorRadiusAt(-z);
			for (const c of centers) {
				const dx = x - c.x, dy = y - c.y;
				const d = Math.hypot(dx, dy);
				const clear = lane + r;
				if (d < clear) {
					const ang = d > 1 ? Math.atan2(dy, dx) : rng() * Math.PI * 2;
					const out = clear + 40 + rng() * 260;
					x = c.x + Math.cos(ang) * out;
					y = c.y + Math.sin(ang) * out;
				}
			}
			records.push(this._spawn(rng, x, y, z, r));
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
			hp: r <= 45 ? 2 : Math.ceil(r / 14), // everything dies with enough fire
			alive: true,
			simulated: false, // true while a physics body owns pos/quat
			vel: null,        // initial velocity hint for the physics adoption
		};
		this.records.add(rec);
		return rec;
	}

	_despawn(rec) {
		if (!rec.alive) return;
		rec.alive = false;
		this.records.delete(rec);
		if (this.physics) this.physics.removeFor(rec);
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

		// tumble + write matrices (physics-owned rocks get pos/quat from their
		// rigid body — see physics.js — so only scripted rocks integrate spin)
		for (const rec of this.records) {
			if (!rec.simulated) {
				this._q.setFromAxisAngle(rec.axis, rec.spin * dt);
				rec.quat.premultiply(this._q);
			}
			this._s.setScalar(rec.r);
			this._m.compose(rec.pos, rec.quat, this._s);
			this.meshes[rec.variant].setMatrixAt(rec.slot, this._m);
		}
		for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;

		this.uniforms.uBeat.value = Math.max(0, this.uniforms.uBeat.value - dt * 4);
		this.gate.rotation.z += dt * 0.4;
		this._gateRing.scale.setScalar(1 + this.uniforms.uBeat.value * 0.03);
		this._ringMat.opacity = 0.3 + this.uniforms.uBeat.value * 0.45;
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

	// returns true if the rock was destroyed. Big rocks calve into fragments.
	damage(rec, n = 1) {
		rec.hp -= n;
		if (rec.hp > 0) return false;

		let list = null;
		for (const records of this.chunks.values()) {
			const i = records.indexOf(rec);
			if (i >= 0) { list = records; records.splice(i, 1); break; }
		}
		this._despawn(rec);

		if (rec.r > 55 && list) {
			const rng = Math.random;
			// fragments carry their parent's momentum plus a radial burst —
			// a shattered rock is a hazard, not a disappearance
			const pv = this.physics ? this.physics.velocityOf(rec) : null;
			for (let i = 0; i < 3; i++) {
				const ox = (rng() * 2 - 1) * rec.r * 0.8;
				const oy = (rng() * 2 - 1) * rec.r * 0.8;
				const oz = (rng() * 2 - 1) * rec.r * 0.5;
				const child = this._spawn(rng,
					rec.pos.x + ox, rec.pos.y + oy, rec.pos.z + oz,
					rec.r * (0.3 + rng() * 0.15));
				if (child) {
					const burst = (55 + rng() * 65) / Math.max(1, Math.hypot(ox, oy, oz));
					child.vel = {
						x: (pv ? pv.x : 0) + ox * burst,
						y: (pv ? pv.y : 0) + oy * burst,
						z: (pv ? pv.z : 0) + oz * burst,
					};
					list.push(child);
				}
			}
		}
		return true;
	}

	beatPulse(strength = 1) {
		this.uniforms.uBeat.value = strength;
	}

	reset() {
		for (const rec of [...this.records]) this._despawn(rec);
		this.chunks.clear();
		// re-arm the rings: pointer back to the start, colors restored
		this._nextRingGroup = 0;
		for (const g of this.ringGroups) {
			for (const r of g.rings) {
				this._ringColor.setHex(r.colorHex);
				if (r.dim) this._ringColor.multiplyScalar(0.55);
				this._ringMesh.setColorAt(r.idx, this._ringColor);
			}
		}
		this._ringMesh.instanceColor.needsUpdate = true;
		this.setGateLit(false);
	}
}
