// Inside a galaxy: density model, particle cloud, dust lanes, streamed star cells, nebulae. Coordinates: parsecs, galaxy disk frame (Y = disk normal).
import { C, makeRng, seedOf, clamp, smooth, TAU, blackbody, qrot, qconj } from '../core.js';
import { snoise, fbm } from '../noise.js';
import { nebulaName } from '../names.js';
import { starSpec } from './system.js';

export const STAR_CELL = 60;    // pc
export const NEB_CELL = 320;    // pc
const PC = C.PC;

export function armPhase(g, r, th) { // returns 0..1 arm proximity (1 on arm centre), r normalised 0..1
  if (!g.arms) return 0;
  const rr = Math.max(r, 0.04);
  const ang = th - Math.log(rr / 0.08) / Math.tan(g.pitch);
  const d = (g.arms * ang) / TAU; const f = d - Math.round(d);   // -0.5..0.5 distance in arm spacing
  const w = 0.30 * (1.1 - g.armSharp * 0.6);
  return Math.exp(-(f * f) / (w * w));
}
// relative stellar density at point (pc, disk frame) — ≈1 at 0.45R in the disk plane.
export function galaxyDensity(g, x, y, z) {
  const R = g.radius / PC, rad = Math.hypot(x, z) / R, r3 = Math.hypot(x, y, z) / R;
  if (r3 > 1.15) return 0;
  const th = Math.atan2(z, x);
  let d = 0;
  const bulgeR = 0.06 + 0.10 * g.bulge;
  if (g.type === 'elliptical' || g.type === 'dwarf') {
    const e = Math.hypot(x / g.ellip[0], y / g.ellip[1], z) / R;
    d = Math.exp(-Math.pow(e / 0.18, 0.5) * 2.2) * 6;
  } else if (g.type === 'irregular') {
    d = clamp(fbm(x / (R * 0.4) + g.seed * 0.001, y / (R * 0.4), z / (R * 0.4), 3) + 0.35, 0, 1.5) * Math.exp(-r3 * 2.4) * 2.4;
  } else {
    const h = g.thick * R * (1 + 1.5 * Math.exp(-rad * 6));
    let disk = Math.exp(-rad * 3.4) * Math.exp(-Math.abs(y) / h) * 3;
    if (g.type === 'ring') disk = Math.exp(-Math.pow((rad - g.ringR) / 0.1, 2)) * Math.exp(-Math.abs(y) / h) * 2.5;
    const arm = g.arms ? 0.35 + 1.9 * armPhase(g, rad, th) * smooth(0.08, 0.25, rad) : 1;
    d = disk * arm + g.bulge * 14 * Math.exp(-Math.pow(r3 / bulgeR, 0.45) * 2.4);
    if (g.bar > 0) { const bx = x * Math.cos(g.barAngle || 0) + z * Math.sin(g.barAngle || 0), bz = -x * Math.sin(g.barAngle || 0) + z * Math.cos(g.barAngle || 0); d += 5 * Math.exp(-Math.pow(bx / (g.bar * R), 2) - Math.pow(bz / (g.bar * R * 0.28), 2) - Math.pow(y / (R * 0.03), 2)); }
  }
  d += 0.015 * Math.exp(-r3 * 3); // halo
  return d * smooth(1.15, 0.9, r3);
}
const SQ = 1 / Math.sqrt(2);
// Build the particle cloud. 8 floats per point: x y z r g b size bright. Returns {pts, dust}
export function buildCloud(g, N) {
  const r = makeRng('cloud', g.seed); const R = g.radius / PC;
  const pts = new Float32Array(N * 8); let n = 0;
  const bulgeR = 0.06 + 0.1 * g.bulge; g.barAngle = r() * TAU;
  const hotCol = (Tlo, Thi) => blackbody(Tlo + (Thi - Tlo) * r());
  const push = (x, y, z, col, size, br) => { if (n >= N) return; const o = n * 8; pts[o] = x; pts[o + 1] = y; pts[o + 2] = z; pts[o + 3] = col[0]; pts[o + 4] = col[1]; pts[o + 5] = col[2]; pts[o + 6] = size; pts[o + 7] = br; n++; };
  const yellow = [0.95, 0.72, 0.42], orange = [1.0, 0.55, 0.28], blue = [0.55, 0.7, 1.0], white = [1, 0.95, 0.88];
  const hue = g.hue; const tintY = [1, 0.7 + 0.2 * hue, 0.4 + 0.3 * hue];
  const sizeBase = R * 0.0013;
  const young = (rad) => clamp(1.0 - rad * 1.3, 0.1, 1) * (g.sfr > 0.5 ? 1 : 0.5);
  const type = g.type;
  const emitDisk = (count, arms) => {
    for (let i = 0; i < count; i++) {
      let rad = -(Math.log(r() + 1e-6) + Math.log(r() + 1e-6)) * 0.15; if (rad > 1) { i--; continue; }
      if (g.type === 'ring') rad = g.ringR + r.gauss() * 0.07;
      let th = r() * TAU, onArm = 0;
      if (arms && g.arms && rad > 0.07 && r() < 0.78) {
        const k = Math.floor(r() * g.arms); th = k * TAU / g.arms + Math.log(rad / 0.08) / Math.tan(g.pitch) + r.gauss() * (0.2 + 0.28 * (1 - g.armSharp)) * (0.5 + 0.7 / (0.5 + rad * 3));
        onArm = 1;
      }
      let px = Math.cos(th) * rad * R, pz = Math.sin(th) * rad * R;
      if (g.bar && rad < g.bar * 1.1) { // bar region: elongated
        const a = g.barAngle, u = r.gauss() * g.bar * R * 0.55, v = r.gauss() * g.bar * R * 0.14; px = Math.cos(a) * u - Math.sin(a) * v; pz = Math.sin(a) * u + Math.cos(a) * v; rad = Math.hypot(px, pz) / R;
      }
      const h = g.thick * R * (1 + 1.5 * Math.exp(-rad * 6)); const py = -Math.log(r() + 1e-6) * h * (r() < 0.5 ? -1 : 1) * 0.7;
      const yg = young(rad) * (onArm ? 1.0 : 0.35) * (g.sfr > 0.3 ? 1 : 0.5);
      let col, br;
      if (r() < yg * 0.7) { col = hotCol(7000, 22000); br = 1.2 + r() * 0.8; } else { const m = r(); col = [yellow[0] * (0.8 + 0.2 * m), tintY[1] * (0.9 + 0.1 * m), tintY[2] * (0.8 + 0.2 * m)]; br = 0.8 + 0.5 * r(); }
      push(px, py, pz, col, sizeBase * (0.6 + r() * 1.2), br);
    }
  };
  const emitBulge = (count, sx, sy, sz, rscale) => {
    for (let i = 0; i < count; i++) {
      const q = Math.pow(-Math.log(1 - r() * 0.995), 2.2) * rscale; // heavy tail
      const dir = r.unitVec(); const rr = Math.min(q, 1) * R;
      const m = r(); const col = [orange[0] + (white[0] - orange[0]) * m * 0.5, orange[1] + (white[1] - orange[1]) * m * 0.6, orange[2] + (white[2] - orange[2]) * m * 0.7];
      push(dir[0] * rr * sx, dir[1] * rr * sy, dir[2] * rr * sz, col, sizeBase * (0.5 + r()), 0.9 + r() * 0.6);
    }
  };
  if (type === 'elliptical' || type === 'dwarf') {
    emitBulge(Math.floor(N * 0.97), g.ellip[0], g.ellip[1], 1, type === 'dwarf' ? 0.2 : 0.09);
    for (let i = 0; i < N * 0.03; i++) { const d = r.unitVec(), q = (0.2 + r() * 0.8) * R; push(d[0] * q, d[1] * q, d[2] * q, [0.9, 0.85, 0.6], sizeBase * 1.4, 1.6); } // globular clusters
  } else if (type === 'irregular') {
    const K = 7; const cs = []; for (let k = 0; k < K; k++) { const d = r.unitVec(); const q = r() * 0.55 * R; cs.push([d[0] * q, d[1] * q * 0.4, d[2] * q, 0.1 + r() * 0.18]); }
    for (let i = 0; i < N * 0.9; i++) { const c = cs[Math.floor(r() * K)]; const young = r() < 0.4; push(c[0] + r.gauss() * c[3] * R, c[1] + r.gauss() * c[3] * R * 0.5, c[2] + r.gauss() * c[3] * R, young ? hotCol(8000, 20000) : yellow, sizeBase * (0.6 + r()), young ? 1.6 : 0.9); }
  } else {
    const nb = Math.floor(N * (type === 'lenticular' ? 0.45 : 0.22 + g.bulge)); const nd = Math.floor(N * 0.74) - nb;
    emitDisk(nd, g.arms > 0); emitBulge(nb, 1, 0.78, 1, bulgeR * 0.55);
  }
  // halo + glob clusters
  for (let i = 0; i < N * 0.025; i++) { const d = r.unitVec(); const q = Math.pow(r(), 1.8) * 0.9 * R + 0.02 * R; push(d[0] * q, d[1] * q, d[2] * q, [1, 0.8, 0.55], sizeBase * 0.9, 0.6); }
  // HII regions
  const nh = g.spiralLike ? Math.min(2400, Math.floor(30 + g.sfr * 90)) : type === 'irregular' ? 200 : 0;
  for (let i = 0; i < nh; i++) {
    const rad = 0.12 + Math.pow(r(), 0.7) * 0.8; const k = Math.floor(r() * Math.max(1, g.arms)); const th = g.arms ? k * TAU / g.arms + Math.log(rad / 0.08) / Math.tan(g.pitch) + r.gauss() * 0.18 : r() * TAU;
    push(Math.cos(th) * rad * R, r.gauss() * g.thick * R * 0.4, Math.sin(th) * rad * R, [1.0, 0.25 + 0.2 * r(), 0.45 + 0.2 * r()], sizeBase * (2 + r() * 4), 2.2 + r() * 2);
  }
  // dust lanes along inner edges of arms
  const dustN = g.dust > 0.1 ? Math.floor(2500 * g.dust) : 0; const dust = new Float32Array(dustN * 5); let dn = 0;
  for (let i = 0; i < dustN; i++) {
    const rad = 0.1 + Math.pow(r(), 0.8) * 0.78; let th;
    if (g.arms) { const k = Math.floor(r() * g.arms); th = k * TAU / g.arms + Math.log(rad / 0.08) / Math.tan(g.pitch) - 0.16 + r.gauss() * 0.07; } else th = r() * TAU;
    const o = dn * 5; dust[o] = Math.cos(th) * rad * R; dust[o + 1] = r.gauss() * g.thick * R * 0.25; dust[o + 2] = Math.sin(th) * rad * R; dust[o + 3] = sizeBase * (4 + r() * 9); dust[o + 4] = (0.25 + r() * 0.5) * g.dust; dn++;
  }
  return { pts: pts.subarray(0, n * 8), n, dust: dust.subarray(0, dn * 5), dn };
}

// ---- nebulae --------------------------------------------------------------------
const nebCache = new Map();
export function nebulaeInCell(g, cx, cy, cz) {
  const key = g.id + ':' + cx + ',' + cy + ',' + cz; if (nebCache.has(key)) return nebCache.get(key);
  const r = makeRng('neb', g.seed, cx, cy, cz); const out = [];
  const p = [(cx + 0.5) * NEB_CELL, (cy + 0.5) * NEB_CELL, (cz + 0.5) * NEB_CELL];
  const d = galaxyDensity(g, p[0], p[1], p[2]);
  let n = d > 0.35 ? (r() < clamp(d * 0.28, 0, 0.95) ? 1 : 0) : 0; if (d > 1.2 && r() < 0.45) n++;
  for (let i = 0; i < n; i++) {
    const kind = r.weighted([['emission', 4], ['reflection', 2], ['dark', 2.2], ['planetary', 1.3], ['snr', 1.2]]);
    const radius = kind === 'planetary' ? r.range(0.4, 2.2) : kind === 'snr' ? r.range(3, 30) : kind === 'dark' ? r.range(8, 50) : r.range(10, 80);
    const pos = [(cx + r()) * NEB_CELL, (cy + r() * 0.8 + 0.1) * NEB_CELL, (cz + r()) * NEB_CELL];
    const seed = seedOf('nebula', g.seed, cx, cy, cz, i);
    out.push({ id: `${g.id}/n:${cx}:${cy}:${cz}:${i}`, kind: 'nebula', nkind: kind, pos, radius, seed, name: nebulaName(r, kind), hue: r(), temp: r.range(7000, 40000), cx, cy, cz, i, density: r.range(0.5, 1.3) });
  }
  if (nebCache.size > 4000) nebCache.clear();
  nebCache.set(key, out); return out;
}
export function nebulaeNear(g, p, radiusPc) {
  const out = []; const k = Math.ceil(radiusPc / NEB_CELL) + 1; const cx = Math.floor(p[0] / NEB_CELL), cy = Math.floor(p[1] / NEB_CELL), cz = Math.floor(p[2] / NEB_CELL);
  for (let z = -k; z <= k; z++) for (let y = -k; y <= k; y++) for (let x = -k; x <= k; x++) for (const n of nebulaeInCell(g, cx + x, cy + y, cz + z)) { const dd = Math.hypot(n.pos[0] - p[0], n.pos[1] - p[1], n.pos[2] - p[2]); if (dd < radiusPc + n.radius) out.push(n); }
  return out;
}
export function nebulaById(g, id) { const m = id.match(/n:(-?\d+):(-?\d+):(-?\d+):(\d+)$/); return nebulaeInCell(g, +m[1], +m[2], +m[3])[+m[4]]; }
function nebulaStars(g, neb) {
  if (neb._stars) return neb._stars; const r = makeRng('nebstars', neb.seed); const out = [];
  if (neb.nkind === 'dark' || neb.nkind === 'planetary' || neb.nkind === 'snr') { neb._stars = out; return out; }
  const n = neb.nkind === 'emission' ? 40 : 14;
  for (let i = 0; i < n; i++) { const q = neb.radius * 0.5; out.push([neb.pos[0] + r.gauss() * q * 0.5, neb.pos[1] + r.gauss() * q * 0.35, neb.pos[2] + r.gauss() * q * 0.5, 1]); }
  neb._stars = out; return out;
}

// ---- local stars ---------------------------------------------------------------------
const cellCache = new Map();
export function starCell(g, cx, cy, cz) {
  const key = g.id + ':' + cx + ',' + cy + ',' + cz; let c = cellCache.get(key); if (c) return c;
  const r = makeRng('scell', g.seed, cx, cy, cz); const list = [];
  const o = [cx * STAR_CELL, cy * STAR_CELL, cz * STAR_CELL];
  const cen = [o[0] + STAR_CELL / 2, o[1] + STAR_CELL / 2, o[2] + STAR_CELL / 2];
  const d = galaxyDensity(g, cen[0], cen[1], cen[2]);
  let n = Math.floor(d * 26); if (r() < d * 26 - n) n++; n = Math.min(n, 220);
  for (let i = 0; i < n; i++) {
    const p = [o[0] + r() * STAR_CELL, o[1] + r() * STAR_CELL, o[2] + r() * STAR_CELL];
    list.push({ pos: p, seed: seedOf('star', g.seed, cx, cy, cz, i), idx: list.length, cell: [cx, cy, cz] });
  }
  // embedded cluster stars from nebulae touching this cell
  for (const nb of nebulaeNear(g, cen, STAR_CELL)) for (const s of nebulaStars(g, nb)) {
    if (s[0] >= o[0] && s[0] < o[0] + STAR_CELL && s[1] >= o[1] && s[1] < o[1] + STAR_CELL && s[2] >= o[2] && s[2] < o[2] + STAR_CELL) list.push({ pos: [s[0], s[1], s[2]], seed: seedOf('estar', nb.seed, Math.floor(s[0] * 1000)), idx: list.length, cell: [cx, cy, cz], hot: true });
  }
  for (const s of list) { s.id = `${g.id}/s:${cx}:${cy}:${cz}:${s.idx}`; s.spec = starSpec(s.seed, s.hot ? { hot: true } : null); }
  if (cellCache.size > 3000) cellCache.clear();
  cellCache.set(key, list); return list;
}
export function starById(g, id) {
  const m = id.match(/s:(-?\d+):(-?\d+):(-?\d+):(\d+)$/); const l = starCell(g, +m[1], +m[2], +m[3]); return l[+m[4]] || l[0];
}
// nearest generated star to a galaxy-local point (pc). Searches a 3x3x3 block.
export function nearestStar(g, p, maxCells = 1) {
  const cx = Math.floor(p[0] / STAR_CELL), cy = Math.floor(p[1] / STAR_CELL), cz = Math.floor(p[2] / STAR_CELL); let best = null, bd = 1e30;
  for (let k = -maxCells; k <= maxCells; k++) for (let j = -maxCells; j <= maxCells; j++) for (let i = -maxCells; i <= maxCells; i++) for (const s of starCell(g, cx + i, cy + j, cz + k)) { const dd = (s.pos[0] - p[0]) ** 2 + (s.pos[1] - p[1]) ** 2 + (s.pos[2] - p[2]) ** 2; if (dd < bd) { bd = dd; best = s; } }
  return best;
}
export function starsNear(g, p, radiusPc) {
  const k = Math.ceil(radiusPc / STAR_CELL); const cx = Math.floor(p[0] / STAR_CELL), cy = Math.floor(p[1] / STAR_CELL), cz = Math.floor(p[2] / STAR_CELL); const out = [];
  for (let z = -k; z <= k; z++) for (let y = -k; y <= k; y++) for (let x = -k; x <= k; x++) for (const s of starCell(g, cx + x, cy + y, cz + z)) out.push(s);
  return out;
}
