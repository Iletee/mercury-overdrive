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
weapons.events.onShoot = () => music.playerShoot();

weapons.events.onLockChange = (lockState) => {
	if (lockState === 'locked') music.lockOn();
};

weapons.events.onEnemyHit = (e, point) => {
	fx.spawnHitSpark(point, e.color);
	if (enemies.damage(e, 1)) {
		const big = e.type === 'bastion';
		fx.spawnExplosion(e.position, e.color, big ? 3 : 1.5);
		music.explosion(big);
		addScore(e.score);
	}
};

weapons.events.onAsteroidHit = (rec, point) => {
	fx.spawnHitSpark(point, Colors.cyan);
	if (field.damage(rec, 1)) {
		fx.spawnExplosion(rec.pos, Colors.orange, Math.max(1, rec.r / 18));
		music.explosion(false);
		addScore(CONFIG.scoreAsteroid);
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
	score += n;
	hud.setScore(score);
}

function hurtPlayer() {
	if (!ship.takeDamage(1)) return;
	hud.damageFlash();
	hud.setHull(ship.hp, CONFIG.playerHp);
	music.playerHit();
	if (ship.hp <= 0) endGame(false);
}

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

	// waves keyed to progress
	const p = progress();
	while (waveIndex < WAVES.length && p >= WAVES[waveIndex].at) {
		const w = WAVES[waveIndex];
		enemies.spawnWave(w);
		if (w.text) hud.showWave(w.text);
		music.setIntensity(Math.min(3, 1 + Math.floor(waveIndex / 2)));
		waveIndex += 1;
	}

	// sun follows the backdrop's fiction: light from the low-left horizon
	sunLight.position.copy(ship.position).add(_sunDir);
	sunLight.target.position.copy(ship.position);

	// HUD
	hud.setSpeed(ship.speed);
	hud.setBoost(ship.boost / CONFIG.boostMax);
	hud.setProgress(p);
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
	const dt = Math.min(clock.getDelta(), 0.05);
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
