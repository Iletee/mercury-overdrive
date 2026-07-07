// Deep-space backdrop: shader nebula dome, star points, a beat-pulsing
// pulsar and a kilometre-scale ringed planet that slowly grows as the run
// progresses. The dome, stars and planet re-centre on the ship each frame so
// they read as infinitely far; the pulsar sits "nearer" (see the parallax
// factor in update) so it slides against the starfield as you steer.

import * as THREE from 'three';
import { Colors, CONFIG } from './store.js';

const NEBULA_VERT = /* glsl */`
	varying vec3 vDir;
	void main() {
		vDir = position;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * mv;
	}
`;

const NEBULA_FRAG = /* glsl */`
	varying vec3 vDir;
	uniform float uBeat;
	uniform float uRings; // 0 = deep space, 1 = inside the neon ring system

	float hash(vec3 p) {
		p = fract(p * 0.3183099 + 0.1);
		p *= 17.0;
		return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
	}
	float noise(vec3 x) {
		vec3 i = floor(x); vec3 f = fract(x);
		f = f * f * (3.0 - 2.0 * f);
		return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
					mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
				mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
					mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
	}
	float fbm(vec3 p) {
		float v = 0.0, a = 0.5;
		for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
		return v;
	}

	void main() {
		vec3 d = normalize(vDir);
		vec3 deep = vec3(0.035, 0.008, 0.10);
		vec3 purple = vec3(0.14, 0.06, 0.28);
		vec3 magenta = vec3(0.55, 0.10, 0.35);
		vec3 cyan = vec3(0.05, 0.45, 0.5);

		float n = fbm(d * 3.0 + vec3(7.0));
		float f5 = fbm(d * 5.0);
		float f8 = fbm(d * 8.0 + vec3(3.0));
		float band = smoothstep(0.35, 0.0, abs(d.y + 0.15)) ; // galactic band near horizon
		vec3 col = deep;
		col = mix(col, purple, smoothstep(0.35, 0.75, n));
		col = mix(col, magenta * (0.9 + 0.25 * uBeat), band * smoothstep(0.5, 0.85, f5));
		col = mix(col, cyan, band * smoothstep(0.65, 0.95, f8) * 0.6);
		col *= 0.75 + 0.35 * band;

		// inside the ring system the whole sky goes ring-coloured: neon teal
		// haze with hot gold ringlets streaking the (flattened) band. Reuses
		// the fbm samples above — zero extra noise cost.
		if (uRings > 0.001) {
			float rband = smoothstep(0.45, 0.0, abs(d.y + 0.05)); // tighter to the plane
			vec3 rcol = vec3(0.01, 0.045, 0.06);
			rcol = mix(rcol, vec3(0.045, 0.26, 0.28), smoothstep(0.3, 0.8, n));
			rcol = mix(rcol, vec3(0.42, 0.3, 0.09) * (0.9 + 0.3 * uBeat),
				rband * smoothstep(0.42, 0.8, f5));
			rcol = mix(rcol, vec3(0.1, 0.5, 0.52), rband * smoothstep(0.6, 0.95, f8) * 0.7);
			rcol *= 0.55 + 0.4 * rband;
			col = mix(col, rcol, uRings);
		}
		gl_FragColor = vec4(col, 1.0);
	}
`;

// The pulsar core: a hard white-cyan point with a diffraction cross.
function makePulsarCoreTexture() {
	const s = 256;
	const cv = document.createElement('canvas');
	cv.width = cv.height = s;
	const g = cv.getContext('2d');
	const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
	grad.addColorStop(0, 'rgba(255,255,255,1)');
	grad.addColorStop(0.16, 'rgba(196,250,255,0.95)');
	grad.addColorStop(0.42, 'rgba(45,226,230,0.45)');
	grad.addColorStop(1, 'rgba(45,226,230,0)');
	g.fillStyle = grad;
	g.fillRect(0, 0, s, s);
	// diffraction spikes
	g.globalCompositeOperation = 'lighter';
	for (const horizontal of [true, false]) {
		const spike = horizontal
			? g.createLinearGradient(0, 0, s, 0)
			: g.createLinearGradient(0, 0, 0, s);
		spike.addColorStop(0, 'rgba(160,240,255,0)');
		spike.addColorStop(0.5, 'rgba(220,252,255,0.55)');
		spike.addColorStop(1, 'rgba(160,240,255,0)');
		g.fillStyle = spike;
		if (horizontal) g.fillRect(0, s / 2 - 2, s, 4);
		else g.fillRect(s / 2 - 2, 0, 4, s);
	}
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

// A thin circular halo band — the expanding "beat ring" the pulsar emits.
function makeHaloTexture() {
	const s = 256;
	const cv = document.createElement('canvas');
	cv.width = cv.height = s;
	const g = cv.getContext('2d');
	const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
	grad.addColorStop(0.38, 'rgba(45,226,230,0)');
	grad.addColorStop(0.46, 'rgba(196,250,255,0.85)');
	grad.addColorStop(0.5, 'rgba(255,120,200,0.35)');
	grad.addColorStop(0.56, 'rgba(45,226,230,0)');
	g.fillStyle = grad;
	g.fillRect(0, 0, s, s);
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

export class SpaceBackdrop {
	constructor(scene) {
		this.scene = scene;
		this.root = new THREE.Group();
		scene.add(this.root);

		// nebula dome
		this.nebula = new THREE.Mesh(
			new THREE.SphereGeometry(9000, 32, 24),
			new THREE.ShaderMaterial({
				vertexShader: NEBULA_VERT,
				fragmentShader: NEBULA_FRAG,
				uniforms: { uBeat: { value: 0 }, uRings: { value: 0 } },
				side: THREE.BackSide,
				depthWrite: false,
			})
		);
		this.nebula.renderOrder = -3;
		this.root.add(this.nebula);

		// stars
		const starCount = 2600;
		const pos = new Float32Array(starCount * 3);
		const col = new Float32Array(starCount * 3);
		const c = new THREE.Color();
		for (let i = 0; i < starCount; i++) {
			const v = new THREE.Vector3().randomDirection().multiplyScalar(8500);
			pos.set([v.x, v.y, v.z], i * 3);
			const roll = Math.random();
			if (roll > 0.94) c.setHex(Colors.pink);
			else if (roll > 0.85) c.setHex(Colors.cyan);
			else c.setScalar(0.55 + Math.random() * 0.45);
			col.set([c.r, c.g, c.b], i * 3);
		}
		const starGeo = new THREE.BufferGeometry();
		starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
		this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
			size: 22, vertexColors: true, transparent: true, opacity: 0.9,
			blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
		}));
		this.stars.renderOrder = -2;
		this.root.add(this.stars);

		// The pulsar — the visible source of the soundtrack's pulse. Its core
		// kicks and a halo ring races outward on every beat, and it hangs
		// nearer than the stars so it parallaxes against them as you steer.
		this.pulsar = new THREE.Group();
		this._pulsarBase = new THREE.Vector3(-4300, 350, -7200);
		this._coreScale = 1050;
		this._corePulse = 0;
		this.pulsarCore = new THREE.Sprite(new THREE.SpriteMaterial({
			map: makePulsarCoreTexture(), transparent: true, depthWrite: false,
			blending: THREE.AdditiveBlending,
		}));
		this.pulsarCore.scale.setScalar(this._coreScale);
		this.pulsarCore.renderOrder = -1;
		this.pulsar.add(this.pulsarCore);
		this._halos = [];
		const haloTex = makeHaloTexture();
		for (let i = 0; i < 4; i++) {
			const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
				map: haloTex, transparent: true, depthWrite: false,
				blending: THREE.AdditiveBlending, opacity: 0,
			}));
			sprite.visible = false;
			sprite.renderOrder = -1;
			this.pulsar.add(sprite);
			this._halos.push({ sprite, t: 1, strength: 0 });
		}
		this._nextHalo = 0;
		this.pulsar.position.copy(this._pulsarBase);
		this.root.add(this.pulsar);

		// the destination planet — grows from a marble to a monster over the run
		this.planet = new THREE.Group();
		const body = new THREE.Mesh(
			new THREE.SphereGeometry(1, 48, 32),
			new THREE.MeshStandardMaterial({
				color: 0x1b0f38, roughness: 0.85, metalness: 0.1,
				emissive: Colors.deepPurple, emissiveIntensity: 0.55,
			})
		);
		const ring = new THREE.Mesh(
			new THREE.RingGeometry(1.35, 2.15, 72),
			new THREE.MeshBasicMaterial({
				// modest opacity: by the boss arena the planet fills the sky and
				// this ring must stay a backdrop, not a searchlight
				color: Colors.cyan, transparent: true, opacity: 0.16,
				side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
			})
		);
		ring.rotation.x = Math.PI / 2.6;
		const rim = new THREE.Mesh(
			new THREE.SphereGeometry(1.02, 48, 32),
			new THREE.MeshBasicMaterial({
				color: Colors.pink, transparent: true, opacity: 0.14,
				blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
			})
		);
		this.planet.add(body, ring, rim);
		this.planet.position.set(2400, 900, -8200);
		this.root.add(this.planet);
		this._planetRing = ring;
		this._ringsMode = 0; // 0 = approaching, 1 = inside the ring system
	}

	// Stage 2: you're IN the rings — the planet swings up to own the sky
	// instead of hanging ahead like an unreachable poster. Blended 0..1 so
	// the descent cinematic can sweep it into place.
	setRingsMode(t) {
		this._ringsMode = Math.max(0, Math.min(1, t));
		this.nebula.material.uniforms.uRings.value = this._ringsMode;
	}

	update(dt, shipPos, progress) {
		// backdrop is glued to the ship: infinitely far away
		this.root.position.copy(shipPos);
		// ...except the planet swells with progress — that's the sense of
		// arrival. In rings mode it blends up and overhead: a colossus you
		// fly beneath, its ring plane (fictionally) the one you're in.
		const rm = this._ringsMode;
		const scale = (340 + progress * 3400) * (1 - rm) + 6200 * rm;
		this.planet.scale.setScalar(scale);
		this.planet.position.set(
			(2400 - progress * 1400) * (1 - rm) + 500 * rm,
			(900 - progress * 500) * (1 - rm) + 3400 * rm,
			-8200 - 1400 * rm
		);
		this._planetRing.material.opacity = 0.16 + rm * 0.1;
		this.planet.rotation.y += dt * 0.01;
		this.nebula.material.uniforms.uBeat.value *= Math.max(0, 1 - dt * 5);

		// Pulsar parallax: offset it against the ship's lateral position so it
		// drifts across the (infinitely far) starfield as you steer and the
		// route snakes — the one depth cue in the sky.
		this.pulsar.position.set(
			this._pulsarBase.x - shipPos.x * 0.35,
			this._pulsarBase.y - shipPos.y * 0.35,
			this._pulsarBase.z
		);

		// Core kick decay + expanding halo rings.
		this._corePulse = Math.max(0, this._corePulse - dt * 3.2);
		this.pulsarCore.scale.setScalar(this._coreScale * (1 + this._corePulse * 0.3));
		const HALO_LIFE = 1.4; // seconds for a ring to cross the sky and fade
		for (const h of this._halos) {
			if (!h.sprite.visible) continue;
			h.t += dt / HALO_LIFE;
			if (h.t >= 1) { h.sprite.visible = false; continue; }
			h.sprite.scale.setScalar(this._coreScale * (0.55 + h.t * 3.4));
			h.sprite.material.opacity = (1 - h.t) * (1 - h.t) * 0.55 * h.strength;
		}
	}

	beatPulse(strength = 1) {
		// The nebula only breathes faintly now — the pulsar carries the beat.
		this.nebula.material.uniforms.uBeat.value = 0.22 * strength;
		this._corePulse = Math.max(this._corePulse, strength);
		const h = this._halos[this._nextHalo];
		this._nextHalo = (this._nextHalo + 1) % this._halos.length;
		h.t = 0;
		h.strength = strength;
		h.sprite.visible = true;
		h.sprite.scale.setScalar(this._coreScale * 0.55);
		h.sprite.material.opacity = 0.55 * strength;
	}
}
