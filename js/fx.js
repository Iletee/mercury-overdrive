// fx.js
// Pooled particle effects system for the Tron-styled space shooter.
// Everything here is allocated up-front in the FXSystem constructor.
// update()/spawn*() paths only mutate pre-existing typed arrays, geometry
// attributes and shader uniforms - no `new` on the hot path.
//
// Effects:
//   1. Speed-lines / star dust  - LineSegments, single draw call, ~600 streaks
//   2. Explosions                - pooled THREE.Points bursts + flash sprite
//   3. Hit sparks                - pooled THREE.Points bursts (small/fast)

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const COLOR_CYAN = 0x2DE2E6;
const COLOR_PINK = 0xFF3864;
const COLOR_ORANGE = 0xFF6C11;

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const SPEEDLINE_COUNT = 600;
const SPEEDLINE_RADIUS = 300;
const SPEEDLINE_LENGTH = 1200;
const SPEEDLINE_AHEAD = 100;
const SPEEDLINE_PINK_CHANCE = 0.12;

const EXPLOSION_POOL_SIZE = 8;
const EXPLOSION_PARTICLES = 150;

const SPARK_POOL_SIZE = 16;
const SPARK_PARTICLES = 20;

const FLASH_POOL_SIZE = 8;

// ---------------------------------------------------------------------------
// Small allocation-free math helpers
// ---------------------------------------------------------------------------

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// Shared GPU-side burst shader (used by both explosions and hit sparks).
// Particles integrate a spawn-time velocity with exponential drag entirely
// on the GPU: pos(t) = startOffset + velocity * (1 - e^(-drag*t)) / drag.
// This means per-frame updates only need to touch a single `uTime` uniform
// per active pool slot - no CPU position integration, no reallocation.
// ---------------------------------------------------------------------------

const BURST_VERTEX_SHADER = `
attribute vec3 aVelocity;
attribute float aSize;
attribute float aLifeMul;

uniform float uTime;
uniform float uDuration;
uniform float uDrag;
uniform float uSize;

varying float vLife;

void main() {
  float maxLife = max(uDuration * aLifeMul, 0.0001);
  float t = clamp(uTime / maxLife, 0.0, 1.0);
  vLife = 1.0 - t;

  float k = (1.0 - exp(-uDrag * uTime)) / max(uDrag, 0.0001);
  vec3 pos = position + aVelocity * k;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float atten = clamp(320.0 / max(-mvPosition.z, 1.0), 0.15, 8.0);
  gl_PointSize = uSize * aSize * (0.35 + vLife * 0.65) * atten;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const BURST_FRAGMENT_SHADER = `
uniform vec3 uColor;
varying float vLife;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  float core = smoothstep(1.0, 0.0, d);
  vec3 hot = mix(uColor, vec3(1.0), smoothstep(0.55, 1.0, vLife));
  float alpha = core * core * vLife;
  gl_FragColor = vec4(hot * (0.6 + core * 0.8), alpha);
}
`;

function createBurstMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDuration: { value: 1 },
      uDrag: { value: 1.5 },
      uSize: { value: 10 },
      uColor: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: BURST_VERTEX_SHADER,
    fragmentShader: BURST_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

// A soft radial-gradient sprite texture, generated once and shared by every
function createRingTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 5;
  g.shadowColor = 'rgba(255,255,255,0.9)';
  g.shadowBlur = 10;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 12, 0, Math.PI * 2);
  g.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// pooled flash sprite (only the SpriteMaterial's color/opacity differ).
function createGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// FXSystem
// ---------------------------------------------------------------------------

export class FXSystem {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    this._beatPulseValue = 0;
    this._spawnId = 0;

    this._glowTexture = createGlowTexture();
    this._ringTexture = createRingTexture();

    this._initSpeedLines();
    this._explosions = this._createBurstPool(EXPLOSION_POOL_SIZE, EXPLOSION_PARTICLES);
    this._sparks = this._createBurstPool(SPARK_POOL_SIZE, SPARK_PARTICLES);
    this._flashes = this._createFlashPool(FLASH_POOL_SIZE);
    this._shockwaves = this._createShockwavePool(8);
  }

  // -------------------------------------------------------------------
  // Construction helpers (allocations only happen here)
  // -------------------------------------------------------------------

  _initSpeedLines() {
    const n = SPEEDLINE_COUNT;
    const positions = new Float32Array(n * 6); // 2 verts * 3 comps per streak
    const colors = new Float32Array(n * 6);

    this._slHeadX = new Float32Array(n);
    this._slHeadY = new Float32Array(n);
    this._slHeadZ = new Float32Array(n);
    this._slBaseR = new Float32Array(n);
    this._slBaseG = new Float32Array(n);
    this._slBaseB = new Float32Array(n);

    const cyan = new THREE.Color(COLOR_CYAN);
    const pink = new THREE.Color(COLOR_PINK);
    const white = new THREE.Color(0xffffff);

    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * SPEEDLINE_RADIUS;
      this._slHeadX[i] = Math.cos(theta) * r;
      this._slHeadY[i] = Math.sin(theta) * r;
      this._slHeadZ[i] = -Math.random() * SPEEDLINE_LENGTH;

      const isPink = Math.random() < SPEEDLINE_PINK_CHANCE;
      const tint = isPink ? pink : cyan.clone().lerp(white, 0.3 + Math.random() * 0.7);
      this._slBaseR[i] = tint.r;
      this._slBaseG[i] = tint.g;
      this._slBaseB[i] = tint.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.3,
    });

    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    this._speedLineGeometry = geometry;
    this._speedLineMaterial = material;
    this._speedLineMesh = mesh;
  }

  // Builds a pool of `poolSize` independent Points clouds, each with
  // `particleCount` particles, sharing the burst shader recipe but owning
  // their own geometry/material/uniform instances so they can run
  // concurrently with different colors/lifetimes.
  _createBurstPool(poolSize, particleCount) {
    const pool = [];
    for (let p = 0; p < poolSize; p++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(particleCount * 3), 3).setUsage(THREE.DynamicDrawUsage)
      );
      geometry.setAttribute(
        'aVelocity',
        new THREE.BufferAttribute(new Float32Array(particleCount * 3), 3).setUsage(THREE.DynamicDrawUsage)
      );
      geometry.setAttribute(
        'aSize',
        new THREE.BufferAttribute(new Float32Array(particleCount), 1).setUsage(THREE.DynamicDrawUsage)
      );
      geometry.setAttribute(
        'aLifeMul',
        new THREE.BufferAttribute(new Float32Array(particleCount), 1).setUsage(THREE.DynamicDrawUsage)
      );

      const material = createBurstMaterial();
      const mesh = new THREE.Points(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);

      pool.push({
        mesh,
        geometry,
        material,
        particleCount,
        active: false,
        elapsed: 0,
        duration: 1,
        spawnId: -1,
      });
    }
    return pool;
  }

  _createShockwavePool(poolSize) {
    // expanding neon ring on kills — billboarded sprite with a ring texture
    const pool = [];
    for (let p = 0; p < poolSize; p++) {
      const material = new THREE.SpriteMaterial({
        map: this._ringTexture,
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.frustumCulled = false;
      this.scene.add(sprite);
      pool.push({
        sprite, material,
        active: false, elapsed: 0, duration: 0.45,
        maxScale: 90, spawnId: -1,
      });
    }
    return pool;
  }

  spawnShockwave(position, colorHex = 0x2de2e6, scale = 1) {
    const slot = this._acquireSlot(this._shockwaves);
    slot.active = true;
    slot.elapsed = 0;
    slot.duration = 0.4 + scale * 0.08;
    slot.maxScale = 70 * scale;
    slot.spawnId = this._spawnId++;
    slot.material.color.setHex(colorHex);
    slot.material.opacity = 0.9;
    slot.sprite.position.copy(position);
    slot.sprite.scale.setScalar(6);
    slot.sprite.visible = true;
  }

  _updateShockwaves(dt) {
    for (let i = 0; i < this._shockwaves.length; i++) {
      const slot = this._shockwaves[i];
      if (!slot.active) continue;
      slot.elapsed += dt;
      const t = slot.elapsed / slot.duration;
      if (t >= 1) {
        slot.active = false;
        slot.sprite.visible = false;
        slot.material.opacity = 0;
        continue;
      }
      const ease = 1 - (1 - t) * (1 - t); // fast start, decelerating
      slot.sprite.scale.setScalar(6 + ease * slot.maxScale);
      slot.material.opacity = 0.9 * (1 - t);
    }
  }

  _createFlashPool(poolSize) {
    const pool = [];
    for (let p = 0; p < poolSize; p++) {
      const material = new THREE.SpriteMaterial({
        map: this._glowTexture,
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.frustumCulled = false;
      this.scene.add(sprite);

      pool.push({
        sprite,
        material,
        active: false,
        elapsed: 0,
        duration: 0.16,
        startScale: 1,
        maxScale: 1,
        spawnId: -1,
      });
    }
    return pool;
  }

  // -------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------

  update(dt, speed, shipPosition) {
    dt = clamp(dt, 0, 0.1);

    this._beatPulseValue *= Math.max(0, 1 - dt * 6);

    this._updateSpeedLines(dt, speed, shipPosition);
    this._updateBursts(this._explosions, dt);
    this._updateBursts(this._sparks, dt);
    this._updateFlashes(dt);
    this._updateShockwaves(dt);
  }

  _updateSpeedLines(dt, speed, shipPosition) {
    const n = SPEEDLINE_COUNT;
    const shipX = shipPosition.x;
    const shipY = shipPosition.y;
    const shipZ = shipPosition.z;
    const radiusSq = SPEEDLINE_RADIUS * SPEEDLINE_RADIUS;

    const speedT = clamp01(speed / 900);
    const pulse = this._beatPulseValue;
    const streakLen = clamp(2.5 + speed * 0.1, 2.5, SPEEDLINE_LENGTH * 0.24);
    const brightnessMul = 0.3 + speedT * 0.55 + pulse * 0.12;

    const headX = this._slHeadX;
    const headY = this._slHeadY;
    const headZ = this._slHeadZ;
    const baseR = this._slBaseR;
    const baseG = this._slBaseG;
    const baseB = this._slBaseB;

    const positions = this._speedLineGeometry.attributes.position.array;
    const colors = this._speedLineGeometry.attributes.color.array;

    for (let i = 0; i < n; i++) {
      let hx = headX[i];
      let hy = headY[i];
      let hz = headZ[i];

      const dx = hx - shipX;
      const dy = hy - shipY;
      const fellBehind = hz > shipZ + SPEEDLINE_AHEAD;
      const driftedOut = dx * dx + dy * dy > radiusSq;

      if (fellBehind || driftedOut) {
        const theta = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * SPEEDLINE_RADIUS;
        hx = shipX + Math.cos(theta) * r;
        hy = shipY + Math.sin(theta) * r;
        hz = shipZ - SPEEDLINE_LENGTH * (0.15 + Math.random() * 0.85);
        headX[i] = hx;
        headY[i] = hy;
        headZ[i] = hz;
      }

      const i6 = i * 6;
      // head vertex
      positions[i6] = hx;
      positions[i6 + 1] = hy;
      positions[i6 + 2] = hz;
      // tail vertex - trails behind the head (ship travels toward -Z)
      positions[i6 + 3] = hx;
      positions[i6 + 4] = hy;
      positions[i6 + 5] = hz + streakLen;

      const r = baseR[i] * brightnessMul;
      const g = baseG[i] * brightnessMul;
      const b = baseB[i] * brightnessMul;
      colors[i6] = r;
      colors[i6 + 1] = g;
      colors[i6 + 2] = b;
      // dimmer, fading tail for a comet-like streak
      colors[i6 + 3] = r * 0.12;
      colors[i6 + 4] = g * 0.12;
      colors[i6 + 5] = b * 0.12;
    }

    this._speedLineGeometry.attributes.position.needsUpdate = true;
    this._speedLineGeometry.attributes.color.needsUpdate = true;
    this._speedLineMaterial.opacity = clamp01(0.14 + speedT * 0.32 + pulse * 0.08);
  }

  _updateBursts(pool, dt) {
    for (let i = 0; i < pool.length; i++) {
      const slot = pool[i];
      if (!slot.active) continue;

      slot.elapsed += dt;
      slot.material.uniforms.uTime.value = slot.elapsed;

      if (slot.elapsed >= slot.duration) {
        slot.active = false;
        slot.mesh.visible = false;
      }
    }
  }

  _updateFlashes(dt) {
    const flashes = this._flashes;
    for (let i = 0; i < flashes.length; i++) {
      const slot = flashes[i];
      if (!slot.active) continue;

      slot.elapsed += dt;
      const t = slot.elapsed / slot.duration;

      if (t >= 1) {
        slot.active = false;
        slot.sprite.visible = false;
        continue;
      }

      const eased = 1 - (1 - t) * (1 - t); // ease-out quad
      const s = slot.startScale + (slot.maxScale - slot.startScale) * eased;
      slot.sprite.scale.set(s, s, 1);
      slot.material.opacity = 1 - t;
    }
  }

  // -------------------------------------------------------------------
  // Pool acquisition
  // -------------------------------------------------------------------

  // Returns the first free slot, or - if the pool is fully busy - the slot
  // that was spawned earliest (the "oldest instance") so it gets reused.
  _acquireSlot(pool) {
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].active) return pool[i];
    }
    let oldest = pool[0];
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].spawnId < oldest.spawnId) oldest = pool[i];
    }
    return oldest;
  }

  // -------------------------------------------------------------------
  // Public spawn API
  // -------------------------------------------------------------------

  spawnExplosion(position, colorHex = COLOR_ORANGE, scale = 1) {
    const duration = 1.2 * scale;
    this._spawnBurst(this._explosions, position, colorHex, {
      duration,
      drag: 1.4,
      sizeBase: 16 * Math.sqrt(scale),
      speedMin: 20 * scale,
      speedMax: 90 * scale,
    });
    this._spawnFlash(position, colorHex, scale);
  }

  spawnHitSpark(position, colorHex = COLOR_CYAN) {
    this._spawnBurst(this._sparks, position, colorHex, {
      duration: 0.3,
      drag: 3.5,
      sizeBase: 7,
      speedMin: 15,
      speedMax: 55,
    });
  }

  beatPulse(strength = 1) {
    this._beatPulseValue = Math.min(2.5, this._beatPulseValue + strength * 0.85);
  }

  // -------------------------------------------------------------------
  // Spawn implementation (writes into pre-existing typed arrays only)
  // -------------------------------------------------------------------

  _spawnBurst(pool, position, colorHex, opts) {
    const slot = this._acquireSlot(pool);
    const { duration, drag, sizeBase, speedMin, speedMax } = opts;
    const particleCount = slot.particleCount;

    slot.mesh.position.copy(position);
    slot.mesh.visible = true;
    slot.active = true;
    slot.elapsed = 0;
    slot.duration = duration;
    slot.spawnId = this._spawnId++;

    const posAttr = slot.geometry.attributes.position;
    const velAttr = slot.geometry.attributes.aVelocity;
    const sizeAttr = slot.geometry.attributes.aSize;
    const lifeAttr = slot.geometry.attributes.aLifeMul;

    const posArr = posAttr.array;
    const velArr = velAttr.array;
    const sizeArr = sizeAttr.array;
    const lifeArr = lifeAttr.array;

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;

      // small random start offset inside a tiny sphere (spawn jitter)
      const theta1 = Math.random() * Math.PI * 2;
      const phi1 = Math.acos(2 * Math.random() - 1);
      const sinPhi1 = Math.sin(phi1);
      const jitter = Math.random() * 0.6;
      posArr[i3] = Math.cos(theta1) * sinPhi1 * jitter;
      posArr[i3 + 1] = Math.sin(theta1) * sinPhi1 * jitter;
      posArr[i3 + 2] = Math.cos(phi1) * jitter;

      // spherical burst velocity
      const theta2 = Math.random() * Math.PI * 2;
      const phi2 = Math.acos(2 * Math.random() - 1);
      const sinPhi2 = Math.sin(phi2);
      const speedR = speedMin + Math.random() * (speedMax - speedMin);
      velArr[i3] = Math.cos(theta2) * sinPhi2 * speedR;
      velArr[i3 + 1] = Math.sin(theta2) * sinPhi2 * speedR;
      velArr[i3 + 2] = Math.cos(phi2) * speedR;

      sizeArr[i] = 0.55 + Math.random() * 0.9;
      lifeArr[i] = 0.65 + Math.random() * 0.35;
    }

    posAttr.needsUpdate = true;
    velAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;

    const u = slot.material.uniforms;
    u.uTime.value = 0;
    u.uDuration.value = duration;
    u.uDrag.value = drag;
    u.uSize.value = sizeBase;
    u.uColor.value.setHex(colorHex);
  }

  _spawnFlash(position, colorHex, scale) {
    const slot = this._acquireSlot(this._flashes);

    slot.sprite.position.copy(position);
    slot.sprite.visible = true;
    slot.active = true;
    slot.elapsed = 0;
    slot.duration = 0.16;
    slot.spawnId = this._spawnId++;
    slot.startScale = 2.5 * scale;
    slot.maxScale = 22 * scale;

    slot.sprite.scale.set(slot.startScale, slot.startScale, 1);
    slot.material.color.setHex(colorHex);
    slot.material.opacity = 1;
  }

  // -------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------

  dispose() {
    this.scene.remove(this._speedLineMesh);
    this._speedLineGeometry.dispose();
    this._speedLineMaterial.dispose();

    this._disposeBurstPool(this._explosions);
    this._disposeBurstPool(this._sparks);

    for (let i = 0; i < this._flashes.length; i++) {
      const slot = this._flashes[i];
      this.scene.remove(slot.sprite);
      slot.material.dispose();
    }

    this._glowTexture.dispose();
  }

  _disposeBurstPool(pool) {
    for (let i = 0; i < pool.length; i++) {
      const slot = pool[i];
      this.scene.remove(slot.mesh);
      slot.geometry.dispose();
      slot.material.dispose();
    }
  }
}
