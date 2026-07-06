// Volumetric pulsar light — god rays through the meteorite field.
// Technique adapted from cullenwebber/three-volumetric-light: a box volume
// (BackSide, additive) raymarched in the fragment shader against a spotlight
// cone, with the light's shadow map giving real volumetric occlusion — the
// asteroids carve moving shafts of darkness through the beam. Changes from
// the source demo: distances rescaled from meters to game units, the shadow
// read uses three's stock RGBA-packed spot shadow map (portable — no depth
// texture attachment needed), and the smoke/scene-depth branches are dropped
// (space, and the shadow term already darkens occluded stretches).

import * as THREE from 'three';
import { Colors } from './store.js';

const STEPS = 14;
const UNIT = 1 / 600; // one demo-meter worth of falloff per 600 game units

const VERT = /* glsl */`
	varying vec3 vWorldPosition;
	void main() {
		vec4 wp = modelMatrix * vec4(position, 1.0);
		vWorldPosition = wp.xyz;
		gl_Position = projectionMatrix * viewMatrix * wp;
	}
`;

const FRAG = /* glsl */`
	#include <packing>

	varying vec3 vWorldPosition;

	uniform sampler2D uShadowMap;
	uniform mat4 uShadowMatrix;
	uniform bool uShadowReady;

	uniform vec3 uLightPosition;
	uniform vec3 uLightDirection;
	uniform vec3 uBeamUp;
	uniform vec3 uBeamRight;
	uniform float uCosInner;
	uniform float uCosOuter;
	uniform float uCosHalo;

	uniform vec3 uBoxMin;
	uniform vec3 uBoxMax;

	uniform vec3 uColorCore;
	uniform vec3 uColorTop;
	uniform vec3 uColorBottom;

	uniform float uHaloIntensity;
	uniform float uIntensity;
	uniform float uAttenuation;
	uniform float uFalloff;
	uniform float uUnit;
	uniform float uTime;
	uniform float uBeat;

	vec2 intersectBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
		vec3 inv = 1.0 / rd;
		vec3 t0 = (bmin - ro) * inv;
		vec3 t1 = (bmax - ro) * inv;
		vec3 tmin = min(t0, t1);
		vec3 tmax = max(t0, t1);
		return vec2(
			max(max(tmin.x, tmin.y), tmin.z),
			min(min(tmax.x, tmax.y), tmax.z)
		);
	}

	// three's stock spot shadow map: depth packed into RGBA by MeshDepthMaterial
	float shadowVisibility(vec3 worldPos) {
		if (!uShadowReady) return 1.0;
		vec4 coord = uShadowMatrix * vec4(worldPos, 1.0);
		vec3 sc = coord.xyz / coord.w;
		if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) {
			return 1.0;
		}
		float d = unpackRGBAToDepth(texture2D(uShadowMap, sc.xy));
		return sc.z - 0.003 > d ? 0.0 : 1.0;
	}

	float hash(vec2 p) {
		uvec2 v = uvec2(ivec2(floor(p)));
		v = v * 1664525u + 1013904223u;
		v.x += v.y * 1664525u;
		v.y += v.x * 1664525u;
		v ^= v >> 16u;
		v.x += v.y * 1664525u;
		v.y += v.x * 1664525u;
		v ^= v >> 16u;
		return float(v.x) * (1.0 / 4294967296.0);
	}

	float valueNoise(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(
			mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
			mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
			u.y
		);
	}

	float fbm(vec2 p) {
		float v = 0.0;
		float a = 0.5;
		for (int i = 0; i < 3; i++) {
			v += a * valueNoise(p);
			p *= 2.1;
			a *= 0.5;
		}
		return v;
	}

	vec3 sampleBeam(vec3 p) {
		vec3 toP = p - uLightPosition;
		float dist = length(toP);
		vec3 ld = toP / dist;

		float cosA = dot(ld, uLightDirection);

		float halo = pow(clamp((cosA - uCosHalo) / (1.0 - uCosHalo), 0.0, 1.0), 2.0);
		if (halo <= 0.001) return vec3(0.0);

		float angular = smoothstep(uCosOuter, uCosInner, cosA);
		float visibility = shadowVisibility(p);

		float du = dist * uUnit;
		float attenuation = exp(-du * uFalloff) / (1.0 + uAttenuation * du * du);

		float coneRadius = max(dist * 0.5, 0.001);
		float signedV = clamp(dot(toP, uBeamUp) / coneRadius, -1.5, 1.5);

		vec3 color = mix(uColorBottom, uColorTop, smoothstep(-1.1, 1.1, signedV));
		color = mix(uColorCore, color, smoothstep(0.15, 0.85, abs(signedV)));

		// slow drifting streaks across the beam — the "dust in the shaft" read
		float streak = fbm(vec2(
			dot(toP, uBeamUp) * uUnit * 8.0 + uTime * 0.05,
			dot(toP, uBeamRight) * uUnit * 0.9 - uTime * 0.02
		));
		streak = 0.7 + 0.6 * streak;

		vec3 hazeColor = mix(color, vec3(dot(color, vec3(0.333))), 0.45 * smoothstep(0.8, 1.5, abs(signedV)));
		vec3 beam = color * angular * streak * visibility;
		vec3 haze = hazeColor * halo * uHaloIntensity * visibility;

		vec3 dEdge = min(p - uBoxMin, uBoxMax - p);
		float edgeFade = smoothstep(0.0, 500.0, min(dEdge.y, dEdge.z));

		return (beam + haze) * attenuation * edgeFade * uIntensity * (1.0 + uBeat * 0.6);
	}

	float ignDither(vec2 p) {
		p += mod(floor(uTime * 60.0), 64.0) * 5.588238;
		return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
	}

	void main() {
		vec3 ro = cameraPosition;
		vec3 rd = normalize(vWorldPosition - cameraPosition);

		vec2 hit = intersectBox(ro, rd, uBoxMin, uBoxMax);
		float tNear = max(hit.x, 0.0);
		float tFar = hit.y;
		if (tFar <= tNear) discard;

		float stepLength = (tFar - tNear) / float(${STEPS});
		float dither = ignDither(gl_FragCoord.xy);
		float t = tNear + dither * stepLength;

		vec3 accumulated = vec3(0.0);
		for (int i = 0; i < ${STEPS}; i++) {
			vec3 p = ro + rd * t;
			accumulated += sampleBeam(p) * stepLength * uUnit;
			t += stepLength;
		}

		gl_FragColor = vec4(accumulated, 1.0);
	}
`;

export class VolumetricPulsarLight {
	constructor(scene, renderer, field) {
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFShadowMap;
		// the rocks carve the god rays — instanced meshes cast fine
		for (const mesh of field.meshes) mesh.castShadow = true;

		// The beam source rides the pulsar's sky direction (up-front-left),
		// pointed through the course around the ship.
		this.light = new THREE.SpotLight(Colors.cyan, 0.4);
		this.light.decay = 0;
		this.light.angle = 0.65; // a broad, soft wash rather than a tight shaft
		this.light.penumbra = 0.55;
		this.light.castShadow = true;
		this.light.shadow.mapSize.set(1024, 1024);
		this.light.shadow.camera.near = 800;
		this.light.shadow.camera.far = 11000;
		this.light.shadow.bias = -0.0015;
		scene.add(this.light, this.light.target);

		this._offset = new THREE.Vector3(-2650, 220, -4470); // toward the pulsar
		this._targetOffset = new THREE.Vector3(600, -100, 900); // past the ship
		this._boxMin = new THREE.Vector3();
		this._boxMax = new THREE.Vector3();
		this._dir = new THREE.Vector3();
		this._right = new THREE.Vector3();
		this._up = new THREE.Vector3();
		this._worldUp = new THREE.Vector3(0, 1, 0);

		const outer = this.light.angle;
		const inner = outer * (1 - this.light.penumbra);
		this.material = new THREE.ShaderMaterial({
			vertexShader: VERT,
			fragmentShader: FRAG,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			depthTest: false,
			side: THREE.BackSide,
			uniforms: {
				uShadowMap: { value: null },
				uShadowMatrix: { value: this.light.shadow.matrix },
				uShadowReady: { value: false },
				uLightPosition: { value: new THREE.Vector3() },
				uLightDirection: { value: new THREE.Vector3(0, 0, -1) },
				uBeamUp: { value: new THREE.Vector3(0, 1, 0) },
				uBeamRight: { value: new THREE.Vector3(1, 0, 0) },
				uCosInner: { value: Math.cos(inner) },
				uCosOuter: { value: Math.cos(outer) },
				uCosHalo: { value: Math.cos(Math.min(outer * 2.4, 1.25)) },
				uBoxMin: { value: this._boxMin },
				uBoxMax: { value: this._boxMax },
				uColorCore: { value: new THREE.Color(0.8, 1.0, 1.0) },
				uColorTop: { value: new THREE.Color(0.16, 0.85, 0.88) },
				uColorBottom: { value: new THREE.Color(0.22, 0.09, 0.42) },
				// integrated over ~9 box-units and then hit by ACES + bloom, so
				// these are an order of magnitude below the source demo's values
				uHaloIntensity: { value: 0.1 },
				uIntensity: { value: 0.05 },
				uAttenuation: { value: 0.045 },
				uFalloff: { value: 0.16 },
				uUnit: { value: UNIT },
				uTime: { value: 0 },
				uBeat: { value: 0 },
			},
		});

		this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 5; // haze over the world, under nothing solid
		scene.add(this.mesh);
	}

	update(dt, shipPos) {
		const u = this.material.uniforms;
		u.uTime.value += dt;
		u.uBeat.value = Math.max(0, u.uBeat.value - dt * 3);

		this.light.position.copy(shipPos).add(this._offset);
		this.light.target.position.copy(shipPos).add(this._targetOffset);
		u.uLightPosition.value.copy(this.light.position);

		this._dir.copy(this.light.target.position).sub(this.light.position).normalize();
		u.uLightDirection.value.copy(this._dir);
		this._right.crossVectors(this._dir, this._worldUp).normalize();
		u.uBeamRight.value.copy(this._right);
		u.uBeamUp.value.crossVectors(this._right, this._dir).normalize();

		// the raymarch volume follows the ship
		this._boxMin.set(shipPos.x - 2400, shipPos.y - 1500, shipPos.z - 4800);
		this._boxMax.set(shipPos.x + 2400, shipPos.y + 1500, shipPos.z + 900);
		this.mesh.position.set(shipPos.x, shipPos.y, shipPos.z - 1950);
		this.mesh.scale.set(4800, 3000, 5700);

		if (!u.uShadowReady.value && this.light.shadow.map) {
			u.uShadowMap.value = this.light.shadow.map.texture;
			u.uShadowReady.value = true;
		}
	}

	// the pulsar is the beat's source — its light breathes with it
	beatPulse(strength = 1) {
		this.material.uniforms.uBeat.value = Math.max(
			this.material.uniforms.uBeat.value, strength * 0.7);
	}
}
