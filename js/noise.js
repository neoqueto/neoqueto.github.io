// CPU-side noise (shared by the main thread and the terrain worker). Deterministic, seedless; seeds are applied as domain offsets.
const perm = new Uint8Array(512);
(() => { // fixed permutation (mulberry32 shuffle)
  const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  let s = 0x1badf00d; const r = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();
const G3 = new Float32Array([1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1]);
const F3 = 1 / 3, G3c = 1 / 6;
export function snoise(x, y, z) { // simplex 3D, ~[-1,1]
  const s = (x + y + z) * F3; const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * G3c; const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
  else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
  const x1 = x0 - i1 + G3c, y1 = y0 - j1 + G3c, z1 = z0 - k1 + G3c, x2 = x0 - i2 + 2 * G3c, y2 = y0 - j2 + 2 * G3c, z2 = z0 - k2 + 2 * G3c, x3 = x0 - 1 + 3 * G3c, y3 = y0 - 1 + 3 * G3c, z3 = z0 - 1 + 3 * G3c;
  const ii = i & 255, jj = j & 255, kk = k & 255; let n = 0, tt;
  tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0; if (tt > 0) { const g = (perm[ii + perm[jj + perm[kk]]] % 12) * 3; tt *= tt; n += tt * tt * (G3[g] * x0 + G3[g + 1] * y0 + G3[g + 2] * z0); }
  tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1; if (tt > 0) { const g = (perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12) * 3; tt *= tt; n += tt * tt * (G3[g] * x1 + G3[g + 1] * y1 + G3[g + 2] * z1); }
  tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2; if (tt > 0) { const g = (perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12) * 3; tt *= tt; n += tt * tt * (G3[g] * x2 + G3[g + 1] * y2 + G3[g + 2] * z2); }
  tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3; if (tt > 0) { const g = (perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12) * 3; tt *= tt; n += tt * tt * (G3[g] * x3 + G3[g + 1] * y3 + G3[g + 2] * z3); }
  return 32 * n;
}
export function fbm(x, y, z, oct, lac = 2.0, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * snoise(x * f, y * f, z * f); n += a; a *= gain; f *= lac; }
  return s / n;
}
export function ridged(x, y, z, oct, lac = 2.1, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0, w = 1;
  for (let i = 0; i < oct; i++) { let v = 1 - Math.abs(snoise(x * f, y * f, z * f)); v *= v; v *= w; w = Math.min(1, Math.max(0, v * 2)); s += a * v; n += a; a *= gain; f *= lac; }
  return s / n;
}
function ihash(x, y, z, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0;
}
// Crater field: returns height contribution (negative bowls, positive rims) in "radius units" (±1). p scaled so cell size == 1.
export function craters(x, y, z, seed, density) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let h = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy, cz = iz + dz; const hh = ihash(cx, cy, cz, seed);
    if ((hh & 1023) / 1023 > density) continue;
    const px = cx + ((hh >>> 10) & 255) / 255, py = cy + ((hh >>> 18) & 255) / 255, pz = cz + (ihash(cx, cy, cz, seed + 7) & 255) / 255;
    const r = 0.18 + 0.32 * (((hh >>> 4) & 255) / 255) ** 2;
    const d = Math.hypot(x - px, y - py, z - pz) / r; if (d > 1.6) continue;
    const size = r;
    const bowl = d < 1 ? -(1 - d * d) * (1 - 0.35 * Math.exp(-d * d * 18)) : 0; // flat-ish floor w/ central peak
    const rim = Math.exp(-((d - 1.05) * (d - 1.05)) * 28) * 0.28;
    h += (bowl + rim) * size * (0.5 + 0.5 * ((hh >>> 22) & 255) / 255);
  }
  return h;
}

// Cellular noise: returns [F1, F2] (distances in cell units) for the 3x3x3 neighbourhood.
const _cel = [0, 0];
export function cellular(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let f1 = 9, f2 = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy, cz = iz + dz; const h = ihash(cx, cy, cz, seed + 91);
    const px = cx + (h & 255) / 255, py = cy + ((h >>> 8) & 255) / 255, pz = cz + ((h >>> 16) & 255) / 255;
    const d = Math.hypot(x - px, y - py, z - pz);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  _cel[0] = f1; _cel[1] = f2; return _cel;
}
// Volcanoes: cones and shields with calderas on a jittered grid. Returns height in "height units" (0..1);
// volcanoes.cal is set to 1 where the point lies inside a caldera.
export function volcanoes(x, y, z, seed, density) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let h = 0; volcanoes.cal = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy, cz = iz + dz; const hh = ihash(cx, cy, cz, seed + 311);
    if ((hh & 1023) / 1023 > density) continue;
    const px = cx + ((hh >>> 10) & 255) / 255, py = cy + ((hh >>> 18) & 255) / 255, pz = cz + (ihash(cx, cy, cz, seed + 313) & 255) / 255;
    const r = 0.2 + 0.28 * (((hh >>> 4) & 63) / 63); const d = Math.hypot(x - px, y - py, z - pz) / r; if (d >= 1) continue;
    const shield = (hh >>> 30) & 1;
    let v = shield ? (1 - d * d) * 0.55 : Math.pow(1 - d, 1.35);
    const cr = shield ? 0.12 : 0.15;
    if (d < cr) { const dip = 1 - d / cr; v -= dip * (shield ? 0.12 : 0.3); if (dip > 0.15) volcanoes.cal = 1; }
    if (v > h) h = v;
  }
  return h;
}
