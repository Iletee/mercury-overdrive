// Three enemy archetypes, each with its own silhouette and behavior:
//   SHARD   — octahedron drone, strafes ahead of you, fires on the beat
//   SEEKER  — tetrahedron kamikaze, accelerates in and detonates
//   BASTION — heavy icosahedron turret, tanks hits, burst-fires
// All wireframe-edged neon shapes that pulse with the music.

import * as THREE from 'three';
import { Colors, CONFIG } from './store.js';

const TYPES = {
	shard: {
		hp: 2, radius: 14, score: CONFIG.scoreShard, color: Colors.pink,
		geo: () => new THREE.OctahedronGeometry(14, 0),
	},
	seeker: {
		hp: 1, radius: 11, score: CONFIG.scoreSeeker, color: Colors.orange,
		geo: () => new THREE.TetrahedronGeometry(13, 0),
	},
	bastion: {
		hp: 8, radius: 34, score: CONFIG.scoreBastion, color: Colors.cyan,
		geo: () => new THREE.IcosahedronGeometry(34, 0),
	},
};

export class EnemyManager {
	constructor(scene, ship, weapons) {
		this.scene = scene;
		this.ship = ship;
		this.weapons = weapons;
		this.active = [];
		this.events = {
			onSeekerBlast: () => {}, // seeker reached the player and detonated
			onEnemyShoot: () => {},
		};
		this._v = new THREE.Vector3();
		this._aim = new THREE.Vector3();
		this._beat = false;
		this._beatCount = 0;
	}

	get count() { return this.active.length; }

	spawnWave(spec) {
		for (let i = 0; i < (spec.shards || 0); i++) this._spawn('shard', i);
		for (let i = 0; i < (spec.seekers || 0); i++) this._spawn('seeker', i);
		for (let i = 0; i < (spec.bastions || 0); i++) this._spawn('bastion', i);
	}

	_spawn(type, i) {
		const def = TYPES[type];
		const geo = def.geo();
		const group = new THREE.Group();
		const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
			color: 0x12081f, roughness: 0.4, metalness: 0.6, flatShading: true,
			emissive: def.color, emissiveIntensity: 0.6,
		}));
		const edges = new THREE.LineSegments(
			new THREE.EdgesGeometry(geo),
			new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.95 })
		);
		group.add(body, edges);

		const sp = this.ship.position;
		const spreadX = (Math.random() * 2 - 1) * 700;
		const spreadY = (Math.random() * 2 - 1) * 400;
		group.position.set(sp.x + spreadX, sp.y + spreadY, sp.z - 1900 - i * 260 - Math.random() * 300);
		this.scene.add(group);

		this.active.push({
			type, group, body, edges,
			position: group.position,
			radius: def.radius,
			hp: def.hp,
			score: def.score,
			color: def.color,
			alive: true,
			anchorX: spreadX, anchorY: spreadY,
			phase: Math.random() * Math.PI * 2,
			burst: 0,
			glow: 0,
		});
	}

	update(dt) {
		const sp = this.ship.position;
		const beat = this._beat;
		this._beat = false;

		for (const e of this.active) {
			if (!e.alive) continue;
			e.phase += dt;
			e.glow = Math.max(0, e.glow - dt * 5);
			e.body.material.emissiveIntensity = 0.6 + e.glow * 1.4;
			e.group.rotation.y += dt * 0.8;
			e.group.rotation.x += dt * 0.35;

			const dz = e.position.z - sp.z; // negative = ahead of player

			if (e.type === 'shard') {
				// hold formation ~700 ahead, strafing in a lissajous weave
				const holdZ = sp.z - 700;
				e.position.z += (holdZ - e.position.z) * Math.min(1, dt * 1.4);
				e.position.x = sp.x + e.anchorX * 0.5 + Math.sin(e.phase * 1.5) * 260;
				e.position.y = sp.y + e.anchorY * 0.5 + Math.sin(e.phase * 2.3 + 1.7) * 150;
				if (beat && this._beatCount % 2 === 0 && Math.random() < 0.65) this._fireAt(e, 0.12);
			} else if (e.type === 'seeker') {
				// pure pursuit with a top speed just above yours
				this._v.copy(sp).sub(e.position).normalize();
				const speed = this.ship.speed * 1.15 + 260;
				e.position.addScaledVector(this._v, speed * dt);
				e.glow = Math.max(e.glow, 0.4 + Math.sin(e.phase * 12) * 0.3); // angry strobe
				if (e.position.distanceTo(sp) < 46) {
					this._kill(e);
					this.events.onSeekerBlast(e);
					continue;
				}
			} else if (e.type === 'bastion') {
				// heavy: keeps distance, drifts, fires 3-bolt bursts every other beat
				const holdZ = sp.z - 1300;
				e.position.z += (holdZ - e.position.z) * Math.min(1, dt * 0.7);
				e.position.x += (sp.x + e.anchorX - e.position.x) * dt * 0.3;
				e.position.y += (sp.y + e.anchorY * 0.6 - e.position.y) * dt * 0.3;
				if (beat && this._beatCount % 4 === 0) e.burst = 3;
				if (e.burst > 0 && Math.sin(e.phase * 14) > 0.9) {
					e.burst -= 1;
					this._fireAt(e, 0.05);
				}
			}

			// fell behind the player — despawn quietly
			if (dz > 400) this._kill(e);
		}
		this.active = this.active.filter((e) => e.alive);
	}

	_fireAt(e, jitter) {
		// lead the player a little so the shots feel intentional but dodgeable
		this.ship.forward(this._aim);
		this._aim.multiplyScalar(this.ship.speed * 0.35).add(this.ship.position);
		this._v.copy(this._aim).sub(e.position).normalize();
		this._v.x += (Math.random() - 0.5) * jitter;
		this._v.y += (Math.random() - 0.5) * jitter;
		this.weapons.spawnEnemyBolt(e.position, this._v.normalize());
		e.glow = 1;
		this.events.onEnemyShoot(e);
	}

	// returns true if destroyed
	damage(e, n = 1) {
		if (!e.alive) return false;
		e.hp -= n;
		e.glow = 1;
		if (e.hp <= 0) {
			this._kill(e);
			return true;
		}
		return false;
	}

	_kill(e) {
		if (!e.alive) return;
		e.alive = false;
		this.scene.remove(e.group);
		e.body.geometry.dispose();
		e.body.material.dispose();
		e.edges.geometry.dispose();
		e.edges.material.dispose();
	}

	beatPulse() {
		this._beat = true;
		this._beatCount += 1;
		for (const e of this.active) e.glow = Math.max(e.glow, 0.5);
	}

	reset() {
		for (const e of this.active) this._kill(e);
		this.active = [];
	}
}
