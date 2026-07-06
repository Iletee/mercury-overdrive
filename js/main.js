// Mercury Overdrive — a Tron-styled meteorite gauntlet.
// Bootstraps the renderer, wires every subsystem together, runs the loop.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Colors, CONFIG, WAVES } from './store.js';
import { InputState } from './controls.js';
import { PlayerShip } from './ship.js';
import { SpaceBackdrop } from './sky.js';
import { AsteroidField } from './field.js';
import { WeaponSystem } from './weapons.js';
import { EnemyManager } from './enemies.js';
import { FXSystem } from './fx.js';
import { MicroDebris } from './debris.js';
import { SynthwaveEngine } from './music.js';
import { HUD } from './hud.js';
import { ArchitectBoss } from './boss.js';
import { RockPhysics } from './physics.js';

const State = { TITLE: 0, PLAYING: 1, GAMEOVER: 2, VICTORY: 3 };

let state = State.TITLE;
let score = 0;
let elapsed = 0;
let waveIndex = 0;
let ringStreak = 0;
let scoreMult = 1;
let multTimer = 0;
let prevShipZ = 0;
let hitstop = 0; // brief time-dilation on kills — makes hits land
let phaserClaimed = false;  // the Multi-Phaser (multilock + lead unlock)
let phaserTelegraphed = false;
let bossEngaged = false;

// --- renderer / scene / camera -------------------------------------------
const container = document.getElementById('world');
const scene = new THREE.Scene();
scene.background = new THREE.Color(Colors.bg);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 30000);
camera.position.set(0, 13, 46);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.05, 0.55, 0.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// --- lights ----------------------------------------------------------------
const hemi = new THREE.HemisphereLight(Colors.deepPurple, Colors.bg, 2.2);
const ambient = new THREE.AmbientLight(0x342055, 1.4);
const sunLight = new THREE.DirectionalLight(0xffd2a8, 2.4);
scene.add(hemi, ambient, sunLight, sunLight.target);

// --- systems ----------------------------------------------------------------
const input = new InputState(container);
const hud = new HUD();
hud.mount();
const music = new SynthwaveEngine();
const backdrop = new SpaceBackdrop(scene);
const field = new AsteroidField(scene);
const ship = new PlayerShip(scene);
const weapons = new WeaponSystem(scene, camera, ship, field);
const enemies = new EnemyManager(scene, ship, weapons);
const fx = new FXSystem(scene, camera);
const debris = new MicroDebris(scene);
const boss = new ArchitectBoss(scene, ship, weapons, enemies, fx);
// Box3D rock physics — WASM loads async; until then rocks stay scripted
const physics = new RockPhysics();
physics.init();
field.physics = physics;

// --- the Multi-Phaser: the multilock powerup, waiting on the centerline
// at the exit of squeeze 1. Fly through it to claim.
const phaser = new THREE.Group();
const phaserInner = new THREE.Mesh(
	new THREE.OctahedronGeometry(48, 0),
	new THREE.MeshStandardMaterial({
		color: 0x12081f, roughness: 0.3, metalness: 0.7, flatShading: true,
		emissive: Colors.white, emissiveIntensity: 0.9,
	})
);
const phaserInnerEdges = new THREE.LineSegments(
	new THREE.EdgesGeometry(phaserInner.geometry),
	new THREE.LineBasicMaterial({ color: Colors.white, transparent: true, opacity: 0.95 })
);
const phaserOuter = new THREE.LineSegments(
	new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(70, 0)),
	new THREE.LineBasicMaterial({ color: Colors.cyan, transparent: true, opacity: 0.8 })
);
phaser.add(phaserInner, phaserInnerEdges, phaserOuter);
{
	const c = field.routeCenters(CONFIG.phaserZ)[0];
	phaser.position.set(c.x, c.y, -CONFIG.phaserZ);
}
scene.add(phaser);

// --- event wiring ------------------------------------------------------------
// the ascending shot melody, made visible: each shot climbs the palette,
// resetting every bar in step with the music engine's pentatonic run
const SHOT_COLORS = [0x2de2e6, 0x4bd0f0, 0x7ab8ff, 0x9d8cff, 0xc76bff, 0xff5fd0, 0xff3864, 0xffffff];
let shotIdx = 0;
weapons.events.onShoot = () => {
	music.playerShoot();
	shotIdx = Math.min(shotIdx + 1, SHOT_COLORS.length - 1);
	weapons.nextBoltColor = SHOT_COLORS[shotIdx];
};
music.onBar(() => {
	shotIdx = 0;
	weapons.nextBoltColor = SHOT_COLORS[0];
});

weapons.events.onLockChange = (lockState) => {
	if (lockState === 'locked') music.lockOn();
};

weapons.events.onEnemyHit = (e, point, dmg = 1) => {
	fx.spawnHitSpark(point, e.color);
	if (enemies.damage(e, dmg)) {
		const big = e.type === 'bastion' || e.type === 'bosscore';
		fx.spawnExplosion(e.position, e.color, big ? 3 : 1.5);
		fx.spawnShockwave(e.position, e.color, big ? 3 : 1.3);
		hitstop = big ? 0.1 : 0.06;
		ship.shake(big ? 0.5 : 0.25);
		music.explosion(big);
		physics.blast(e.position, big ? 420 : 260, big ? 5200 : 3200);
		addScore(e.score);
	}
};

// multilock: each paint is a note walking up the scale; the volley strums
weapons.events.onPaint = (k) => music.multilockPaint(k);
weapons.events.onVolley = (n) => music.multilockVolley(n);

// a rock died — fx, music, a real blast wave into the field, maybe score
function rockDestroyed(rec, byPlayer) {
	fx.spawnExplosion(rec.pos, Colors.orange, Math.max(1, rec.r / 18));
	if (rec.r > 55) {
		fx.spawnShockwave(rec.pos, Colors.orange, Math.min(3, rec.r / 45));
		if (byPlayer) hitstop = 0.05;
	}
	music.explosion(rec.r > 120);
	physics.blast(rec.pos, rec.r * 2.4 + 120, rec.r > 55 ? 2600 : 1500);
	if (byPlayer) addScore(Math.round(CONFIG.scoreAsteroid + rec.r * 2)); // big rocks pay big
}

// how hard a bolt shoves a rock: target speed change, small rocks fly
function boltKick(rec, dir, dmg) {
	const dv = Math.min(170, Math.max(6, 240 * 16 / rec.r)) * (1 + (dmg - 1) * 0.4);
	physics.kick(rec, dir, dv);
}

weapons.events.onAsteroidHit = (rec, point, dir, dmg = 1) => {
	fx.spawnHitSpark(point, Colors.cyan);
	boltKick(rec, dir, dmg);
	if (field.damage(rec, dmg)) rockDestroyed(rec, true);
};

// enemy fire chips rocks too — and their bolts fly toward YOU, so the
// debris they knock loose becomes your problem
weapons.events.onEnemyBoltRock = (rec, point, dir) => {
	fx.spawnHitSpark(point, Colors.orange);
	boltKick(rec, dir, 1.4);
	if (field.damage(rec, 1)) rockDestroyed(rec, false);
};

// rocks slamming into each other above the hit threshold chip away
const _impactV = new THREE.Vector3();
physics.onRockImpact = (rec, point, speed) => {
	if (speed < 115 || state !== State.PLAYING) return;
	_impactV.set(point.x, point.y, point.z);
	fx.spawnHitSpark(_impactV, Colors.orange);
	if (field.damage(rec, 1)) rockDestroyed(rec, false);
};

weapons.events.onPlayerHit = (point) => {
	fx.spawnHitSpark(point, Colors.pink);
	hurtPlayer();
};

enemies.events.onSeekerBlast = (e) => {
	fx.spawnExplosion(e.position, Colors.orange, 2.2);
	music.explosion(true);
	ship.shake(1);
	physics.blast(e.position, 320, 3800);
	hurtPlayer();
};

enemies.events.onEnemyShoot = (e) => {
	if (e.position.distanceTo(ship.position) < 1800) music.enemyShoot();
};

// --- the Architect (boss) ----------------------------------------------------
boss.events.onPhase = (n) => {
	music.bossPhase(n);
	hud.showWave(n === 2 ? 'CORE EXPOSED' : 'ARCHITECT OVERLOAD');
};
boss.events.onPlayerHit = () => {
	ship.shake(0.7);
	hurtPlayer();
};
boss.events.onShoot = () => music.enemyShoot();
boss.events.onNodeDown = (remaining) => {
	if (remaining > 0) hud.showWave(`SHIELD LATTICE ${remaining}/6`);
};
boss.events.onDefeated = () => {
	music.setBoss(false);
	music.explosion(true);
	music.gateChime();
	hitstop = 0.3;
	ship.shake(1.5);
	ship.speedCap = null;
	field.setGateLit(true);
	hud.hideBoss();
	hud.showWave('ARCHITECT DEREZZED — GATE OPEN');
	addScore(10000);
};

music.onBeat(({ beat, bar }) => {
	if (state !== State.PLAYING) return;
	// The pulsar in the sky is the visible source of the beat (big halo ring
	// on the downbeat); the world around the ship only shimmers in sympathy.
	backdrop.beatPulse(beat % 4 === 0 ? 1 : 0.55);
	field.beatPulse(0.55);
	fx.beatPulse(1);
	debris.beatPulse(1);
	hud.beatPulse();
	enemies.beatPulse();
	if (beat % 2 === 0) ship.beatPulse();
	if (bossEngaged && !boss.defeated) boss.beat(beat, bar);
});

function claimPhaser(auto) {
	phaserClaimed = true;
	phaser.visible = false;
	weapons.multilockEnabled = true;
	weapons.lockCharge = CONFIG.multilockMax;
	// the lead instrument is the Phaser's sonic reward — it sings from here on
	music.setLeadUnlocked(true);
	music.gateChime();
	fx.spawnShockwave(phaser.position, Colors.white, 4);
	fx.spawnExplosion(phaser.position, Colors.cyan, 2.5);
	hitstop = 0.15;
	ship.shake(0.6);
	hud.showMultilock();
	hud.showWave(auto ? 'MULTI-PHASER ABSORBED' : 'MULTI-PHASER ONLINE');
	setTimeout(() => {
		if (state === State.PLAYING) hud.showWave('HOLD RMB OR CTRL TO PAINT — RELEASE TO VOLLEY');
	}, 2300);
}

function addScore(n) {
	score += n * scoreMult;
	hud.setScore(score);
}

function hurtPlayer() {
	const result = ship.takeDamage(1);
	if (!result) return;
	if (result === 'shield') {
		music.shieldHit();
		return;
	}
	hud.damageFlash();
	hud.setHull(ship.hp, CONFIG.playerHp);
	music.playerHit();
	if (ship.hp <= 0) endGame(false);
}

ship.onShieldUp = () => music.shieldUp();

// --- state transitions -------------------------------------------------------
hud.bindStart(async () => {
	await music.start();
	music.setIntensity(1);
	startRun();
});

function startRun() {
	state = State.PLAYING;
	hud.hideTitle();
	hud.setHull(ship.hp, CONFIG.playerHp);
	hud.setScore(score);
	clock.getDelta(); // swallow the pause so the first frame isn't a jump
}

function restart() {
	ship.reset();
	ship.group.visible = true;
	field.reset();
	physics.reset();
	enemies.reset();
	weapons.reset();
	boss.reset();
	bossEngaged = false;
	phaserClaimed = false;
	phaserTelegraphed = false;
	phaser.visible = true;
	score = 0;
	elapsed = 0;
	waveIndex = 0;
	ringStreak = 0;
	scoreMult = 1;
	multTimer = 0;
	prevShipZ = 0;
	hud.setStreak(0, 1);
	hud.hideMultilock();
	hud.hideBoss();
	hud.setPaintMarks([]);
	camera.position.set(0, 13, 46);
	camera.quaternion.identity();
	music.setIntensity(1);
	music.setLeadUnlocked(false);
	music.setBoss(false);
	startRun();
}

function endGame(won) {
	if (won) {
		state = State.VICTORY;
		music.gateChime();
		music.setIntensity(0);
		addScore(Math.max(0, Math.round(50000 - elapsed * 100))); // time bonus
		hud.showVictory(score, elapsed, restart);
	} else {
		state = State.GAMEOVER;
		hud.setPings([]);
		hud.setPaintMarks([]);
		fx.spawnExplosion(ship.position, Colors.cyan, 3);
		music.explosion(true);
		music.gameOverSting();
		music.setIntensity(0);
		ship.group.visible = false;
		hud.showGameOver(score, restart);
	}
}

// --- per-frame -----------------------------------------------------------------
let wasBoosting = false;

function updatePlaying(dt) {
	elapsed += dt;

	ship.update(dt, input);
	ship.updateCamera(camera, dt);
	field.update(dt, ship.position.z);
	physics.update(dt, field, ship.position);
	enemies.update(dt);

	// the Multi-Phaser: fly through it to claim; auto-absorbed just past it
	// so the back half (designed around the multilock) is never unsolvable
	if (!phaserClaimed) {
		phaser.rotation.y += dt * 0.8;
		phaser.rotation.x -= dt * 0.3;
		phaserOuter.rotation.z += dt * 0.6;
		if (!phaserTelegraphed && ship.progressZ > CONFIG.phaserZ - 1600) {
			phaserTelegraphed = true;
			hud.showWave('MULTI-PHASER AHEAD');
		}
		if (ship.position.distanceTo(phaser.position) < CONFIG.phaserRadius) claimPhaser(false);
		else if (ship.progressZ > CONFIG.phaserAutoGrantZ) claimPhaser(true);
	}

	// the Architect: engages before the gate; the run holds until it falls
	if (!bossEngaged && ship.progressZ >= CONFIG.bossStartZ) {
		bossEngaged = true;
		boss.engage(ship.position.z);
		ship.speedCap = CONFIG.bossArenaSpeed;
		music.setBoss(true);
		hud.showBoss('THE ARCHITECT');
		hud.showWave('THE ARCHITECT');
	}
	if (bossEngaged) {
		boss.update(dt);
		if (!boss.defeated) {
			hud.setBossHp(boss.hpFraction);
			// never reach the gate while the boss lives
			if (ship.progressZ > CONFIG.bossHoldZ) ship.position.z = -CONFIG.bossHoldZ;
		}
	}

	weapons.update(dt, input, enemies.active);
	fx.update(dt, ship.speed, ship.position);
	debris.update(dt, ship.position, ship.speed);
	backdrop.update(dt, ship.position, progress());

	// boost audio state
	if (ship.boostEngaged !== wasBoosting) {
		music.boost(ship.boostEngaged);
		wasBoosting = ship.boostEngaged;
	}

	// ship vs rock
	const hit = field.collideSphere(ship.position, ship.radius);
	if (hit) {
		if (hit.record.r <= 45) {
			field.damage(hit.record, 99);
			fx.spawnExplosion(hit.record.pos, Colors.orange, 1.5);
			music.explosion(false);
		} else {
			ship.nudgeOutOf(hit.normal, hit.depth);
			// the hull shoves the rock too — ramming has consequences both ways
			_shipPush.copy(hit.normal).negate();
			physics.kick(hit.record, _shipPush, Math.min(60, 1400 / hit.record.r));
		}
		ship.shake(0.8);
		hurtPlayer();
	}

	// route rings: thread them for streak rewards, drift past one and it resets
	const ringEvt = field.checkRings(prevShipZ, ship.position.z, ship.position.x, ship.position.y);
	prevShipZ = ship.position.z;
	if (ringEvt) {
		if (ringEvt.type === 'hit') {
			ringStreak += 1;
			addScore(100);
			if (music.ringChime) music.ringChime(ringStreak);
			_ringPos.set(ringEvt.x, ringEvt.y, -ringEvt.p);
			fx.spawnHitSpark(_ringPos, Colors.cyan);
			// route mastery feeds firepower: rings top up the multilock bank
			if (weapons.multilockEnabled) {
				weapons.lockCharge = Math.min(CONFIG.multilockMax,
					weapons.lockCharge + CONFIG.multilockRingBonus);
			}
			if (ringStreak === 3) { ship.boost = CONFIG.boostMax; hud.showWave('BOOST RESTORED'); }
			if (ringStreak === 6 && !ship.shieldReady) { ship.restoreShield(); hud.showWave('SHIELD RESTORED'); }
			if (ringStreak >= 10) {
				if (scoreMult === 1) hud.showWave('OVERDRIVE — SCORE ×2 FOR 20s');
				scoreMult = 2;
				multTimer = 20;
			}
		} else {
			ringStreak = 0;
		}
		hud.setStreak(ringStreak, scoreMult);
	}
	if (multTimer > 0) {
		multTimer -= dt;
		if (multTimer <= 0) { scoreMult = 1; hud.setStreak(ringStreak, 1); }
	}

	// waves keyed to progress; clean flying earns an escort of bonus targets
	// (a lighter escort in the multilock half, where waves are already dense)
	const p = progress();
	while (waveIndex < WAVES.length && p >= WAVES[waveIndex].at) {
		const w = WAVES[waveIndex];
		const bonus = p < 0.44 ? 2 : 1;
		const spec = ringStreak >= 6 ? { ...w, shards: (w.shards || 0) + bonus } : w;
		enemies.spawnWave(spec);
		if (w.text) hud.showWave(w.text);
		waveIndex += 1;
	}

	// sun follows the backdrop's fiction: light from the low-left horizon
	sunLight.position.copy(ship.position).add(_sunDir);
	sunLight.target.position.copy(ship.position);

	// HUD
	// the soundtrack BUILDS across the run: pad+kick at launch, the riff at
	// p 0.05, the full band at 0.30 — and the lead only enters when the
	// Multi-Phaser is claimed (see claimPhaser). Sections still track thirds.
	music.setSection(Math.min(2, Math.floor(p * 3)));
	music.setIntensity(p > 0.30 ? 3 : (p > 0.05 ? 2 : 1));
	_presence.shard = _presence.seeker = _presence.bastion = 0;
	for (const e of enemies.active) _presence[e.type] += 1;
	music.setPresence(_presence);

	hud.setSpeed(ship.speed);
	hud.setBoost(ship.boost / CONFIG.boostMax);
	hud.setProgress(p);
	hud.setShield(ship.shieldReady ? 1 : ship.shieldTimer / CONFIG.shieldRecharge, ship.shieldReady);
	if (weapons.multilockEnabled) hud.setLockCharge(weapons.lockCharge, CONFIG.multilockMax);
	hud.setPaintMarks(weapons.paintMarks);
	if (weapons.lockState === 'none') hud.hideLock();
	else hud.setLock(weapons.lockPx.x, weapons.lockPx.y, weapons.lockState === 'locked');
	updatePings();

	if (p >= 1 && (!bossEngaged || boss.defeated)) endGame(true);
}

function updateIdle(dt) {
	// title / end screens: slow drift through the field so the world breathes
	const t = performance.now() * 0.0001;
	if (state === State.TITLE) {
		camera.position.set(Math.sin(t) * 60, 20 + Math.sin(t * 1.7) * 10, 46);
		camera.lookAt(0, 0, -600);
	}
	field.update(dt, ship.position.z);
	fx.update(dt, state === State.TITLE ? 120 : 0, ship.position);
	debris.update(dt, ship.position, state === State.TITLE ? 120 : 0);
	backdrop.update(dt, camera.position, progress());
}

function progress() {
	return Math.min(1, ship.progressZ / CONFIG.courseLength);
}

// radar pings: project every hostile to the screen; clamp off-screen (or
// behind-camera) contacts to the edge with a chevron pointing their way
const _presence = { shard: 0, seeker: 0, bastion: 0 };
const _ringPos = new THREE.Vector3();
const _pingV = new THREE.Vector3();
const _pings = [];
function updatePings() {
	_pings.length = 0;
	const w = window.innerWidth, h = window.innerHeight, m = 46;
	for (const e of enemies.active) {
		if (e === weapons.lockTarget) continue; // the lock reticle marks this one
		_pingV.copy(e.position).project(camera);
		const behind = _pingV.z > 1;
		let sx = (_pingV.x * 0.5 + 0.5) * w;
		let sy = (-_pingV.y * 0.5 + 0.5) * h;
		if (behind) { sx = w - sx; sy = h - sy; }
		const off = behind || sx < m || sx > w - m || sy < m || sy > h - m;
		let angle = 0;
		if (off) {
			const dx = sx - w / 2, dy = sy - h / 2;
			angle = Math.atan2(dy, dx);
			const k = Math.min((w / 2 - m) / Math.max(1e-6, Math.abs(dx)),
				(h / 2 - m) / Math.max(1e-6, Math.abs(dy)));
			sx = w / 2 + dx * k;
			sy = h / 2 + dy * k;
		}
		_pings.push({ x: sx, y: sy, off, angle });
		if (_pings.length >= 12) break;
	}
	hud.setPings(_pings);
}

const _sunDir = new THREE.Vector3(-2600, -350, -4400);
const _shipPush = new THREE.Vector3();
const clock = new THREE.Clock();

function loop() {
	requestAnimationFrame(loop);
	const rawDt = Math.min(clock.getDelta(), 0.05);
	let dt = rawDt;
	if (hitstop > 0) {
		hitstop -= rawDt;
		dt *= 0.15; // the world catches its breath on a kill
	}
	if (state === State.PLAYING) updatePlaying(dt);
	else updateIdle(dt);
	composer.render();
}

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
	composer.setSize(window.innerWidth, window.innerHeight);
});

loop();

// debug handle for automated testing
window.__mo = { field, ship, enemies, weapons, music, backdrop, boss, input, phaser, physics };
