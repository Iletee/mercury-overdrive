// Tractor Array — stage 2's pickup. Hold E to drag nearby small rocks into
// a slowly-rotating orbital shell around the ship: they soak enemy bolts
// (the existing bolt-vs-rock collision does the work) and read as a whirling
// debris shield. Release to fling the whole cloud toward the crosshair at
// smash speed — the rock-vs-enemy kinetic-kill rule turns it into a shotgun.

import * as THREE from 'three';
import { CONFIG } from './store.js';

export class TractorArray {
	constructor(ship, field, physics) {
		this.ship = ship;
		this.field = field;
		this.physics = physics;
		this.enabled = false;
		this.captured = [];
		this.events = { onGrab: () => {}, onFling: () => {} };
		this._spin = 0;
		this._slot = new THREE.Vector3();
		this._wasHolding = false;
	}

	get count() { return this.captured.length; }

	update(dt, input, aimDir) {
		if (!this.enabled) return;

		// drop anything that died or lost its physics body
		if (this.captured.length) {
			this.captured = this.captured.filter((r) => r.alive && r.simulated);
		}

		const holding = input.tractoring && this.ship.alive;
		if (holding) {
			this._spin += dt * 1.6;
			this._gather();
			this._hold(dt);
		} else if (this._wasHolding && this.captured.length) {
			this._fling(aimDir);
		}
		this._wasHolding = holding;
	}

	_gather() {
		if (this.captured.length >= CONFIG.tractorMaxRocks) return;
		const sp = this.ship.position;
		for (const rec of this.field.records) {
			if (!rec.simulated || rec.r > 45) continue;
			if (this.captured.includes(rec)) continue;
			if (Math.abs(rec.pos.z - sp.z) > CONFIG.tractorReach) continue;
			if (rec.pos.distanceTo(sp) > CONFIG.tractorReach) continue;
			this.captured.push(rec);
			this.events.onGrab(this.captured.length);
			if (this.captured.length >= CONFIG.tractorMaxRocks) break;
		}
	}

	// hold each rock at its own slot on a tilted, rotating shell — a living
	// debris shield that also happens to be ammunition
	_hold(dt) {
		const sp = this.ship.position;
		const R = CONFIG.tractorOrbitR;
		for (let i = 0; i < this.captured.length; i++) {
			const a = this._spin + (i / CONFIG.tractorMaxRocks) * Math.PI * 2;
			this._slot.set(
				sp.x + Math.cos(a) * R,
				sp.y + Math.sin(a * 1.3 + i) * R * 0.55,
				sp.z + Math.sin(a) * R * 0.8 - 25
			);
			this.physics.steerTo(this.captured[i], this._slot, dt);
		}
	}

	_fling(aimDir) {
		for (const rec of this.captured) {
			this.physics.fling(rec, aimDir, CONFIG.tractorFlingSpeed);
		}
		this.events.onFling(this.captured.length);
		this.captured.length = 0;
	}

	reset() {
		this.enabled = false;
		this.captured.length = 0;
		this._wasHolding = false;
	}
}
