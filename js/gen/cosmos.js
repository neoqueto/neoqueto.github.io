// Large-scale structure: cosmic web density, galaxy clusters, galaxies (tier 0 cells) and far-field galaxy dust (tier 1).
import { C, makeRng, seedOf, clamp, smooth, qfromEuler, TAU, v3 } from '../core.js';
import { snoise, fbm } from '../noise.js';
import { galaxyName, properName } from '../names.js';

export const CELL0 = 0.4 * C.MPC;   // galaxy cell
export const CELL1 = 5 * C.MPC;     // far-field cell
export const CLUSTER_CELL = 40 * C.MPC;
const Mpc = C.MPC;

// cluster nodes: one candidate per 40 Mpc cell
const clusterCache = new Map();
export function clustersInCell(cx, cy, cz) {
  const key = cx + ',' + cy + ',' + cz; let c = clusterCache.get(key); if (c !== undefined) return c;
  const r = makeRng('cl', cx, cy, cz);
  if (r() < 0.12) c = null; else {
    const rich = r.logu(0.15, 2.4);
    c = { id: `cl:${cx}:${cy}:${cz}`, cx, cy, cz, rich, sigma: (2.0 + 3.2 * Math.sqrt(rich)) * Mpc * 0.55, pos: [(cx + r.range(0.15, 0.85)) * CLUSTER_CELL, (cy + r.range(0.15, 0.85)) * CLUSTER_CELL, (cz + r.range(0.15, 0.85)) * CLUSTER_CELL], name: properName(r) + ' Cluster' };
  }
  if (clusterCache.size > 4000) clusterCache.clear();
  clusterCache.set(key, c); return c;
}
export function nearbyClusters(p, radius) {
  const out = []; const r = Math.ceil(radius / CLUSTER_CELL);
  const cx = Math.floor(p[0] / CLUSTER_CELL), cy = Math.floor(p[1] / CLUSTER_CELL), cz = Math.floor(p[2] / CLUSTER_CELL);
  for (let z = -r; z <= r; z++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const c = clustersInCell(cx + x, cy + y, cz + z); if (c) out.push(c); }
  return out;
}
const SC = 1 / (30 * Mpc);
// relative galaxy density at a universe position (meters). ~1 in the field, large in clusters, tiny in voids.
export function webDensity(x, y, z) {
  const sx = x * SC, sy = y * SC, sz = z * SC;
  // filaments: ridge of low-freq noise
  const n1 = snoise(sx * 0.9 + 3.1, sy * 0.9, sz * 0.9 - 1.7), n2 = snoise(sx * 1.7 - 9, sy * 1.7 + 2, sz * 1.7);
  let fil = Math.pow(Math.max(0, 1 - Math.abs(n1) * 2.2), 3.0) * 2.6 + Math.pow(Math.max(0, 1 - Math.abs(n2) * 2.6), 3.0) * 1.6;
  const void_ = smooth(-0.55, 0.15, snoise(sx * 0.5 + 7, sy * 0.5 - 4, sz * 0.5 + 1));
  let d = (0.12 + fil) * (0.25 + 0.75 * void_);
  // clusters
  const cx = Math.floor(x / CLUSTER_CELL), cy = Math.floor(y / CLUSTER_CELL), cz = Math.floor(z / CLUSTER_CELL);
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const c = clustersInCell(cx + i, cy + j, cz + k); if (!c) continue;
    const dx = x - c.pos[0], dy = y - c.pos[1], dz = z - c.pos[2]; const r2 = (dx * dx + dy * dy + dz * dz) / (c.sigma * c.sigma);
    if (r2 < 30) d += c.rich * 14 * Math.exp(-r2 * 0.5);
  }
  return d;
}
export function clusterAt(x, y, z) { // strongest cluster influence (for membership display)
  let best = null, bv = 0.0; const cx = Math.floor(x / CLUSTER_CELL), cy = Math.floor(y / CLUSTER_CELL), cz = Math.floor(z / CLUSTER_CELL);
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const c = clustersInCell(cx + i, cy + j, cz + k); if (!c) continue;
    const dx = x - c.pos[0], dy = y - c.pos[1], dz = z - c.pos[2]; const v = Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * c.sigma * c.sigma * 4));
    if (v > bv) { bv = v; best = c; }
  }
  return bv > 0.08 ? best : null;
}

// ---- galaxy ---------------------------------------------------------------
export const GTYPES = {
  spiral: 'Spiral', barred: 'Barred spiral', elliptical: 'Elliptical', lenticular: 'Lenticular', irregular: 'Irregular', dwarf: 'Dwarf', ring: 'Ring', active: 'Active (Seyfert)',
};
const galCache = new Map();
export function galaxyAt(ix, iy, iz, k) {
  const id = `g:${ix}:${iy}:${iz}:${k}`; let g = galCache.get(id); if (g) return g;
  const r = makeRng('gal', ix, iy, iz, k);
  const pos = [(ix + r()) * CELL0, (iy + r()) * CELL0, (iz + r()) * CELL0];
  const dens = webDensity(pos[0], pos[1], pos[2]);
  const cl = clusterAt(pos[0], pos[1], pos[2]);
  const dense = clamp(dens / 6, 0, 1);
  const tr = r();
  let type;
  const pe = 0.12 + 0.55 * dense, pl = 0.08 + 0.1 * dense;
  if (tr < pe) type = 'elliptical'; else if (tr < pe + pl) type = 'lenticular'; else if (tr < pe + pl + 0.18) type = 'dwarf'; else if (tr < pe + pl + 0.18 + 0.07) type = 'irregular';
  else { const t2 = r(); type = t2 < 0.45 ? 'barred' : t2 < 0.55 ? 'ring' : t2 < 0.62 ? 'active' : 'spiral'; }
  const spiralLike = type === 'spiral' || type === 'barred' || type === 'ring' || type === 'active';
  let Rk; // kpc
  switch (type) {
    case 'elliptical': Rk = r.logu(6, 40) * (1 + dense * 0.8); break;
    case 'lenticular': Rk = r.logu(8, 28); break;
    case 'dwarf': Rk = r.logu(1.2, 5); break;
    case 'irregular': Rk = r.logu(3, 14); break;
    default: Rk = r.logu(10, 42);
  }
  const boost = 1.8; // fictional enlargement for explorability
  const radius = Rk * boost * C.KPC;
  const g_ = {
    id, kind: 'galaxy', ix, iy, iz, k, pos, type, spiralLike, seed: seedOf('galaxy', ix, iy, iz, k),
    radius, Rkpc: Rk * boost, name: galaxyName(r), clusterId: cl ? cl.id : null, clusterName: cl ? cl.name : null,
    orient: qfromEuler(r.range(0, TAU), r.range(0, Math.PI), r.range(0, TAU)),
    arms: spiralLike ? r.weighted([[2, 6], [3, 2], [4, 2], [5, 0.4], [6, 0.1]]) : 0,
    pitch: r.range(9, 30) * Math.PI / 180, armSharp: r.range(0.35, 0.9), bar: type === 'barred' ? r.range(0.18, 0.38) : type === 'active' && r() < 0.5 ? r.range(0.1, 0.2) : 0,
    bulge: type === 'elliptical' ? 1 : spiralLike ? r.range(0.08, 0.3) : type === 'lenticular' ? r.range(0.3, 0.55) : 0.05,
    thick: type === 'elliptical' ? 1 : type === 'dwarf' || type === 'irregular' ? r.range(0.25, 0.6) : r.range(0.015, 0.035) * (type === 'lenticular' ? 2 : 1),
    ellip: type === 'elliptical' ? [r.range(0.55, 1), r.range(0.5, 1)] : [1, 1],
    ringR: type === 'ring' ? r.range(0.5, 0.75) : 0,
    age: r.range(2, 13.4), met: r.range(0.2, 1.8), sfr: spiralLike ? r.logu(0.2, 14) : type === 'irregular' ? r.logu(0.05, 2) : r.logu(0.001, 0.2),
    hue: r(), dust: spiralLike ? r.range(0.4, 1) : type === 'lenticular' ? 0.3 : 0.05,
    smbhLog: clamp(5.2 + Math.log10(Rk) * 1.6 + r.gauss() * 0.7 + (type === 'elliptical' ? 1 : 0) - (type === 'dwarf' ? 1.5 : 0), 3.5, 10.3),
    agn: type === 'active' || (type === 'elliptical' && r() < 0.12) || r() < 0.02,
    jets: false, vel: v3.zero(),
  };
  g_.jets = g_.agn && r() < 0.6;
  g_.mass = Math.pow(10, 9.6 + 2.2 * Math.log10(Rk / 12 + 0.05) + r.gauss() * 0.25 + (type === 'elliptical' ? 0.5 : 0)) * C.MSUN;
  g_.stars = g_.mass / C.MSUN / (type === 'elliptical' ? 1.2 : 1.6);
  g_.distLy = 0;
  if (galCache.size > 6000) galCache.clear();
  galCache.set(id, g_); return g_;
}
export function galaxiesInCell(ix, iy, iz) {
  // expected count from density (acceptance sampled)
  const r = makeRng('gcell', ix, iy, iz); const out = [];
  const cpos = [(ix + 0.5) * CELL0, (iy + 0.5) * CELL0, (iz + 0.5) * CELL0];
  const d = webDensity(cpos[0], cpos[1], cpos[2]);
  const lam = clamp(d * 0.22, 0, 6.5);
  let n = Math.floor(lam); if (r() < lam - n) n++;
  for (let k = 0; k < n; k++) out.push(galaxyAt(ix, iy, iz, k));
  return out;
}
export function galaxyById(id) {
  const p = id.split(':'); return galaxyAt(+p[1], +p[2], +p[3], +p[4]);
}
// tier-1 far-field dust points around p (meters). Returns Float32 positions rel to origin + brightness.
export function farFieldCell(cx, cy, cz, out, o) {
  const r = makeRng('far', cx, cy, cz); const M = 70;
  for (let i = 0; i < M; i++) {
    const x = (cx + r()) * CELL1, y = (cy + r()) * CELL1, z = (cz + r()) * CELL1;
    const d = webDensity(x, y, z);
    const a = clamp(d * 0.5, 0, 1);
    if (r() > a * 0.9) continue;
    out.push(x, y, z, 0.35 + r() * 0.65 * (d > 3 ? 1 : 0.5));
  }
}
