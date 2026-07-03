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

weapons.events.onEnemyHit = (e, point) => {
	fx.spawnHitSpark(point, e.color);
	if (enemies.damage(e, 1)) {
		const big = e.type === 'bastion';
		fx.spawnExplosion(e.position, e.color, big ? 3 : 1.5);
		fx.spawnShockwave(e.position, e.color, big ? 3 : 1.3);
		hitstop = big ? 0.1 : 0.06;
		ship.shake(big ? 0.5 : 0.25);
		music.explosion(big);
		addScore(e.score);
	}
};

weapons.events.onAsteroidHit = (rec, point) => {
	fx.spawnHitSpark(point, Colors.cyan);
	if (field.damage(rec, 1)) {
		fx.spawnExplosion(rec.pos, Colors.orange, Math.max(1, rec.r / 18));
		if (rec.r > 55) {
			fx.spawnShockwave(rec.pos, Colors.orange, Math.min(3, rec.r / 45));
			hitstop = 0.05;
		}
		music.explosion(rec.r > 120);
		addScore(Math.round(CONFIG.scoreAsteroid + rec.r * 2)); // big rocks pay big
	}
};

weapons.events.onPlayerHit = (point) => {
	fx.spawnHitSpark(point, Colors.pink);
	hurtPlayer();
};

enemies.events.onSeekerBlast = (e) => {
	fx.spawnExplosion(e.position, Colors.orange, 2.2);
	music.explosion(true);
	ship.shake(1);
	hurtPlayer();
};

enemies.events.onEnemyShoot = (e) => {
	if (e.position.distanceTo(ship.position) < 1800) music.enemyShoot();
};

music.onBeat(({ beat, bar }) => {
	if (state !== State.PLAYING) return;
	field.beatPulse(0.9);
	backdrop.beatPulse(1);
	fx.beatPulse(1);
	debris.beatPulse(1);
	hud.beatPulse();
	enemies.beatPulse();
	if (beat % 2 === 0) ship.beatPulse();
});

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
	enemies.reset();
	weapons.reset();
	score = 0;
	elapsed = 0;
	waveIndex = 0;
	ringStreak = 0;
	scoreMult = 1;
	multTimer = 0;
	prevShipZ = 0;
	hud.setStreak(0, 1);
	camera.position.set(0, 13, 46);
	camera.quaternion.identity();
	music.setIntensity(1);
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
	enemies.update(dt);
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
			if (ringStreak === 3) { ship.boost = CONFIG.boostMax; hud.showWave('BOOST RESTORED'); }
			if (ringStreak === 6 && !ship.shieldReady) { ship.restoreShield(); hud.showWave('SHIELD RESTORED'); }
			if (ringStreak >= 10) {
				if (scoreMult === 1) hud.showWave('OVERDRIVE ×2');
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
	const p = progress();
	while (waveIndex < WAVES.length && p >= WAVES[waveIndex].at) {
		const w = WAVES[waveIndex];
		const spec = ringStreak >= 6 ? { ...w, shards: (w.shards || 0) + 2 } : w;
		enemies.spawnWave(spec);
		if (w.text) hud.showWave(w.text);
		waveIndex += 1;
	}

	// sun follows the backdrop's fiction: light from the low-left horizon
	sunLight.position.copy(ship.position).add(_sunDir);
	sunLight.target.position.copy(ship.position);

	// HUD
	// the soundtrack tracks the run: course thirds change the section, and
	// live enemies each contribute their own motif layer. Intensity is
	// front-loaded — the riff (the hook) arrives seconds in, not a minute
	music.setSection(Math.min(2, Math.floor(p * 3)));
	music.setIntensity(p > 0.35 ? 3 : (p > 0.015 ? 2 : 1));
	_presence.shard = _presence.seeker = _presence.bastion = 0;
	for (const e of enemies.active) _presence[e.type] += 1;
	music.setPresence(_presence);

	hud.setSpeed(ship.speed);
	hud.setBoost(ship.boost / CONFIG.boostMax);
	hud.setProgress(p);
	hud.setShield(ship.shieldReady ? 1 : ship.shieldTimer / CONFIG.shieldRecharge, ship.shieldReady);
	if (weapons.lockState === 'none') hud.hideLock();
	else hud.setLock(weapons.lockPx.x, weapons.lockPx.y, weapons.lockState === 'locked');
	updatePings();

	if (p >= 1) endGame(true);
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
window.__mo = { field, ship, enemies, weapons };
