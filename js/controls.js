// Raw input state. No flight logic here — the ship reads from this every frame.

export class InputState {
	constructor(domElement) {
		this.el = domElement;
		// normalized mouse, -1..1, +y = screen top
		this.mouseX = 0;
		this.mouseY = 0;
		// raw pixels for HUD crosshair
		this.mousePxX = window.innerWidth / 2;
		this.mousePxY = window.innerHeight / 2;

		this.firing = false;
		this.boosting = false;
		this.throttleUp = false;
		this.braking = false;
		this.rollLeft = false;
		this.rollRight = false;

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
		switch (e.code) {
			case 'ShiftLeft':
			case 'ShiftRight': this.boosting = down; break;
			case 'KeyW':
			case 'ArrowUp': this.throttleUp = down; break;
			case 'KeyS':
			case 'ArrowDown': this.braking = down; break;
			case 'KeyQ': this.rollLeft = down; break;
			case 'KeyE': this.rollRight = down; break;
			case 'Space': this.firing = down; e.preventDefault(); break;
		}
		if (down) for (const h of this._keyHandlers) if (h.code === e.code) h.cb();
	}

	_releaseAll() {
		this.firing = this.boosting = this.throttleUp = false;
		this.braking = this.rollLeft = this.rollRight = false;
	}
}
