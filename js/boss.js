// The Architect — end-of-run boss. A three-phase fight: a shield lattice of
// six orbiting nodes, then an exposed core that vents weak points, then an
// overloading core in full assault. Every attack is beat-synced.
//
// Shootable parts (nodes/core/vents) are pushed into enemies.active as plain
// pseudo-enemy objects shaped exactly like enemies.js's own entries, so the
// existing lock-on, bolts, collision, explosions and scoring all work on them
// for free — enemies.update() even drives their idle tumble/glow-decay.
// This file only owns positioning (orbits + drift) and attack timing.

import * as THREE from 'three';
import { Colors } from './store.js';

const TOTAL_HP = 60;          // 6 nodes * 6hp + 24 core hp — for the HUD bar
const HOLD_Z = 1300;          // boss holds this far ahead of the ship

const CORE_RADIUS = 140;
const CORE_HP = 24;
const NODE_RADIUS = 30;
const NODE_HP = 6;
const NODE_ORBIT_R = 260;
const ORBIT_SPEED = 0.5;      // rad/s, before the phase-3 multiplier
const VENT_RADIUS = 18;
const VENT_HP = 3;
const VENT_OFFSETS = [
	{ x: 170, y: 170, z: 40 }, { x: -170, y: 170, z: 40 },
	{ x: 170, y: -170, z: 40 }, { x: -170, y: -170, z: 40 },
];

const BPM = 118;
const BEAT_SEC = 60 / BPM;
const BAR_SEC = BEAT_SEC * 4;

const BEAM_LEN = 2400;
const BEAM_RADIUS = 7;
const BEAM_REACH = 900;       // lateral reach of the sweep at the ship's depth
const HALF_SWEEP = THREE.MathUtils.degToRad(70); // 140 deg total sweep
const SWEEP_RANGE = HALF_SWEEP * 2;
const WINDUP_DUR = BAR_SEC;
const ACTIVE_DUR = BAR_SEC * 2;
const FADE_DUR = 0.4;

const UP = new THREE.Vector3(0, 1, 0);
const NODE_FAN = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]; // cross pattern
const ORBIT_PLANE_EULERS = [
	new THREE.Euler(0.35, 0, 0),
	new THREE.Euler(1.05, 0.5, 0.2),
	new THREE.Euler(-0.6, -0.8, 0.4),
];

export class ArchitectBoss {
	constructor(scene, ship, weapons, enemies, fx) {
		this.scene = scene;
		this.ship = ship;
		this.weapons = weapons;
		this.enemies = enemies;
		this.fx = fx;

		this.events = {
			onPhase: () => {},
			onPlayerHit: () => {},
			onDefeated: () => {},
			onNodeDown: () => {},
			onShoot: () => {},
		};

		this._engaged = false;
		this._defeated = false;
		this._defeating = false;
		this.phase = 0;

		this.center = new THREE.Vector3();
		this.core = null;   // the entry object itself (also the enemies.active push, from phase 2 on)
		this.nodes = [];
		this.vents = [];

		this._selfAngle = 0;
		this._selfRotSpeed = 0.12;
		this._orbitSpeedMul = 1;
		this._selfQuat = new THREE.Quaternion();
		this._orbitPlaneQuats = ORBIT_PLANE_EULERS.map((e) => new THREE.Quaternion().setFromEuler(e));

		this._nodeFireIdx = -1;
		this._seekerSpawnIdx = 0;
		this._ventsOpen = false;
		this._ventOpenBar = -999;
		this._lastNovaBar = -999;
		this._hitCooldown = 0;

		this._beam = { state: 'off', t: 0, mesh: null, quat: new THREE.Quaternion() };
		this._beamBaseAngle = 0;
		this._beamDz = HOLD_Z;

		this._derezEvents = null;
		this._derezT = 0;
		this._derezDur = 1.4;

		// scratch — no allocation in per-frame/per-beat paths
		this._v = new THREE.Vector3();
		this._aimDir = new THREE.Vector3();
		this._aimPoint = new THREE.Vector3();
		this._fireDir = new THREE.Vector3();
		this._shootDir = new THREE.Vector3();
		this._fanRight = new THREE.Vector3();
		this._fanUp = new THREE.Vector3();
		this._beamDir = new THREE.Vector3();
		this._beamP0 = new THREE.Vector3();
		this._beamP1 = new THREE.Vector3();
		this._novaTarget = new THREE.Vector3();
	}

	get engaged() { return this._engaged; }
	get defeated() { return this._defeated; }

	get hpFraction() {
		if (!this._engaged) return 1;
		let hp = 0;
		for (const n of this.nodes) if (n.alive) hp += Math.max(0, n.hp);
		if (this.core) hp += Math.max(0, this.core.hp);
		return Math.max(0, Math.min(1, hp / TOTAL_HP));
	}

	// ---- lifecycle ---------------------------------------------------

	engage(zCenter) {
		if (this._engaged) return;
		this._engaged = true;
		this._defeated = false;
		this._defeating = false;
		this.phase = 1;

		this.center.set(0, 0, zCenter - HOLD_Z);
		this._selfAngle = 0;
		this._selfQuat.identity();
		this._selfRotSpeed = 0.12;
		this._orbitSpeedMul = 1;
		this._nodeFireIdx = -1;
		this._seekerSpawnIdx = 0;
		this._ventsOpen = false;
		this._ventOpenBar = -999;
		this._lastNovaBar = -999;
		this._hitCooldown = 0;

		const coreGeo = new THREE.IcosahedronGeometry(CORE_RADIUS, 0);
		this.core = this._makePart('bosscore', coreGeo, Colors.cyan, CORE_RADIUS, CORE_HP, 5000, false);
		this.core.position.copy(this.center);

		this.nodes = [];
		for (let i = 0; i < 6; i++) {
			const geo = new THREE.OctahedronGeometry(NODE_RADIUS, 0);
			const node = this._makePart('bossnode', geo, Colors.pink, NODE_RADIUS, NODE_HP, 800, true);
			node.orbitPlane = Math.floor(i / 2);
			node.orbitOffset = (i % 2) * Math.PI;
			node.orbitAngle = node.orbitOffset;
			node.nodeDone = false;
			this.nodes.push(node);
		}

		this.vents = [];
		this._buildBeam();
	}

	beat(beat, bar) {
		if (!this._engaged || this._defeated || this._defeating) return;

		for (const n of this.nodes) if (n.alive) n.glow = Math.max(n.glow, 0.5);
		for (const v of this.vents) if (v.alive) v.glow = Math.max(v.glow, 0.5);
		if (this.core) this.core.glow = Math.max(this.core.glow, 0.5);

		if (this.phase === 1) {
			if (beat % 2 === 0) this._fireNextNode();
			if (beat === 0 && bar % 4 === 3 && this._beam.state === 'off') this._startBeam();
		} else if (this.phase === 2) {
			if (beat % 4 === 0) this._fireCoreBurst();
			if (beat === 0) {
				if (bar % 2 === 0) this._maybeSpawnSeeker();
				if (!this._ventsOpen && bar % 4 === 0) this._openVents(bar);
				else if (this._ventsOpen && bar - this._ventOpenBar >= 2) this._closeVents();
			}
		} else if (this.phase === 3) {
			this._fireRadialRing();
			if (beat === 0) {
				if (bar % 2 === 0) this._maybeSpawnSeeker();
				if (bar % 4 === 0 && bar !== this._lastNovaBar) {
					this._lastNovaBar = bar;
					this._fireNova();
				}
			}
		}
	}

	update(dt) {
		if (!this._engaged) return;
		if (this._defeated) return;
		if (this._defeating) { this._updateDerez(dt); return; }

		this._hitCooldown -= dt;

		this._updateCenter(dt);
		this._selfAngle += this._selfRotSpeed * dt;
		this._selfQuat.setFromAxisAngle(UP, this._selfAngle);

		for (const n of this.nodes) if (n.alive) this._positionNode(n, dt);
		for (const v of this.vents) if (v.alive) this._positionVent(v);
		if (this.core) {
			this.core.position.copy(this.center);
			this.core.group.rotation.y = this._selfAngle;
			// core isn't in enemies.active during phase 1 — pulse it ourselves
			this.core.glow = Math.max(0, this.core.glow - dt * 5);
			this.core.body.material.emissiveIntensity = 0.6 + this.core.glow * 1.4;
		}

		this._checkNodeDamage();
		this._checkVentDamage();
		this._checkPhaseAdvance();

		if (this.phase === 1) this._updateBeam(dt);
	}

	reset() {
		this.enemies.active = this.enemies.active.filter((e) => {
			const mine = e.type === 'bossnode' || e.type === 'bosscore' || e.type === 'bossvent';
			if (mine) this._disposePart(e);
			return !mine;
		});
		if (this.core) this._disposePart(this.core); // may predate enemies.active registration

		if (this._beam.mesh) {
			this.scene.remove(this._beam.mesh);
			this._beam.mesh.geometry.dispose();
			this._beam.mesh.material.dispose();
		}

		this.core = null;
		this.nodes = [];
		this.vents = [];
		this._beam = { state: 'off', t: 0, mesh: null, quat: new THREE.Quaternion() };
		this._derezEvents = null;

		this._engaged = false;
		this._defeated = false;
		this._defeating = false;
		this.phase = 0;
		this._ventsOpen = false;
	}

	// ---- part construction / teardown --------------------------------

	// Builds one shootable part in the enemies.js material recipe and pushes
	// it into enemies.active (unless deferred, e.g. the invulnerable core).
	_makePart(type, geo, colorHex, radius, hp, score, addToActive) {
		const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
			color: 0x12081f, roughness: 0.4, metalness: 0.6, flatShading: true,
			emissive: colorHex, emissiveIntensity: 0.6,
		}));
		const edges = new THREE.LineSegments(
			new THREE.EdgesGeometry(geo),
			new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95 })
		);
		const group = new THREE.Group();
		group.add(body, edges);
		this.scene.add(group);
		const entry = {
			type, group, body, edges,
			position: group.position,
			radius, hp, score, color: colorHex,
			alive: true,
			anchorX: 0, anchorY: 0,
			phase: Math.random() * Math.PI * 2,
			burst: 0,
			glow: 0,
		};
		if (addToActive) this.enemies.active.push(entry);
		return entry;
	}

	_disposePart(e) {
		if (!e.alive) return;
		e.alive = false;
		this.scene.remove(e.group);
		e.body.geometry.dispose();
		e.body.material.dispose();
		e.edges.geometry.dispose();
		e.edges.material.dispose();
	}

	// ---- movement ------------------------------------------------------

	_updateCenter(dt) {
		const sp = this.ship.position;
		const holdZ = sp.z - HOLD_Z;
		this.center.z += (holdZ - this.center.z) * Math.min(1, dt * 0.7);
		this.center.x += (sp.x * 0.35 - this.center.x) * Math.min(1, dt * 0.25);
		this.center.y += (sp.y * 0.35 - this.center.y) * Math.min(1, dt * 0.25);
	}

	_positionNode(n, dt) {
		n.orbitAngle += ORBIT_SPEED * this._orbitSpeedMul * dt;
		this._v.set(Math.cos(n.orbitAngle) * NODE_ORBIT_R, 0, Math.sin(n.orbitAngle) * NODE_ORBIT_R);
		this._v.applyQuaternion(this._orbitPlaneQuats[n.orbitPlane]);
		this._v.applyQuaternion(this._selfQuat);
		n.position.copy(this.center).add(this._v);
	}

	_positionVent(v) {
		this._v.copy(v.ventOffset).applyQuaternion(this._selfQuat);
		v.position.copy(this.center).add(this._v);
	}

	// ---- damage bookkeeping ---------------------------------------------

	_checkNodeDamage() {
		let remaining = 0;
		for (const n of this.nodes) if (n.alive) remaining++;
		for (const n of this.nodes) {
			if (!n.alive && !n.nodeDone) {
				n.nodeDone = true;
				this.events.onNodeDown(remaining);
			}
		}
	}

	// A destroyed (not retracted) vent bites the core for bonus damage —
	// clamped so the vent alone never finishes it off; only a real bolt does.
	_checkVentDamage() {
		for (const v of this.vents) {
			if (!v.alive && !v.ventDone) {
				v.ventDone = true;
				this.core.hp = Math.max(1, this.core.hp - 3);
			}
		}
	}

	_checkPhaseAdvance() {
		if (this.phase === 1) {
			if (this.nodes.every((n) => !n.alive)) {
				this.phase = 2;
				this.enemies.active.push(this.core);
				this.events.onPhase(2);
			}
		} else if (this.phase === 2) {
			if (this.core.hp <= 12) {
				this.phase = 3;
				this._enterPhase3();
				this.events.onPhase(3);
			}
		} else if (this.phase === 3) {
			if (!this.core.alive) this._startDerez();
		}
	}

	_enterPhase3() {
		this.core.body.material.emissive.setHex(Colors.pink);
		this.core.edges.material.color.setHex(Colors.pink);
		this._orbitSpeedMul = 1.8;
		this._selfRotSpeed = 0.3;
		if (this._ventsOpen) this._closeVents(); // phase 3 doesn't vent
	}

	// ---- vents (phase 2) -------------------------------------------------

	_openVents(bar) {
		this._ventsOpen = true;
		this._ventOpenBar = bar;
		this.vents = [];
		for (const off of VENT_OFFSETS) {
			const geo = new THREE.OctahedronGeometry(VENT_RADIUS, 0);
			const vent = this._makePart('bossvent', geo, Colors.orange, VENT_RADIUS, VENT_HP, 400, true);
			vent.ventOffset = new THREE.Vector3(off.x, off.y, off.z);
			vent.ventDone = false;
			this.vents.push(vent);
		}
	}

	_closeVents() {
		for (const v of this.vents) this._disposePart(v);
		this.vents = [];
		this._ventsOpen = false;
	}

	// ---- weapons fire ------------------------------------------------

	// lead the player a little, mirroring enemies.js's own _fireAt
	_predictAim(out) {
		this.ship.forward(this._aimDir);
		out.copy(this.ship.position).addScaledVector(this._aimDir, this.ship.speed * 0.35);
	}

	_fanBasis(fromPos) {
		this._fireDir.copy(this._aimPoint).sub(fromPos).normalize();
		this._fanRight.crossVectors(this._fireDir, UP);
		if (this._fanRight.lengthSq() < 1e-6) this._fanRight.set(1, 0, 0);
		this._fanRight.normalize();
		this._fanUp.crossVectors(this._fanRight, this._fireDir).normalize();
	}

	_fireNextNode() {
		const living = this.nodes.filter((n) => n.alive);
		if (!living.length) return;
		this._nodeFireIdx = (this._nodeFireIdx + 1) % living.length;
		this._fireNodeVolley(living[this._nodeFireIdx]);
	}

	// 5-bolt cross spread, led toward the player
	_fireNodeVolley(n) {
		this._predictAim(this._aimPoint);
		this._fanBasis(n.position);
		for (const [sr, su] of NODE_FAN) {
			this._shootDir.copy(this._fireDir)
				.addScaledVector(this._fanRight, sr * 0.15)
				.addScaledVector(this._fanUp, su * 0.15)
				.normalize();
			this.weapons.spawnEnemyBolt(n.position, this._shootDir);
			this.events.onShoot();
		}
		n.glow = 1;
	}

	// bastion-style 3-bolt burst with a little jitter
	_fireCoreBurst() {
		this._predictAim(this._aimPoint);
		for (let i = 0; i < 3; i++) {
			this._fireDir.copy(this._aimPoint).sub(this.core.position).normalize();
			this._fireDir.x += (Math.random() - 0.5) * 0.05;
			this._fireDir.y += (Math.random() - 0.5) * 0.05;
			this._fireDir.normalize();
			this.weapons.spawnEnemyBolt(this.core.position, this._fireDir);
			this.events.onShoot();
		}
		this.core.glow = 1;
	}

	// 6-bolt ring on a cone toward the player, jittered
	_fireRadialRing() {
		this._predictAim(this._aimPoint);
		this._fanBasis(this.core.position);
		for (let i = 0; i < 6; i++) {
			const a = i * (Math.PI / 3);
			this._shootDir.copy(this._fireDir)
				.addScaledVector(this._fanRight, Math.cos(a) * 0.3 + (Math.random() - 0.5) * 0.05)
				.addScaledVector(this._fanUp, Math.sin(a) * 0.3 + (Math.random() - 0.5) * 0.05)
				.normalize();
			this.weapons.spawnEnemyBolt(this.core.position, this._shootDir);
			this.events.onShoot();
		}
		this.core.glow = 1;
	}

	// 12 bolts converging on a ring around the ship's current spot — an
	// escapable "nova": standing still is lethal-adjacent, moving isn't.
	_fireNova() {
		const sp = this.ship.position;
		for (let i = 0; i < 12; i++) {
			const a = i * (Math.PI * 2 / 12);
			const r = 260 + (i % 2) * 160;
			this._novaTarget.set(sp.x + Math.cos(a) * r, sp.y + Math.sin(a) * r, sp.z);
			this._shootDir.copy(this._novaTarget).sub(this.core.position).normalize();
			this.weapons.spawnEnemyBolt(this.core.position, this._shootDir);
			this.events.onShoot();
		}
		this.core.glow = 1;
	}

	_maybeSpawnSeeker() {
		let live = 0;
		for (const e of this.enemies.active) if (e.type === 'seeker' && e.alive) live++;
		if (live < 3) this.enemies._spawn('seeker', this._seekerSpawnIdx++);
	}

	// ---- sweeping beam (phase 1) -----------------------------------------

	_buildBeam() {
		const geo = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_LEN, 8, 1, true);
		geo.translate(0, BEAM_LEN / 2, 0); // pivot at the core end, extends along +Y
		const mat = new THREE.MeshBasicMaterial({
			color: Colors.cyan, transparent: true, opacity: 0,
			blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
		});
		const mesh = new THREE.Mesh(geo, mat);
		mesh.visible = false;
		mesh.frustumCulled = false;
		this.scene.add(mesh);
		this._beam.mesh = mesh;
		this._beam.state = 'off';
		this._beam.t = 0;
	}

	_startBeam() {
		const dx = this.ship.position.x - this.center.x;
		const dy = this.ship.position.y - this.center.y;
		this._beamBaseAngle = Math.atan2(dy, dx);
		this._beamDz = Math.max(600, this.ship.position.z - this.center.z);
		this._beam.state = 'windup';
		this._beam.t = 0;
		this._beam.mesh.visible = true;
	}

	_updateBeam(dt) {
		const b = this._beam;
		if (b.state === 'off') return;
		b.t += dt;

		// opacity stays modest — the beam is additive under heavy bloom, and
		// seen end-on (it reaches toward the ship) it reads as a huge disc.
		if (b.state === 'windup') {
			this._setBeamAngle(this._beamBaseAngle - HALF_SWEEP);
			b.mesh.material.opacity = 0.06;
			if (b.t >= WINDUP_DUR) { b.state = 'active'; b.t = 0; }
			return;
		}
		if (b.state === 'active') {
			const t = Math.min(1, b.t / ACTIVE_DUR);
			this._setBeamAngle(this._beamBaseAngle - HALF_SWEEP + SWEEP_RANGE * t);
			b.mesh.material.opacity = 0.35;
			this._checkBeamHit();
			if (b.t >= ACTIVE_DUR) { b.state = 'fade'; b.t = 0; }
			return;
		}
		// fade
		const t = Math.min(1, b.t / FADE_DUR);
		b.mesh.material.opacity = 0.35 * (1 - t);
		if (b.t >= FADE_DUR) { b.state = 'off'; b.mesh.visible = false; }
	}

	_setBeamAngle(ang) {
		this._beamDir.set(Math.cos(ang) * BEAM_REACH, Math.sin(ang) * BEAM_REACH, this._beamDz).normalize();
		// stop just past the ship's depth plane — far enough to hit, but not
		// so far the tube runs through the camera and whites out the frame
		const effLen = Math.min(BEAM_LEN,
			(this._beamDz + 150) / Math.max(0.2, this._beamDir.z));
		this._beam.mesh.scale.set(1, effLen / BEAM_LEN, 1);
		this._beam.mesh.position.copy(this.center);
		this._beam.quat.setFromUnitVectors(UP, this._beamDir);
		this._beam.mesh.quaternion.copy(this._beam.quat);
		this._beamP0.copy(this.center);
		this._beamP1.copy(this.center).addScaledVector(this._beamDir, effLen);
	}

	_checkBeamHit() {
		if (this._hitCooldown > 0) return;
		if (this._segPointDistSq(this._beamP0, this._beamP1, this.ship.position) < 1600) { // 40^2
			this.events.onPlayerHit();
			this._hitCooldown = 0.8;
		}
	}

	_segPointDistSq(p0, p1, c) {
		const abx = p1.x - p0.x, aby = p1.y - p0.y, abz = p1.z - p0.z;
		const len2 = abx * abx + aby * aby + abz * abz;
		let t = 0;
		if (len2 > 0) {
			t = ((c.x - p0.x) * abx + (c.y - p0.y) * aby + (c.z - p0.z) * abz) / len2;
			t = Math.max(0, Math.min(1, t));
		}
		const dx = p0.x + abx * t - c.x, dy = p0.y + aby * t - c.y, dz = p0.z + abz * t - c.z;
		return dx * dx + dy * dy + dz * dz;
	}

	// ---- defeat / derez ----------------------------------------------

	_startDerez() {
		this._defeating = true;
		this._derezT = 0;
		this._derezDur = 1.4;
		if (this._ventsOpen) this._closeVents();
		const n = 6 + Math.floor(Math.random() * 3);
		this._derezEvents = [];
		for (let i = 0; i < n; i++) {
			this._derezEvents.push({
				t: (i / n) * this._derezDur + Math.random() * 0.08,
				pos: new THREE.Vector3(
					this.center.x + (Math.random() * 2 - 1) * 200,
					this.center.y + (Math.random() * 2 - 1) * 200,
					this.center.z + (Math.random() * 2 - 1) * 150
				),
				done: false,
			});
		}
	}

	_updateDerez(dt) {
		this._derezT += dt;
		for (const ev of this._derezEvents) {
			if (!ev.done && this._derezT >= ev.t) {
				ev.done = true;
				this.fx.spawnExplosion(ev.pos, Colors.pink, 1.3 + Math.random() * 0.6);
				this.fx.spawnShockwave(ev.pos, Colors.pink, 1.2 + Math.random() * 0.8);
			}
		}
		if (this._derezT >= this._derezDur) {
			this._defeating = false;
			this._defeated = true;
			this.events.onDefeated();
		}
	}
}
