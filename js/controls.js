// Raw input state. No flight logic here — the ship reads from this every frame.
// WASD steers the ship; the mouse is a free aiming cursor (turret-style).

export class InputState {
	constructor(domElement) {
		this.el = domElement;
		// normalized mouse, -1..1, +y = screen top — AIM ONLY, never steering
		this.mouseX = 0;
		this.mouseY = 0;
		// raw pixels for the HUD crosshair
		this.mousePxX = window.innerWidth / 2;
		this.mousePxY = window.innerHeight / 2;

		// steering axes from WASD, each -1..1
		this.steerX = 0; // A = -1 (turn left), D = +1
		this.steerY = 0; // W = +1 (climb), S = -1

		this.firing = false;
		this.boosting = false;
		this.braking = false;
		this.rollLeft = false;
		this.rollRight = false;

		this._keys = new Set();
		this._keyHandlers = [];

		window.addEventListener('mousemove', (e) => {
			this.mousePxX = e.clientX;
			this.mousePxY = e.clientY;
			this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
			this.mouseY = 1 - (e.clientY / window.innerHeight) * 2;
		});

		window.addEventListener('mousedown', (e) => {
			if (e.button === 0) this.firing = true;
		});
		window.addEventListener('mouseup', (e) => {
			if (e.button === 0) this.firing = false;
		});
		window.addEventListener('blur', () => this._releaseAll());

		window.addEventListener('keydown', (e) => this._key(e, true));
		window.addEventListener('keyup', (e) => this._key(e, false));
	}

	onKey(code, cb) {
		this._keyHandlers.push({ code, cb });
	}

	_key(e, down) {
		if (down) this._keys.add(e.code); else this._keys.delete(e.code);
		const k = this._keys;
		this.steerX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
		this.steerY = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);

		switch (e.code) {
			case 'ShiftLeft':
			case 'ShiftRight': this.boosting = down; break;
			case 'KeyX': this.braking = down; break;
			case 'KeyQ': this.rollLeft = down; break;
			case 'KeyE': this.rollRight = down; break;
			case 'Space': this.firing = down; e.preventDefault(); break;
		}
		if (down) for (const h of this._keyHandlers) if (h.code === e.code) h.cb();
	}

	_releaseAll() {
		this._keys.clear();
		this.steerX = this.steerY = 0;
		this.firing = this.boosting = this.braking = false;
		this.rollLeft = this.rollRight = false;
	}
}
