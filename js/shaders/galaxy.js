import { wgslFn } from 'three/tsl';
import { LIB } from './lib.js';

export const CLOUDFRAG = wgslFn(`
fn cloudPt(q: vec2<f32>, c: vec3<f32>) -> vec4<f32> {
  let r2 = dot(q, q); if (r2 > 1.0) { return vec4<f32>(0.0); }
  let a = exp(-r2 * 3.4) * (1.0 - r2 * 0.4);
  return vec4<f32>(c * a, 1.0);
}`);
export const DUSTFRAG = wgslFn(`
fn dustPt(q: vec2<f32>, o: f32) -> vec4<f32> {
  let r2 = dot(q, q); if (r2 > 1.0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  let a = exp(-r2 * 2.6) * o;
  return vec4<f32>(0.0, 0.0, 0.0, 1.0 - clamp(a, 0.0, 0.95));
}`);
export const STARPT = wgslFn(`
fn starPt(q: vec2<f32>, c: vec3<f32>, spike: f32) -> vec4<f32> {
  let r2 = dot(q, q); if (r2 > 1.0) { return vec4<f32>(0.0); }
  let core = exp(-r2 * 14.0); let halo = exp(-r2 * 3.0) * 0.18;
  let ax = abs(q.x); let ay = abs(q.y);
  let sp = (exp(-ay * 55.0) * sstep(1.0, 0.0, ax) + exp(-ax * 55.0) * sstep(1.0, 0.0, ay)) * 0.35 * spike;
  return vec4<f32>(c * (core + halo + sp), 1.0);
}`, [LIB]);

// Galaxy billboard (cosmos layer): perspective-correct thin disk / ellipsoid from the camera ray.
export const GALSPRITE = wgslFn(`
fn galSprite(vpc: vec3<f32>, cen: vec3<f32>, nv: vec3<f32>, R: f32, prm: vec4<f32>, prm2: vec4<f32>, fade: f32, gain: f32) -> vec4<f32> {
  // prm=(gtype, arms, pitch, hue)  prm2=(bulge, thick, ellip, dust)
  let rd = normalize(vpc);
  let ndr = dot(rd, nv);
  let tc = dot(cen, rd);
  let pcl = rd * tc - cen;
  let dperp = length(pcl);
  let gtype = i32(prm.x + 0.5);
  let seed = prm.w * 53.0;
  let refv = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(nv.y) > 0.9);
  let e1 = normalize(cross(nv, refv)); let e2 = cross(nv, e1);
  let sa = prm.w * 6.2831853; let c1 = e1 * cos(sa) + e2 * sin(sa); let c2 = -e1 * sin(sa) + e2 * cos(sa);
  var col = vec3<f32>(0.0); var dim = 1.0;
  let bulgeR = 0.06 + 0.1 * prm2.x;
  let warm = vec3<f32>(1.0, 0.72, 0.42); let blue = vec3<f32>(0.62, 0.74, 1.0); let pink = vec3<f32>(1.0, 0.45, 0.6);
  if (gtype == 2 || gtype == 4 || gtype == 5) { // elliptical / dwarf / irregular blobs
    let sc = vec3<f32>(1.0, 1.0, 1.0);
    var rr = dperp / R;
    if (gtype == 4) { rr = rr * 1.6; }
    if (gtype == 2) {
      let ell = prm2.z; let sq = 1.0 - 0.45 * (1.0 - ell);
      let pl = vec3<f32>(dot(pcl, c1), dot(pcl, c2), dot(pcl, nv)); rr = length(vec3<f32>(pl.x, pl.y / ell, pl.z / sq)) / R * 1.1;
    }
    var I = exp(-pow(rr / 0.2, 0.5) * 2.4) * 1.3 * sstep(1.0, 0.85, rr);
    if (gtype == 5) {
      let n = fbm(vec3<f32>(dot(pcl, c1), dot(pcl, c2), seed) / (R * 0.45), 4) * 0.5 + 0.5;
      I = exp(-rr * 2.4) * sstep(0.35, 0.8, n) * 1.6 * sstep(1.0, 0.7, rr);
      let v = voronoi(vec3<f32>(dot(pcl, c1), dot(pcl, c2), seed) / (R * 0.12));
      col = mix(vec3<f32>(0.75, 0.85, 1.0), pink, sstep(0.2, 0.05, v.x) * step(0.7, v.z)) * I * 0.9;
    } else { col = mix(warm, vec3<f32>(1.0, 0.85, 0.65), clamp(rr * 2.0, 0.0, 1.0)) * I; }
  } else { // disk galaxies: spiral(0) barred(1) lenticular(3) ring(6) active(7)
    let h = prm2.y * R;
    let safe = select(max(abs(ndr), 0.07) , -max(abs(ndr), 0.07), ndr < 0.0);
    var Ptr = vec3<f32>(0.0);
    let t = dot(cen, nv) / safe;
    let P = rd * t - cen;
    let x = dot(P, c1); let y = dot(P, c2);
    let r = length(vec2<f32>(x, y)) / R;
    let ang = atan2(y, x);
    var arm = 0.0;
    if (gtype == 0 || gtype == 1 || gtype == 7 || gtype == 6) {
      let rr = max(r, 0.04);
      let ph = prm.y * (ang - log(rr / 0.08) / tan(prm.z)) / 6.2831853; let f = ph - round(ph);
      arm = exp(-(f * f) / (0.09));
    }
    var disk = exp(-r * 3.4) * (0.3 + 1.7 * arm * sstep(0.06, 0.22, r));
    if (gtype == 6) { disk = exp(-sq((r - 0.62) / 0.12)) * 1.8; }
    let path = (2.0 * prm2.y) / abs(safe);
    disk = disk * clamp(path * 14.0, 0.18, 2.2) * sstep(1.0, 0.9, r);
    let bulge = exp(-pow(dperp / (R * bulgeR), 0.5) * 2.2) * prm2.x * 6.0;
    let young = clamp(arm * 1.3, 0.0, 1.0);
    let diskCol = mix(warm * 0.9, blue, young * 0.85);
    // HII knots
    let v = voronoi(vec3<f32>(x, y, seed) / (R * 0.05));
    let hii = sstep(0.22, 0.06, v.x) * step(0.82, v.z) * arm * sstep(0.12, 0.3, r);
    col = diskCol * disk + warm * bulge + pink * hii * 1.4;
    // dust lane (edge-on) + dust in arms
    let zc = dot(pcl, nv);
    let lane = exp(-sq(zc / (h * 0.7 + 1e-3 * R))) * sstep(0.55, 0.0, abs(ndr)) * prm2.w;
    dim = 1.0 - 0.8 * lane * sstep(0.1, 0.5, 1.0 - dperp / R);
    col *= dim;
    col *= 1.0 + 0.0 * ptrDummy(Ptr);
  }
  let edge = sstep(1.0, 0.8, length(vpc.xy - cen.xy) / (R * 1.7 + 1e-9));
  return vec4<f32>(col * gain * fade, 1.0);
}
fn ptrDummy(p: vec3<f32>) -> f32 { return 0.0; }`, [LIB]);

// Volumetric nebula (ray-marched). One unified model: emission + dust absorption + reflection, on an irregular anisotropic domain
// (radial gradient blended with noise). Step count and octave count follow the pixel footprint (LOD). Output is premultiplied.
export const NEBULA = wgslFn(`
fn nebula(posW: vec3<f32>, cen: vec3<f32>, R: f32, kind: f32, seed: f32, hue: f32, temp: f32, dens0: f32, time: f32, pix: f32,
  ax: vec3<f32>, r0: vec3<f32>, r1: vec3<f32>, r2: vec3<f32>, nmat: vec3<f32>) -> vec4<f32> {
  let rd = normalize(posW);
  let h = raySphere(-cen, rd, R);
  if (h.y <= 0.0) { return vec4<f32>(0.0); }
  let t0 = max(h.x, 0.0); let t1 = h.y;
  let K = i32(kind + 0.5);
  let dist = max(length(cen), 1.0);
  let apx = R / dist / max(pix, 1.0e-6);
  let N = 6 + i32(clamp(apx / 14.0, 0.0, 12.0));
  let dt = (t1 - t0) / f32(N);
  let jit = hash21(vec2<f32>(posW.x * 7.31 + posW.y * 3.1, posW.z * 5.7 + seed));
  var T = 1.0; var acc = vec3<f32>(0.0);
  let sO = vec3<f32>(seed * 0.0173, seed * 0.0091, seed * 0.0137);
  let hotCol = blackbody(clamp(temp, 6000.0, 40000.0));
  let emitK = nmat.x; let dustK = nmat.y; let reflK = nmat.z;
  for (var i = 0; i < N; i++) {
    let t = t0 + (f32(i) + jit) * dt;
    let pw = (-cen + rd * t) / R;
    let rr0 = length(pw);
    if (rr0 > 0.99) { continue; }
    let fpu = t * pix / R;
    let oct = i32(clamp(log2(1.0 / (7.0 * fpu + 1.0e-5)), 1.0, 5.0));
    let p = vec3<f32>(dot(r0, pw), dot(r1, pw), dot(r2, pw)) / ax;
    let r = length(p);
    let nb = fbm(p * 1.7 + sO, min(oct, 3));
    let shape = sstep(0.0, 0.55, 1.0 - r + 0.62 * nb) * sstep(1.0, 0.82, rr0);
    if (shape < 0.003) { continue; }
    let q = p + vec3<f32>(fbm(p * 2.3 + sO + vec3<f32>(3.0), min(oct, 2))) * 0.6;
    var d = 0.0;
    if (K == 0) {
      let base = fbm(q * 3.2 + sO, oct) * 0.5 + 0.5;
      let fil = ridged(q * 5.5 + sO + vec3<f32>(3.0), min(oct, 3));
      d = sstep(0.25, 0.95, base * 0.8 + fil * 0.5) * shape * dens0;
      d = d * d * 1.8;
      let core = exp(-r * r * 4.0);
      let ha = vec3<f32>(1.0, 0.18, 0.28); let o3 = vec3<f32>(0.2, 0.9, 0.85); let sii = vec3<f32>(0.9, 0.35, 0.15);
      let emc = mix(mix(ha, sii, fil * 0.5), o3, core * 0.5 * (0.5 + 0.5 * hue)) * (0.8 + 1.4 * core);
      let blue = mix(vec3<f32>(0.35, 0.5, 1.0), vec3<f32>(0.6, 0.75, 1.0), core);
      let lane = sstep(0.5, 0.85, fbm(q * 4.0 + sO + vec3<f32>(9.0), min(oct, 3)) * 0.5 + 0.5);
      let sig = d * (0.35 + 3.6 * dustK * (0.25 + 0.75 * lane));
      acc += T * (emc * emitK + blue * reflK * 0.55) * d * dt / R * 5.5;
      T *= exp(-sig * dt / R * 6.0);
    } else if (K == 3) { // planetary: irregular bipolar shell
      let lobe = 1.0 + 0.55 * abs(p.y) / max(r, 0.05);
      let shell = exp(-sq((r * lobe - 0.62) / 0.13));
      let fil = sstep(0.3, 0.9, fbm(q * 7.0 + sO, min(oct, 3)) * 0.5 + 0.5);
      d = shell * (0.35 + 0.8 * fil) * dens0 * (0.4 + 0.6 * shape);
      let ec = mix(vec3<f32>(0.2, 1.0, 0.8), vec3<f32>(1.0, 0.25, 0.4), sstep(0.55, 0.9, r * lobe));
      acc += T * ec * d * dt / R * 9.0; T *= exp(-d * dt / R * 0.8);
    } else { // supernova remnant: filamentary shell
      let rr = r + 0.18 * fbm(p * 4.0 + sO, min(oct, 3));
      let shell = exp(-sq((rr - 0.78) / 0.1));
      let fil = sq(ridged(q * 7.0 + sO, min(oct, 3)));
      d = (shell * fil * 1.5 + exp(-sq(r / 0.28)) * 0.25 * (fbm(q * 5.0, 2) * 0.5 + 0.5)) * dens0 * (0.4 + 0.6 * shape);
      let ec = mix(vec3<f32>(0.2, 0.55, 1.0), vec3<f32>(1.0, 0.25, 0.3), sstep(0.1, 0.9, fbm(q * 3.0 + sO, 2) * 0.5 + 0.5));
      acc += T * mix(ec, vec3<f32>(0.3, 1.0, 0.7), step(0.8, fract(hue * 7.0 + fil))) * d * dt / R * 7.0;
      T *= exp(-d * dt / R * 0.6);
    }
    if (T < 0.02) { break; }
  }
  var g = vec3<f32>(0.0);
  if (K == 0) { let cd = length(cross(-cen, rd)) / R; g = hotCol * exp(-cd * cd * 22.0) * 0.5 * emitK; }
  if (K == 3) { let cd = length(cross(-cen, rd)) / R; g = vec3<f32>(0.8, 0.9, 1.0) * exp(-cd * cd * 700.0) * 1.2; }
  return vec4<f32>(acc + g * (1.0 - T), 1.0 - T);
}`, [LIB]);

// Relativistic jet from an active nucleus: q.x across (-1..1), q.y along (-1..1, sign = which jet)
export const JET = wgslFn(`
fn jetFrag(q: vec2<f32>, seed: f32, time: f32, gain: f32) -> vec4<f32> {
  let s = abs(q.y);
  let w = 0.12 + 0.9 * s;
  let across = exp(-sq(q.x / w) * 2.2);
  let knots = 0.55 + 0.9 * pow(fbm(vec3<f32>(s * 9.0 - time * 0.00002, seed, 1.7), 3) * 0.5 + 0.5, 1.5);
  let along = exp(-s * 2.4) * sstep(0.0, 0.04, s);
  let c = mix(vec3<f32>(0.55, 0.7, 1.0), vec3<f32>(0.9, 0.6, 0.9), s);
  let a = across * knots * along * gain;
  return vec4<f32>(c * a, 1.0);
}`, [LIB]);
