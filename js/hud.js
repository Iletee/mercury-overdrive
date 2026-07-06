// Mercury Overdrive — HUD
// ES module. No imports. Builds and owns all of its DOM.

const HULL_SEGMENTS = 12;

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
}

export class HUD {
	constructor() {
		this.rootEl = null;

		// cached "last written" values so hot per-frame setters skip redundant DOM writes
		this._lastHullLit = -1;
		this._lastHullAlarm = null;
		this._lastHullPct = -1;
		this._lastSpeed = null;
		this._lastScore = null;
		this._lastProgress = null;
		this._lastBoost = null;
		this._lastCrossX = null;
		this._lastCrossY = null;
		this._lastLockX = null;
		this._lastLockY = null;
		this._lastLocked = null;

		this._progressTrackWidth = 0;

		this._titleHidden = false;
		this._titleFired = false;
		this._titleCleanup = null;
		this._endCleanup = null;

		this._waveTimer = null;
		this._damageTimer = null;
		this._beatTimer = null;
	}

	// ------------------------------------------------------------------
	// Construction
	// ------------------------------------------------------------------

	mount() {
		this.rootEl = el('div', 'mo-hud');
		document.body.appendChild(this.rootEl);

		this._buildAmbient();
		this._buildHullAndBoost();
		this._buildSpeed();
		this._buildScore();
		this._buildProgress();
		this._buildCrosshair();
		this._buildLock();
		this._buildPings();
		this._buildPaintMarks();
		this._buildBossBar();
		this._buildWave();
		this._buildTitle();
		this._buildEndScreen();

		this._onResize = () => this._measureProgressTrack();
		window.addEventListener('resize', this._onResize);
		this._measureProgressTrack();

		// sensible defaults so nothing is glued to the top-left corner
		this.setCrosshair(window.innerWidth / 2, window.innerHeight / 2);
		// crosshair chases the pointer from the event itself, not the render
		// loop — zero added latency even when the GPU frame runs long
		window.addEventListener('mousemove', (e) => this.setCrosshair(e.clientX, e.clientY));
		this.setHull(1, 1);
		this.setSpeed(0);
		this.setScore(0);
		this.setProgress(0);
		this.setBoost(0);

		return this;
	}

	_buildAmbient() {
		this.rootEl.appendChild(el('div', 'mo-scanlines'));
		this.rootEl.appendChild(el('div', 'mo-vignette'));
		this.damageEl = el('div', 'mo-damage-flash');
		this.rootEl.appendChild(this.damageEl);
	}

	_buildHullAndBoost() {
		const wrap = el('div', 'mo-corner mo-corner--hull');

		wrap.appendChild(el('div', 'mo-hud-label', 'HULL'));

		const segs = el('div', 'mo-hull__segments');
		this._hullSegEls = [];
		for (let i = 0; i < HULL_SEGMENTS; i++) {
			const seg = el('div', 'mo-hull__seg');
			segs.appendChild(seg);
			this._hullSegEls.push(seg);
		}
		wrap.appendChild(segs);

		this.hullValueEl = el('div', 'mo-hull__value', '100%');
		wrap.appendChild(this.hullValueEl);

		const boost = el('div', 'mo-boost');
		boost.appendChild(el('div', 'mo-hud-label mo-hud-label--sm', 'BOOST'));
		const boostTrack = el('div', 'mo-boost__track');
		this.boostFillEl = el('div', 'mo-boost__fill');
		boostTrack.appendChild(this.boostFillEl);
		boost.appendChild(boostTrack);
		wrap.appendChild(boost);

		const shield = el('div', 'mo-shield');
		shield.appendChild(el('div', 'mo-hud-label mo-hud-label--sm', 'SHIELD'));
		const shieldTrack = el('div', 'mo-shield__track');
		this.shieldFillEl = el('div', 'mo-shield__fill');
		shieldTrack.appendChild(this.shieldFillEl);
		shield.appendChild(shieldTrack);
		wrap.appendChild(shield);

		// multilock charge — hidden until the Multi-Phaser is claimed
		const ml = el('div', 'mo-multilock mo-multilock--hidden');
		ml.appendChild(el('div', 'mo-hud-label mo-hud-label--sm', 'MULTILOCK'));
		const cells = el('div', 'mo-multilock__cells');
		this._lockCellEls = [];
		for (let i = 0; i < 6; i++) {
			const c = el('div', 'mo-multilock__cell');
			cells.appendChild(c);
			this._lockCellEls.push(c);
		}
		ml.appendChild(cells);
		wrap.appendChild(ml);

		this.hullContainerEl = wrap;
		this.boostContainerEl = boost;
		this.shieldContainerEl = shield;
		this.multilockEl = ml;
		this.rootEl.appendChild(wrap);
	}

	showMultilock() { this.multilockEl.classList.remove('mo-multilock--hidden'); }
	hideMultilock() { this.multilockEl.classList.add('mo-multilock--hidden'); }

	// charge in whole locks (0..max); lit cells = banked volley missiles
	setLockCharge(charge, max) {
		const lit = Math.floor(Math.max(0, Math.min(max, charge)));
		if (lit === this._lastLockCharge) return;
		this._lastLockCharge = lit;
		for (let i = 0; i < this._lockCellEls.length; i++) {
			this._lockCellEls[i].classList.toggle('lit', i < lit);
		}
	}

	// t: 0..1 recharge progress; ready: shield armed
	setShield(t, ready) {
		const ct = Math.max(0, Math.min(1, t));
		if (ct !== this._lastShield) {
			this._lastShield = ct;
			this.shieldFillEl.style.transform = `scaleX(${ct.toFixed(3)})`;
		}
		if (ready !== this._lastShieldReady) {
			this._lastShieldReady = ready;
			this.shieldContainerEl.classList.toggle('mo-shield--ready', !!ready);
		}
	}

	_buildSpeed() {
		const wrap = el('div', 'mo-corner mo-corner--speed');
		this.speedValueEl = el('div', 'mo-speed__value', '0');
		const unit = el('div', 'mo-speed__unit', 'U/S');
		wrap.appendChild(this.speedValueEl);
		wrap.appendChild(unit);
		this.rootEl.appendChild(wrap);
	}

	_buildScore() {
		const wrap = el('div', 'mo-corner mo-corner--score');
		wrap.appendChild(el('div', 'mo-hud-label', 'SCORE'));
		this.scoreValueEl = el('div', 'mo-score__value', '000000');
		wrap.appendChild(this.scoreValueEl);
		this.rootEl.appendChild(wrap);
	}

	_buildProgress() {
		const wrap = el('div', 'mo-progress');
		wrap.appendChild(el('div', 'mo-progress__flag mo-progress__flag--start', '◆'));

		const track = el('div', 'mo-progress__track');
		this.progressFillEl = el('div', 'mo-progress__fill');
		this.progressMarkerEl = el('div', 'mo-progress__marker');
		track.appendChild(this.progressFillEl);
		track.appendChild(this.progressMarkerEl);
		wrap.appendChild(track);

		wrap.appendChild(el('div', 'mo-progress__flag mo-progress__flag--end', '▲'));

		this.streakEl = el('div', 'mo-streak');
		wrap.appendChild(this.streakEl);

		this.progressTrackEl = track;
		this.rootEl.appendChild(wrap);
	}

	// ring streak readout under the progress bar; hidden at zero
	setStreak(n, mult = 1) {
		if (n === this._lastStreak && mult === this._lastMult) return;
		this._lastStreak = n;
		this._lastMult = mult;
		if (n === 0 && mult <= 1) {
			this.streakEl.textContent = '';
			this.streakEl.classList.remove('mo-streak--hot');
			return;
		}
		this.streakEl.textContent =
			`RINGS ${n}` + (mult > 1 ? `  ·  SCORE ×${mult}` : '');
		this.streakEl.classList.toggle('mo-streak--hot', mult > 1);
	}

	_buildCrosshair() {
		const cross = el('div', 'mo-crosshair');
		cross.appendChild(el('div', 'mo-crosshair__dot'));
		['t', 'r', 'b', 'l'].forEach((dir) => {
			cross.appendChild(el('div', `mo-crosshair__line mo-crosshair__line--${dir}`));
		});
		this.crosshairEl = cross;
		this.rootEl.appendChild(cross);
	}

	_buildLock() {
		const lock = el('div', 'mo-lock mo-lock--hidden');
		['tl', 'tr', 'bl', 'br'].forEach((pos) => {
			lock.appendChild(el('div', `mo-lock__corner mo-lock__corner--${pos}`));
		});
		this.lockEl = lock;
		this.rootEl.appendChild(lock);
	}

	_buildPings() {
		// pooled radar markers: diamond over on-screen enemies, edge chevron
		// pointing at off-screen ones
		this._pingEls = [];
		for (let i = 0; i < 12; i++) {
			const ping = el('div', 'mo-ping mo-ping--hidden');
			ping.appendChild(el('div', 'mo-ping__d'));
			ping.appendChild(el('div', 'mo-ping__a'));
			this.rootEl.appendChild(ping);
			this._pingEls.push(ping);
		}
	}

	// pings: [{x, y, off, angle}] — screen px; off = clamped to edge, angle
	// (radians) points from screen centre toward the enemy
	setPings(pings) {
		for (let i = 0; i < this._pingEls.length; i++) {
			const elp = this._pingEls[i];
			const p = pings[i];
			if (!p) {
				if (!elp.classList.contains('mo-ping--hidden')) elp.classList.add('mo-ping--hidden');
				continue;
			}
			elp.classList.remove('mo-ping--hidden');
			elp.classList.toggle('mo-ping--off', !!p.off);
			const rot = p.off ? ` rotate(${p.angle.toFixed(3)}rad)` : '';
			elp.style.transform = `translate(-50%, -50%) translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)${rot}`;
		}
	}

	_buildPaintMarks() {
		// pooled multilock paint reticles — pink brackets with a stack count
		this._paintEls = [];
		for (let i = 0; i < 6; i++) {
			const mark = el('div', 'mo-paint mo-paint--hidden');
			mark.appendChild(el('div', 'mo-paint__box'));
			const n = el('div', 'mo-paint__n', '');
			mark.appendChild(n);
			mark._n = n;
			this.rootEl.appendChild(mark);
			this._paintEls.push(mark);
		}
	}

	// marks: [{x, y, stacks}] in screen px
	setPaintMarks(marks) {
		for (let i = 0; i < this._paintEls.length; i++) {
			const elp = this._paintEls[i];
			const m = marks[i];
			if (!m) {
				if (!elp.classList.contains('mo-paint--hidden')) elp.classList.add('mo-paint--hidden');
				continue;
			}
			elp.classList.remove('mo-paint--hidden');
			elp.style.transform = `translate(-50%, -50%) translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0)`;
			const label = m.stacks > 1 ? '×' + m.stacks : '';
			if (elp._n.textContent !== label) elp._n.textContent = label;
		}
	}

	_buildBossBar() {
		const wrap = el('div', 'mo-boss mo-boss--hidden');
		this.bossNameEl = el('div', 'mo-boss__name', '');
		const track = el('div', 'mo-boss__track');
		this.bossFillEl = el('div', 'mo-boss__fill');
		track.appendChild(this.bossFillEl);
		wrap.appendChild(this.bossNameEl);
		wrap.appendChild(track);
		this.bossEl = wrap;
		this.rootEl.appendChild(wrap);
	}

	showBoss(name) {
		this.bossNameEl.textContent = name;
		this.bossEl.classList.remove('mo-boss--hidden');
	}

	hideBoss() { this.bossEl.classList.add('mo-boss--hidden'); }

	setBossHp(t) {
		const ct = Math.max(0, Math.min(1, t));
		if (ct === this._lastBossHp) return;
		this._lastBossHp = ct;
		this.bossFillEl.style.transform = `scaleX(${ct.toFixed(3)})`;
	}

	_buildWave() {
		this.waveEl = el('div', 'mo-wave');
		this.rootEl.appendChild(this.waveEl);
	}

	_buildTitle() {
		const title = el('div', 'mo-title');
		const inner = el('div', 'mo-title__inner');

		inner.appendChild(el('h1', 'mo-title__name', 'MERCURY OVERDRIVE'));
		inner.appendChild(el('p', 'mo-title__subtitle', 'A METEOR GAUNTLET'));
		inner.appendChild(el('p', 'mo-title__prompt', 'CLICK TO ENGAGE'));

		const legend = el('div', 'mo-title__legend');
		const controls = [
			['WASD', 'steer'],
			['MOUSE', 'aim'],
			['CLICK', 'fire'],
			['Q', 'multilock'],
			['SHIFT', 'boost'],
			['X', 'brake'],
			['A·A / D·D', 'barrel roll'],
		];
		controls.forEach(([key, desc], i) => {
			if (i > 0) legend.appendChild(el('span', 'mo-title__dot', '·'));
			const item = el('span', 'mo-title__legend-item');
			item.appendChild(el('b', 'mo-title__key', key));
			item.appendChild(document.createTextNode(' ' + desc));
			legend.appendChild(item);
		});
		inner.appendChild(legend);

		title.appendChild(inner);
		this.titleEl = title;
		this.rootEl.appendChild(title);
	}

	_buildEndScreen() {
		const end = el('div', 'mo-end');
		const inner = el('div', 'mo-end__inner');
		this.endTitleEl = el('h2', 'mo-end__title', '');
		this.endScoreEl = el('p', 'mo-end__score', '');
		this.endHintEl = el('p', 'mo-end__hint', '');
		inner.appendChild(this.endTitleEl);
		inner.appendChild(this.endScoreEl);
		inner.appendChild(this.endHintEl);
		end.appendChild(inner);
		this.endEl = end;
		this.rootEl.appendChild(end);
	}

	_measureProgressTrack() {
		if (!this.progressTrackEl) return;
		this._progressTrackWidth = this.progressTrackEl.getBoundingClientRect().width;
		if (this._lastProgress != null) {
			const x = this._lastProgress * this._progressTrackWidth;
			this.progressMarkerEl.style.transform = `translate(-50%, -50%) translate3d(${x}px, 0, 0)`;
		}
	}

	// ------------------------------------------------------------------
	// Title screen
	// ------------------------------------------------------------------

	bindStart(cb) {
		if (this._titleCleanup) return; // already armed
		const fire = () => {
			if (this._titleFired) return;
			this._titleFired = true;
			cleanup();
			this.hideTitle();
			cb();
		};
		const onClick = () => fire();
		const onKey = () => fire();
		document.addEventListener('click', onClick);
		document.addEventListener('keydown', onKey);
		const cleanup = () => {
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKey);
			this._titleCleanup = null;
		};
		this._titleCleanup = cleanup;
	}

	hideTitle() {
		if (this._titleHidden) return;
		this._titleHidden = true;
		this.titleEl.classList.add('mo-title--hidden');
		this.rootEl.classList.add('mo-hud--live');
		const finish = () => {
			this.titleEl.style.display = 'none';
		};
		this.titleEl.addEventListener('transitionend', finish, { once: true });
		setTimeout(finish, 700);
	}

	// ------------------------------------------------------------------
	// Per-frame HUD setters
	// ------------------------------------------------------------------

	setHull(hp, max) {
		const m = max > 0 ? max : 1;
		const ratio = Math.max(0, Math.min(1, hp / m));
		const lit = Math.round(ratio * HULL_SEGMENTS);
		const alarm = ratio <= 0.3;
		const pct = Math.round(ratio * 100);

		if (lit !== this._lastHullLit) {
			this._lastHullLit = lit;
			for (let i = 0; i < this._hullSegEls.length; i++) {
				this._hullSegEls[i].classList.toggle('lit', i < lit);
			}
		}
		if (alarm !== this._lastHullAlarm) {
			this._lastHullAlarm = alarm;
			this.hullContainerEl.classList.toggle('mo-hull--alarm', alarm);
		}
		if (pct !== this._lastHullPct) {
			this._lastHullPct = pct;
			this.hullValueEl.textContent = pct + '%';
		}
	}

	setSpeed(v) {
		const iv = Math.round(v);
		if (iv === this._lastSpeed) return;
		this._lastSpeed = iv;
		this.speedValueEl.textContent = String(iv);
	}

	setScore(s) {
		const is = Math.max(0, Math.round(s));
		if (is === this._lastScore) return;
		this._lastScore = is;
		this.scoreValueEl.textContent = String(is).padStart(6, '0');
	}

	setProgress(t) {
		const ct = Math.max(0, Math.min(1, t));
		if (ct === this._lastProgress) return;
		this._lastProgress = ct;
		this.progressFillEl.style.transform = `scaleX(${ct})`;
		const x = ct * this._progressTrackWidth;
		this.progressMarkerEl.style.transform = `translate(-50%, -50%) translate3d(${x}px, 0, 0)`;
	}

	setBoost(t) {
		const ct = Math.max(0, Math.min(1, t));
		if (ct === this._lastBoost) return;
		this._lastBoost = ct;
		this.boostFillEl.style.transform = `scaleX(${ct})`;
		this.boostContainerEl.classList.toggle('mo-boost--full', ct >= 0.999);
	}

	setCrosshair(xPx, yPx) {
		if (xPx === this._lastCrossX && yPx === this._lastCrossY) return;
		this._lastCrossX = xPx;
		this._lastCrossY = yPx;
		this.crosshairEl.style.transform = `translate(-50%, -50%) translate3d(${xPx}px, ${yPx}px, 0)`;
	}

	setLock(xPx, yPx, locked) {
		if (xPx !== this._lastLockX || yPx !== this._lastLockY) {
			this._lastLockX = xPx;
			this._lastLockY = yPx;
			this.lockEl.style.transform = `translate(-50%, -50%) translate3d(${xPx}px, ${yPx}px, 0)`;
		}
		this.lockEl.classList.remove('mo-lock--hidden');
		if (locked !== this._lastLocked) {
			this._lastLocked = locked;
			this.lockEl.classList.toggle('mo-lock--locked', !!locked);
		}
	}

	hideLock() {
		this.lockEl.classList.add('mo-lock--hidden');
		this._lastLocked = null;
	}

	// ------------------------------------------------------------------
	// Transient feedback
	// ------------------------------------------------------------------

	showWave(text) {
		this.waveEl.textContent = text;
		this.waveEl.classList.remove('mo-wave--active');
		void this.waveEl.offsetWidth; // restart CSS animation
		this.waveEl.classList.add('mo-wave--active');
		clearTimeout(this._waveTimer);
		this._waveTimer = setTimeout(() => {
			this.waveEl.classList.remove('mo-wave--active');
		}, 2000);
	}

	damageFlash() {
		this.damageEl.classList.remove('mo-damage--active');
		void this.damageEl.offsetWidth; // restart CSS animation
		this.damageEl.classList.add('mo-damage--active');
		clearTimeout(this._damageTimer);
		this._damageTimer = setTimeout(() => {
			this.damageEl.classList.remove('mo-damage--active');
		}, 500);
	}

	beatPulse() {
		this.rootEl.classList.add('mo-hud--beat');
		clearTimeout(this._beatTimer);
		this._beatTimer = setTimeout(() => {
			this.rootEl.classList.remove('mo-hud--beat');
		}, 120);
	}

	// ------------------------------------------------------------------
	// End screens
	// ------------------------------------------------------------------

	_armEnd(onRestart) {
		if (this._endCleanup) this._endCleanup();
		let fired = false;
		const finish = () => {
			if (fired) return;
			fired = true;
			cleanup();
			this.endEl.classList.remove('mo-end--visible');
			onRestart();
		};
		const onClick = () => finish();
		const onKey = (e) => {
			if (e.key === 'r' || e.key === 'R') finish();
		};
		document.addEventListener('click', onClick);
		document.addEventListener('keydown', onKey);
		const cleanup = () => {
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKey);
			this._endCleanup = null;
		};
		this._endCleanup = cleanup;
	}

	showGameOver(score, onRestart) {
		this.endTitleEl.textContent = 'SIGNAL LOST';
		this.endScoreEl.textContent = `SCORE ${Math.max(0, Math.round(score))}`;
		this.endHintEl.textContent = 'PRESS R OR CLICK TO RETRY';
		this.endEl.classList.remove('mo-end--victory');
		this.endEl.classList.add('mo-end--gameover', 'mo-end--visible');
		this._armEnd(onRestart);
	}

	showVictory(score, timeSec, onRestart) {
		const mm = Math.floor(timeSec / 60);
		const ss = String(Math.floor(timeSec % 60)).padStart(2, '0');
		this.endTitleEl.textContent = 'GAUNTLET CLEARED';
		this.endScoreEl.textContent = `SCORE ${Math.max(0, Math.round(score))} · TIME ${mm}:${ss}`;
		this.endHintEl.textContent = 'PRESS R OR CLICK TO CONTINUE';
		this.endEl.classList.remove('mo-end--gameover');
		this.endEl.classList.add('mo-end--victory', 'mo-end--visible');
		this._armEnd(onRestart);
	}
}
