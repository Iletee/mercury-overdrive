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

		this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
		this._fwd = new THREE.Vector3();
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
		// --- steering: mouse maps to a target heading inside a cone; sharp lerp toward it
		let tx = THREE.MathUtils.clamp(input.mouseX, -1, 1);
		let ty = THREE.MathUtils.clamp(input.mouseY, -1, 1);
		// soft corridor: steer back when drifting far off the field axis
		tx -= THREE.MathUtils.clamp(this.position.x / 2600, -0.55, 0.55);
		ty -= THREE.MathUtils.clamp(this.position.y / 1600, -0.55, 0.55);

		const targetYaw = -tx * CONFIG.maxYaw;
		const targetPitch = ty * CONFIG.maxPitch;
		const k = Math.min(1, dt * CONFIG.steerLerp);
		this.yaw += (targetYaw - this.yaw) * k;
		this.pitch += (targetPitch - this.pitch) * k;

		// bank into turns + manual roll
		let targetRoll = (targetYaw - this.yaw) * 3.2;
		if (input.rollLeft) targetRoll += 1.3;
		if (input.rollRight) targetRoll -= 1.3;
		this.roll += (targetRoll - this.roll) * Math.min(1, dt * 6);

		this._euler.set(this.pitch, this.yaw, this.roll);
		this.quaternion.setFromEuler(this._euler);
		this.group.quaternion.copy(this.quaternion);

		// --- throttle
		this.boostEngaged = input.boosting && this.boost > (this.boostEngaged ? 0 : 12);
		let targetSpeed = CONFIG.cruiseSpeed;
		if (input.throttleUp) targetSpeed = CONFIG.cruiseSpeed * 1.35;
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

		// --- timers & visuals
		if (this.invuln > 0) {
			this.invuln -= dt;
			this.edges.material.opacity = (Math.sin(performance.now() * 0.03) > 0) ? 1 : 0.15;
		} else {
			this.edges.material.opacity = 1;
		}
		this._beatKick = Math.max(0, this._beatKick - dt * 4);
		const thrust = this.speed / CONFIG.boostSpeed;
		this.exhaust.scale.set(1, 0.6 + thrust * 2.2 + this._beatKick * 0.5, 1);
		this.exhaust.material.opacity = 0.45 + thrust * 0.5 + this._beatKick * 0.3;
		this.glow.intensity = 70 + thrust * 90 + this._beatKick * 60;
		this._shake = Math.max(0, this._shake - dt * 3.2);
	}

	updateCamera(camera, dt) {
		// chase rig: yaw/pitch follow fully, roll only partially (keeps stomachs settled)
		this._euler.set(this.pitch, this.yaw, this.roll * 0.35);
		this._camQuat.setFromEuler(this._euler);

		this._camPos.set(0, 13, 46).applyQuaternion(this._camQuat).add(this.position);
		const k = Math.min(1, dt * 10);
		camera.position.lerp(this._camPos, k);

		this.forward(this._fwd);
		this._camTarget.copy(this.position).addScaledVector(this._fwd, 220);
		camera.lookAt(this._camTarget);
		camera.quaternion.slerp(this._camQuat, 0.15); // blend in a touch of bank

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

	takeDamage(n = 1) {
		if (this.invuln > 0 || !this.alive) return false;
		this.hp -= n;
		this.invuln = CONFIG.invulnTime;
		this._shake = 1;
		return true;
	}

	nudgeOutOf(normal, depth) {
		this.position.addScaledVector(normal, depth + 3);
	}

	beatPulse() { this._beatKick = 1; }
	shake(n = 0.6) { this._shake = Math.max(this._shake, n); }

	reset() {
		this.position.set(0, 0, 0);
		this.yaw = this.pitch = this.roll = 0;
		this.quaternion.identity();
		this.group.quaternion.identity();
		this.speed = CONFIG.cruiseSpeed;
		this.boost = CONFIG.boostMax;
		this.hp = CONFIG.playerHp;
		this.invuln = 0;
		this._shake = 0;
	}
}
