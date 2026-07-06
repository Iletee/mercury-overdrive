// Rock physics — Box3D (Erin Catto's 3D rigid body engine) via the box3d.js
// WASM bindings. A physics "bubble" follows the ship: asteroid records near
// it get dynamic sphere bodies that drift, tumble, and collide; leaving the
// bubble hands a rock back to its scripted slow spin. Space has no gravity —
// all the motion comes from impulses: bolts kick rocks, every explosion is a
// real radial blast (b3World_Explode), and rocks that slam into each other
// above the hit threshold chip away (slightly destructible, dangerously so).

import Box3D from 'box3d.js/inline';

const BUBBLE_AHEAD = 4000;   // covers bolt range — kills always birth live fragments
const BUBBLE_BEHIND = 500;
const BUBBLE_X = 2300;       // lateral extent (backdrop monoliths stay scripted)
const BUBBLE_Y = 1600;
const MAX_BODIES = 300;
const FIXED_DT = 1 / 60;
const DENSITY = 1;           // game units are big; impulses are tuned against this
const HIT_SPEED = 80;        // world hit-event threshold (approach speed, u/s)
const DRIFT = 10;            // idle drift velocity on adoption, ±u/s per axis

export class RockPhysics {
	constructor() {
		this.ready = false;
		// (rec, {x,y,z} point, approachSpeed) — a rock got slammed hard; main
		// decides whether it chips. Fired at most a few times per step.
		this.onRockImpact = () => {};

		this._entries = new Map();  // rec -> { body, shapeKey, bodyKey }
		this._byBody = new Map();   // bodyId.index1 -> rec
		this._byShape = new Map();  // shapeId.index1 -> rec
		this._acc = 0;
	}

	// WASM loads async; the game runs fine before ready (rocks just stay on
	// their scripted tumble until the module arrives — usually mid title).
	async init() {
		const b3 = this.b3 = await Box3D();
		const wd = b3.b3DefaultWorldDef();
		wd.gravity = { x: 0, y: 0, z: 0 };
		wd.hitEventThreshold = HIT_SPEED;
		wd.maximumLinearSpeed = 2800; // above anything a blast can produce
		this.world = b3.b3CreateWorld(wd);
		// zero-alloc event plumbing: one buffer + scratch objects, reused forever
		this._events = b3.createEventsBuffer();
		this._hit = b3.createContactHitEvent();
		this._move = b3.createBodyMoveEvent();
		this.ready = true;
	}

	_inBubble(rec, shipPos) {
		const dz = rec.pos.z - shipPos.z; // negative = ahead
		if (dz < -BUBBLE_AHEAD || dz > BUBBLE_BEHIND) return false;
		return Math.abs(rec.pos.x - shipPos.x) < BUBBLE_X
			&& Math.abs(rec.pos.y - shipPos.y) < BUBBLE_Y;
	}

	_adopt(rec) {
		const b3 = this.b3;
		const bd = b3.b3DefaultBodyDef();
		bd.type = b3.b3BodyType.b3_dynamicBody;
		bd.position = { x: rec.pos.x, y: rec.pos.y, z: rec.pos.z };
		// box3d quats are vector/scalar form: v = xyz, s = w
		bd.rotation = { v: { x: rec.quat.x, y: rec.quat.y, z: rec.quat.z }, s: rec.quat.w };
		// fragments inherit their parent's velocity (rec.vel); everything else
		// wakes up with a gentle drift so the field reads as alive
		bd.linearVelocity = rec.vel
			? { x: rec.vel.x, y: rec.vel.y, z: rec.vel.z }
			: {
				x: (Math.random() * 2 - 1) * DRIFT,
				y: (Math.random() * 2 - 1) * DRIFT,
				z: (Math.random() * 2 - 1) * DRIFT,
			};
		// take over the scripted tumble exactly where it was
		bd.angularVelocity = {
			x: rec.axis.x * rec.spin,
			y: rec.axis.y * rec.spin,
			z: rec.axis.z * rec.spin,
		};
		// blasted rocks shouldn't keep their speed across the whole course
		bd.linearDamping = 0.06;
		bd.angularDamping = 0.04;
		const body = b3.b3CreateBody(this.world, bd);

		const sd = b3.b3DefaultShapeDef();
		sd.density = DENSITY;
		sd.enableHitEvents = true;
		sd.baseMaterial.friction = 0.35;
		sd.baseMaterial.restitution = 0.55;
		// radius matches the analytic bolt/ship collision forgiveness (0.82)
		const shape = b3.b3CreateSphereShape(body, sd, {
			center: { x: 0, y: 0, z: 0 }, radius: rec.r * 0.82,
		});

		this._entries.set(rec, { body, bodyKey: body.index1, shapeKey: shape.index1 });
		this._byBody.set(body.index1, rec);
		this._byShape.set(shape.index1, rec);
		rec.simulated = true;
		rec.vel = null;
	}

	_retire(rec) {
		const e = this._entries.get(rec);
		if (!e) return;
		// hand real momentum back to the record: outside the bubble the field
		// integrates rec.vel kinematically, so a shoved rock keeps flying
		const v = this.b3.b3Body_GetLinearVelocity(e.body);
		rec.vel = (v.x * v.x + v.y * v.y + v.z * v.z > 25)
			? { x: v.x, y: v.y, z: v.z } : null;
		this._entries.delete(rec);
		this._byBody.delete(e.bodyKey);
		this._byShape.delete(e.shapeKey);
		this.b3.b3DestroyBody(e.body);
		rec.simulated = false;
	}

	// field calls this from _despawn so bodies never outlive their records
	removeFor(rec) {
		if (this.ready) this._retire(rec);
	}

	update(dt, field, shipPos) {
		if (!this.ready) return;
		const b3 = this.b3;

		// membership: adopt rocks entering the bubble, retire the leavers.
		// Adoptions are capped per frame — crossing a chunk boundary in a
		// dense band shouldn't cost a burst of body creation in one frame.
		let adopts = 0;
		for (const rec of field.records) {
			const has = this._entries.has(rec);
			const inB = this._inBubble(rec, shipPos);
			if (!has && inB && this._entries.size < MAX_BODIES && adopts < 24) {
				this._adopt(rec);
				adopts += 1;
			} else if (has && !inB) this._retire(rec);
		}

		// fixed-step with an accumulator (clamped: never spiral on a long frame)
		this._acc = Math.min(this._acc + dt, FIXED_DT * 4);
		let stepped = false;
		while (this._acc >= FIXED_DT) {
			b3.b3World_Step(this.world, FIXED_DT, 4);
			this._acc -= FIXED_DT;
			stepped = true;
		}
		if (!stepped) return;

		b3.getEvents(this._events, this.world);

		// write moved bodies back into their records — the instanced renderer,
		// bolt raycasts, and ship collision all read rec.pos/rec.quat directly
		const moves = b3.getNumBodyMoveEvents(this._events);
		for (let i = 0; i < moves; i++) {
			b3.getBodyMoveEventAt(this._move, this._events, i);
			const rec = this._byBody.get(this._move.bodyId.index1);
			if (!rec) continue;
			const p = this._move.position, q = this._move.rotation;
			rec.pos.set(p.x, p.y, p.z);
			rec.quat.set(q.x, q.y, q.z, q.w);
		}

		// hard rock-on-rock impacts chip both parties (capped per step so a
		// blast in a dense squeeze can't cascade into a fireworks stack)
		const hits = Math.min(b3.getNumContactHitEvents(this._events), 6);
		for (let i = 0; i < hits; i++) {
			b3.getContactHitEventAt(this._hit, this._events, i);
			const a = this._byShape.get(this._hit.shapeIdA.index1);
			const b = this._byShape.get(this._hit.shapeIdB.index1);
			if (a) this.onRockImpact(a, this._hit.point, this._hit.approachSpeed);
			if (b) this.onRockImpact(b, this._hit.point, this._hit.approachSpeed);
		}
	}

	// shove one rock: dv is a target speed change, so small rocks fly and
	// giants shrug (impulse = mass * dv, mass ~ r^3)
	kick(rec, dir, dv) {
		if (!this.ready) return;
		const e = this._entries.get(rec);
		if (!e) return;
		const m = this.b3.b3Body_GetMass(e.body);
		this.b3.b3Body_ApplyLinearImpulseToCenter(e.body, {
			x: dir.x * m * dv, y: dir.y * m * dv, z: dir.z * m * dv,
		}, true);
	}

	// radial blast — impulse per projected area, so dv falls off ~1/r
	// naturally: debris scatters, mid rocks lumber, monoliths ignore it
	blast(center, radius, impulsePerArea) {
		if (!this.ready) return;
		const ex = this.b3.b3DefaultExplosionDef();
		ex.position = { x: center.x, y: center.y, z: center.z };
		ex.radius = radius;
		ex.falloff = 0.5;
		ex.impulsePerArea = impulsePerArea;
		this.b3.b3World_Explode(this.world, ex);
	}

	// tractor: velocity-steer a rock toward a target point (spring-ish, frame
	// safe — used to hold captured debris in orbit around the ship)
	steerTo(rec, target, dt, maxSpeed = 620) {
		if (!this.ready) return;
		const e = this._entries.get(rec);
		if (!e) return;
		const b3 = this.b3;
		const p = b3.b3Body_GetPosition(e.body);
		let dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
		const d = Math.hypot(dx, dy, dz);
		const want = Math.min(maxSpeed, d * 4);
		if (d > 0.001) { dx = dx / d * want; dy = dy / d * want; dz = dz / d * want; }
		const v = b3.b3Body_GetLinearVelocity(e.body);
		const blend = Math.min(1, dt * 9);
		b3.b3Body_SetLinearVelocity(e.body, {
			x: v.x + (dx - v.x) * blend,
			y: v.y + (dy - v.y) * blend,
			z: v.z + (dz - v.z) * blend,
		});
	}

	// tractor release: hurl a rock in a direction at a fixed speed
	fling(rec, dir, speed) {
		if (!this.ready) return;
		const e = this._entries.get(rec);
		if (!e) return;
		this.b3.b3Body_SetLinearVelocity(e.body, {
			x: dir.x * speed, y: dir.y * speed, z: dir.z * speed,
		});
	}

	// fragment inheritance: what was the parent doing when it shattered?
	velocityOf(rec) {
		if (!this.ready) return null;
		const e = this._entries.get(rec);
		if (!e) return null;
		return this.b3.b3Body_GetLinearVelocity(e.body);
	}

	reset() {
		if (!this.ready) return;
		for (const rec of [...this._entries.keys()]) this._retire(rec);
		this._acc = 0;
	}
}
