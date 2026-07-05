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
	// The run: perpetually generated but finite
	courseLength: 60000,     // units from start to the finish gate
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

	// Multilock — the Overdrive Core powerup. Fly through the Core (waiting on
	// the centerline at the exit of squeeze 1) to unlock: hold RIGHT mouse to
	// paint targets near the crosshair, release to loose a homing volley that
	// detonates as an ascending arpeggio. Left-mouse plucks are untouched.
	coreZ: 26500,            // course distance of the Overdrive Core
	coreAutoGrantZ: 27600,   // failsafe: absorbed automatically past this
	coreRadius: 200,         // fly-through claim radius
	multilockMax: 6,         // total simultaneous paint locks
	multilockStack: 3,       // max locks stacked on a single target
	multilockDamage: 3,      // damage per volley missile
	multilockTurn: 5.0,      // rad/s homing for volley missiles (plucks: 2.6)
	multilockRegen: 1.5,     // seconds to regain one lock charge
	multilockRingBonus: 2,   // lock charges per ring threaded

	// The Architect — boss fight before the gate
	bossStartZ: 54000,       // the Architect engages here (p 0.90)
	bossArenaSpeed: 150,     // forward speed cap during the fight
	bossHoldZ: 59200,        // the run never passes this while the boss lives

	// Scoring
	scoreAsteroid: 50,
	scoreShard: 500,
	scoreSeeker: 300,
	scoreBastion: 1500,
};

// Enemy waves keyed to run progress (fraction 0..1). Front half (pre-Core)
// is the single-lock tutorial; from the Core (p 0.44) on, every wave is a
// simultaneous/swarm problem that a painted multilock volley answers.
export const WAVES = [
	{ at: 0.07, shards: 3, seekers: 0, bastions: 0, text: 'HOSTILES INBOUND' },
	{ at: 0.19, shards: 0, seekers: 4, bastions: 0, text: 'SEEKERS LAUNCHED' },
	{ at: 0.31, shards: 2, seekers: 0, bastions: 1, text: 'BASTION DETECTED' },
	{ at: 0.45, shards: 3, seekers: 4, bastions: 0, text: null },              // fires as the Core is claimed
	{ at: 0.50, shards: 6, seekers: 0, bastions: 0, text: 'PAINT THE FORMATION' },
	{ at: 0.57, shards: 0, seekers: 4, bastions: 2, text: 'HEAVY RESISTANCE' },
	{ at: 0.65, shards: 2, seekers: 3, bastions: 0, text: 'SEEKER SWARM' },
	{ at: 0.665, shards: 0, seekers: 3, bastions: 0, text: null },             // swarm's second trio, staggered
	{ at: 0.71, shards: 3, seekers: 0, bastions: 0, text: null },              // inside squeeze 2 — volley-clear
	{ at: 0.79, shards: 3, seekers: 2, bastions: 1, text: 'FINAL PICKET' },
	{ at: 0.86, shards: 0, seekers: 0, bastions: 0, text: 'CORE SIGNATURE DETECTED' },
];
