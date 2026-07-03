// Bolts + aiming. Player fire converges on the crosshair ray (what you point
// at is what you hit), with a magnetic lock reticle: track an enemy near the
// crosshair, and when fully locked, bolts home in Starfox-style.

import * as THREE from 'three';
import { Colors, CONFIG } from './store.js';

const PLAYER_CAP = 48;
const ENEMY_CAP = 64;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function makeBoltMesh(colorHex, cap, len, rad) {
	const geo = new THREE.CylinderGeometry(rad * 0.45, rad, len, 6, 1, true);
	geo.rotateX(Math.PI / 2); // align along +Z so a unit-vector quat orients it
	const mat = new THREE.MeshBasicMaterial({
		color: colorHex, transparent: true, opacity: 0.95,
		blending: THREE.AdditiveBlending, depthWrite: false,
	});
	const mesh = new THREE.InstancedMesh(geo, mat, cap);
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	mesh.frustumCulled = false;
	return mesh;
}

class BoltPool {
	constructor(scene, colorHex, cap, len, rad) {
		this.mesh = makeBoltMesh(colorHex, cap, len, rad);
		scene.add(this.mesh);
		this.cap = cap;
		this.bolts = Array.from({ length: cap }, (_, slot) => ({
			slot, active: false,
			pos: new THREE.Vector3(), prev: new THREE.Vector3(),
			dir: new THREE.Vector3(), dist: 0, target: null,
		}));
		this._m = new THREE.Matrix4();
		this._q = new THREE.Quaternion();
		this._s = new THREE.Vector3(1, 1, 1);
		this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
		for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, this._zero);
		this.mesh.instanceMatrix.needsUpdate = true;
	}

	spawn(pos, dir, target = null) {
		const b = this.bolts.find((x) => !x.active);
		if (!b) return null;
		b.active = true;
		b.pos.copy(pos);
		b.prev.copy(pos);
		b.dir.copy(dir).normalize();
		b.dist = 0;
		b.target = target;
		return b;
	}

	kill(b) {
		b.active = false;
		b.target = null;
		this.mesh.setMatrixAt(b.slot, this._zero);
	}

	writeMatrix(b) {
		this._q.setFromUnitVectors(Z_AXIS, b.dir);
		this._m.compose(b.pos, this._q, this._s);
		this.mesh.setMatrixAt(b.slot, this._m);
	}

	flush() { this.mesh.instanceMatrix.needsUpdate = true; }
}

export class WeaponSystem {
	constructor(scene, camera, ship, field) {
		this.scene = scene;
		this.camera = camera;
		this.ship = ship;
		this.field = field;

		this.player = new BoltPool(scene, Colors.cyan, PLAYER_CAP, 30, 1.6);
		this.enemy = new BoltPool(scene, Colors.orange, ENEMY_CAP, 22, 2.2);

		// wired by main after construction
		this.events = {
			onShoot: () => {},
			onEnemyHit: () => {},
			onAsteroidHit: () => {},
			onPlayerHit: () => {},
			onLockChange: () => {},
		};

		this.lockTarget = null;
		this.lockState = 'none'; // none | tracking | locked
		this.lockPx = { x: 0, y: 0 };

		this._cooldown = 0;
		this._steer = new THREE.Vector3();
		this._aim = new THREE.Vector3();
		this._nose = new THREE.Vector3();
		this._proj = new THREE.Vector3();
		this._ndc = new THREE.Vector2();
		this._ray = new THREE.Raycaster();
	}

	update(dt, input, enemies) {
		this._updateLock(input, enemies);
		this._updateFire(dt, input);
		this._movePlayerBolts(dt, enemies);
		this._moveEnemyBolts(dt);
		this.player.flush();
		this.enemy.flush();
	}

	_updateLock(input, enemies) {
		const prevState = this.lockState;
		let best = null, bestPx = CONFIG.lockRangePx;
		const w = window.innerWidth, h = window.innerHeight;
		for (const e of enemies) {
			this._proj.copy(e.position).project(this.camera);
			if (this._proj.z > 1) continue; // behind camera
			const sx = (this._proj.x * 0.5 + 0.5) * w;
			const sy = (-this._proj.y * 0.5 + 0.5) * h;
			const dPx = Math.hypot(sx - input.mousePxX, sy - input.mousePxY);
			const dist = e.position.distanceTo(this.ship.position);
			if (dPx < bestPx && dist < 4500) {
				best = e; bestPx = dPx;
				this.lockPx.x = sx; this.lockPx.y = sy;
			}
		}
		this.lockTarget = best;
		this.lockState = best ? (bestPx < CONFIG.lockSnapPx ? 'locked' : 'tracking') : 'none';
		if (this.lockState !== prevState) this.events.onLockChange(this.lockState);
	}

	_updateFire(dt, input) {
		this._cooldown -= dt;
		if (!input.firing || this._cooldown > 0 || !this.ship.alive) return;
		this._cooldown = CONFIG.fireInterval;

		// aim point: through the crosshair, or straight at the locked target
		if (this.lockTarget) {
			this._aim.copy(this.lockTarget.position);
		} else {
			this._ndc.set(input.mouseX, input.mouseY);
			this._ray.setFromCamera(this._ndc, this.camera);
			this._aim.copy(this._ray.ray.origin).addScaledVector(this._ray.ray.direction, 3000);
		}
		this.ship.forward(this._nose);
		this._nose.multiplyScalar(20).add(this.ship.position);
		this._steer.copy(this._aim).sub(this._nose).normalize();
		const homing = this.lockState === 'locked' ? this.lockTarget : null;
		this.player.spawn(this._nose, this._steer, homing);
		this.events.onShoot();
	}

	_movePlayerBolts(dt, enemies) {
		const step = CONFIG.boltSpeed * dt;
		for (const b of this.player.bolts) {
			if (!b.active) continue;
			// homing: bend toward the locked target
			if (b.target && b.target.alive) {
				this._steer.copy(b.target.position).sub(b.pos).normalize();
				const maxTurn = CONFIG.homingTurn * dt;
				const angle = b.dir.angleTo(this._steer);
				if (angle > 1e-4) {
					const t = Math.min(1, maxTurn / angle);
					b.dir.lerp(this._steer, t).normalize();
				}
			}
			b.prev.copy(b.pos);
			b.pos.addScaledVector(b.dir, step);
			b.dist += step;

			let dead = b.dist > CONFIG.boltRange;

			if (!dead) {
				for (const e of enemies) {
					if (!e.alive) continue;
					if (this._segSphere(b.prev, b.pos, e.position, e.radius + 3)) {
						this.events.onEnemyHit(e, b.pos);
						dead = true;
						break;
					}
				}
			}
			if (!dead) {
				const hit = this.field.segmentHit(b.prev, b.pos, 2);
				if (hit) {
					this.events.onAsteroidHit(hit.record, hit.point);
					dead = true;
				}
			}
			if (dead) this.player.kill(b);
			else this.player.writeMatrix(b);
		}
	}

	_moveEnemyBolts(dt) {
		const step = CONFIG.enemyBoltSpeed * dt;
		for (const b of this.enemy.bolts) {
			if (!b.active) continue;
			b.prev.copy(b.pos);
			b.pos.addScaledVector(b.dir, step);
			b.dist += step;

			let dead = b.dist > CONFIG.boltRange;
			if (!dead && this._segSphere(b.prev, b.pos, this.ship.position, this.ship.radius + 3)) {
				this.events.onPlayerHit(b.pos);
				dead = true;
			}
			if (!dead && this.field.segmentHit(b.prev, b.pos, 2)) dead = true; // rocks soak enemy fire
			if (dead) this.enemy.kill(b);
			else this.enemy.writeMatrix(b);
		}
	}

	spawnEnemyBolt(pos, dir) {
		this.enemy.spawn(pos, dir);
	}

	_segSphere(p0, p1, c, r) {
		const abx = p1.x - p0.x, aby = p1.y - p0.y, abz = p1.z - p0.z;
		const len2 = abx * abx + aby * aby + abz * abz;
		let t = 0;
		if (len2 > 0) {
			t = ((c.x - p0.x) * abx + (c.y - p0.y) * aby + (c.z - p0.z) * abz) / len2;
			t = Math.max(0, Math.min(1, t));
		}
		const dx = p0.x + abx * t - c.x;
		const dy = p0.y + aby * t - c.y;
		const dz = p0.z + abz * t - c.z;
		return dx * dx + dy * dy + dz * dz < r * r;
	}

	reset() {
		for (const b of this.player.bolts) if (b.active) this.player.kill(b);
		for (const b of this.enemy.bolts) if (b.active) this.enemy.kill(b);
		this.player.flush();
		this.enemy.flush();
		this.lockTarget = null;
		this.lockState = 'none';
	}
}
