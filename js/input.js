// Touch / mouse / keyboard input → per-frame control state.
export class Input {
  constructor(canvas, hooks) {
    this.canvas = canvas; this.hooks = hooks; this.ptrs = new Map(); this.acc = { lookdx: 0, lookdy: 0, dolly: 0, roll: 0 }; this.keys = new Set(); this.stick = [0, 0]; this.vert = 0; this.boost = false; this.rollKey = 0;
    this.sens = 1; this.fovRad = 65 * Math.PI / 180; this.last = { t: 0, x: 0, y: 0 }; this.dragging = false; this.lastPinch = null; this.mode = 'free';
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.down(e)); window.addEventListener('pointermove', (e) => this.move(e)); window.addEventListener('pointerup', (e) => this.up(e)); window.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.acc.dolly += -e.deltaY * 0.0012 * (e.ctrlKey ? 3 : 1); this.hooks.userInput && this.hooks.userInput('wheel'); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => { if (/input|textarea|select/i.test(e.target.tagName)) return; this.keys.add(e.code); if (e.code === 'Space') { e.preventDefault(); this.hooks.togglePlay && this.hooks.togglePlay(); } if (e.code === 'Escape') this.hooks.escape && this.hooks.escape(); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code)); window.addEventListener('blur', () => this.keys.clear());
  }
  down(e) {
    if (e.target !== this.canvas) return; this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), btn: e.button, moved: 0 });
    if (this.ptrs.size === 2) this.lastPinch = this.pinchState(); this.hooks.userInput && this.hooks.userInput('down');
  }
  pinchState() { const p = [...this.ptrs.values()]; const dx = p[1].x - p[0].x, dy = p[1].y - p[0].y; return { d: Math.hypot(dx, dy) || 1, a: Math.atan2(dy, dx) }; }
  move(e) {
    const p = this.ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; p.moved += Math.abs(dx) + Math.abs(dy);
    if (this.ptrs.size === 1) {
      const s = this.fovRad / this.canvas.clientHeight * this.sens * (this.mode === 'orbit' ? 1.6 : 1); const r = p.btn === 2 ? 1 : 0;
      if (p.btn === 2) this.acc.roll += dx * 0.004; else { this.acc.lookdx += dx * s; this.acc.lookdy += dy * s * (this.invertY ? -1 : 1); }
    } else if (this.ptrs.size === 2) {
      const st = this.pinchState(); if (this.lastPinch) { this.acc.dolly += Math.log(st.d / this.lastPinch.d) * 1.55; let da = st.a - this.lastPinch.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; this.acc.roll += da * 0.9; } this.lastPinch = st;
    }
  }
  up(e) {
    const p = this.ptrs.get(e.pointerId); if (!p) return; this.ptrs.delete(e.pointerId); this.lastPinch = null;
    const now = performance.now();
    if (p.moved < 10 && now - p.t < 320 && this.ptrs.size === 0 && p.btn !== 2) {
      const dbl = now - this.last.t < 340 && Math.hypot(e.clientX - this.last.x, e.clientY - this.last.y) < 30; this.last = { t: now, x: e.clientX, y: e.clientY };
      this.hooks.tap && this.hooks.tap(e.clientX, e.clientY, dbl);
    }
    if (this.ptrs.size === 1) { const q = [...this.ptrs.values()][0]; q.moved = 99; }
  }
  frame(dt, mode) {
    this.mode = mode; const k = this.keys; const a = this.acc;
    let mx = this.stick[0], mz = -this.stick[1], my = this.vert;
    if (k.has('KeyW')) mz += 1; if (k.has('KeyS')) mz -= 1; if (k.has('KeyD')) mx += 1; if (k.has('KeyA')) mx -= 1; if (k.has('KeyR')) my += 1; if (k.has('KeyF')) my -= 1;
    let roll = a.roll + ((k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0)) * dt * 1.2 + this.rollKey * dt * 1.2;
    let lx = -a.lookdx, ly = -a.lookdy;
    const ar = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0), au = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
    lx += ar * dt * 1.0; ly += -au * dt * 1.0;
    const boost = this.boost || k.has('ShiftLeft') || k.has('ShiftRight');
    const inp = { look: [lx, ly], lookDirect: true, roll, rolling: Math.abs(roll) > 1e-4, move: [Math.max(-1, Math.min(1, mx)), Math.max(-1, Math.min(1, my)), Math.max(-1, Math.min(1, mz))], dolly: a.dolly, boost, cancel: false };
    if (inp.look[0] || inp.look[1]) inp.lookDirect = true;
    a.lookdx = a.lookdy = a.dolly = a.roll = 0; return inp;
  }
}
