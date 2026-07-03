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

	// Flight model
	cruiseSpeed: 340,
	brakeSpeed: 170,
	boostSpeed: 920,
	speedLerp: 2.2,          // how fast speed approaches target
	maxYaw: 0.62,            // rad, steering cone half-angle
	maxPitch: 0.5,
	steerLerp: 7.0,          // sharpness of steering response
	boostDrain: 34,          // per second
	boostRegen: 16,
	boostMax: 100,

	// Combat
	playerHp: 5,
	shipRadius: 8,
	boltSpeed: 2600,
	enemyBoltSpeed: 1050,
	fireInterval: 0.12,      // seconds between player shots (hold to fire)
	boltRange: 3800,
	lockRangePx: 100,        // px from crosshair to start tracking
	lockSnapPx: 48,          // px to fully lock (homing bolts)
	homingTurn: 2.6,         // rad/s bolt steering when locked
	invulnTime: 1.4,         // s of grace after taking a hit

	// Scoring
	scoreAsteroid: 50,
	scoreShard: 500,
	scoreSeeker: 300,
	scoreBastion: 1500,
};

// Enemy waves keyed to run progress (fraction 0..1)
export const WAVES = [
	{ at: 0.07, shards: 3, seekers: 0, bastions: 0, text: 'HOSTILES INBOUND' },
	{ at: 0.19, shards: 0, seekers: 4, bastions: 0, text: 'SEEKERS LAUNCHED' },
	{ at: 0.31, shards: 2, seekers: 0, bastions: 1, text: 'BASTION DETECTED' },
	{ at: 0.44, shards: 2, seekers: 5, bastions: 0, text: null },
	{ at: 0.58, shards: 0, seekers: 0, bastions: 2, text: 'HEAVY RESISTANCE' },
	{ at: 0.72, shards: 4, seekers: 3, bastions: 0, text: null },
	{ at: 0.86, shards: 0, seekers: 4, bastions: 1, text: 'FINAL PICKET — GATE AHEAD' },
];
