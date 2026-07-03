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
		this._buildWave();
		this._buildTitle();
		this._buildEndScreen();

		this._onResize = () => this._measureProgressTrack();
		window.addEventListener('resize', this._onResize);
		this._measureProgressTrack();

		// sensible defaults so nothing is glued to the top-left corner
		this.setCrosshair(window.innerWidth / 2, window.innerHeight / 2);
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

		this.hullContainerEl = wrap;
		this.boostContainerEl = boost;
		this.rootEl.appendChild(wrap);
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

		this.progressTrackEl = track;
		this.rootEl.appendChild(wrap);
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
			['SHIFT', 'boost'],
			['X', 'brake'],
			['Q/E', 'roll'],
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
