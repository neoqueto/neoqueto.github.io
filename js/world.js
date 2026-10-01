// World state: simulation time, camera (anchor + relative offset + orientation), navigation modes, travel, level switching.
import { C, v3, qrot, qconj, qmul, qfromAxisAngle, clamp, TAU, lerp } from './core.js';
import { UNIVERSE, posIn, inChain, galaxyOf, systemOf, galaxyEntity, systemEntity, resolve } from './entities.js';
import { nearestStar } from './gen/galaxy.js';
import { bodyPos } from './gen/system.js';
import { terrainHeight } from './terrain.js';
import { spinQuat } from './spin.js';

const ez = (x) => x * x * x * (x * (x * 6 - 15) + 10);
function lookQuat(fwd, up) { // quaternion whose -Z axis points along fwd
  const f = v3.norm(fwd); let r = v3.cross(f, up); if (v3.len(r) < 1e-6) r = v3.cross(f, [1, 0, 0]); r = v3.norm(r); const u = v3.cross(r, f);
  // basis columns: right=r, up=u, back=-f
  const m00 = r[0], m01 = u[0], m02 = -f[0], m10 = r[1], m11 = u[1], m12 = -f[1], m20 = r[2], m21 = u[2], m22 = -f[2];
  const tr = m00 + m11 + m22; let x, y, z, w;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  const l = Math.hypot(x, y, z, w); return [x / l, y / l, z / l, w / l];
}
function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; let bb = b; if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) { const r = [a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]; const l = Math.hypot(...r); return r.map((x) => x / l); }
  const th = Math.acos(d), s = Math.sin(th), w1 = Math.sin((1 - t) * th) / s, w2 = Math.sin(t * th) / s;
  return [a[0] * w1 + bb[0] * w2, a[1] * w1 + bb[1] * w2, a[2] * w1 + bb[2] * w2, a[3] * w1 + bb[3] * w2];
}
export { lookQuat, qslerp };

export class World {
  constructor() {
    this.t = 0; this.rate = 1; this.playing = true;
    this.anchor = UNIVERSE; this.rel = [0, 0, 0]; this.q = [0, 0, 0, 1];
    this.mode = 'free'; this.target = null; this.vel = [0, 0, 0]; this.angVel = [0, 0, 0];
    this.orbit = { az: 0.6, el: 0.35, dist: 1e20, azS: 0.6, elS: 0.35, distS: 1e20 };
    this.travel = null; this.surface = null; this.speedMul = 1; this.cruise = 1; this.nearestDist = 1e18; this.nearestEnt = null; this.altitude = Infinity;
    this.frame = 0; this.onEnter = null; this.cosmosGalaxies = []; this.events = [];
  }
  // ---- coordinate helpers --------------------------------------------------------------------------
  camIn(F) { // camera position in frame of F (metres) — F must be in the anchor chain (anchor itself counts)
    const r = this.worldRel();
    if (F === this.anchor) return r.slice();
    const p = posIn(this.anchor, F, this.t); return [p[0] + r[0], p[1] + r[1], p[2] + r[2]];
  }
  camUniverse() { const p = posIn(this.anchor, UNIVERSE, this.t); const r = this.worldRel(); return [p[0] + r[0], p[1] + r[1], p[2] + r[2]]; }
  camInGalaxy(ge) { // works even if anchor is not inside the galaxy
    if (inChain(this.anchor, ge)) return this.camIn(ge); const u = this.camUniverse(); return [u[0] - ge.pos[0], u[1] - ge.pos[1], u[2] - ge.pos[2]];
  }
  reanchor(na) {
    if (na === this.anchor) return;
    // lowest common ancestor frame
    let F = UNIVERSE; const chainA = []; let c = this.anchor; while (c) { chainA.push(c); c = c.container; }
    c = na; while (c) { if (chainA.includes(c)) { F = c; break; } c = c.container; }
    const pa = posIn(this.anchor, F, this.t), pn = posIn(na, F, this.t);
    this.rel = [pa[0] + this.rel[0] - pn[0], pa[1] + this.rel[1] - pn[1], pa[2] + this.rel[2] - pn[2]]; this.anchor = na;
  }
  rootFor(e) { // free-flight root to use near entity e
    const sE = systemOf(e), gE = galaxyOf(e); const u = this.camUniverse();
    if (sE) { const p = this.camIn(sE.container === this.anchor || inChain(this.anchor, sE) ? sE : sE); }
    return gE ? gE : UNIVERSE;
  }
  // ---- queries -------------------------------------------------------------------------------------
  arrivalDist(e) {
    switch (e.kind) {
      case 'galaxy': return e.radius * 2.0; case 'cluster': return e.radius * 1.5; case 'smbh': return Math.max(e.radius * 36, 1e9); case 'nebula': return e.radius * 1.5;
      case 'system': return Math.max(e.sys.extent * 0.9, 5 * C.AU);
      case 'star': { const k = e.spec.kind; if (k === 'bh') return e.radius * (e.accretion ? Math.max(60, e.accretion.rout / e.radius * 1.9) : 80); if (k === 'ns' || k === 'pulsar' || k === 'magnetar') return Math.max(e.radius * 1800, 1.5e7); return Math.max(e.radius * 4.5, 1e8); } case 'planet': return e.radius * (e.ring ? e.ring.outer * 1.5 + 1 : 3.4); case 'moon': return e.radius * 4.5;
      case 'belt': return e.width * 2.2;
      default: return e.radius * 3;
    }
  }
  minDist(e) { // nearest allowed camera distance from entity centre (metres)
    switch (e.kind) { case 'star': return e.radius * 1.05; case 'planet': case 'moon': return e.radius * 1.0 + 3; case 'smbh': return e.radius * 3; case 'belt': return 1e4; case 'galaxy': return 1e17; case 'nebula': return 1e13; default: return e.radius * 0.2 + 1e5; }
  }
  surfaceRadiusAt(b, relWorld) { // radius of the surface of body b below position relWorld (metres)
    if (b.kind === 'star') return b.radius;
    if (b.cls === 'gas') return b.radius * 0.995;
    const Q = spinQuat(b, this.t); const l = qrot(qconj(Q), relWorld); const L = Math.hypot(l[0], l[1], l[2]) || 1; const T = b.visual.T;
    let dx = l[0] / L, dy = l[1] / L, dz = l[2] / L; if (T.axes) { dx /= T.axes[0]; dy /= T.axes[1]; dz /= T.axes[2]; const n = Math.hypot(dx, dy, dz); dx /= n; dy /= n; dz /= n; }
    const h = terrainHeight(T, dx, dy, dz); return T.radius * (T.axes ? (T.axes[0] + T.axes[1] + T.axes[2]) / 3 : 1) + Math.max(h, T.seaLevel);
  }
  // ---- control -------------------------------------------------------------------------------------
  focusOn(e, instant = false) { // travel to entity
    if (!e) return; this.target = e;
    if (e === this.anchor && this.mode === 'orbit') return;
    this.releaseSurface();
    const dEnd = this.arrivalDist(e);
    const camU = this.camUniverse(); this.reanchor(e);
    let d0 = v3.len(this.rel); if (!(d0 > 0)) { this.rel = [0, 0, dEnd * 2]; d0 = dEnd * 2; }
    if (d0 < dEnd * 1.05) { // already close: just orbit
      this.beginOrbitFromRel(); return;
    }
    const dir0 = v3.norm(this.rel);
    this.travel = { e, d0, dEnd, dir0, dir1: dir0, T: instant ? 0.01 : clamp(2.4 + 1.25 * Math.log10(d0 / dEnd), 2.5, 11), s: 0 };
    this.mode = 'travel'; this.vel = [0, 0, 0];
  }
  beginOrbitFromRel() {
    const r = this.rel, d = v3.len(r) || 1; this.orbit.az = this.orbit.azS = Math.atan2(r[0], r[2]); this.orbit.el = this.orbit.elS = Math.asin(clamp(r[1] / d, -1, 1));
    this.orbit.dist = this.orbit.distS = d; this.mode = 'orbit'; this.travel = null;
  }
  releaseToFree() {
    if (this.mode === 'free') return; this.releaseSurface(); const keepQ = this.q.slice();
    const e = this.anchor; let root = UNIVERSE; const sE = systemOf(e), gE = galaxyOf(e);
    if (sE && v3.len(this.camIn(sE)) < sE.extent * 3) root = sE; else if (gE && v3.len(this.camIn(gE)) < gE.radius * 2.8) root = gE;
    this.reanchor(root); this.mode = 'free'; this.travel = null; this.q = keepQ; this.vel = [0, 0, 0];
  }
  releaseSurface() { if (this.surface) { const Q = spinQuat(this.surface, this.t); this.q = qmul(Q, this.q); this.rel = qrot(Q, this.rel); this.surface = null; } }
  attachSurface(b) { if (this.surface === b) return; this.releaseSurface(); const Q = spinQuat(b, this.t), Qi = qconj(Q); this.rel = qrot(Qi, this.rel); this.q = qmul(Qi, this.q); this.vel = qrot(Qi, this.vel); this.surface = b; }
  // world-frame helpers when attached to a spinning body
  worldRel() { return this.surface ? qrot(spinQuat(this.surface, this.t), this.rel) : this.rel; }
  worldQ() { return this.surface ? qmul(spinQuat(this.surface, this.t), this.q) : this.q; }
  // ---- per-frame step ----------------------------------------------------------------------------------
  step(dt, inp) {
    this.frame++; dt = Math.min(dt, 0.1);
    if (this.playing) this.t += dt * this.rate;
    if (this.mode === 'travel') this.stepTravel(dt, inp); else if (this.mode === 'orbit') this.stepOrbit(dt, inp); else this.stepFree(dt, inp);
    this.constrain();
    if (this.mode === 'free') this.autoAnchor();
    this.computeNearest();
  }
  stepFree(dt, inp) {
    // rotation (drag gives per-frame radians; keep angular velocity for inertia)
    const lx = inp.look[0], ly = inp.look[1];
    if (lx || ly) { this.angVel[0] = lx / Math.max(dt, 1e-3); this.angVel[1] = ly / Math.max(dt, 1e-3); } else { const d = Math.exp(-dt * 5.5); this.angVel[0] *= d; this.angVel[1] *= d; }
    this.angVel[2] += (inp.roll / Math.max(dt, 1e-3) - this.angVel[2]) * (1 - Math.exp(-dt * 20));
    const yaw = this.angVel[0] * dt, pitch = this.angVel[1] * dt, roll = this.angVel[2] * dt;
    if (Math.abs(this.angVel[0]) + Math.abs(this.angVel[1]) + Math.abs(this.angVel[2]) > 1e-4) {
      let q = this.q; const r = qrot(q, [1, 0, 0]), u = qrot(q, [0, 1, 0]), f = qrot(q, [0, 0, -1]);
      q = qmul(qfromAxisAngle(u, -yaw), q); q = qmul(qfromAxisAngle(r, -pitch), q); q = qmul(qfromAxisAngle(f, roll), q);
      const l = Math.hypot(...q); this.q = q.map((x) => x / l);
    }
    // level horizon when near a surface
    if (this.surface && this.altitude < this.surface.radius * 0.6 && !inp.rolling) {
      const up = v3.norm(this.rel); const r = qrot(this.q, [1, 0, 0]); const cur = v3.dot(r, up); const f = qrot(this.q, [0, 0, -1]);
      this.q = qmul(qfromAxisAngle(f, clamp(-Math.asin(clamp(cur, -1, 1)), -1, 1) * (1 - Math.exp(-dt * 1.5))), this.q);
    }
    // translation: speed from distance to nearest surface
    const near = Math.max(this.nearestDist, 1);
    const mm = Math.hypot(inp.move[0], inp.move[1], inp.move[2]);
    if (mm > 0.5) this.cruise = Math.min(this.cruise * Math.exp(dt * 0.45), 60); else this.cruise = Math.max(1, this.cruise * Math.exp(-dt * 2.5));
    const base = Math.max(Math.min(near, 1e22) * 0.85, 0.5) * this.speedMul * (inp.boost ? 8 : 1) * this.cruise;
    const fwd = qrot(this.q, [0, 0, -1]), right = qrot(this.q, [1, 0, 0]), up = qrot(this.q, [0, 1, 0]);
    const m = inp.move; const mag = Math.hypot(m[0], m[1], m[2]);
    const dir = [fwd[0] * m[2] + right[0] * m[0] + up[0] * m[1], fwd[1] * m[2] + right[1] * m[0] + up[1] * m[1], fwd[2] * m[2] + right[2] * m[0] + up[2] * m[1]];
    const tv = [dir[0] * base, dir[1] * base, dir[2] * base];
    const kv = 1 - Math.exp(-dt * (mag > 0.01 ? 3.2 : 4.5));
    this.vel = [this.vel[0] + (tv[0] - this.vel[0]) * kv, this.vel[1] + (tv[1] - this.vel[1]) * kv, this.vel[2] + (tv[2] - this.vel[2]) * kv];
    // pinch/wheel dolly: exponential in distance to nearest surface
    if (inp.dolly) { const d = near * (1 - Math.exp(-inp.dolly)); this.rel = [this.rel[0] + fwd[0] * d, this.rel[1] + fwd[1] * d, this.rel[2] + fwd[2] * d]; }
    this.rel = [this.rel[0] + this.vel[0] * dt, this.rel[1] + this.vel[1] * dt, this.rel[2] + this.vel[2] * dt];
    this.speed = v3.len(this.vel);
  }
  stepOrbit(dt, inp) {
    const o = this.orbit; const e = this.anchor;
    const lx = inp.look[0], ly = inp.look[1];
    if (lx || ly) { o.vaz = lx / Math.max(dt, 1e-3); o.vel = ly / Math.max(dt, 1e-3); } else { const dd = Math.exp(-dt * 4.0); o.vaz = (o.vaz || 0) * dd; o.vel = (o.vel || 0) * dd; }
    o.az += (o.vaz || 0) * dt; o.el = clamp(o.el - (o.vel || 0) * dt, -1.52, 1.52);
    const rmin = this.minDist(e) + (e.kind === 'planet' || e.kind === 'moon' ? Math.max(0, this.surfaceRadiusAt(e, this.worldRel()) - e.radius) : 0);
    if (inp.dolly) { const h = Math.max(o.dist - rmin, rmin * 0.001 + 0.1); o.dist = rmin + h * Math.exp(-inp.dolly); }
    if (inp.move[2]) { const h = Math.max(o.dist - rmin, 0.1); o.dist = rmin + h * Math.exp(-inp.move[2] * dt * 1.4 * (inp.boost ? 3 : 1)); }
    o.dist = Math.max(o.dist, rmin);
    const k = 1 - Math.exp(-dt * 9); o.azS += (o.az - o.azS) * k; o.elS += (o.el - o.elS) * k; o.distS += (o.dist - o.distS) * (1 - Math.exp(-dt * 11)); if (o.distS < rmin) o.distS = rmin;
    const ce = Math.cos(o.elS); this.rel = [o.distS * ce * Math.sin(o.azS), o.distS * Math.sin(o.elS), o.distS * ce * Math.cos(o.azS)];
    const q = lookQuat([-this.rel[0], -this.rel[1], -this.rel[2]], [0, 1, 0]);
    // roll twist support
    this.q = inp.roll ? qmul(qfromAxisAngle(qrot(q, [0, 0, -1]), (this.orbitRoll = (this.orbitRoll || 0) + inp.roll)), q) : q;
    this.speed = 0; this.vel = [0, 0, 0];
    // lock to rotating surface when very close
    if ((e.kind === 'planet' || e.kind === 'moon') && !this.surface && o.distS < e.radius * 1.35) { /* inertial orbit; surface lock handled in free mode */ }
  }
  stepTravel(dt, inp) {
    const tr = this.travel; if (inp.cancel || inp.move[0] || inp.move[1] || inp.move[2]) { this.travel = null; this.mode = 'free'; this.releaseToFree(); return; }
    tr.s += dt / tr.T; const s = Math.min(tr.s, 1); const e = ez(s);
    const d = tr.d0 * Math.pow(tr.dEnd / tr.d0, e);
    // aim to arrive slightly above the orbital plane for a nice view
    const arrive = v3.norm([tr.dir0[0], Math.max(tr.dir0[1], 0.18), tr.dir0[2]]);
    const dir = v3.norm(v3.add(v3.scale(tr.dir0, 1 - ez(Math.min(1, s * 1.1))), v3.scale(arrive, ez(Math.min(1, s * 1.1)))));
    this.rel = [dir[0] * d, dir[1] * d, dir[2] * d];
    const want = lookQuat([-dir[0], -dir[1], -dir[2]], [0, 1, 0]); this.q = qslerp(this.q, want, 1 - Math.exp(-dt * (2 + 6 * s)));
    this.speed = Math.abs(Math.log(tr.dEnd / tr.d0)) / tr.T * d;
    if (s >= 1) { this.beginOrbitFromRel(); this.travel = null; this.events.push('arrived'); }
  }
  constrain() { // keep the camera outside solid bodies
    const e = this.anchor; const rr = this.surface ? this.rel : this.rel;
    if (e.kind === 'planet' || e.kind === 'moon' || e.kind === 'star') {
      const rw = this.worldRel(); const L = v3.len(rw); const sr = this.surfaceRadiusAt(e, rw) + (e.kind === 'star' ? e.radius * 0.05 : 1.2);
      this.altitude = L - (sr - (e.kind === 'star' ? e.radius * 0.05 : 1.2));
      if (L < sr) { const k = sr / (L || 1); if (this.surface) this.rel = this.rel.map((x) => x * k); else this.rel = this.rel.map((x) => x * k); if (this.mode === 'orbit') this.orbit.dist = this.orbit.distS = Math.max(this.orbit.dist, sr); }
    } else this.altitude = Infinity;
  }
  computeNearest() {
    // nearest object & distance (surface) for speed scaling; set by main through setNearest(), but fall back to anchor scale
    if (this.nearestOverride !== undefined) { this.nearestDist = this.nearestOverride; }
  }
  autoAnchor() {
    const a = this.anchor; if (this.surface) return;
    // snap to a body frame when low over it (co-rotate)
    if (a.kind === 'system') {
      if (v3.len(this.rel) > a.extent * 3.4) { this.reanchor(a.container); return; }
    } else if (a.kind === 'galaxy') {
      const g = a.g, r = v3.len(this.rel);
      if (r > a.radius * 3.0) { this.reanchor(UNIVERSE); return; }
      if (this.frame % 3 === 0 && r < a.radius * 1.15) {
        const camD = qrot(qconj(g.orient), this.rel); const p = [camD[0] / C.PC, camD[1] / C.PC, camD[2] / C.PC];
        const s = nearestStar(g, p, 1);
        if (s) { const d = Math.hypot(s.pos[0] - p[0], s.pos[1] - p[1], s.pos[2] - p[2]); if (d < 0.08) { const se = systemEntity(a, s); const ext = se.sys.extent; if (d * C.PC < ext * 1.7) { this.reanchor(se); this.events.push('enter:' + se.id); } } }
      }
    } else if (a === UNIVERSE) {
      for (const g of this.cosmosGalaxies) {
        const dx = this.rel[0] - g.pos[0], dy = this.rel[1] - g.pos[1], dz = this.rel[2] - g.pos[2];
        if (dx * dx + dy * dy + dz * dz < (g.radius * 1.7) ** 2) { this.reanchor(galaxyEntity(g)); this.events.push('enter:' + g.id); break; }
      }
    }
  }
  // snapshot for favourites / autosave
  jumpTo(e, dist) { // instant relocation into orbit around e
    this.releaseSurface(); this.travel = null; this.target = e; const d = dist || this.arrivalDist(e) * 1.0; const dir = v3.norm([0.55, 0.3, 0.78]);
    this.anchor = e; this.rel = [dir[0] * d, dir[1] * d, dir[2] * d]; this.beginOrbitFromRel(); this.orbit.az = this.orbit.azS = Math.atan2(dir[0], dir[2]); this.vel = [0, 0, 0];
  }
  attachTo(b) { if (this.surface === b) return; this.releaseSurface(); this.reanchor(b); this.attachSurface(b); }
  detachSurface() { if (!this.surface) return; const b = this.surface; this.releaseSurface(); const sE = systemOf(b); if (sE) this.reanchor(sE); }
  collideWith(b, camSys) { // push camera out of body b; returns altitude above surface (m)
    const bp = bodyPos(b, this.t); const rel = [camSys[0] - bp[0], camSys[1] - bp[1], camSys[2] - bp[2]]; const L = v3.len(rel) || 1;
    const sr = this.surfaceRadiusAt(b, rel); const margin = b.kind === 'star' ? b.radius * 0.03 : 1.2;
    if (L < sr + margin) { const k = (sr + margin) / L; const wr = this.worldRel(); const d = [rel[0] * (k - 1), rel[1] * (k - 1), rel[2] * (k - 1)];
      if (this.surface) { const ql = qrot(qconj(spinQuat(this.surface, this.t)), d); this.rel = [this.rel[0] + ql[0], this.rel[1] + ql[1], this.rel[2] + ql[2]]; } else this.rel = [this.rel[0] + d[0], this.rel[1] + d[1], this.rel[2] + d[2]];
      if (this.mode === 'orbit' && this.anchor === b) this.orbit.dist = this.orbit.distS = Math.max(this.orbit.dist, v3.len(this.rel)); this.vel = [0, 0, 0]; }
    return L - sr;
  }
  snapshot() { return { anchor: this.anchor.id, rel: this.rel.slice(), q: this.q.slice(), t: this.t, mode: this.mode, target: this.target ? this.target.id : null, surface: this.surface ? this.surface.id : null, orbit: { ...this.orbit } }; }
  restore(s) {
    try {
      this.surface = null; this.travel = null; const a = resolve(s.anchor); this.anchor = a; this.rel = s.rel.slice(); this.q = s.q.slice(); this.t = s.t ?? this.t; this.vel = [0, 0, 0];
      this.target = s.target ? resolve(s.target) : null; this.mode = 'free';
      if (s.mode === 'orbit' && a !== UNIVERSE && a.kind !== 'galaxy' || (s.mode === 'orbit')) { this.orbit = { ...this.orbit, ...s.orbit }; this.mode = 'orbit'; this.beginOrbitFromRel(); this.q = s.q.slice(); }
      return true;
    } catch (e) { console.warn('restore failed', e); return false; }
  }
}
