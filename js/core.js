// Core constants, deterministic RNG, small double-precision vector helpers, Kepler solver.
export const C = {
  AU: 1.495978707e11, PC: 3.0856775814913673e16, KPC: 3.0856775814913673e19, MPC: 3.0856775814913673e22,
  RSUN: 6.957e8, MSUN: 1.98847e30, LSUN: 3.828e26, REARTH: 6.371e6, MEARTH: 5.972e24,
  RJUP: 7.1492e7, MJUP: 1.898e27, G: 6.6743e-11, c: 299792458, YEAR: 3.15576e7, DAY: 86400,
  SIGMA: 5.670374e-8, TSUN: 5772, ZERO_K: 0,
};
export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- hashing / RNG -------------------------------------------------------
export function mix32(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
export function seedOf(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) {
    if (typeof p === 'string') { for (let i = 0; i < p.length; i++) h = mix32(h ^ Math.imul(p.charCodeAt(i) + 1, 0x85ebca6b)); }
    else { const n = Math.floor(p); h = mix32(h ^ mix32((n | 0) + 0x632be5ab)); h = mix32(h + mix32((Math.floor(n / 4294967296) | 0) ^ 0x2545f491)); }
  }
  return h >>> 0;
}
export function makeRng(...parts) {
  let a = seedOf(...parts), b = mix32(a ^ 0xdeadbeef), c = mix32(b + 0x1234567), d = mix32(c ^ 0x7f4a7c15);
  const next = () => { // sfc32
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0;
    const r = (t + d) | 0; c = (c + r) | 0; return (r >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.chance = (p) => next() < p;
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += next(); return (u - 2) * 1.7320508; };
  next.logu = (lo, hi) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * next());
  next.weighted = (items) => { let t = 0; for (const [, w] of items) t += w; let r = next() * t; for (const [v, w] of items) { r -= w; if (r <= 0) return v; } return items[items.length - 1][0]; };
  next.unitVec = () => { const z = next() * 2 - 1, t = next() * TAU, s = Math.sqrt(1 - z * z); return [s * Math.cos(t), s * Math.sin(t), z]; };
  return next;
}

// ---- tiny vec3 on plain arrays (doubles) --------------------------------
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  madd: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  zero: () => [0, 0, 0],
};
// rotate vector by quaternion [x,y,z,w]
export function qrot(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
export function qconj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
export function qfromAxisAngle(ax, ang) { const s = Math.sin(ang / 2); const n = v3.norm(ax); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(ang / 2)]; }
export function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
export function qfromEuler(rx, ry, rz) { // Z * X * Y style, enough for random orientations
  return qmul(qfromAxisAngle([0, 0, 1], rz), qmul(qfromAxisAngle([1, 0, 0], rx), qfromAxisAngle([0, 1, 0], ry)));
}

// ---- Kepler -------------------------------------------------------------
export function solveKepler(M, e) {
  M = ((M % TAU) + TAU) % TAU;
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 12; i++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-10) break; }
  return E;
}
// orbit: {a,e,inc,node,argp,M0,P}; returns position [x,y,z] relative to the focus. Orbital plane = XZ-ish with Y up.
export function orbitPos(o, t, out) {
  const M = o.M0 + TAU * (t / o.P);
  const E = solveKepler(M, o.e);
  const cE = Math.cos(E), sE = Math.sin(E), b = Math.sqrt(1 - o.e * o.e);
  const x = o.a * (cE - o.e), z = o.a * b * sE;
  const cw = Math.cos(o.argp), sw = Math.sin(o.argp), cO = Math.cos(o.node), sO = Math.sin(o.node), ci = Math.cos(o.inc), si = Math.sin(o.inc);
  // rotate by argp about Y(normal), then incline about X, then node about Y
  const x1 = x * cw - z * sw, z1 = x * sw + z * cw;
  const y2 = -z1 * si, z2 = z1 * ci;
  const X = x1 * cO + z2 * sO, Z = -x1 * sO + z2 * cO;
  if (out) { out[0] = X; out[1] = y2; out[2] = Z; return out; }
  return [X, y2, Z];
}
export function orbitVel(o, t) { // finite difference velocity (m/s)
  const dt = Math.max(1, o.P * 1e-5);
  const a = orbitPos(o, t - dt), b = orbitPos(o, t + dt);
  return [(b[0] - a[0]) / (2 * dt), (b[1] - a[1]) / (2 * dt), (b[2] - a[2]) / (2 * dt)];
}
// blackbody colour (linear sRGB-ish, normalised to max 1) for temperature T
export function blackbody(T) {
  T = clamp(T, 800, 60000) / 100; let r, g, b;
  if (T <= 66) { r = 255; g = 99.4708025861 * Math.log(T) - 161.1195681661; } else { r = 329.698727446 * Math.pow(T - 60, -0.1332047592); g = 288.1221695283 * Math.pow(T - 60, -0.0755148492); }
  if (T >= 66) b = 255; else if (T <= 19) b = 0; else b = 138.5177312231 * Math.log(T - 10) - 305.0447927307;
  const f = (v) => Math.pow(clamp(v, 0, 255) / 255, 2.2);
  return [f(r), f(g), f(b)];
}
// ---- formatting ---------------------------------------------------------
export function fmtSci(x, d = 2) { if (x === 0) return '0'; const e = Math.floor(Math.log10(Math.abs(x))); if (e > -3 && e < 5) return (+x.toPrecision(d + 1)).toLocaleString('en-US', { maximumFractionDigits: 6 }); return (x / Math.pow(10, e)).toFixed(d) + '×10' + String(e).replace(/-/g, '⁻').replace(/\d/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]); }
export function fmtDist(m) {
  const a = Math.abs(m);
  if (a < 1e3) return m.toFixed(a < 10 ? 2 : 0) + ' m';
  if (a < 1e7) return (m / 1e3).toFixed(a < 1e4 ? 2 : 1) + ' km';
  if (a < 0.05 * C.AU) return fmtSci(m / 1e3, 2) + ' km';
  if (a < 0.02 * C.PC) return (m / C.AU).toFixed(a < C.AU ? 3 : 1) + ' AU';
  if (a < 0.2 * C.KPC) return (m / C.PC).toFixed(a < 10 * C.PC ? 3 : 1) + ' pc';
  if (a < 0.2 * C.MPC) return (m / C.KPC).toFixed(2) + ' kpc';
  return (m / C.MPC).toFixed(2) + ' Mpc';
}
export function fmtTime(s) {
  const a = Math.abs(s);
  if (a < 120) return s.toFixed(1) + ' s';
  if (a < 7200) return (s / 60).toFixed(1) + ' min';
  if (a < 172800) return (s / 3600).toFixed(1) + ' h';
  if (a < C.YEAR * 2) return (s / C.DAY).toFixed(1) + ' d';
  if (a < C.YEAR * 1e4) return (s / C.YEAR).toFixed(2) + ' yr';
  return fmtSci(s / C.YEAR, 2) + ' yr';
}
export function fmtMass(kg) {
  const a = kg;
  if (a < 1e22) return fmtSci(kg, 2) + ' kg';
  if (a < 0.1 * C.MEARTH * 100) return (kg / C.MEARTH).toFixed(3) + ' M⊕';
  if (a < 0.08 * C.MSUN) return (kg / C.MJUP).toFixed(2) + ' M♃';
  if (a < 1e6 * C.MSUN) return (kg / C.MSUN).toFixed(2) + ' M☉';
  return fmtSci(kg / C.MSUN, 2) + ' M☉';
}
export function fmtRadius(m) {
  if (m < 5e5) return (m / 1e3).toFixed(m < 1e4 ? 1 : 0) + ' km';
  if (m < 0.3 * C.RJUP) return (m / C.REARTH).toFixed(2) + ' R⊕ (' + Math.round(m / 1e3).toLocaleString('en-US') + ' km)';
  if (m < 0.2 * C.RSUN) return (m / C.RJUP).toFixed(2) + ' R♃';
  if (m < 1e3 * C.RSUN) return (m / C.RSUN).toFixed(m < 5 * C.RSUN ? 3 : 1) + ' R☉';
  if (m < 0.01 * C.PC) return (m / C.AU).toFixed(3) + ' AU';
  return fmtDist(m);
}
