// Procedural terrain height function + cube-sphere chunk builder (runs in worker AND main thread for collision queries).
import { snoise, fbm, ridged, craters } from './noise.js';

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
// T: {seed,type,radius,amp,contFreq,mountFreq,mountAmp,craterDensity,craterAmp,seaLevel,irregular,axes:[sx,sy,sz],rough,ridgeW,terrace}
// returns signed height in metres relative to the reference radius (before sea clamp).
export function terrainHeight(T, x, y, z) {
  const so = T.seed * 0.0137; // domain offset per planet
  let h = 0;
  if (T.irregular > 0) { // lumpy small body
    const n = fbm(x * 1.3 + so, y * 1.3 + so, z * 1.3 + so, 4, 2.1, 0.5);
    h += n * T.irregular * T.radius;
  }
  if (T.contAmp) {
    const wx = fbm(x * 0.9 + so + 11, y * 0.9 + so, z * 0.9 + so, 3) * 0.35, wy = fbm(x * 0.9 + so, y * 0.9 + so + 5, z * 0.9 + so, 3) * 0.35, wz = fbm(x * 0.9 + so - 8, y * 0.9 + so, z * 0.9 + so + 3, 3) * 0.35;
    const cx = x + wx, cy = y + wy, cz = z + wz;
    const c = fbm(cx * T.contFreq + so, cy * T.contFreq + so, cz * T.contFreq + so, 6, 2.0, 0.5);
    let land = c * T.contAmp;
    // mountains: ridged noise masked to land / highlands
    const m = ridged(cx * T.mountFreq + so, cy * T.mountFreq + so, cz * T.mountFreq + so, 6, 2.15, 0.52);
    const mask = Math.min(1, Math.max(0, (c - T.mountMask) * 3));
    land += m * T.mountAmp * (0.15 + 0.85 * mask) * (T.ridgeW);
    // fine rolling detail
    land += fbm(x * 42 + so, y * 42 + so, z * 42 + so, 4, 2.0, 0.5) * T.rough;
    if (T.terrace) { const s = T.terrace; land = Math.round(land / s) * s * 0.55 + land * 0.45; }
    h += land;
  }
  if (T.craterDensity > 0) {
    const ca = T.craterAmp;
    h += craters(x * 3.2, y * 3.2, z * 3.2, T.seed | 0, T.craterDensity * 0.9) * ca * 1.6;
    h += craters(x * 9 + 3, y * 9, z * 9, (T.seed | 0) + 1, T.craterDensity) * ca * 0.55;
    h += craters(x * 27, y * 27 + 2, z * 27, (T.seed | 0) + 2, T.craterDensity * 1.2) * ca * 0.16;
    h += craters(x * 80, y * 80, z * 80 + 1, (T.seed | 0) + 3, T.craterDensity * 1.4) * ca * 0.045;
  }
  return h;
}
// full surface radius (metres) at direction d, including clamp to sea level
export function surfaceRadius(T, dx, dy, dz) {
  let ax = 1, ay = 1, az = 1; if (T.axes) { ax = T.axes[0]; ay = T.axes[1]; az = T.axes[2]; }
  const h = terrainHeight(T, dx, dy, dz);
  const hs = Math.max(h, T.seaLevel);
  const k = 1 + 0; // scale axes only for irregular bodies
  return { r: T.radius + hs, h, ax, ay, az, k };
}
const _d = [0, 0, 0];
export function buildChunk(T, face, level, ci, cj) {
  const N = CHUNK_N, n = 1 << level, G = N + 2; // padded grid for normals
  const u0 = -1 + 2 * ci / n, v0 = -1 + 2 * cj / n, du = 2 / n / (N - 1);
  const grid = new Float64Array(G * G * 3), hts = new Float64Array(G * G), dirs = new Float32Array(G * G * 3);
  const ax = T.axes ? T.axes : [1, 1, 1];
  const sea = T.seaLevel;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const u = u0 + (i - 1) * du, v = v0 + (j - 1) * du; faceDir(face, u, v, _d);
    const h = terrainHeight(T, _d[0], _d[1], _d[2]); const hc = h > sea ? h : sea; const r = T.radius + hc; const k = j * G + i;
    grid[k * 3] = _d[0] * r * ax[0]; grid[k * 3 + 1] = _d[1] * r * ax[1]; grid[k * 3 + 2] = _d[2] * r * ax[2]; hts[k] = h - sea;
    dirs[k * 3] = _d[0]; dirs[k * 3 + 1] = _d[1]; dirs[k * 3 + 2] = _d[2];
  }
  // chunk centre: middle vertex (base radius)
  faceDir(face, u0 + 1 / n, v0 + 1 / n, _d);
  const cr = T.radius; const cx = _d[0] * cr * ax[0], cy = _d[1] * cr * ax[1], cz = _d[2] * cr * ax[2];
  const total = N * N + 4 * N; const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), dir = new Float32Array(total * 3), elev = new Float32Array(total);
  const skirt = T.radius * (2 / n) * 0.06 + 2;
  let minH = 1e30, maxH = -1e30;
  const put = (idx, gi, gj, drop) => {
    const k = (gj + 1) * G + (gi + 1);
    // normal from neighbours
    const kx0 = k - 1, kx1 = k + 1, ky0 = k - G, ky1 = k + G;
    const tx = grid[kx1 * 3] - grid[kx0 * 3], ty = grid[kx1 * 3 + 1] - grid[kx0 * 3 + 1], tz = grid[kx1 * 3 + 2] - grid[kx0 * 3 + 2];
    const bx = grid[ky1 * 3] - grid[ky0 * 3], by = grid[ky1 * 3 + 1] - grid[ky0 * 3 + 1], bz = grid[ky1 * 3 + 2] - grid[ky0 * 3 + 2];
    let nx = ty * bz - tz * by, ny = tz * bx - tx * bz, nz = tx * by - ty * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // ensure outward
    const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2]; if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    pos[idx * 3] = grid[k * 3] - cx - dx * drop; pos[idx * 3 + 1] = grid[k * 3 + 1] - cy - dy * drop; pos[idx * 3 + 2] = grid[k * 3 + 2] - cz - dz * drop;
    nrm[idx * 3] = nx; nrm[idx * 3 + 1] = ny; nrm[idx * 3 + 2] = nz; dir[idx * 3] = dx; dir[idx * 3 + 1] = dy; dir[idx * 3 + 2] = dz; elev[idx] = hts[k];
    if (hts[k] < minH) minH = hts[k]; if (hts[k] > maxH) maxH = hts[k];
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) put(j * N + i, i, j, 0);
  let s = N * N;
  for (let i = 0; i < N; i++) put(s + i, i, 0, skirt);               // bottom
  for (let i = 0; i < N; i++) put(s + N + i, i, N - 1, skirt);       // top
  for (let j = 0; j < N; j++) put(s + 2 * N + j, 0, j, skirt);       // left
  for (let j = 0; j < N; j++) put(s + 3 * N + j, N - 1, j, skirt);   // right
  return { pos, nrm, dir, elev, center: [cx, cy, cz], minH, maxH };
}
export function chunkIndices() { // shared topology
  const N = CHUNK_N, idx = []; 
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i, b = a + 1, c = a + N, d = c + 1; idx.push(a, b, c, b, d, c); }
  const s = N * N; // skirts: bottom(0) top(1) left(2) right(3)
  for (let i = 0; i < N - 1; i++) { // bottom row j=0
    const a = i, b = i + 1, sa = s + i, sb = s + i + 1; idx.push(a, sa, b, b, sa, sb);
    const t = (N - 1) * N + i, t2 = t + 1, ta = s + N + i, tb = s + N + i + 1; idx.push(t, t2, ta, t2, tb, ta);
  }
  for (let j = 0; j < N - 1; j++) {
    const a = j * N, b = (j + 1) * N, sa = s + 2 * N + j, sb = s + 2 * N + j + 1; idx.push(a, b, sa, b, sb, sa);
    const r = j * N + N - 1, r2 = (j + 1) * N + N - 1, ra = s + 3 * N + j, rb = s + 3 * N + j + 1; idx.push(r, ra, r2, r2, ra, rb);
  }
  return new Uint16Array(idx);
}
