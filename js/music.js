// music.js — Procedural synthwave music + SFX engine for a Tron-style space shooter.
//
// Pure Web Audio API. No external assets, no libraries. Everything you hear —
// pads, bass, drums, arps, leads and every sound effect — is synthesized on the
// fly from oscillators, filters and noise buffers.
//
// Music uses the classic "lookahead scheduler" pattern ("A Tale of Two Clocks"):
// a cheap setInterval wakes up frequently and schedules precisely-timed Web
// Audio events a little bit into the future, using the AudioContext's own
// sample-accurate clock for the actual note timing. UI callbacks (onBeat/onBar)
// are fired via setTimeout delayed to line up with the *audible* moment so the
// game's visuals stay locked to the music.

// ---------------------------------------------------------------------------
// Constants — tweak the whole feel of the track from here.
// ---------------------------------------------------------------------------

const BPM_DEFAULT = 104;
const STEPS_PER_BEAT = 4;                              // 16th-note resolution
const BEATS_PER_BAR = 4;
const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;  // 16
const BARS_PER_PHRASE = 8;
const TOTAL_STEPS = STEPS_PER_BAR * BARS_PER_PHRASE;   // 128

const LOOKAHEAD_MS = 25;          // how often the scheduler wakes up
const SCHEDULE_AHEAD_S = 0.12;    // how far ahead of "now" we schedule audio

// 8-bar A-minor progression: i - VI - III - VII / i - VI - iv - V
// (Am - F - C - G / Am - F - Dm - E). The final E is a borrowed dominant
// (major third, G#) for real harmonic pull back into Am at the loop point.
// `root` is derived automatically, one octave below the chord's own root tone.
const PROGRESSION = [
  { name: 'Am', triad: [45, 48, 52] },
  { name: 'F',  triad: [41, 45, 48] },
  { name: 'C',  triad: [48, 52, 55] },
  { name: 'G',  triad: [43, 47, 50] },
  { name: 'Am', triad: [45, 48, 52] },
  { name: 'F',  triad: [41, 45, 48] },
  { name: 'Dm', triad: [50, 53, 57] },
  { name: 'E',  triad: [52, 56, 59] },
].map((c) => ({ ...c, root: c.triad[0] - 12 }));

// 16-step arpeggio pattern: index into the chord's extended tone set, or null
// for a rest. Deliberately syncopated so it doesn't feel like a metronome.
const ARP_PATTERN = [0, null, 1, 2, null, 1, 0, 3, 2, null, 1, 0, 2, null, 3, 1];

// Simple heroic 8-bar lead hook, generated from the chord tones so it always
// stays "in key" — one short rising-and-falling phrase per bar, up an octave
// from the pad register.
function buildLeadMelody() {
  const beatOffsets = [0, 6, 8, 12];
  const degreeSeq = [0, 2, 1, 2];
  const holdSeq = [5, 2, 3, 4];
  const notes = [];
  for (let bar = 0; bar < BARS_PER_PHRASE; bar++) {
    const chord = PROGRESSION[bar];
    beatOffsets.forEach((offset, i) => {
      const midi = chord.triad[degreeSeq[i]] + 12;
      notes.push({ step: bar * STEPS_PER_BAR + offset, midi, hold: holdSeq[i] });
    });
  }
  return notes;
}
const LEAD_MELODY = buildLeadMelody();
const LEAD_INDEX = Object.fromEntries(LEAD_MELODY.map((n) => [n.step, n]));

// ---------------------------------------------------------------------------
// Small DSP / scheduling helpers
// ---------------------------------------------------------------------------

const dbToGain = (db) => Math.pow(10, db / 20);
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Multi-point ramp helper. points = [[dtFromT0, value], ...]. */
function env(param, t0, points, curve = 'lin') {
  param.cancelScheduledValues(t0);
  points.forEach(([dt, value], i) => {
    const t = t0 + dt;
    if (i === 0) {
      param.setValueAtTime(curve === 'exp' ? Math.max(value, 0.0001) : value, t);
    } else if (curve === 'exp') {
      param.exponentialRampToValueAtTime(Math.max(value, 0.0001), t);
    } else {
      param.linearRampToValueAtTime(value, t);
    }
  });
}

/** Smoothly moves a gain param to a new target — avoids clicks on layer toggles. */
function rampGain(param, t0, target, duration = 0.05) {
  param.cancelScheduledValues(t0);
  param.setValueAtTime(param.value, t0);
  param.linearRampToValueAtTime(target, t0 + duration);
}

/** One reusable buffer of white noise, sliced by each noise burst via start/stop. */
function makeNoiseBuffer(ctx, seconds = 2) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Filtered, enveloped burst of noise — used for hats, snare, risers, explosions. */
function noiseBurst(ctx, dest, buffer, t, dur, opts = {}) {
  const {
    filterType = 'bandpass', freq = 1200, freqEnd = null, q = 1, peak = 0.5,
  } = opts;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  if (freqEnd !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), t + dur);
  const gain = ctx.createGain();
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  env(gain.gain, t, [[0, 0.0001], [Math.min(0.01, dur * 0.25), peak], [dur, 0.0001]]);
  src.start(t);
  src.stop(t + dur + 0.02);
  return { src, filter, gain };
}

/** Short synth "pluck" voice — one oscillator through a filter with its own envelope. */
function pluckVoice(ctx, dest, t, dur, opts = {}) {
  const {
    type = 'sawtooth', freq, detune = 0, filterType = 'lowpass',
    filterFreq = 2200, filterFreqEnd = null, q = 1, peak = 0.35, attack = 0.006,
  } = opts;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(filterFreq, t);
  if (filterFreqEnd !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(filterFreqEnd, 20), t + dur);
  const gain = ctx.createGain();
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  env(gain.gain, t, [[0, 0.0001], [attack, peak], [dur, 0.0001]]);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  return { osc, filter, gain };
}

function layerTargetsForIntensity(level) {
  return {
    kick: level >= 1 ? 1 : 0,
    bass: level >= 1 ? 1 : 0,
    snare: level >= 1 ? 1 : 0,
    arp: level >= 2 ? 1 : 0,
    lead: level >= 3 ? 1 : 0,
    openHat: level >= 3 ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export class SynthwaveEngine {
  constructor() {
    // No AudioContext here — browsers block autoplay until a user gesture,
    // so the whole graph is built lazily the first time it's actually needed.
    this.ctx = null;
    this.bpm = BPM_DEFAULT;
    this.intensity = 0;
    this._pendingIntensity = null;

    this._started = false;
    this._schedulerId = null;
    this._timeouts = [];
    this._beatCbs = [];
    this._barCbs = [];

    this.step = 0;
    this.nextNoteTime = 0;
    this._boostVoice = null;
  }

  // -- public transport -------------------------------------------------

  async start() {
    if (this._started) return; // never double-schedule
    if (!this.ctx) {
      try {
        this._buildGraph();
      } catch (e) {
        return; // audio unsupported / blocked — fail silently
      }
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {
        // still allowed to proceed; scheduler will just be silent until resumed
      }
    }
    rampGain(this.musicBus.gain, this.ctx.currentTime, this._musicBaseGain, 0.25);
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    this._started = true;
    this._schedulerId = setInterval(() => this._tick(), LOOKAHEAD_MS);
  }

  stop() {
    if (!this._started) return;
    this._started = false;
    if (this._schedulerId) {
      clearInterval(this._schedulerId);
      this._schedulerId = null;
    }
    this._timeouts.forEach(clearTimeout);
    this._timeouts = [];
    if (this.ctx && this.musicBus) {
      rampGain(this.musicBus.gain, this.ctx.currentTime, 0.0001, 0.2);
    }
  }

  onBeat(cb) {
    this._beatCbs.push(cb);
    return () => { this._beatCbs = this._beatCbs.filter((f) => f !== cb); };
  }

  onBar(cb) {
    this._barCbs.push(cb);
    return () => { this._barCbs = this._barCbs.filter((f) => f !== cb); };
  }

  setIntensity(level) {
    const lvl = Math.max(0, Math.min(3, Math.round(level)));
    this._pendingIntensity = lvl; // applied at the next bar boundary by the scheduler
  }

  // -- graph construction -------------------------------------------------

  _buildGraph() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    this.ctx = ctx;
    this.noiseBuffer = makeNoiseBuffer(ctx, 2);
    this._musicBaseGain = dbToGain(-8);

    // Master chain: buses -> compressor -> master gain -> destination.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    const musicBus = ctx.createGain();
    musicBus.gain.value = 0.0001; // ramped up in start()
    musicBus.connect(compressor);

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = dbToGain(-4);
    sfxBus.connect(compressor);

    // Shared feedback delay (dotted-eighth) for arp/lead sparkle.
    const delayNode = ctx.createDelay(1.5);
    delayNode.delayTime.value = (60 / this.bpm) * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 1;
    delayNode.connect(feedback);
    feedback.connect(delayNode);
    delayNode.connect(delayWet);
    delayWet.connect(musicBus);

    // Per-layer bus gains. Always-on layers (pad/sub/soft hat) sit at 1;
    // intensity-gated layers start silent and are ramped by setIntensity().
    const padGain = ctx.createGain(); padGain.gain.value = 1; padGain.connect(musicBus);
    const subGain = ctx.createGain(); subGain.gain.value = 1; subGain.connect(musicBus);
    const softHatGain = ctx.createGain(); softHatGain.gain.value = 1; softHatGain.connect(musicBus);
    const kickGain = ctx.createGain(); kickGain.gain.value = 0; kickGain.connect(musicBus);
    const bassGain = ctx.createGain(); bassGain.gain.value = 0; bassGain.connect(musicBus);
    const snareGain = ctx.createGain(); snareGain.gain.value = 0; snareGain.connect(musicBus);
    const arpGain = ctx.createGain(); arpGain.gain.value = 0;
    arpGain.connect(musicBus); arpGain.connect(delayNode);
    const leadGain = ctx.createGain(); leadGain.gain.value = 0;
    leadGain.connect(musicBus); leadGain.connect(delayNode);
    const openHatGain = ctx.createGain(); openHatGain.gain.value = 0; openHatGain.connect(musicBus);

    Object.assign(this, {
      compressor, masterGain, musicBus, sfxBus, delayNode, feedback, delayWet,
      padGain, subGain, softHatGain, kickGain, bassGain, snareGain, arpGain, leadGain, openHatGain,
    });

    // Persistent mono lead voice (two detuned saws) — kept alive across notes
    // so it can genuinely glide (portamento) instead of hard-retriggering.
    const l1 = ctx.createOscillator(); l1.type = 'sawtooth'; l1.detune.value = -7;
    const l2 = ctx.createOscillator(); l2.type = 'sawtooth'; l2.detune.value = 7;
    const leadFilter = ctx.createBiquadFilter();
    leadFilter.type = 'lowpass'; leadFilter.frequency.value = 2600; leadFilter.Q.value = 0.6;
    const leadAmp = ctx.createGain(); leadAmp.gain.value = 0.0001;
    l1.connect(leadFilter); l2.connect(leadFilter); leadFilter.connect(leadAmp); leadAmp.connect(leadGain);
    l1.frequency.value = 220; l2.frequency.value = 220;
    l1.start(); l2.start();
    this._lead = { o1: l1, o2: l2, filter: leadFilter, amp: leadAmp, lastFreq: 220 };

    this._boostVoice = null;
  }

  /** Lazily builds the graph so SFX work even if start() was never called. */
  _ensure() {
    if (!this.ctx) {
      try {
        this._buildGraph();
      } catch (e) {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _safe(fn) {
    try { fn(); } catch (e) { /* SFX must never throw */ }
  }

  // -- scheduler ("A Tale of Two Clocks") ---------------------------------

  _secondsPer16th() { return 60 / this.bpm / STEPS_PER_BEAT; }

  _tick() {
    if (!this._started || !this.ctx) return;
    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD_S) {
      this._scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += this._secondsPer16th();
      this.step = (this.step + 1) % TOTAL_STEPS;
    }
  }

  /** Fires a callback via setTimeout timed to match the audible moment. */
  _fireAt(time, fn) {
    const delay = Math.max(0, (time - this.ctx.currentTime) * 1000);
    this._timeouts.push(setTimeout(fn, delay));
  }

  _scheduleStep(step, time) {
    const barIndex = Math.floor(step / STEPS_PER_BAR) % BARS_PER_PHRASE;
    const stepInBar = step % STEPS_PER_BAR;
    const beatInBar = Math.floor(stepInBar / STEPS_PER_BEAT);
    const sixteenthInBeat = stepInBar % STEPS_PER_BEAT;
    const isBeat = sixteenthInBeat === 0;
    const isBarStart = stepInBar === 0;
    const chord = PROGRESSION[barIndex];
    const secondsPer16th = this._secondsPer16th();

    if (isBarStart) {
      this._applyPendingIntensity(time);
      this._triggerPad(chord, time, secondsPer16th);
      this._triggerSubBass(chord, time, secondsPer16th);
      this._maybeTriggerRiser(barIndex, time, secondsPer16th);
    }

    // Level 0+: sparse soft hats on the off-8ths.
    if (stepInBar % 4 === 2) this._scheduleSoftHat(time);

    // Level 1+: four-on-the-floor kick, snare/clap on 2 & 4, outrun octave bass.
    if (isBeat) {
      this._scheduleKick(time);
      if (beatInBar === 1 || beatInBar === 3) this._scheduleSnare(time);
    }
    if (stepInBar % 2 === 0) {
      const octaveUp = ((stepInBar / 2) % 2) === 1;
      this._scheduleOffbeatBass(chord, time, octaveUp);
    }

    // Level 2+: 16th-note arpeggio.
    const arpDegree = ARP_PATTERN[stepInBar];
    if (arpDegree !== null && arpDegree !== undefined) {
      this._scheduleArpNote(chord, arpDegree, time);
    }

    // Level 3+: lead melody + open hat accents.
    const leadNote = LEAD_INDEX[step];
    if (leadNote) this._triggerLead(leadNote.midi, time, leadNote.hold * secondsPer16th);
    if (stepInBar % 8 === 6) this._scheduleOpenHat(time);

    // Visual sync callbacks, timed to the audible moment.
    if (isBeat) {
      const beatNumber = beatInBar + 1;
      this._fireAt(time, () => this._emitBeat({ beat: beatNumber, bar: barIndex + 1, sixteenth: sixteenthInBeat }));
    }
    if (isBarStart) {
      this._fireAt(time, () => this._emitBar({ bar: barIndex + 1 }));
    }
  }

  _emitBeat(info) { this._beatCbs.forEach((cb) => { try { cb(info); } catch (e) {} }); }
  _emitBar(info) { this._barCbs.forEach((cb) => { try { cb(info); } catch (e) {} }); }

  _applyPendingIntensity(time) {
    if (this._pendingIntensity === null || this._pendingIntensity === this.intensity) return;
    this.intensity = this._pendingIntensity;
    this._pendingIntensity = null;
    const t = layerTargetsForIntensity(this.intensity);
    rampGain(this.kickGain.gain, time, t.kick);
    rampGain(this.bassGain.gain, time, t.bass);
    rampGain(this.snareGain.gain, time, t.snare);
    rampGain(this.arpGain.gain, time, t.arp);
    rampGain(this.leadGain.gain, time, t.lead);
    rampGain(this.openHatGain.gain, time, t.openHat);
  }

  // -- music layers ---------------------------------------------------

  _triggerPad(chord, time, secondsPer16th) {
    const ctx = this.ctx;
    const barDur = STEPS_PER_BAR * secondsPer16th;
    // Two detuned saws voicing the 3rd + 5th (the sub-bass layer covers the root).
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.detune.value = -6;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 6;
    o1.frequency.value = midiToFreq(chord.triad[1]);
    o2.frequency.value = midiToFreq(chord.triad[2]);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.Q.value = 0.5;
    filter.frequency.setValueAtTime(700, time);

    // Slow LFO sweeping the cutoff for movement across the bar.
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.11;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 320;
    lfo.connect(lfoDepth); lfoDepth.connect(filter.frequency);

    const gain = ctx.createGain();
    o1.connect(filter); o2.connect(filter); filter.connect(gain); gain.connect(this.padGain);
    env(gain.gain, time, [[0, 0.0001], [0.5, 0.32], [barDur - 0.35, 0.28], [barDur, 0.0001]]);

    o1.start(time); o2.start(time); lfo.start(time);
    const stopAt = time + barDur + 0.05;
    o1.stop(stopAt); o2.stop(stopAt); lfo.stop(stopAt);
  }

  _triggerSubBass(chord, time, secondsPer16th) {
    const barDur = STEPS_PER_BAR * secondsPer16th;
    pluckVoice(this.ctx, this.subGain, time, barDur * 0.9, {
      type: 'sine', freq: midiToFreq(chord.root), filterType: 'lowpass',
      filterFreq: 400, q: 0.5, peak: 0.55, attack: 0.05,
    });
  }

  _maybeTriggerRiser(barIndex, time, secondsPer16th) {
    if (this.intensity < 3 || barIndex !== BARS_PER_PHRASE - 1) return;
    const dur = STEPS_PER_BAR * secondsPer16th;
    noiseBurst(this.ctx, this.musicBus, this.noiseBuffer, time, dur, {
      filterType: 'bandpass', freq: 300, freqEnd: 5000, q: 0.8, peak: 0.4,
    });
  }

  _scheduleKick(time) {
    const ctx = this.ctx;
    const dur = 0.28;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(this.kickGain);
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.12);
    env(gain.gain, time, [[0, 0.0001], [0.006, 0.9], [dur, 0.0001]]);
    osc.start(time); osc.stop(time + dur + 0.02);
  }

  _scheduleSnare(time) {
    noiseBurst(this.ctx, this.snareGain, this.noiseBuffer, time, 0.16, {
      filterType: 'bandpass', freq: 1800, q: 1.2, peak: 0.55,
    });
  }

  _scheduleOffbeatBass(chord, time, octaveUp) {
    const midi = chord.root + 12 + (octaveUp ? 12 : 0);
    pluckVoice(this.ctx, this.bassGain, time, 0.2, {
      type: 'sawtooth', freq: midiToFreq(midi), filterType: 'lowpass',
      filterFreq: 2200, filterFreqEnd: 350, q: 0.8, peak: 0.32, attack: 0.004,
    });
  }

  _scheduleSoftHat(time) {
    noiseBurst(this.ctx, this.softHatGain, this.noiseBuffer, time, 0.045, {
      filterType: 'highpass', freq: 6000, q: 0.7, peak: 0.16,
    });
  }

  _scheduleOpenHat(time) {
    noiseBurst(this.ctx, this.openHatGain, this.noiseBuffer, time, 0.22, {
      filterType: 'highpass', freq: 5000, q: 0.6, peak: 0.2,
    });
  }

  _scheduleArpNote(chord, degree, time) {
    const ext = [chord.triad[0], chord.triad[1], chord.triad[2], chord.triad[0] + 12];
    const midi = ext[degree % ext.length] + 12;
    const type = degree % 2 === 0 ? 'square' : 'sawtooth';
    pluckVoice(this.ctx, this.arpGain, time, 0.11, {
      type, freq: midiToFreq(midi), filterType: 'lowpass',
      filterFreq: 3800, filterFreqEnd: 1000, q: 1, peak: 0.22, attack: 0.003,
    });
  }

  _triggerLead(midi, time, dur) {
    const lead = this._lead;
    const freq = midiToFreq(midi);
    const glide = Math.min(0.09, dur * 0.3);
    lead.o1.frequency.cancelScheduledValues(time);
    lead.o2.frequency.cancelScheduledValues(time);
    lead.o1.frequency.setValueAtTime(lead.lastFreq, time);
    lead.o2.frequency.setValueAtTime(lead.lastFreq, time);
    lead.o1.frequency.linearRampToValueAtTime(freq, time + glide);
    lead.o2.frequency.linearRampToValueAtTime(freq, time + glide);
    lead.lastFreq = freq;
    env(lead.amp.gain, time, [[0, 0.0001], [0.02, 0.26], [Math.max(dur - 0.06, 0.03), 0.18], [dur, 0.0001]]);
  }

  // -- ducking (explosions punch through the music) -----------------------

  _duckMusic(time, big) {
    if (!this.musicBus) return;
    const base = this._musicBaseGain;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(g.value, time);
    g.linearRampToValueAtTime(base * 0.35, time + 0.03);
    g.linearRampToValueAtTime(base, time + 0.03 + (big ? 0.45 : 0.4));
  }

  // -- one-shot SFX ---------------------------------------------------

  playerShoot() {
    this._safe(() => {
      const ctx = this._ensure(); if (!ctx) return;
      const t = ctx.currentTime;
      const variance = 1 + (Math.random() * 0.16 - 0.08);
      const filter = ctx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 400;
      const gain = ctx.createGain();
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.connect(filter); filter.connect(gain); gain.connect(this.sfxBus);
      osc.frequency.setValueAtTime(1600 * variance, t);
      osc.frequency.exponentialRampToValueAtTime(320 * variance, t + 0.11);
      env(gain.gain, t, [[0, 0.0001], [0.005, 0.5], [0.13, 0.0001]]);
      osc.start(t); osc.stop(t + 0.15);
    });
  }

  enemyShoot() {
    this._safe(() => {
      const ctx = this._ensure(); if (!ctx) return;
      const t = ctx.currentTime;
      const variance = 1 + (Math.random() * 0.1 - 0.05);
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1200;
      const gain = ctx.createGain();
      const osc = ctx.createOscillator(); osc.type = 'square';
      const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.detune.value = -18;
      osc.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(this.sfxBus);
      osc.frequency.setValueAtTime(620 * variance, t);
      osc.frequency.exponentialRampToValueAtTime(140 * variance, t + 0.18);
      osc2.frequency.setValueAtTime(614 * variance, t);
      osc2.frequency.exponentialRampToValueAtTime(139 * variance, t + 0.18);
      env(gain.gain, t, [[0, 0.0001], [0.008, 0.45], [0.22, 0.0001]]);
      osc.start(t); osc.stop(t + 0.24);
      osc2.start(t); osc2.stop(t + 0.24);
    });
  }

  explosion(big = false) {
    this._safe(() => {
      const ctx = this._ensure(); if (!ctx) return;
      const t = ctx.currentTime;
      const dur = big ? 1.4 : 0.6;
      noiseBurst(ctx, this.sfxBus, this.noiseBuffer, t, dur, {
        filterType: 'lowpass', freq: big ? 2200 : 3200, freqEnd: big ? 80 : 150, peak: big ? 0.9 : 0.7,
      });
      if (big) {
        const sub = ctx.createOscillator(); sub.type = 'sine';
        const subGain = ctx.createGain();
        sub.connect(subGain); subGain.connect(this.sfxBus);
        sub.frequency.setValueAtTime(120, t);
        sub.frequency.exponentialRampToValueAtTime(35, t + 0.5);
        env(subGain.gain, t, [[0, 0.0001], [0.01, 0.9], [0.55, 0.0001]]);
        sub.start(t); sub.stop(t + 0.6);
      }
      this._duckMusic(t, big);
    });
  }

  playerHit() {
    this._safe(() => {
      const ctx = this._ensure(); if (!ctx) return;
      const t = ctx.currentTime;
      const gain = ctx.createGain(); gain.connect(this.sfxBus);
      [[220, 'sawtooth'], [233, 'square']].forEach(([freq, type]) => {
        const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(t); osc.stop(t + 0.24);
      });
      env(gain.gain, t, [[0, 0.0001], [0.006, 0.5], [0.05, 0.28], [0.22, 0.0001]]);
      noiseBurst(ctx, this.sfxBus, this.noiseBuffer, t, 0.16, {
        filterType: 'bandpass', freq: 1500, q: 0.6, peak: 0.4,
      });
    });
  }

  lockOn() {
    this._safe(() => {
      const ctx = this._ensure(); if (!ctx) return;
      const t = ctx.currentTime;
      [[880, 0], [1320, 0.09]].forEach(([freq, dt]) => {
        const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = freq;
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(this.sfxBus);
        env(gain.gain, t + dt, [[0, 0.0001], [0.008, 0.3], [0.08, 0.0001]]);
        osc.start(t + dt); osc.stop(t + dt + 0.09);
      });
    });
  }

  boost(on) {
    this._safe(() => {
      const ctx = this._ensure(); if (!ctx) return;
      const t = ctx.currentTime;
      if (on) {
        if (this._boostVoice) return; // already running — don't stack
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.loop = true;
        const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 0.9;
        const gain = ctx.createGain(); gain.gain.value = 0.0001;
        src.connect(filter); filter.connect(gain); gain.connect(this.sfxBus);
        filter.frequency.setValueAtTime(300, t);
        filter.frequency.linearRampToValueAtTime(2200, t + 0.5);
        env(gain.gain, t, [[0, 0.0001], [0.15, 0.35]]);
        src.start(t);
        this._boostVoice = { src, filter, gain };
      } else {
        if (!this._boostVoice) return;
        const { src, gain } = this._boostVoice;
        env(gain.gain, t, [[0, gain.gain.value], [0.12, 0.0001]]);
        src.stop(t + 0.15);
        this._boostVoice = null;
      }
    });
  }

  gateChime() {
    this._safe(() => {
      const ctx = this._ensure(); if (!ctx) return;
      const t = ctx.currentTime;
      // Picardy-third resolution (A major) for a triumphant lift out of the dark Am key.
      const notes = [57, 61, 64, 69, 72];
      notes.forEach((midi, i) => {
        const dt = i * 0.09;
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 4000;
        const gain = ctx.createGain();
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = midiToFreq(midi);
        const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.detune.value = 7; osc2.frequency.value = midiToFreq(midi);
        osc.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(this.sfxBus);
        env(gain.gain, t + dt, [[0, 0.0001], [0.01, 0.3], [0.28, 0.0001]]);
        osc.start(t + dt); osc.stop(t + dt + 0.3);
        osc2.start(t + dt); osc2.stop(t + dt + 0.3);
      });
    });
  }

  gameOverSting() {
    this._safe(() => {
      const ctx = this._ensure(); if (!ctx) return;
      const t = ctx.currentTime;
      const notes = [57, 53, 50, 45]; // descending A3 F3 D3 A2
      notes.forEach((midi, i) => {
        const dt = i * 0.22;
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1800, t + dt);
        filter.frequency.exponentialRampToValueAtTime(200, t + dt + 0.5);
        const gain = ctx.createGain();
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = midiToFreq(midi);
        osc.connect(filter); filter.connect(gain); gain.connect(this.sfxBus);
        env(gain.gain, t + dt, [[0, 0.0001], [0.02, 0.35], [0.55, 0.06]]);
        osc.start(t + dt); osc.stop(t + dt + 0.6);
      });
      const tailStart = t + notes.length * 0.22;
      const dFilter = ctx.createBiquadFilter(); dFilter.type = 'lowpass'; dFilter.frequency.value = 500;
      const dGain = ctx.createGain();
      const d1 = ctx.createOscillator(); d1.type = 'sawtooth'; d1.frequency.value = midiToFreq(45);
      const d2 = ctx.createOscillator(); d2.type = 'sawtooth'; d2.detune.value = -35; d2.frequency.value = midiToFreq(45);
      d1.connect(dFilter); d2.connect(dFilter); dFilter.connect(dGain); dGain.connect(this.sfxBus);
      env(dGain.gain, tailStart, [[0, 0.0001], [0.3, 0.35], [1.8, 0.0001]]);
      d1.start(tailStart); d1.stop(tailStart + 1.9);
      d2.start(tailStart); d2.stop(tailStart + 1.9);
    });
  }
}
