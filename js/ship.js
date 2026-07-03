// Player ship: procedural Tron dart, flight model, chase camera.
// The ship truly flies (position integrates from its heading); the camera chases.

import * as THREE from 'three';
import { Colors, CONFIG } from './store.js';

function buildShipGeometry() {
	// A flattened arrowhead dart, hand-built so edges read cleanly under EdgesGeometry.
	const nose = [0, 0, -16];
	const tailT = [0, 3.0, 7];
	const tailB = [0, -2.0, 7];
	const tipL = [-11, 0, 8];
	const tipR = [11, 0, 8];
	const midL = [-3.2, 0.6, 2];
	const midR = [3.2, 0.6, 2];

	const tris = [
		// top surfaces
		nose, midL, tailT,
		nose, tailT, midR,
		midL, tipL, tailT,
		midR, tailT, tipR,
		// bottom surfaces
		nose, tailB, tipL,
		nose, tipR, tailB,
		// stern
		tailT, tipL, tailB,
		tailT, tailB, tipR,
		// leading edges (thin wedge between top and bottom at the wing line)
		nose, tipL, midL,
		nose, midR, tipR,
	];
	const pos = new Float32Array(tris.flat());
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.computeVertexNormals();
	return geo;
}

// ramp a steering axis toward its target: quick but never instant
function slew(current, target, dt) {
	const rate = Math.abs(target) > Math.abs(current) ? 4.2 : 6.0; // attack / release per second
	const d = target - current;
	const step = rate * dt;
	return Math.abs(d) <= step ? target : current + Math.sign(d) * step;
}

export class PlayerShip {
	constructor(scene) {
		this.scene = scene;

		this.group = new THREE.Group();
		const geo = buildShipGeometry();
		this.hull = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
			color: 0x120b26, roughness: 0.35, metalness: 0.7, flatShading: true,
		}));
		this.edges = new THREE.LineSegments(
			new THREE.EdgesGeometry(geo, 12),
			new THREE.LineBasicMaterial({ color: Colors.cyan, transparent: true, opacity: 1 })
		);
		this.group.add(this.hull, this.edges);

		// Engine exhaust: additive cone that stretches with speed, pulses on beat
		this.exhaust = new THREE.Mesh(
			new THREE.ConeGeometry(1.6, 10, 8, 1, true),
			new THREE.MeshBasicMaterial({
				color: Colors.cyan, transparent: true, opacity: 0.85,
				blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
			})
		);
		this.exhaust.rotation.x = Math.PI / 2; // apex trails behind the stern
		this.exhaust.position.set(0, 0.4, 12);
		this.group.add(this.exhaust);

		this.glow = new THREE.PointLight(Colors.cyan, 90, 260, 1.6);
		this.glow.position.set(0, 2, 6);
		this.group.add(this.glow);

		// shield bubble: invisible until it absorbs a hit, faint shimmer when armed
		this.bubble = new THREE.Mesh(
			new THREE.IcosahedronGeometry(15, 1),
			new THREE.MeshBasicMaterial({
				color: Colors.cyan, transparent: true, opacity: 0,
				blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true,
			})
		);
		this.group.add(this.bubble);

		scene.add(this.group);

		// Flight state
		this.position = this.group.position;
		this.quaternion = new THREE.Quaternion();
		this.yaw = 0; this.pitch = 0; this.roll = 0;
		this.speed = CONFIG.cruiseSpeed;
		this.boost = CONFIG.boostMax;
		this.boostEngaged = false;
		this.hp = CONFIG.playerHp;
		this.invuln = 0;
		this.radius = CONFIG.shipRadius;
		// shield: one absorbing charge, recharges over time
		this.shieldReady = true;
		this.shieldTimer = CONFIG.shieldRecharge;
		this._bubbleFlash = 0;

		// slewed steering inputs: keys ramp in/out instead of snapping
		this.steerVX = 0;
		this.steerVY = 0;
		// the camera trails the ship's heading with its own smoothed angles
		this.camYaw = 0;
		this.camPitch = 0;
		// barrel roll state: {dir, t} while rolling, else null
		this.barrel = null;
		this._prevQ = false;
		this._prevE = false;
		this._hurtBlink = 0;

		this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
		this._fwd = new THREE.Vector3();
		this._right = new THREE.Vector3();
		this._camPos = new THREE.Vector3();
		this._camTarget = new THREE.Vector3();
		this._camQuat = new THREE.Quaternion();
		this._shake = 0;
		this._beatKick = 0;
	}

	get alive() { return this.hp > 0; }
	get progressZ() { return -this.position.z; }

	forward(out) {
		return out.set(0, 0, -1).applyQuaternion(this.quaternion);
	}

	update(dt, input) {
		// --- steering: WASD maps to a target heading inside a cone; releasing
		// recenters. Keys are slewed (ramp in ~0.25s) so nothing snaps, and the
		// bank responds faster than the heading so a keypress reads as a lean
		// first, then the turn follows.
		let tx = input.steerX;
		let ty = input.steerY;
		// soft outer wall: steer back only when drifting far outside the field
		tx -= Math.sign(this.position.x) * Math.max(0, (Math.abs(this.position.x) - 2300) / 800);
		ty -= Math.sign(this.position.y) * Math.max(0, (Math.abs(this.position.y) - 1400) / 600);
		tx = THREE.MathUtils.clamp(tx, -1, 1);
		ty = THREE.MathUtils.clamp(ty, -1, 1);

		this.steerVX = slew(this.steerVX, tx, dt);
		this.steerVY = slew(this.steerVY, ty, dt);

		const targetYaw = -this.steerVX * CONFIG.maxYaw;
		const targetPitch = this.steerVY * CONFIG.maxPitch;
		const k = Math.min(1, dt * CONFIG.steerLerp);
		this.yaw += (targetYaw - this.yaw) * k;
		this.pitch += (targetPitch - this.pitch) * k;

		// bank leads the turn: driven by the raw key, not the slewed heading
		const targetRoll = -tx * 1.15 + (targetYaw - this.yaw) * 0.8;
		this.roll += (targetRoll - this.roll) * Math.min(1, dt * 10);

		// --- barrel roll (Q/E): full 360 spin + lateral dodge + brief grace
		const qEdge = input.rollLeft && !this._prevQ;
		const eEdge = input.rollRight && !this._prevE;
		this._prevQ = input.rollLeft;
		this._prevE = input.rollRight;
		if (!this.barrel && (qEdge || eEdge)) {
			this.barrel = { dir: qEdge ? 1 : -1, t: 0 };
			this.invuln = Math.max(this.invuln, CONFIG.barrelTime + 0.1);
		}
		let extraRoll = 0;
		if (this.barrel) {
			this.barrel.t += dt / CONFIG.barrelTime;
			if (this.barrel.t >= 1) {
				this.barrel = null;
			} else {
				const p = this.barrel.t;
				const ease = p * p * (3 - 2 * p);
				extraRoll = this.barrel.dir * Math.PI * 2 * ease;
				// sideways dodge, strongest mid-roll
				this._right.set(1, 0, 0).applyQuaternion(this.quaternion);
				this.position.addScaledVector(this._right,
					-this.barrel.dir * CONFIG.barrelDodge * Math.sin(p * Math.PI) * dt);
			}
		}

		// heading quaternion excludes the spin (aim/flight stay stable mid-roll);
		// the visible mesh gets the full barrel rotation
		this._euler.set(this.pitch, this.yaw, this.roll);
		this.quaternion.setFromEuler(this._euler);
		this._euler.set(this.pitch, this.yaw, this.roll + extraRoll);
		this.group.quaternion.setFromEuler(this._euler);

		// --- throttle
		this.boostEngaged = input.boosting && this.boost > (this.boostEngaged ? 0 : 12);
		let targetSpeed = CONFIG.cruiseSpeed;
		if (input.braking) targetSpeed = CONFIG.brakeSpeed;
		if (this.boostEngaged) {
			targetSpeed = CONFIG.boostSpeed;
			this.boost = Math.max(0, this.boost - CONFIG.boostDrain * dt);
		} else {
			this.boost = Math.min(CONFIG.boostMax, this.boost + CONFIG.boostRegen * dt);
		}
		this.speed += (targetSpeed - this.speed) * Math.min(1, dt * CONFIG.speedLerp);

		// --- integrate
		this.forward(this._fwd);
		this.position.addScaledVector(this._fwd, this.speed * dt);

		// --- timers & visuals (blink only after damage, not during barrel grace)
		if (this.invuln > 0) this.invuln -= dt;
		if (this._hurtBlink > 0) {
			this._hurtBlink -= dt;
			this.edges.material.opacity = (Math.sin(performance.now() * 0.03) > 0) ? 1 : 0.15;
		} else {
			this.edges.material.opacity = 1;
		}
		// shield recharge + bubble visuals
		if (!this.shieldReady) {
			this.shieldTimer += dt;
			if (this.shieldTimer >= CONFIG.shieldRecharge) {
				this.shieldReady = true;
				if (this.onShieldUp) this.onShieldUp();
			}
		}
		this._bubbleFlash = Math.max(0, this._bubbleFlash - dt * 2.2);
		this.bubble.material.opacity =
			this._bubbleFlash * 0.55 + (this.shieldReady ? 0.045 + this._beatKick * 0.03 : 0);
		this.bubble.rotation.y += dt * 0.7;

		this._beatKick = Math.max(0, this._beatKick - dt * 4);
		const thrust = this.speed / CONFIG.boostSpeed;
		this.exhaust.scale.set(1, 0.6 + thrust * 2.2 + this._beatKick * 0.5, 1);
		this.exhaust.material.opacity = 0.45 + thrust * 0.5 + this._beatKick * 0.3;
		this.glow.intensity = 70 + thrust * 90 + this._beatKick * 60;
		this._shake = Math.max(0, this._shake - dt * 3.2);
	}

	updateCamera(camera, dt) {
		// the camera trails the ship's heading: during a turn the ship slides
		// toward the side of the screen it's turning to, so you can read where
		// you're going instead of the whole view whipping around
		const kc = Math.min(1, dt * 3.8);
		this.camYaw += (this.yaw - this.camYaw) * kc;
		this.camPitch += (this.pitch - this.camPitch) * kc;
		this._euler.set(this.camPitch, this.camYaw, this.roll * 0.28);
		this._camQuat.setFromEuler(this._euler);

		this._camPos.set(0, 13, 48).applyQuaternion(this._camQuat).add(this.position);
		camera.position.lerp(this._camPos, Math.min(1, dt * 8));

		this.forward(this._fwd);
		this._camTarget.copy(this.position).addScaledVector(this._fwd, 260);
		camera.lookAt(this._camTarget);
		camera.quaternion.slerp(this._camQuat, 0.12); // blend in a touch of bank

		if (this._shake > 0) {
			const s = this._shake * this._shake * 6;
			camera.position.x += (Math.random() - 0.5) * s;
			camera.position.y += (Math.random() - 0.5) * s;
		}

		// speed reads as FOV
		const targetFov = 70 + (this.speed / CONFIG.boostSpeed) * 22;
		camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
		camera.updateProjectionMatrix();
	}

	// returns 'shield' (absorbed), 'hull' (hp lost), or false (grace period)
	takeDamage(n = 1) {
		if (this.invuln > 0 || !this.alive) return false;
		if (this.shieldReady) {
			this.shieldReady = false;
			this.shieldTimer = 0;
			this._bubbleFlash = 1;
			this.invuln = 0.8;
			this._shake = Math.max(this._shake, 0.5);
			return 'shield';
		}
		this.hp -= n;
		this.invuln = CONFIG.invulnTime;
		this._hurtBlink = CONFIG.invulnTime;
		this._shake = 1;
		return 'hull';
	}

	nudgeOutOf(normal, depth) {
		this.position.addScaledVector(normal, depth + 3);
	}

	beatPulse() { this._beatKick = 1; }
	shake(n = 0.6) { this._shake = Math.max(this._shake, n); }

	reset() {
		this.position.set(0, 0, 0);
		this.yaw = this.pitch = this.roll = 0;
		this.steerVX = this.steerVY = 0;
		this.camYaw = this.camPitch = 0;
		this.barrel = null;
		this._hurtBlink = 0;
		this.quaternion.identity();
		this.group.quaternion.identity();
		this.speed = CONFIG.cruiseSpeed;
		this.boost = CONFIG.boostMax;
		this.hp = CONFIG.playerHp;
		this.invuln = 0;
		this._shake = 0;
		this.shieldReady = true;
		this.shieldTimer = CONFIG.shieldRecharge;
		this._bubbleFlash = 0;
	}
}
