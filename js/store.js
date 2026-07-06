// Shared palette + game tuning. One place to tweak the feel.

export const Colors = {
	bg: 0x0d0221,
	deepPurple: 0x261447,
	grayPurple: 0x241734,
	cyan: 0x2de2e6,
	pink: 0xff3864,
	orange: 0xff6c11,
	lightOrange: 0xff9011,
	white: 0xffffff,
};

export const CONFIG = {
	// The run: perpetually generated but finite. Two stages: the meteorite
	// gauntlet (0..stage1End, ends at the Architect's gate), then THE RINGS —
	// the destination planet's ring system, flat co-moving debris bands with
	// gap channels, ending at the final gate.
	courseLength: 105000,    // total: stage 1 (60k) + the rings (45k)
	stage1End: 60000,        // the Architect's gate — crossing it enters the rings
	chunkDepth: 2000,        // field generation slab depth
	chunksAhead: 5,          // slabs kept generated in front of the ship
	seed: 1984,              // deterministic field — same gauntlet every run

	// Alternate routes: the field is carved into flyable corridors that fork
	// and merge. Pick a lane at the split rings; each fork's two branches
	// diverge to ±forkSpread and rejoin.
	corridorRadius: 430,     // clear space around each route centerline
	forkSpread: 1150,        // lateral offset of each branch at full split
	forkBlend: 2600,         // units over which a fork opens/closes
	forks: [                 // course-distance ranges where the route is split
		{ start: 9000, end: 21000 },
		{ start: 27000, end: 39000 },
		{ start: 45000, end: 57000 },
		{ start: 76000, end: 90000 },  // the rings: split around the shepherd swarm
	],
	routeRingSpacing: 1500,  // guidance rings along each corridor
	// squeeze zones: the corridor narrows and fills with debris — thread it
	squeezes: [
		{ start: 22800, end: 26000 },
		{ start: 40800, end: 44200 },
	],
	squeezeRadius: 235,

	// Flight model (WASD steering; slewed input, bank leads the turn)
	cruiseSpeed: 380,
	brakeSpeed: 190,
	boostSpeed: 980,
	speedLerp: 2.4,          // how fast speed approaches target
	maxYaw: 0.74,            // rad, steering cone half-angle
	maxPitch: 0.58,
	steerLerp: 5.5,          // heading response (bank is faster, see ship.js)
	barrelTime: 0.55,        // s for a full Q/E barrel roll
	barrelDodge: 760,        // peak lateral dodge speed during a barrel roll
	boostDrain: 34,          // per second
	boostRegen: 16,
	boostMax: 100,

	// Combat
	playerHp: 5,
	shieldRecharge: 9,       // s without using it before the shield is back
	shipRadius: 8,
	boltSpeed: 2600,
	enemyBoltSpeed: 1050,
	fireInterval: 0.12,      // seconds between player shots (hold to fire)
	boltRange: 3800,
	lockRangePx: 100,        // px from crosshair to start tracking
	lockSnapPx: 48,          // px to fully lock (homing bolts)
	homingTurn: 2.6,         // rad/s bolt steering when locked
	invulnTime: 1.4,         // s of grace after taking a hit

	// Multilock — the MULTI-PHASER powerup. Fly through it (waiting on the
	// centerline at the exit of squeeze 1) to unlock: hold RIGHT mouse or
	// Ctrl (touchpads) to paint targets near the crosshair, release to loose
	// a homing volley that detonates as an ascending arpeggio. Left-mouse
	// plucks are untouched.
	phaserZ: 26500,          // course distance of the Multi-Phaser pickup
	phaserAutoGrantZ: 27600, // failsafe: absorbed automatically past this
	phaserRadius: 200,       // fly-through claim radius
	multilockMax: 6,         // total simultaneous paint locks
	multilockStack: 3,       // max locks stacked on a single target
	multilockDamage: 3,      // damage per volley missile
	multilockTurn: 5.0,      // rad/s homing for volley missiles (plucks: 2.6)
	multilockRegen: 1.5,     // seconds to regain one lock charge
	multilockRingBonus: 2,   // lock charges per ring threaded

	// The Architect — boss fight before the stage 1 gate
	bossStartZ: 54000,       // the Architect engages here
	bossArenaSpeed: 150,     // forward speed cap during the fight
	bossHoldZ: 59200,        // stage 1 never ends while the boss lives

	// The Rings (stage 2): flat debris bands orbiting the destination planet
	ringPlaneSpread: 170,    // vertical thickness of the main debris sheet
	ringOrbitSpeed: 110,     // co-moving band speed (same direction as flight)
	ringOrbitSpread: 80,     // ± variation per rock

	// Tractor Array — stage 2 pickup. Hold E to gather nearby debris into a
	// protective orbit; release to fling the whole cloud where you're aiming.
	tractorZ: 73000,
	tractorRadius: 200,      // fly-through claim radius
	tractorReach: 750,       // gather range
	tractorMaxRocks: 8,
	tractorOrbitR: 95,       // holding-shell radius around the ship
	tractorFlingSpeed: 950,

	// Scoring
	scoreAsteroid: 50,
	scoreShard: 500,
	scoreSeeker: 300,
	scoreBastion: 1500,
};

// Enemy waves keyed to course distance (units). Stage 1 front half (pre-
// Phaser) is the single-lock tutorial; from the Multi-Phaser (26.5k) on,
// every wave is a swarm problem the painted volley answers. Stage 2 (the
// rings) leans on the environment: seekers die to the bands, the tractor
// turns the bands into ammunition.
export const WAVES = [
	{ at: 4200, shards: 3, seekers: 0, bastions: 0, text: 'HOSTILES INBOUND' },
	{ at: 11400, shards: 0, seekers: 4, bastions: 0, text: 'SEEKERS LAUNCHED' },
	{ at: 18600, shards: 2, seekers: 0, bastions: 1, text: 'BASTION DETECTED' },
	{ at: 27000, shards: 3, seekers: 4, bastions: 0, text: null },             // fires as the Phaser is claimed
	{ at: 30000, shards: 6, seekers: 0, bastions: 0, text: 'PAINT THE FORMATION' },
	{ at: 34200, shards: 0, seekers: 4, bastions: 2, text: 'HEAVY RESISTANCE' },
	{ at: 39000, shards: 2, seekers: 3, bastions: 0, text: 'SEEKER SWARM' },
	{ at: 39900, shards: 0, seekers: 3, bastions: 0, text: null },             // swarm's second trio, staggered
	{ at: 42600, shards: 3, seekers: 0, bastions: 0, text: null },             // inside squeeze 2 — volley-clear
	{ at: 47400, shards: 3, seekers: 2, bastions: 1, text: 'FINAL PICKET' },
	{ at: 51600, shards: 0, seekers: 0, bastions: 0, text: 'CORE SIGNATURE DETECTED' },
	// —— the rings ——
	{ at: 63500, shards: 4, seekers: 0, bastions: 0, text: 'RING HOSTILES' },
	{ at: 69000, shards: 0, seekers: 5, bastions: 0, text: 'SEEKERS — USE THE BANDS' },
	{ at: 75500, shards: 3, seekers: 0, bastions: 1, text: 'GATHER AND FLING' },
	{ at: 82000, shards: 0, seekers: 4, bastions: 1, text: null },
	{ at: 88500, shards: 6, seekers: 0, bastions: 0, text: 'FORMATION IN THE BANDS' },
	{ at: 95500, shards: 2, seekers: 4, bastions: 2, text: 'FINAL GUARD' },
	{ at: 101000, shards: 0, seekers: 0, bastions: 0, text: 'THE LAST GATE' },
];
