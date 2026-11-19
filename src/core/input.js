// BENTONVILLE ROYALE — keyboard / mouse / pointer-lock state.
//
// Gameplay code reads remappable *actions*, never raw key codes:
//   input.action('moveForward')   held this frame
//   input.actionHit('reload')     went down since the last endFrame()
// Bindings come from settings (src/ui/settings.js) via setBindings(). Mouse
// buttons are tracked as codes 'Mouse0' (left), 'Mouse1' (middle), 'Mouse2' (right).

import { DEFAULT_BINDINGS, keyLabel } from '../ui/settings.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // key codes that went down since the last endFrame()
    this.buttons = [false, false, false];
    this.clicked = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.enabled = true;
    this.trap = false; // keep preventDefault on game keys (Tab, Space, bound keys) while unlocked
    this.inMatch = false; // set by Game while a match is playable: the inventory key never reaches the page
    this.onLockChange = null;
    this.bindings = { ...DEFAULT_BINDINGS };

    this._down = (e) => {
      if (!this.enabled) return;
      // `trap`: an in-game overlay (inventory) has the unlocked pointer but still owns the keys.
      // `inMatch`: the inventory key is always ours mid-match, even if pointer lock was refused
      // (otherwise Tab would move browser focus onto a hidden menu button).
      const ours = this.locked || this.trap;
      if ((ours && (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow') || this._isBound(e.code))) || (this.inMatch && e.code === this.bindings.inventory)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    };
    this._up = (e) => this.keys.delete(e.code);
    this._mdown = (e) => {
      if (!this.locked || !this.enabled) return;
      if (e.button < 3) {
        this.buttons[e.button] = true;
        this.clicked[e.button] = true;
      }
      if (e.button < 5) {
        this.keys.add('Mouse' + e.button);
        this.pressed.add('Mouse' + e.button);
      }
    };
    this._mup = (e) => {
      if (e.button < 3) this.buttons[e.button] = false;
      if (e.button < 5) this.keys.delete('Mouse' + e.button);
    };
    this._move = (e) => {
      this.moveEvents = (this.moveEvents || 0) + 1; // FPS overlay: mouse events per second
      if (!this.locked) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    };
    this._wheel = (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    };
    this._lock = () => {
      if (!this.locked) {
        if (this.trap) this.releaseMouse(); // inventory open: keep walking, never keep firing
        else this.releaseAll();
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    this._blur = () => this.releaseAll();
    this._ctx = (e) => e.preventDefault();

    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('mousedown', this._mdown);
    window.addEventListener('mouseup', this._mup);
    window.addEventListener('mousemove', this._move);
    window.addEventListener('wheel', this._wheel, { passive: true });
    window.addEventListener('blur', this._blur);
    document.addEventListener('pointerlockchange', this._lock);
    canvas.addEventListener('contextmenu', this._ctx);
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  lock() {
    if (this.locked) return;
    const plain = () => {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (err) {
        /* not allowed right now (no user gesture) */
      }
    };
    if (!this.rawMouse) return plain();
    try {
      // raw input (settings.rawMouse); browsers without it reject or throw: plain lock instead
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch((err) => (err && err.name === 'NotSupportedError' ? plain() : undefined));
      else if (!p) plain();
    } catch (err) {
      plain();
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  hit(code) {
    return this.pressed.has(code);
  }

  /** bindings: { actionId: code } (see ACTIONS in src/ui/settings.js). */
  setBindings(bindings) {
    this.bindings = { ...DEFAULT_BINDINGS, ...(bindings || {}) };
  }

  _isBound(code) {
    for (const k in this.bindings) if (this.bindings[k] === code) return true;
    return false;
  }

  /** True while the key / button bound to `name` is held. */
  action(name) {
    const code = this.bindings[name];
    return !!code && this.keys.has(code);
  }

  /** True if the key / button bound to `name` went down this frame. */
  actionHit(name) {
    const code = this.bindings[name];
    return !!code && this.pressed.has(code);
  }

  /** Display label of the key bound to `name` ('E', 'LMB', 'L-SHIFT'). */
  label(name) {
    return keyLabel(this.bindings[name]);
  }

  releaseAll() {
    this.keys.clear();
    this.buttons[0] = this.buttons[1] = this.buttons[2] = false;
  }

  /** Drops held mouse buttons only (held keys stay down). */
  releaseMouse() {
    for (let i = 0; i < 5; i++) {
      this.keys.delete('Mouse' + i);
      this.pressed.delete('Mouse' + i);
    }
    this.buttons[0] = this.buttons[1] = this.buttons[2] = false;
    this.clicked[0] = this.clicked[1] = this.clicked[2] = false;
  }

  /** Swallows a key press for the rest of this frame (actionHit / hit return false). */
  consume(code) {
    if (code) this.pressed.delete(code);
  }

  endFrame() {
    this.pressed.clear();
    this.clicked[0] = this.clicked[1] = this.clicked[2] = false;
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}
