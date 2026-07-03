// music.js — Procedural audio engine for a Tron-styled space shooter.
//
// Pure Web Audio API. No imports, no external assets. Everything audible —
// pads, kick, hats, snare, the 16th-note riff, every SFX — is synthesized on
// the fly from oscillators, filters, WaveShapers and a shared noise buffer.
//
// Two references drive the design:
//   1) Daft Punk's Tron: Legacy score / "Derezzed" — dark, relentless,
//      French-house-pumping electro. The signature is `pumpBus`: every kick
//      ducks the pads/arp/bass bus and lets it snap back — the sidechain
//      "breathing" that makes four-on-the-floor electro feel alive.
//   2) Rez — player actions aren't sound layered on top of the music, they
//      ARE the music. SFX are quantized to the 16th-note grid and pull their
//      pitches from the track's scale, so rapid-fire shooting composes an
//      ascending melody locked to the beat.
//
// Timing uses the classic lookahead-scheduler pattern ("A Tale of Two
// Clocks"): a cheap setInterval wakes up every ~25ms and schedules
// sample-accurate Web Audio events ~120ms into the future. onBeat/onBar are
// fired via setTimeout delayed to land on the *audible* moment, so game
// visuals stay locked to what the player actually hears.

// ---------------------------------------------------------------------------
// Constants — tune the whole track from here.
// ---------------------------------------------------------------------------

const BPM = 118;
const SECONDS_PER_BEAT = 60 / BPM;
const SECONDS_PER_16TH = SECONDS_PER_BEAT / 4;
const STEPS_PER_BAR = 16;
const BARS_PER_PHRASE = 8;

const LOOKAHEAD_MS = 25;         // scheduler wake-up interval
const SCHEDULE_AHEAD_SEC = 0.12; // how far ahead of "now" we schedule audio

function noteFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function dbToGain(db) { return Math.pow(10, db / 20); }

const MASTER_GAIN = 0.9;
const MUSIC_BUS_GAIN = dbToGain(-8); // music sits ~-8dB of headroom
const SFX_BUS_GAIN = 0.9;

// 8-bar modal loop, E minor, Tron-score style: mostly a drone with just
// enough movement to feel like it's going somewhere.
const CHORD_ROOTS = [40, 40, 48, 50, 40, 40, 48, 47]; // Em Em C D Em Em C B

// Derezzed-style riff: semitone offsets from a bar's root, two 8-step cells
// per bar (steps 0-7, 8-15). Octave jumps + a chromatic passing tone give it
// the "bite". Root sits an octave above the pad/bass drone root.
const RIFF_CELL_MAIN = [0, 0, 3, 0, 5, 3, 2, 0];    // E-E-G-E-A-G-F#-E
const RIFF_CELL_WIDE = [0, 3, 0, 5, 7, 5, 3, 0];    // E-G-E-A-B-A-G-E
const RIFF_CELL_OCT = [12, 0, 3, 7, 5, 3, 2, 0];    // octave-up stab then fall
const RIFF_CELL_CHR = [0, 0, 3, 5, 3, 0, -2, 0];    // chromatic dip / bite
const RIFF_CELL_PAIRS = [
  [RIFF_CELL_MAIN, RIFF_CELL_MAIN], [RIFF_CELL_MAIN, RIFF_CELL_OCT],
  [RIFF_CELL_WIDE, RIFF_CELL_WIDE], [RIFF_CELL_WIDE, RIFF_CELL_CHR],
  [RIFF_CELL_MAIN, RIFF_CELL_MAIN], [RIFF_CELL_OCT, RIFF_CELL_MAIN],
  [RIFF_CELL_WIDE, RIFF_CELL_CHR], [RIFF_CELL_CHR, RIFF_CELL_MAIN],
];
const RIFF_BARS = CHORD_ROOTS.map((root, i) => ({ root: root + 12, cells: RIFF_CELL_PAIRS[i] }));

// Rez-style ascending E-minor-pentatonic sequence for playerShoot(). Walks up
// this list on every shot, resets to index 0 at every new bar.
const PENTATONIC_SEQUENCE = [64, 67, 69, 71, 74, 76, 79, 81, 83, 86, 88, 91, 93, 95, 98, 100];

// Per-layer target gain by intensity level [0, 1, 2, 3].
const LAYER_GAIN = {
  pad: [0.55, 0.50, 0.45, 0.42],
  pulse: [0.55, 0, 0, 0],
  kick: [0, 0.90, 0.90, 0.90],
  perc: [0, 0.65, 0.70, 0.75], // hats + snare/clap share this bus
  riff: [0, 0, 0.85, 0.80],
  stab: [0, 0, 0, 0.55],
  fx: [0, 0, 0, 0.70],        // riser + crash
};
const INTENSITY_RAMP_SEC = 0.05; // "50ms gain ramps" applied at the bar boundary

function makeDriveCurve(amount = 18) {
  const n = 256, curve = new Float32Array(n), norm = Math.tanh(amount) || 1;
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = Math.tanh(x * amount) / norm; }
  return curve;
}
function makeCrushCurve(steps = 6) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = Math.round(x * steps) / steps; }
  return curve;
}

// ---------------------------------------------------------------------------

export class SynthwaveEngine {
  constructor() {
    // NOTE: no AudioContext here — browsers require a user gesture, so it's
    // lazily created in start().
    this.ctx = null;
    this.started = false;
    this.bpm = BPM;

    this._schedulerTimer = null;
    this._pendingTimeouts = new Set();

    // Transport.
    this._current16th = 0;
    this._currentBar = 0;   // absolute bar count since start()
    this._nextNoteTime = 0;
    this._gridEpoch = 0;    // ctx time of step 0 of bar 0

    // Intensity (0-3); pendingIntensity applies at the next bar boundary.
    this._pendingIntensity = 0;
    this._currentIntensity = 0;

    this._beatCallbacks = [];
    this._barCallbacks = [];

    // Rez shot-melody state.
    this._shootIndex = 0;
    this._shootBar = -1;

    // Stateful SFX voices.
    this._boostOn = false;
    this._boostVoice = null;

    // Static waveshaper curves — pure data, no ctx needed, build once.
    this._driveCurve = makeDriveCurve(18);
    this._crushCurve = makeCrushCurve(6);
  }

  // ---- Lifecycle ------------------------------------------------------

  async start() {
    if (this.started && this.ctx) {
      // Repeat calls must not double-schedule; just make sure we're audible.
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (_) {} }
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    this.started = true;
    if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (_) {} }

    this._buildGraph();
    this._resetTransport();
    this._schedulerTimer = setInterval(() => this._scheduler(), LOOKAHEAD_MS);
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    if (this._schedulerTimer) { clearInterval(this._schedulerTimer); this._schedulerTimer = null; }
    for (const id of this._pendingTimeouts) clearTimeout(id);
    this._pendingTimeouts.clear();

    const ctx = this.ctx;
    if (ctx) {
      try {
        const t = ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(t);
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
        this.masterGain.gain.linearRampToValueAtTime(0, t + 0.15);
      } catch (_) {}
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 250);
    }
    this.ctx = null;
    this._boostVoice = null;
    this._boostOn = false;
  }

  // ---- Beat / bar callbacks --------------------------------------------

  onBeat(cb) { if (typeof cb === 'function') this._beatCallbacks.push(cb); }
  onBar(cb) { if (typeof cb === 'function') this._barCallbacks.push(cb); }

  setIntensity(level) {
    this._pendingIntensity = Math.max(0, Math.min(3, level | 0)); // applied at next bar
  }

  // ---- Audio graph ------------------------------------------------------

  _buildGraph() {
    const ctx = this.ctx;
    this.compressor = ctx.createDynamicsCompressor();
    Object.assign(this.compressor.threshold, { value: -14 });
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.22;

    this.masterGain = this._gain(ctx, MASTER_GAIN, ctx.destination);
    this.compressor.connect(this.masterGain);

    this.musicBus = this._gain(ctx, MUSIC_BUS_GAIN, this.compressor);
    this.sfxBus = this._gain(ctx, SFX_BUS_GAIN, this.compressor);

    // THE PUMP: pads + arp/riff + sustained bass live here and get ducked on
    // every kick. Kick and lead SFX bypass this entirely.
    this.pumpBus = this._gain(ctx, 1.0, this.musicBus);

    this.padGain = this._gain(ctx, 0, this.pumpBus);
    this.riffGain = this._gain(ctx, 0, this.pumpBus);
    this.pulseGain = this._gain(ctx, 0, this.pumpBus);
    this.kickGain = this._gain(ctx, 0, this.musicBus);
    this.percGain = this._gain(ctx, 0, this.musicBus);
    this.stabGain = this._gain(ctx, 0, this.musicBus);
    this.fxGain = this._gain(ctx, 0, this.musicBus);

    // Shared white-noise buffer for hats/snare/riser/crash/explosions.
    const len = Math.floor(ctx.sampleRate * 2);
    this._noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._buildPad();
  }

  _gain(ctx, value, dest) {
    const g = ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
  }

  _buildPad() {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.6;
    filter.connect(this.padGain);

    const rootFreq = noteFreq(CHORD_ROOTS[0]);
    this.padOscs = [-11, 0, 11].map((detune) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = rootFreq; o.detune.value = detune;
      o.connect(filter); o.start();
      return o;
    });

    this.padSub = ctx.createOscillator();
    this.padSub.type = 'sine';
    this.padSub.frequency.value = noteFreq(CHORD_ROOTS[0] - 12);
    this.padSub.connect(filter); this.padSub.start();

    // Slow LFO breathing the filter cutoff — ominous, "Grid-idle" drift.
    this.padLfo = ctx.createOscillator();
    this.padLfo.type = 'sine';
    this.padLfo.frequency.value = 0.07;
    const lfoDepth = this._gain(ctx, 220, filter.frequency);
    this.padLfo.connect(lfoDepth);
    this.padLfo.start();
  }

  _updatePadChord(rootMidi, time) {
    for (const o of this.padOscs) o.frequency.setTargetAtTime(noteFreq(rootMidi), time, 0.15);
    this.padSub.frequency.setTargetAtTime(noteFreq(rootMidi - 12), time, 0.15);
  }

  // ---- Transport / lookahead scheduler ("A Tale of Two Clocks") ---------

  _resetTransport() {
    this._current16th = 0;
    this._currentBar = 0;
    this._gridEpoch = this.ctx.currentTime + 0.05;
    this._nextNoteTime = this._gridEpoch;
    this._currentIntensity = this._pendingIntensity;
  }

  _scheduler() {
    if (!this.ctx) return;
    while (this._nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      this._scheduleStep(this._current16th, this._currentBar, this._nextNoteTime);
      this._nextNoteTime += SECONDS_PER_16TH;
      if (++this._current16th >= STEPS_PER_BAR) { this._current16th = 0; this._currentBar++; }
    }
  }

  _scheduleTimeout(fn, time) {
    const delayMs = Math.max(0, (time - this.ctx.currentTime) * 1000);
    const id = setTimeout(() => { this._pendingTimeouts.delete(id); fn(); }, delayMs);
    this._pendingTimeouts.add(id);
  }

  _fireBeat(beat, bar, time) {
    if (!this._beatCallbacks.length) return;
    this._scheduleTimeout(() => {
      const payload = { beat, bar, sixteenth: beat * 4 };
      for (const cb of this._beatCallbacks) { try { cb(payload); } catch (e) { console.error(e); } }
    }, time);
  }

  _fireBar(bar, time) {
    if (!this._barCallbacks.length) return;
    this._scheduleTimeout(() => {
      for (const cb of this._barCallbacks) { try { cb({ bar }); } catch (e) { console.error(e); } }
    }, time);
  }

  // Every step of the 16th-note grid gets a chance to trigger a layer.
  _scheduleStep(step, bar, time) {
    const phraseBar = bar % BARS_PER_PHRASE;

    if (step === 0) {
      this._currentIntensity = this._pendingIntensity;
      this._applyIntensityGains(time);
      this._updatePadChord(CHORD_ROOTS[phraseBar], time);
      this._fireBar(bar, time);
      if (this._currentIntensity >= 3 && phraseBar === 0 && bar > 0) {
        this._triggerCrash(time); // resolves the riser from the previous bar
      }
    }
    if (step % 4 === 0) this._fireBeat(step / 4, bar, time);

    const lvl = this._currentIntensity;

    // Level 0: ominous drone + sparse deep pulse (half notes).
    if (lvl === 0 && (step === 0 || step === 8)) this._triggerPulse(CHORD_ROOTS[phraseBar] - 12, time);

    // Level 1+: four-on-the-floor kick (drives the pump), offbeat open hat,
    // snare/clap on 2 & 4.
    if (lvl >= 1 && step % 4 === 0) this._triggerKick(time);
    if (lvl >= 1 && (step === 4 || step === 12)) this._triggerSnare(time);
    if (lvl >= 1 && (step === 2 || step === 6 || step === 10 || step === 14)) this._triggerHat(time, true);

    // Level 2+: the Derezzed riff.
    if (lvl >= 2) this._triggerRiffStep(phraseBar, step, time);

    // Level 3+: 16th closed hats, accent stabs, riser into the phrase turn.
    if (lvl >= 3) this._triggerHat(time, false);
    if (lvl >= 3 && (step === 0 || step === 14)) this._triggerStab(CHORD_ROOTS[phraseBar], time);
    if (lvl >= 3 && phraseBar === BARS_PER_PHRASE - 1 && step === 0) this._triggerRiser(time, SECONDS_PER_BEAT * 4);
  }

  _applyIntensityGains(time) {
    const lvl = this._currentIntensity;
    this._rampGain(this.padGain, LAYER_GAIN.pad[lvl], time);
    this._rampGain(this.pulseGain, LAYER_GAIN.pulse[lvl], time);
    this._rampGain(this.kickGain, LAYER_GAIN.kick[lvl], time);
    this._rampGain(this.percGain, LAYER_GAIN.perc[lvl], time);
    this._rampGain(this.riffGain, LAYER_GAIN.riff[lvl], time);
    this._rampGain(this.stabGain, LAYER_GAIN.stab[lvl], time);
    this._rampGain(this.fxGain, LAYER_GAIN.fx[lvl], time);
  }

  _rampGain(node, target, time, ramp = INTENSITY_RAMP_SEC) {
    node.gain.cancelScheduledValues(time);
    node.gain.setValueAtTime(node.gain.value, time);
    node.gain.linearRampToValueAtTime(target, time + ramp);
  }

  // ---- THE PUMP — Daft Punk sidechain duck, fired on every kick ---------

  _duckPump(time) {
    const g = this.pumpBus.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(1.0, time);
    g.linearRampToValueAtTime(0.35, time + 0.01);
    g.exponentialRampToValueAtTime(1.0, time + 0.27);
  }

  // ---- One-shot synthesis helpers ---------------------------------------

  _noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    return s;
  }

  // Standard fast-attack / exponential-decay envelope on a GainNode's param.
  _pluck(param, peak, attack, decay, time) {
    param.cancelScheduledValues(time);
    param.setValueAtTime(0.0001, time);
    param.linearRampToValueAtTime(peak, time + attack);
    param.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  }

  // ---- Music layers -------------------------------------------------

  _triggerKick(time) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, time);
    o.frequency.exponentialRampToValueAtTime(45, time + 0.15);
    const g = ctx.createGain();
    this._pluck(g.gain, 1.0, 0.005, 0.275, time);
    o.connect(g); g.connect(this.kickGain);
    o.start(time); o.stop(time + 0.3);

    const click = this._noiseSrc();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const cg = ctx.createGain();
    this._pluck(cg.gain, 0.35, 0.001, 0.019, time);
    click.connect(hp); hp.connect(cg); cg.connect(this.kickGain);
    click.start(time); click.stop(time + 0.03);

    this._duckPump(time);
  }

  _triggerPulse(midi, time) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = noteFreq(midi);
    const g = ctx.createGain();
    this._pluck(g.gain, 0.8, 0.02, 0.88, time);
    o.connect(g); g.connect(this.pulseGain);
    o.start(time); o.stop(time + 0.95);
  }

  _triggerSnare(time) {
    const ctx = this.ctx;
    const src = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.1;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(this.percGain);
    src.start(time); src.stop(time + 0.15);
  }

  _triggerHat(time, open) {
    const ctx = this.ctx;
    const src = this._noiseSrc();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
    const g = ctx.createGain();
    const dur = open ? 0.16 : 0.045;
    g.gain.setValueAtTime(open ? 0.32 : 0.24, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(hp); hp.connect(g); g.connect(this.percGain);
    src.start(time); src.stop(time + dur + 0.02);
  }

  _triggerRiffStep(phraseBar, step, time) {
    const barDef = RIFF_BARS[phraseBar];
    const cell = step < 8 ? barDef.cells[0] : barDef.cells[1];
    this._triggerRiffNote(barDef.root + cell[step % 8], time, SECONDS_PER_16TH * 0.9);
  }

  // Aggressive detuned saw through a WaveShaper (mild tanh drive) and a
  // resonant lowpass with its own envelope per note — the Derezzed hook.
  _triggerRiffNote(midi, time, dur) {
    const ctx = this.ctx;
    const freq = noteFreq(midi);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = freq; o1.detune.value = -8;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq; o2.detune.value = 8;
    const shaper = ctx.createWaveShaper(); shaper.curve = this._driveCurve; shaper.oversample = '2x';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.Q.value = 9;
    filter.frequency.setValueAtTime(2000, time);
    filter.frequency.exponentialRampToValueAtTime(450, time + dur * 0.9);
    const g = ctx.createGain();
    this._pluck(g.gain, 0.85, 0.006, dur - 0.006, time);
    o1.connect(shaper); o2.connect(shaper); shaper.connect(filter); filter.connect(g); g.connect(this.riffGain);
    o1.start(time); o2.start(time);
    o1.stop(time + dur + 0.02); o2.stop(time + dur + 0.02);
  }

  _triggerStab(rootMidi, time) {
    const ctx = this.ctx;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 2;
    const g = ctx.createGain();
    this._pluck(g.gain, 0.32, 0.005, 0.175, time);
    bp.connect(g); g.connect(this.stabGain);
    for (const n of [rootMidi + 12, rootMidi + 19, rootMidi + 24]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = noteFreq(n);
      o.connect(bp); o.start(time); o.stop(time + 0.2);
    }
  }

  _triggerRiser(time, dur) {
    const ctx = this.ctx;
    const src = this._noiseSrc();
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(200, time);
    filter.frequency.exponentialRampToValueAtTime(9000, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.5, time + dur);
    src.connect(filter); filter.connect(g); g.connect(this.fxGain);
    src.start(time); src.stop(time + dur + 0.02);
  }

  _triggerCrash(time) {
    const ctx = this.ctx;
    const src = this._noiseSrc();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 1.2);
    src.connect(hp); hp.connect(g); g.connect(this.fxGain);
    src.start(time); src.stop(time + 1.3);
  }

  // ---- Rez-style beat-grid quantization for player/enemy actions --------

  // Returns the AudioContext time of the next 16th-note boundary (plus
  // `offsetSteps - 1` extra 16ths). Max wait at 118bpm is one 16th note,
  // ~127ms — that deliberate wait is the Rez feel.
  quantize(offsetSteps = 1) {
    if (!this.ctx) return 0;
    return this._nextGridTime(1, offsetSteps - 1);
  }

  // multipleSteps: 1 = 16th grid, 2 = 8th grid, 4 = beat grid.
  _nextGridTime(multipleSteps, extraSteps = 0) {
    const stepsSinceEpoch = (this.ctx.currentTime - this._gridEpoch) / SECONDS_PER_16TH;
    const n = Math.floor(stepsSinceEpoch / multipleSteps) * multipleSteps + multipleSteps;
    return this._gridEpoch + (n + extraSteps) * SECONDS_PER_16TH;
  }

  _stepIndexAt(time) { return Math.round((time - this._gridEpoch) / SECONDS_PER_16TH); }

  // ---- Player / enemy SFX — all no-op gracefully before start() ---------

  playerShoot() {
    if (!this.ctx) return;
    const time = this.quantize(1);
    const bar = Math.floor(this._stepIndexAt(time) / STEPS_PER_BAR);
    if (bar !== this._shootBar) { this._shootBar = bar; this._shootIndex = 0; }
    const midi = PENTATONIC_SEQUENCE[this._shootIndex % PENTATONIC_SEQUENCE.length];
    this._triggerPluck(midi, time, this._shootIndex++);
  }

  // Bright pluck: square+saw, fast decay, ping-pong-ish feedback delay at
  // 3/16. Pitch walks up PENTATONIC_SEQUENCE — rapid fire = an ascending
  // melody line locked to the grid.
  _triggerPluck(midi, time, shotNumber) {
    const ctx = this.ctx;
    const freq = noteFreq(midi);
    const o1 = ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq; o2.detune.value = 7;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 6000; filter.Q.value = 0.8;
    const g = ctx.createGain();
    this._pluck(g.gain, 0.55, 0.004, 0.216, time);

    const pan = ctx.createStereoPanner();
    pan.pan.value = shotNumber % 2 === 0 ? -0.4 : 0.4;
    o1.connect(filter); o2.connect(filter); filter.connect(g); g.connect(pan); pan.connect(this.sfxBus);

    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = SECONDS_PER_16TH * 3;
    const fb = this._gain(ctx, 0.32, delay);
    const wet = this._gain(ctx, 0.28, pan);
    g.connect(delay); delay.connect(fb); delay.connect(wet);

    o1.start(time); o2.start(time);
    o1.stop(time + 0.3); o2.stop(time + 0.3);
  }

  // Low FM-ish zap — meaner than the player's pluck.
  enemyShoot() {
    if (!this.ctx) return;
    const time = this.quantize(1);
    const ctx = this.ctx;
    const carrier = ctx.createOscillator(); carrier.type = 'sawtooth'; carrier.frequency.value = 180;
    const mod = ctx.createOscillator(); mod.type = 'square'; mod.frequency.value = 55;
    const modGain = this._gain(ctx, 120, carrier.frequency);
    mod.connect(modGain);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, time);
    filter.frequency.exponentialRampToValueAtTime(150, time + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    carrier.connect(filter); filter.connect(g); g.connect(this.sfxBus);
    carrier.start(time); mod.start(time);
    carrier.stop(time + 0.22); mod.stop(time + 0.22);
  }

  // Two-note rising confirm, high register, lightly bit-crushed.
  lockOn() {
    if (!this.ctx) return;
    const t1 = this.quantize(1);
    this._triggerBlip(83, t1);                    // B5
    this._triggerBlip(88, t1 + SECONDS_PER_16TH);  // E6
  }

  _triggerBlip(midi, time) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = noteFreq(midi);
    const shaper = ctx.createWaveShaper(); shaper.curve = this._crushCurve;
    const g = ctx.createGain();
    this._pluck(g.gain, 0.4, 0.003, 0.157, time);
    o.connect(shaper); shaper.connect(g); g.connect(this.sfxBus);
    o.start(time); o.stop(time + 0.18);
  }

  explosion(big = false) {
    if (!this.ctx) return;
    const time = this._nextGridTime(2, 0); // next 8th note
    this._triggerSubBoom(time, big);
    this._triggerNoiseCrash(time, big);
    if (big) {
      this._triggerPowerChordStab(time);
      this._duckPump(time); // manual duck — big hits punch through the mix
    }
  }

  _triggerSubBoom(time, big) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 90 : 70, time);
    o.frequency.exponentialRampToValueAtTime(40, time + 0.35);
    const g = ctx.createGain();
    this._pluck(g.gain, big ? 0.9 : 0.6, 0.01, (big ? 0.7 : 0.4) - 0.01, time);
    o.connect(g); g.connect(this.sfxBus);
    o.start(time); o.stop(time + (big ? 0.75 : 0.45));
  }

  _triggerNoiseCrash(time, big) {
    const ctx = this.ctx;
    const src = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = big ? 1200 : 2200; bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(big ? 0.65 : 0.42, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + (big ? 0.6 : 0.3));
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    src.start(time); src.stop(time + (big ? 0.65 : 0.35));
  }

  // One-beat Em power chord, manually ducking the pump — the "big" explosion punch.
  _triggerPowerChordStab(time) {
    const ctx = this.ctx;
    const dur = SECONDS_PER_BEAT;
    const shaper = ctx.createWaveShaper(); shaper.curve = this._driveCurve;
    const g = ctx.createGain();
    this._pluck(g.gain, 0.5, 0.01, dur - 0.01, time);
    shaper.connect(g); g.connect(this.sfxBus);
    for (const n of [40, 47, 52]) { // E2 B2 E3
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = noteFreq(n);
      o.connect(shaper); o.start(time); o.stop(time + dur + 0.05);
    }
  }

  // Immediate — danger can't wait for the grid: dissonant minor-second stab + noise burst.
  playerHit() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const time = ctx.currentTime + 0.001;

    const shaper = ctx.createWaveShaper(); shaper.curve = this._driveCurve;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    shaper.connect(g); g.connect(this.sfxBus);
    for (const midi of [64, 65]) { // E4 + F4
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = noteFreq(midi);
      o.connect(shaper); o.start(time); o.stop(time + 0.32);
    }

    const src = this._noiseSrc();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    src.connect(hp); hp.connect(ng); ng.connect(this.sfxBus);
    src.start(time); src.stop(time + 0.17);
  }

  // Filtered-noise + saw riser rising over ~700ms at the next beat. Repeated
  // calls with the same value are ignored; the voice is tracked for release.
  boost(on) {
    if (!this.ctx) return;
    const wantOn = !!on;
    if (wantOn === this._boostOn) return;
    this._boostOn = wantOn;
    const ctx = this.ctx;

    if (wantOn) {
      const time = this._nextGridTime(4, 0); // next beat
      const src = this._noiseSrc(); src.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 0.9;
      filter.frequency.setValueAtTime(300, time);
      filter.frequency.exponentialRampToValueAtTime(4000, time + 0.7);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, time);
      o.frequency.exponentialRampToValueAtTime(440, time + 0.7);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.38, time + 0.7);
      src.connect(filter); filter.connect(g); o.connect(g); g.connect(this.sfxBus);
      src.start(time); o.start(time);
      this._boostVoice = { src, o, g };
    } else {
      const v = this._boostVoice;
      this._boostVoice = null;
      if (!v) return;
      const t = ctx.currentTime;
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(v.g.gain.value, t);
      v.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      try { v.src.stop(t + 0.15); v.o.stop(t + 0.15); } catch (_) {}
    }
  }

  // Triumphant ascending E-minor -> E-major arpeggio (Picardy-third lift)
  // with a long delay tail, quantized to the next beat.
  gateChime() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const start = this._nextGridTime(4, 0);
    const seq = [64, 67, 71, 76, 76, 80, 83, 88]; // E4 G4 B4 E5 | E5 G#5 B5 E6

    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = SECONDS_PER_16TH * 3;
    const fb = this._gain(ctx, 0.55, delay);
    const wet = this._gain(ctx, 0.4, this.sfxBus);
    delay.connect(fb); delay.connect(wet);

    seq.forEach((midi, i) => {
      const t = start + i * SECONDS_PER_16TH;
      const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = noteFreq(midi);
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = noteFreq(midi) * 2;
      const g = ctx.createGain();
      this._pluck(g.gain, 0.4, 0.01, 0.34, t);
      o1.connect(g); o2.connect(g); g.connect(this.sfxBus); g.connect(delay);
      o1.start(t); o2.start(t);
      o1.stop(t + 0.4); o2.stop(t + 0.4);
    });
  }

  // Immediate: descending detuned drop over ~2s while the music layers ramp out.
  gameOverSting() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const time = ctx.currentTime + 0.001;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, time);
    filter.frequency.exponentialRampToValueAtTime(180, time + 2.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 2.0);
    filter.connect(g); g.connect(this.sfxBus);

    const rootFreq = noteFreq(64); // E4
    for (const detune of [-10, 0, 10]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = detune;
      o.frequency.setValueAtTime(rootFreq, time);
      o.frequency.exponentialRampToValueAtTime(rootFreq / 4, time + 2.0);
      o.connect(filter); o.start(time); o.stop(time + 2.05);
    }

    // Music layers ramp out under the sting.
    this._pendingIntensity = 0;
    this._currentIntensity = 0;
    for (const layer of [this.padGain, this.pulseGain, this.kickGain, this.percGain, this.riffGain, this.stabGain, this.fxGain]) {
      layer.gain.cancelScheduledValues(time);
      layer.gain.setValueAtTime(layer.gain.value, time);
      layer.gain.linearRampToValueAtTime(0, time + 1.6);
    }
    this.musicBus.gain.cancelScheduledValues(time);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, time);
    this.musicBus.gain.linearRampToValueAtTime(MUSIC_BUS_GAIN * 0.15, time + 1.8);
  }
}
