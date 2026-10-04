// Procedural terrain height function + cube-sphere chunk builder (runs in worker AND main thread for collision queries).
import { snoise, fbm, ridged, craters, cellular, volcanoes } from './noise.js';

export const CHUNK_N = 33; // vertices per side
const FACES = [ // [normal, right, up]
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
export function faceDir(face, u, v, out) { // u,v in [-1,1]
  const [n, r, up] = FACES[face]; const a = Math.tan(u * Math.PI / 4), b = Math.tan(v * Math.PI / 4);
  const x = n[0] + r[0] * a + up[0] * b, y = n[1] + r[1] * a + up[1] * b, z = n[2] + r[2] * a + up[2] * b; const l = Math.hypot(x, y, z);
  out[0] = x / l; out[1] = y / l; out[2] = z / l; return out;
}
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const cl01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// Per-call feature outputs (read right after terrainHeight): river / lake / lava-caldera masks in 0..1.
export const FEAT = { river: 0, lake: 0 };

// T: terrain parameter set (see gen/system.js). Returns signed height in metres relative to the reference radius.
export function terrainHeight(T, x, y, z) {
  FEAT.river = 0; FEAT.lake = 0;
  const so = T.seed * 0.0137; let h = 0; const R = T.radius;
  if (T.irregular > 0) h += fbm(x * 1.3 + so, y * 1.3 + so, z * 1.3 + so, 4, 2.1, 0.5) * T.irregular * R;
  if (T.contAmp) {
    const wr = T.warp === undefined ? 0.35 : T.warp;
    const wx = fbm(x * 0.9 + so + 11, y * 0.9 + so, z * 0.9 + so, 2) * wr, wy = fbm(x * 0.9 + so, y * 0.9 + so + 5, z * 0.9 + so, 2) * wr, wz = fbm(x * 0.9 + so - 8, y * 0.9 + so, z * 0.9 + so + 3, 2) * wr;
    const cx = x + wx, cy = y + wy, cz = z + wz, cf = T.contFreq;
    const c = fbm(cx * cf + so, cy * cf + so, cz * cf + so, 6, 2.0, 0.5);
    let land = c * T.contAmp;
    const mask = cl01((c - T.mountMask) * 3);
    land += ridged(cx * T.mountFreq + so, cy * T.mountFreq + so, cz * T.mountFreq + so, 5, 2.15, 0.52) * T.mountAmp * (0.15 + 0.85 * mask) * T.ridgeW;
    if (T.chainAmp > 0) { // tectonic ranges along plate boundaries
      const pf = T.plateFreq || 2.2; const v = cellular(cx * pf + so, cy * pf + so, cz * pf + so, T.seed | 0);
      const b = 1 - sm(0, 0.24, v[1] - v[0]); const rr = ridged(cx * 9 + so, cy * 9 + so, cz * 9 + so, 4, 2.1, 0.5);
      land += b * b * (0.35 + 0.9 * rr) * T.chainAmp * (0.25 + 0.75 * mask);
    }
    land += fbm(x * 42 + so, y * 42 + so, z * 42 + so, 3, 2.0, 0.5) * T.rough;
    if (T.terrace) { const s = T.terrace; land = Math.round(land / s) * s * 0.55 + land * 0.45; }
    const above = cl01((land - T.seaLevel) / (T.relief * 0.22 + 1));
    if (above > 0) {
      if (T.riverAmp > 0) { // meandering valleys with a narrow channel
        const rf = T.riverFreq || 5, w = T.riverW || 0.028;
        const n = Math.abs(fbm(cx * rf + so + 31, cy * rf + so + 7, cz * rf + so + 13, 3, 2.0, 0.5));
        const ch = 1 - sm(0, w, n), valley = 1 - sm(0, w * 4.5, n);
        land -= (valley * 0.4 + ch * 0.6) * T.riverAmp * above;
        FEAT.river = ch * cl01(above * 5);
      }
      if (T.canyonAmp > 0) { // steep ravines / canyon systems
        const cf2 = T.canyonFreq || 3, cw = T.canyonW || 0.03;
        const n = Math.abs(fbm(cx * cf2 + so + 55, cy * cf2 + so + 22, cz * cf2 + so + 9, 3, 2.0, 0.5));
        const can = 1 - sm(0, cw, n); land -= Math.pow(can, 0.7) * T.canyonAmp * cl01(above * 3) * (0.55 + 0.45 * mask);
        if (T.canyonFill) FEAT.river = Math.max(FEAT.river, can * can * cl01(above * 4));
      }
      if (T.lakeAmp > 0) { // flat-bottomed basins
        const bn = fbm(cx * (T.lakeFreq || 3) + so + 77, cy * (T.lakeFreq || 3) + so, cz * (T.lakeFreq || 3) + so + 19, 3, 2.0, 0.5);
        const thr = T.lakeThr || 0.22; const lm = sm(thr, thr + 0.07, bn) * cl01(above * 3);
        if (lm > 0) { const lvl = T.seaLevel + T.lakeLevel; land = land * (1 - lm) + (lvl - T.lakeAmp * 0.2) * lm; FEAT.lake = lm; }
      }
    }
    h += land;
  }
  if (T.volcDensity > 0) {
    const vf = T.volcFreq || 5; const v = volcanoes(x * vf + so, y * vf + so, z * vf + so, T.seed | 0, T.volcDensity);
    h += v * T.volcAmp; if (volcanoes.cal && T.lavaCaldera) FEAT.lake = 1;
  }
  if (T.craterDensity > 0) {
    const ca = T.craterAmp, cd = T.craterDensity;
    h += craters(x * 1.7, y * 1.7, z * 1.7, (T.seed | 0) + 5, cd * 0.35) * ca * 3.2; // old multi-km basins
    h += craters(x * 3.2, y * 3.2, z * 3.2, T.seed | 0, cd * 0.9) * ca * 1.6;
    h += craters(x * 9 + 3, y * 9, z * 9, (T.seed | 0) + 1, cd) * ca * 0.55;
    h += craters(x * 27, y * 27 + 2, z * 27, (T.seed | 0) + 2, cd * 1.2) * ca * 0.16;
    h += craters(x * 80, y * 80, z * 80 + 1, (T.seed | 0) + 3, cd * 1.4) * ca * 0.045;
  }
  return h;
}
export function surfaceRadius(T, dx, dy, dz) { const h = terrainHeight(T, dx, dy, dz); return T.radius + Math.max(h, T.seaLevel); }

const _d = [0, 0, 0];
export function buildChunk(T, face, level, ci, cj) {
  const N = CHUNK_N, n = 1 << level, G = N + 2;
  const u0 = -1 + 2 * ci / n, v0 = -1 + 2 * cj / n, du = 2 / n / (N - 1);
  const grid = new Float64Array(G * G * 3), hts = new Float64Array(G * G), dirs = new Float32Array(G * G * 3), riv = new Float32Array(G * G), lak = new Float32Array(G * G);
  const ax = T.axes ? T.axes : [1, 1, 1]; const sea = T.seaLevel;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const u = u0 + (i - 1) * du, v = v0 + (j - 1) * du; faceDir(face, u, v, _d);
    const h = terrainHeight(T, _d[0], _d[1], _d[2]); const hc = h > sea ? h : sea; const r = T.radius + hc; const k = j * G + i;
    grid[k * 3] = _d[0] * r * ax[0]; grid[k * 3 + 1] = _d[1] * r * ax[1]; grid[k * 3 + 2] = _d[2] * r * ax[2]; hts[k] = h - sea;
    dirs[k * 3] = _d[0]; dirs[k * 3 + 1] = _d[1]; dirs[k * 3 + 2] = _d[2]; riv[k] = FEAT.river; lak[k] = FEAT.lake;
  }
  faceDir(face, u0 + 1 / n, v0 + 1 / n, _d);
  const cr = T.radius; const cx = _d[0] * cr * ax[0], cy = _d[1] * cr * ax[1], cz = _d[2] * cr * ax[2];
  const total = N * N + 4 * N; const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), dir = new Float32Array(total * 3), aux = new Float32Array(total * 3);
  const skirt = T.radius * (2 / n) * 0.06 + 2; let minH = 1e30, maxH = -1e30;
  const put = (idx, gi, gj, drop) => {
    const k = (gj + 1) * G + (gi + 1); const kx0 = k - 1, kx1 = k + 1, ky0 = k - G, ky1 = k + G;
    const tx = grid[kx1 * 3] - grid[kx0 * 3], ty = grid[kx1 * 3 + 1] - grid[kx0 * 3 + 1], tz = grid[kx1 * 3 + 2] - grid[kx0 * 3 + 2];
    const bx = grid[ky1 * 3] - grid[ky0 * 3], by = grid[ky1 * 3 + 1] - grid[ky0 * 3 + 1], bz = grid[ky1 * 3 + 2] - grid[ky0 * 3 + 2];
    let nx = ty * bz - tz * by, ny = tz * bx - tx * bz, nz = tx * by - ty * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2]; if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    pos[idx * 3] = grid[k * 3] - cx - dx * drop; pos[idx * 3 + 1] = grid[k * 3 + 1] - cy - dy * drop; pos[idx * 3 + 2] = grid[k * 3 + 2] - cz - dz * drop;
    nrm[idx * 3] = nx; nrm[idx * 3 + 1] = ny; nrm[idx * 3 + 2] = nz; dir[idx * 3] = dx; dir[idx * 3 + 1] = dy; dir[idx * 3 + 2] = dz;
    aux[idx * 3] = hts[k]; aux[idx * 3 + 1] = riv[k]; aux[idx * 3 + 2] = lak[k];
    if (hts[k] < minH) minH = hts[k]; if (hts[k] > maxH) maxH = hts[k];
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) put(j * N + i, i, j, 0);
  const s = N * N;
  for (let i = 0; i < N; i++) put(s + i, i, 0, skirt);
  for (let i = 0; i < N; i++) put(s + N + i, i, N - 1, skirt);
  for (let j = 0; j < N; j++) put(s + 2 * N + j, 0, j, skirt);
  for (let j = 0; j < N; j++) put(s + 3 * N + j, N - 1, j, skirt);
  return { pos, nrm, dir, aux, center: [cx, cy, cz], minH, maxH };
}
export function chunkIndices() {
  const N = CHUNK_N, idx = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i, b = a + 1, c = a + N, d = c + 1; idx.push(a, b, c, b, d, c); }
  const s = N * N;
  for (let i = 0; i < N - 1; i++) {
    const a = i, b = i + 1, sa = s + i, sb = s + i + 1; idx.push(a, sa, b, b, sa, sb);
    const t = (N - 1) * N + i, t2 = t + 1, ta = s + N + i, tb = s + N + i + 1; idx.push(t, t2, ta, t2, tb, ta);
  }
  for (let j = 0; j < N - 1; j++) {
    const a = j * N, b = (j + 1) * N, sa = s + 2 * N + j, sb = s + 2 * N + j + 1; idx.push(a, b, sa, b, sb, sa);
    const r = j * N + N - 1, r2 = (j + 1) * N + N - 1, ra = s + 3 * N + j, rb = s + 3 * N + j + 1; idx.push(r, ra, r2, r2, ra, rb);
  }
  return new Uint16Array(idx);
}
