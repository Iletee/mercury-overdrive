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

// Three course-section variants, switched via setSection(0|1|2) as the
// player crosses course thirds (applied at the next bar boundary). All are
// dark/modal E-minor family so the pump bus, bass and pad code below never
// has to care which section is active — only the pitch material and riff
// pattern change.
//   S0: Em Em C D Em Em C B  — the original drone-and-turn loop.
//   S1: Em G D Am, twice     — more harmonic movement, still modal.
//   S2: Em C Am B, rising    — same family, climbs across the 8-bar phrase
//       before folding back to the loop point.
const SECTION_CHORD_ROOTS = [
  [40, 40, 48, 50, 40, 40, 48, 47], // S0: Em Em C D Em Em C B
  [40, 43, 50, 45, 40, 43, 50, 45], // S1: Em G D Am / Em G D Am
  [40, 48, 45, 47, 52, 48, 45, 59], // S2: Em C Am B, climbing to B5
];

// Derezzed-style riff cells: semitone offsets from a bar's root, two 8-step
// cells per bar (steps 0-7, 8-15). `null` is a rhythmic rest. Octave jumps,
// passing tones and gaps give the variants below their distinct character.
const RIFF_CELL_MAIN = [0, 0, 3, 0, 5, 3, 2, 0];          // E-E-G-E-A-G-F#-E
const RIFF_CELL_WIDE = [0, 3, 0, 5, 7, 5, 3, 0];          // E-G-E-A-B-A-G-E
const RIFF_CELL_OCT = [12, 0, 3, 7, 5, 3, 2, 0];          // octave-up stab then fall
const RIFF_CELL_CHR = [0, 0, 3, 5, 3, 0, -2, 0];          // chromatic dip / bite
const RIFF_CELL_GAP = [0, null, 3, null, 7, 5, null, 0];  // syncopated, sparser
const RIFF_CELL_HIGH = [12, 7, 12, 10, 12, 7, 5, 3];      // octave-up register
const RIFF_CELL_PASS = [0, 2, 3, 5, 7, 5, 3, 2];          // stepwise passing tones

// Three riff-pattern variants, rotated phrase-by-phrase (see
// _activeRiffBars) so an 8-bar loop never plays the same shape twice in a
// row. Each section reuses these same three variants, transposed onto its
// own chord roots.
const RIFF_VARIANTS = [
  [ // close to the original hook
    [RIFF_CELL_MAIN, RIFF_CELL_MAIN], [RIFF_CELL_MAIN, RIFF_CELL_OCT],
    [RIFF_CELL_WIDE, RIFF_CELL_WIDE], [RIFF_CELL_WIDE, RIFF_CELL_CHR],
    [RIFF_CELL_MAIN, RIFF_CELL_MAIN], [RIFF_CELL_OCT, RIFF_CELL_MAIN],
    [RIFF_CELL_WIDE, RIFF_CELL_CHR], [RIFF_CELL_CHR, RIFF_CELL_MAIN],
  ],
  [ // sparser + syncopated — leaves gaps for the pump to breathe
    [RIFF_CELL_GAP, RIFF_CELL_MAIN], [RIFF_CELL_GAP, RIFF_CELL_WIDE],
    [RIFF_CELL_MAIN, RIFF_CELL_GAP], [RIFF_CELL_CHR, RIFF_CELL_GAP],
    [RIFF_CELL_GAP, RIFF_CELL_OCT], [RIFF_CELL_WIDE, RIFF_CELL_GAP],
    [RIFF_CELL_GAP, RIFF_CELL_MAIN], [RIFF_CELL_MAIN, RIFF_CELL_CHR],
  ],
  [ // higher octave placement + stepwise passing tones
    [RIFF_CELL_HIGH, RIFF_CELL_PASS], [RIFF_CELL_MAIN, RIFF_CELL_HIGH],
    [RIFF_CELL_PASS, RIFF_CELL_WIDE], [RIFF_CELL_HIGH, RIFF_CELL_CHR],
    [RIFF_CELL_PASS, RIFF_CELL_MAIN], [RIFF_CELL_HIGH, RIFF_CELL_PASS],
    [RIFF_CELL_WIDE, RIFF_CELL_HIGH], [RIFF_CELL_PASS, RIFF_CELL_CHR],
  ],
];

function buildRiffBars(chordRoots, cellPairs) {
  return chordRoots.map((root, i) => ({ root: root + 12, cells: cellPairs[i % cellPairs.length] }));
}

// One entry per section: its chord loop plus the same 3 riff variants
// transposed onto it. Picked by setSection() + phrase index — see
// _activeChordRoots/_activeRiffBars in _scheduleStep.
const SECTIONS = SECTION_CHORD_ROOTS.map(chordRoots => ({
  chordRoots,
  riffBarsByVariant: RIFF_VARIANTS.map(variant => buildRiffBars(chordRoots, variant)),
}));

// Rez-style ascending E-minor-pentatonic sequences for playerShoot(), one per
// section so the shot melody always resonates with whichever chord/section
// is currently playing. All three walk the same E-minor-pentatonic pitch
// collection (E G A B D); each starts on a different scale degree to match
// its section's harmonic centre. Walks up on every shot, resets to index 0
// at every new bar.
const PENTATONIC_SEQUENCES = [
  [64, 67, 69, 71, 74, 76, 79, 81, 83, 86, 88, 91, 93, 95, 98, 100],    // S0 — rooted on E
  [67, 69, 71, 74, 76, 79, 81, 83, 86, 88, 91, 93, 95, 98, 100, 103],  // S1 — rooted on G
  [71, 74, 76, 79, 81, 83, 86, 88, 91, 93, 95, 98, 100, 103, 105, 107], // S2 — rooted on B
];

// Per-layer target gain by intensity level [0, 1, 2, 3].
// (pad/riff trimmed slightly vs. their pre-harmonics-enrichment levels to
// leave headroom for the added unison/stack/shimmer partials below. riff and
// pulse trimmed a further ~2.5dB on top of that to tame the bass/riff bite —
// see the drive-curve comments in the constructor.)
const LAYER_GAIN = {
  pad: [0.50, 0.46, 0.42, 0.39],
  pulse: [0.41, 0, 0, 0],
  kick: [0, 0.90, 0.90, 0.90],
  perc: [0, 0.65, 0.70, 0.75], // hats + snare/clap share this bus
  riff: [0, 0, 0.58, 0.56],
  stab: [0, 0, 0, 0.55],
  fx: [0, 0, 0, 0.70],        // riser + crash
  shimmer: [0, 0, dbToGain(-20), dbToGain(-20)], // high-register "air" doubling the riff, 2 8ves up
};
const INTENSITY_RAMP_SEC = 0.05; // "50ms gain ramps" applied at the bar boundary

// Enemy-presence motif layer gains by live count [0, 1, 2, 3] — gentle
// scaling, capped at 3, each sitting around -14dB so they color the mix
// rather than dominate it.
const PRESENCE_GAIN = {
  shard: [0, dbToGain(-16), dbToGain(-14), dbToGain(-12)],
  seeker: [0, dbToGain(-16), dbToGain(-14), dbToGain(-12)],
  bastion: [0, dbToGain(-15), dbToGain(-13), dbToGain(-11)],
};

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

    // Section (course-third, 0-2) set via setSection(); pendingSection
    // applies at the next bar boundary. _activeChordRoots/_activeRiffBars
    // are the resolved pattern data for whatever bar is currently playing.
    this._pendingSection = 0;
    this._currentSection = 0;
    this._activeChordRoots = SECTIONS[0].chordRoots;
    this._activeRiffBars = SECTIONS[0].riffBarsByVariant[0];

    // Live enemy-type counts set via setPresence(); pendingPresence applies
    // at the next bar boundary with short gain ramps.
    this._presence = { shard: 0, seeker: 0, bastion: 0 };
    this._pendingPresence = { shard: 0, seeker: 0, bastion: 0 };

    this._beatCallbacks = [];
    this._barCallbacks = [];

    // Rez shot-melody state.
    this._shootIndex = 0;
    this._shootBar = -1;

    // Stateful SFX voices.
    this._boostOn = false;
    this._boostVoice = null;

    // Static waveshaper curves — pure data, no ctx needed, build once.
    // (pulled back from an earlier, too-hard pass at 22 — 13 keeps the
    // riff/stab/hit voices driving without turning harsh.)
    this._driveCurve = makeDriveCurve(13);
    // Near-subtle bus-level saturation for the pump bus (pad+riff+pulse+
    // shimmer) — just enough to round the mix, not add fuzz.
    this._padDriveCurve = makeDriveCurve(3);
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

  // Course-section (0, 1, 2) — call as the player crosses course thirds.
  // Swaps the chord loop + rotates the riff variant bank; applies at the
  // next bar boundary so the switch never happens mid-bar. No-ops
  // gracefully before start() (just records the pending value).
  setSection(n) {
    this._pendingSection = Math.max(0, Math.min(SECTIONS.length - 1, n | 0));
  }

  // Live enemy-type counts ({ shard, seeker, bastion }). Safe to call every
  // frame: if the values match what's already pending this is a fast no-op.
  // Otherwise the new counts (each clamped to 0-3) apply — with short gain
  // ramps — at the next bar boundary. No-ops gracefully before start().
  setPresence({ shard = 0, seeker = 0, bastion = 0 } = {}) {
    const s = Math.max(0, Math.min(3, shard | 0));
    const k = Math.max(0, Math.min(3, seeker | 0));
    const b = Math.max(0, Math.min(3, bastion | 0));
    const p = this._pendingPresence;
    if (p.shard === s && p.seeker === k && p.bastion === b) return;
    p.shard = s; p.seeker = k; p.bastion = b;
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
    // Gain trimmed slightly (was 1.0) — headroom for the harmonic layers
    // added below (pad stack/bright, riff octave shadow, shimmer, bus drive).
    this.pumpBus = this._gain(ctx, 0.92, null);

    // Shared soft-saturation stage for the whole pump bus — a gentle tanh
    // curve that adds harmonic content to the pad/riff/shimmer mix without
    // turning into fuzz. This is the "subtle drive" bus the per-voice
    // WaveShapers (riff/stab/hit) sit alongside.
    this.pumpDrive = ctx.createWaveShaper();
    this.pumpDrive.curve = this._padDriveCurve;
    this.pumpDrive.oversample = '2x';
    this.pumpBus.connect(this.pumpDrive);
    this.pumpDrive.connect(this.musicBus);

    this.padGain = this._gain(ctx, 0, this.pumpBus);
    this.riffGain = this._gain(ctx, 0, this.pumpBus);
    this.pulseGain = this._gain(ctx, 0, this.pumpBus);
    this.kickGain = this._gain(ctx, 0, this.musicBus);
    this.percGain = this._gain(ctx, 0, this.musicBus);
    this.stabGain = this._gain(ctx, 0, this.musicBus);
    this.fxGain = this._gain(ctx, 0, this.musicBus);

    // Shimmer/air bus: a very quiet high-register layer that doubles the riff
    // two octaves up (see _triggerShimmerNote). Runs through its own short
    // feedback delay for a bit of "sparkle trail", then joins the pump bus.
    this.shimmerGain = this._gain(ctx, 0, this.pumpBus);
    this.shimmerDelay = ctx.createDelay(1.0);
    this.shimmerDelay.delayTime.value = SECONDS_PER_16TH * 3;
    const shimmerFeedback = this._gain(ctx, 0.25, this.shimmerDelay);
    this.shimmerDelay.connect(shimmerFeedback);
    this.shimmerDelay.connect(this.shimmerGain);

    // Enemy-presence motif layers (shard/seeker/bastion) — quiet, distinct,
    // routed through the pump bus so they duck with every kick like the
    // rest of the mix.
    this.shardGain = this._gain(ctx, 0, this.pumpBus);
    this.seekerGain = this._gain(ctx, 0, this.pumpBus);
    this.bastionGain = this._gain(ctx, 0, this.pumpBus);

    // Short delay send for the shard arp — a quick glassy trail (much
    // shorter/tighter than the shimmer bus's feedback tail).
    this.shardDelay = ctx.createDelay(1.0);
    this.shardDelay.delayTime.value = SECONDS_PER_16TH * 2;
    const shardFeedback = this._gain(ctx, 0.2, this.shardDelay);
    this.shardDelay.connect(shardFeedback);
    this.shardDelay.connect(this.shardGain);

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

    const rootFreq = noteFreq(SECTIONS[0].chordRoots[0]);

    // Slow chorus LFO — nudges the outer unison voices a few cents so the
    // pad breathes instead of sitting perfectly static.
    this.padChorusLfo = ctx.createOscillator();
    this.padChorusLfo.type = 'sine';
    this.padChorusLfo.frequency.value = 0.17; // 0.1-0.3Hz chorus rate
    const chorusDepth = this._gain(ctx, 5, null); // +/-5 cents
    this.padChorusLfo.connect(chorusDepth);
    this.padChorusLfo.start();

    // Core unison — spread and panned slightly for width.
    const panPositions = [-0.22, 0, 0.22];
    this.padOscs = [-11, 0, 11].map((detune, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = rootFreq; o.detune.value = detune;
      const pan = ctx.createStereoPanner(); pan.pan.value = panPositions[i];
      o.connect(pan); pan.connect(filter);
      if (i !== 1) chorusDepth.connect(o.detune); // outer voices only; keep a stable center anchor
      o.start();
      return o;
    });

    this.padSub = ctx.createOscillator();
    this.padSub.type = 'sine';
    this.padSub.frequency.value = noteFreq(SECTIONS[0].chordRoots[0] - 12);
    this.padSub.connect(filter); this.padSub.start();

    // Quiet fifth + octave-up partials (-12dB) so the pad voices a full
    // root-fifth-octave triad instead of a bare unison drone.
    const stackGain = this._gain(ctx, dbToGain(-12), filter);
    const stackPan = [-0.3, 0.3];
    this.padStackOscs = [7, 24].map((interval, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = noteFreq(SECTIONS[0].chordRoots[0] + interval);
      o.detune.value = i === 0 ? -6 : 6;
      const pan = ctx.createStereoPanner(); pan.pan.value = stackPan[i];
      o.connect(pan); pan.connect(stackGain);
      o.start();
      return o;
    });

    // Bright shadow: a quiet square blended in through its own gentle lowpass
    // so the pad carries upper harmonics beyond the saws' natural rolloff,
    // without harshing the overall tone.
    const brightFilter = ctx.createBiquadFilter();
    brightFilter.type = 'lowpass'; brightFilter.frequency.value = 2600; brightFilter.Q.value = 0.4;
    const brightGain = this._gain(ctx, dbToGain(-14), this.padGain);
    this.padBright = ctx.createOscillator();
    this.padBright.type = 'square';
    this.padBright.frequency.value = rootFreq;
    this.padBright.connect(brightFilter); brightFilter.connect(brightGain);
    this.padBright.start();

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
    if (this.padStackOscs) {
      const intervals = [7, 24];
      this.padStackOscs.forEach((o, i) => o.frequency.setTargetAtTime(noteFreq(rootMidi + intervals[i]), time, 0.15));
    }
    if (this.padBright) this.padBright.frequency.setTargetAtTime(noteFreq(rootMidi), time, 0.15);
  }

  // ---- Transport / lookahead scheduler ("A Tale of Two Clocks") ---------

  _resetTransport() {
    this._current16th = 0;
    this._currentBar = 0;
    this._gridEpoch = this.ctx.currentTime + 0.05;
    this._nextNoteTime = this._gridEpoch;
    this._currentIntensity = this._pendingIntensity;
    this._currentSection = this._pendingSection;
    this._activeChordRoots = SECTIONS[this._currentSection].chordRoots;
    this._activeRiffBars = SECTIONS[this._currentSection].riffBarsByVariant[0];
    this._presence.shard = this._pendingPresence.shard;
    this._presence.seeker = this._pendingPresence.seeker;
    this._presence.bastion = this._pendingPresence.bastion;
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
      this._currentSection = this._pendingSection;
      // Rotate riff variant every phrase (8 bars) so the loop never repeats
      // identically twice in a row; each section reuses the same 3 variants.
      const variantIndex = Math.floor(bar / BARS_PER_PHRASE) % RIFF_VARIANTS.length;
      this._activeChordRoots = SECTIONS[this._currentSection].chordRoots;
      this._activeRiffBars = SECTIONS[this._currentSection].riffBarsByVariant[variantIndex];
      this._applyIntensityGains(time);
      this._applyPresenceGains(time);
      this._updatePadChord(this._activeChordRoots[phraseBar], time);
      this._fireBar(bar, time);
      if (this._currentIntensity >= 3 && phraseBar === 0 && bar > 0) {
        this._triggerCrash(time); // resolves the riser from the previous bar
      }
    }
    if (step % 4 === 0) this._fireBeat(step / 4, bar, time);

    const lvl = this._currentIntensity;

    // Level 0: ominous drone + sparse deep pulse (half notes).
    if (lvl === 0 && (step === 0 || step === 8)) this._triggerPulse(this._activeChordRoots[phraseBar] - 12, time);

    // Level 1+: four-on-the-floor kick (drives the pump), offbeat open hat,
    // snare/clap on 2 & 4.
    if (lvl >= 1 && step % 4 === 0) this._triggerKick(time);
    if (lvl >= 1 && (step === 4 || step === 12)) this._triggerSnare(time);
    if (lvl >= 1 && (step === 2 || step === 6 || step === 10 || step === 14)) this._triggerHat(time, true);

    // Level 2+: the Derezzed riff.
    if (lvl >= 2) this._triggerRiffStep(phraseBar, step, time);

    // Level 3+: 16th closed hats, accent stabs, riser into the phrase turn.
    if (lvl >= 3) this._triggerHat(time, false);
    if (lvl >= 3 && (step === 0 || step === 14)) this._triggerStab(this._activeChordRoots[phraseBar], time);
    if (lvl >= 3 && phraseBar === BARS_PER_PHRASE - 1 && step === 0) this._triggerRiser(time, SECONDS_PER_BEAT * 4);

    // Enemy-presence motifs — gated purely by live counts, independent of
    // intensity `lvl`, so they can color even a quiet moment. All three
    // route through the pump bus (see _buildGraph) so they duck on the kick.
    if (this._presence.shard > 0 && (step === 3 || step === 7 || step === 11 || step === 15)) {
      this._triggerShardMotif(time);
    }
    if (this._presence.seeker > 0 && step % 2 === 0) {
      this._triggerSeekerPulse(phraseBar, time);
    }
    if (this._presence.bastion > 0 && step === 0) {
      this._triggerBastionStab(phraseBar, time);
      if (bar % 2 === 0) this._triggerBastionSwell(time);
    }
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
    this._rampGain(this.shimmerGain, LAYER_GAIN.shimmer[lvl], time);
  }

  _rampGain(node, target, time, ramp = INTENSITY_RAMP_SEC) {
    node.gain.cancelScheduledValues(time);
    node.gain.setValueAtTime(node.gain.value, time);
    node.gain.linearRampToValueAtTime(target, time + ramp);
  }

  // Applies pendingPresence -> presence with short gain ramps. Called once
  // per bar from _scheduleStep; cheap even when nothing changed.
  _applyPresenceGains(time) {
    this._presence.shard = this._pendingPresence.shard;
    this._presence.seeker = this._pendingPresence.seeker;
    this._presence.bastion = this._pendingPresence.bastion;
    const ramp = 0.15; // short gain ramp, longer than the 50ms intensity ramp
    this._rampGain(this.shardGain, PRESENCE_GAIN.shard[this._presence.shard], time, ramp);
    this._rampGain(this.seekerGain, PRESENCE_GAIN.seeker[this._presence.seeker], time, ramp);
    this._rampGain(this.bastionGain, PRESENCE_GAIN.bastion[this._presence.bastion], time, ramp);
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

    // Quiet saw partner, tamed by its own lowpass — adds harmonic content to
    // the drone without turning the sub pulse into a buzz. Cutoff darkened
    // slightly (was 900) to keep the low end round rather than buzzy.
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth'; saw.frequency.value = noteFreq(midi);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; lp.Q.value = 0.5;
    const sg = ctx.createGain();
    this._pluck(sg.gain, 0.8 * dbToGain(-12), 0.02, 0.88, time);
    saw.connect(lp); lp.connect(sg); sg.connect(this.pulseGain);
    saw.start(time); saw.stop(time + 0.95);

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
    const barDef = this._activeRiffBars[phraseBar];
    const cell = step < 8 ? barDef.cells[0] : barDef.cells[1];
    const offset = cell[step % 8];
    if (offset === null) return; // rhythmic gap — rest
    const midi = barDef.root + offset;
    const dur = SECONDS_PER_16TH * 0.9;
    this._triggerRiffNote(midi, time, dur);
    // Shimmer/air: a very quiet 16th-note double of the riff, two octaves up.
    // Reads as sparkle, not a second melody — see LAYER_GAIN.shimmer.
    this._triggerShimmerNote(midi + 24, time, dur);
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

    // Quiet +1 octave shadow — adds a little extra bite/air above the
    // fundamental without thickening the core unison pair.
    const o3 = ctx.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = freq * 2;
    const shadowFilter = ctx.createBiquadFilter();
    shadowFilter.type = 'lowpass'; shadowFilter.frequency.value = 3200; shadowFilter.Q.value = 0.5;
    const shadowGain = ctx.createGain();
    this._pluck(shadowGain.gain, 0.85 * dbToGain(-12), 0.006, dur - 0.006, time);
    o3.connect(shadowFilter); shadowFilter.connect(shadowGain); shadowGain.connect(this.riffGain);
    o3.start(time); o3.stop(time + dur + 0.02);
  }

  // High-register sparkle layer doubling a note two octaves up through a
  // highpass and the shimmer bus's short feedback delay — reads as air, not
  // a new melody line.
  _triggerShimmerNote(midi, time, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = noteFreq(midi);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
    const g = ctx.createGain();
    this._pluck(g.gain, dbToGain(-20), 0.003, dur * 0.8, time);
    o.connect(hp); hp.connect(g);
    g.connect(this.shimmerGain);
    g.connect(this.shimmerDelay);
    o.start(time); o.stop(time + dur + 0.05);
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

  // ---- Enemy-presence motif layers (task 3) ------------------------------

  // Shard: nervous, glassy — a two-note arp blip on syncopated 16th
  // offbeats, sent to a short feedback delay for a bit of sparkle trail.
  _triggerShardMotif(time) {
    const ctx = this.ctx;
    const notes = [88, 91]; // E6, G6 — high and glassy
    notes.forEach((midi, i) => {
      const t = time + i * SECONDS_PER_16TH * 0.5;
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = noteFreq(midi);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
      const g = ctx.createGain();
      this._pluck(g.gain, 0.6, 0.002, 0.07, t);
      o.connect(hp); hp.connect(g);
      g.connect(this.shardGain);
      g.connect(this.shardDelay);
      o.start(t); o.stop(t + 0.09);
    });
  }

  // Seeker: urgent, low-mid, chase energy — a filtered-square ostinato pulse
  // on every 8th note, pitched to the current chord root.
  _triggerSeekerPulse(phraseBar, time) {
    const ctx = this.ctx;
    const midi = this._activeChordRoots[phraseBar];
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.value = noteFreq(midi);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 500; filter.Q.value = 4;
    const g = ctx.createGain();
    this._pluck(g.gain, 0.5, 0.003, SECONDS_PER_16TH * 1.6, time);
    o.connect(filter); filter.connect(g); g.connect(this.seekerGain);
    o.start(time); o.stop(time + SECONDS_PER_16TH * 2);
  }

  // Bastion: dark and heavy — a slow-attack detuned-saw drone swell every 2
  // bars, rooted an octave below the current chord.
  _triggerBastionSwell(time) {
    const ctx = this.ctx;
    const dur = SECONDS_PER_BEAT * 4 * 2; // 2 bars
    const root = this._activeChordRoots[0];
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400; filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.7, time + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    filter.connect(g); g.connect(this.bastionGain);
    for (const detune of [-9, 0, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.detune.value = detune; o.frequency.value = noteFreq(root - 12);
      o.connect(filter); o.start(time); o.stop(time + dur + 0.1);
    }
  }

  // Bastion: low brass-like stab on every bar's downbeat — slow attack,
  // detuned saws through a dark lowpass.
  _triggerBastionStab(phraseBar, time) {
    const ctx = this.ctx;
    const root = this._activeChordRoots[phraseBar];
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 1;
    const g = ctx.createGain();
    this._pluck(g.gain, 0.5, 0.05, 0.45, time); // slow attack = brass-like swell-in
    filter.connect(g); g.connect(this.bastionGain);
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.detune.value = detune; o.frequency.value = noteFreq(root - 12);
      o.connect(filter); o.start(time); o.stop(time + 0.55);
    }
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
    const seq = PENTATONIC_SEQUENCES[this._currentSection];
    const midi = seq[this._shootIndex % seq.length];
    this._triggerPluck(midi, time, this._shootIndex++);
  }

  // Bright pluck: square+saw, fast decay, ping-pong-ish feedback delay at
  // 3/16. Pitch walks up the current section's PENTATONIC_SEQUENCES entry —
  // rapid fire = an ascending melody line locked to the grid and the key.
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

  // Immediate — a protective "whomp": filtered noise burst + sine
  // pitch-drop + a short metallic ring. Distinct from playerHit (hull
  // damage): rounder, lower, no dissonant stab — the shield absorbed it.
  shieldHit() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const time = ctx.currentTime + 0.001;

    // Filtered noise burst — the "whomp" body.
    const src = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
    src.connect(bp); bp.connect(ng); ng.connect(this.sfxBus);
    src.start(time); src.stop(time + 0.24);

    // Sine pitch-drop — the protective thud underneath the noise.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, time);
    o.frequency.exponentialRampToValueAtTime(110, time + 0.2);
    const og = ctx.createGain();
    this._pluck(og.gain, 0.5, 0.004, 0.22, time);
    o.connect(og); og.connect(this.sfxBus);
    o.start(time); o.stop(time + 0.24);

    // Short metallic ring — a few detuned high partials, fast decay.
    const ringBp = ctx.createBiquadFilter(); ringBp.type = 'bandpass'; ringBp.frequency.value = 2400; ringBp.Q.value = 6;
    const rg = ctx.createGain();
    this._pluck(rg.gain, 0.3, 0.002, 0.16, time);
    ringBp.connect(rg); rg.connect(this.sfxBus);
    for (const ratio of [1, 1.8, 2.6]) {
      const ro = ctx.createOscillator(); ro.type = 'triangle'; ro.frequency.value = 1200 * ratio;
      ro.connect(ringBp); ro.start(time); ro.stop(time + 0.18);
    }
  }

  // Quantized to the next beat — "systems back online": a soft rising
  // two-note confirmation (sine, in-key) with a short delay tail.
  shieldUp() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = this._nextGridTime(4, 0); // next beat

    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = SECONDS_PER_16TH * 3;
    const fb = this._gain(ctx, 0.3, delay);
    const wet = this._gain(ctx, 0.32, this.sfxBus);
    delay.connect(fb); delay.connect(wet);

    [71, 76].forEach((midi, i) => { // B4 -> E5, rising fourth, in E minor
      const t = t0 + i * SECONDS_PER_16TH * 2;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = noteFreq(midi);
      const g = ctx.createGain();
      this._pluck(g.gain, 0.35, 0.015, 0.3, t);
      o.connect(g); g.connect(this.sfxBus); g.connect(delay);
      o.start(t); o.stop(t + 0.34);
    });
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

      // Quiet saw brightness partner (octave up), through its own lowpass —
      // extra harmonic sparkle on the triumphant lift without harshness.
      const o3 = ctx.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = noteFreq(midi) * 2;
      const brightLp = ctx.createBiquadFilter(); brightLp.type = 'lowpass'; brightLp.frequency.value = 5000; brightLp.Q.value = 0.4;
      const g3 = ctx.createGain();
      this._pluck(g3.gain, 0.4 * dbToGain(-14), 0.01, 0.34, t);
      o3.connect(brightLp); brightLp.connect(g3); g3.connect(this.sfxBus); g3.connect(delay);

      o1.start(t); o2.start(t); o3.start(t);
      o1.stop(t + 0.4); o2.stop(t + 0.4); o3.stop(t + 0.4);
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
    for (const layer of [this.padGain, this.pulseGain, this.kickGain, this.percGain, this.riffGain, this.stabGain, this.fxGain, this.shimmerGain, this.shardGain, this.seekerGain, this.bastionGain]) {
      layer.gain.cancelScheduledValues(time);
      layer.gain.setValueAtTime(layer.gain.value, time);
      layer.gain.linearRampToValueAtTime(0, time + 1.6);
    }
    this.musicBus.gain.cancelScheduledValues(time);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, time);
    this.musicBus.gain.linearRampToValueAtTime(MUSIC_BUS_GAIN * 0.15, time + 1.8);
  }
}
