// Deep-space backdrop: shader nebula dome, star points, an outrun sun and a
// kilometre-scale ringed planet that slowly grows as the run progresses.
// Everything re-centres on the ship each frame so it reads as infinitely far.

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
		float band = smoothstep(0.35, 0.0, abs(d.y + 0.15)) ; // galactic band near horizon
		vec3 col = deep;
		col = mix(col, purple, smoothstep(0.35, 0.75, n));
		col = mix(col, magenta * (0.9 + 0.25 * uBeat), band * smoothstep(0.5, 0.85, fbm(d * 5.0)));
		col = mix(col, cyan, band * smoothstep(0.65, 0.95, fbm(d * 8.0 + vec3(3.0))) * 0.6);
		col *= 0.75 + 0.35 * band;
		gl_FragColor = vec4(col, 1.0);
	}
`;

function makeSunTexture() {
	const s = 512;
	const cv = document.createElement('canvas');
	cv.width = cv.height = s;
	const g = cv.getContext('2d');
	const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
	grad.addColorStop(0, 'rgba(255,235,200,1)');
	grad.addColorStop(0.35, 'rgba(255,108,17,0.95)');
	grad.addColorStop(0.62, 'rgba(255,56,100,0.55)');
	grad.addColorStop(1, 'rgba(255,56,100,0)');
	g.fillStyle = grad;
	g.fillRect(0, 0, s, s);
	// retro stripes across the lower half
	g.globalCompositeOperation = 'destination-out';
	for (let i = 0; i < 6; i++) {
		const y = s * 0.52 + i * (s * 0.055);
		g.fillRect(0, y, s, 3 + i * 2.2);
	}
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
				uniforms: { uBeat: { value: 0 } },
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

		// outrun sun, low on the horizon
		this.sun = new THREE.Sprite(new THREE.SpriteMaterial({
			map: makeSunTexture(), transparent: true, depthWrite: false,
			blending: THREE.AdditiveBlending,
		}));
		this.sun.scale.setScalar(5200);
		this.sun.position.set(-4200, -600, -7000);
		this.sun.renderOrder = -1;
		this.root.add(this.sun);

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
				color: Colors.cyan, transparent: true, opacity: 0.28,
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
	}

	update(dt, shipPos, progress) {
		// backdrop is glued to the ship: infinitely far away
		this.root.position.copy(shipPos);
		// ...except the planet swells with progress — that's the sense of arrival
		const scale = 340 + progress * 1900;
		this.planet.scale.setScalar(scale);
		this.planet.position.set(2400 - progress * 1400, 900 - progress * 500, -8200);
		this.planet.rotation.y += dt * 0.01;
		this.nebula.material.uniforms.uBeat.value *= Math.max(0, 1 - dt * 5);
	}

	beatPulse(strength = 1) {
		this.nebula.material.uniforms.uBeat.value = 0.6 * strength;
	}
}
