import { wgsl } from 'three/tsl';
// Shared WGSL library: hashing, gradient noise, fbm, voronoi, blackbody, ray/sphere, atmosphere scattering.
export const LIB = wgsl(`
const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;
fn pcg3(v0: vec3<u32>) -> vec3<u32> {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ (v >> vec3<u32>(16u));
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn hash33(p: vec3<f32>) -> vec3<f32> { let u = pcg3(bitcast<vec3<u32>>(vec3<i32>(floor(p)))); return vec3<f32>(u) * (1.0 / 4294967295.0); }
fn hash13(p: vec3<f32>) -> f32 { return hash33(p).x; }
fn hash11(x: f32) -> f32 { return hash33(vec3<f32>(x, 1.7, 3.1)).x; }
fn hash21(p: vec2<f32>) -> f32 { return hash33(vec3<f32>(p, 5.3)).y; }
fn gdot(i: vec3<f32>, f: vec3<f32>) -> f32 { let g = hash33(i) * 2.0 - 1.0; return dot(g, f); }
fn gnoise(p: vec3<f32>) -> f32 {
  let i = floor(p); let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = mix(mix(gdot(i, f), gdot(i + vec3<f32>(1.0, 0.0, 0.0), f - vec3<f32>(1.0, 0.0, 0.0)), u.x),
              mix(gdot(i + vec3<f32>(0.0, 1.0, 0.0), f - vec3<f32>(0.0, 1.0, 0.0)), gdot(i + vec3<f32>(1.0, 1.0, 0.0), f - vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y);
  let b = mix(mix(gdot(i + vec3<f32>(0.0, 0.0, 1.0), f - vec3<f32>(0.0, 0.0, 1.0)), gdot(i + vec3<f32>(1.0, 0.0, 1.0), f - vec3<f32>(1.0, 0.0, 1.0)), u.x),
              mix(gdot(i + vec3<f32>(0.0, 1.0, 1.0), f - vec3<f32>(0.0, 1.0, 1.0)), gdot(i + vec3<f32>(1.0, 1.0, 1.0), f - vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z) * 1.15;
}
fn fbm(p0: vec3<f32>, oct: i32) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var i = 0; i < oct; i++) { s += a * gnoise(p); p = p * 2.03 + vec3<f32>(17.1, 3.7, 9.2); a *= 0.5; }
  return s;
}
fn ridged(p0: vec3<f32>, oct: i32) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0; var w = 1.0;
  for (var i = 0; i < oct; i++) { var v = 1.0 - abs(gnoise(p)); v = v * v * w; w = clamp(v * 2.0, 0.0, 1.0); s += a * v; p = p * 2.1 + vec3<f32>(5.3, 11.7, 2.9); a *= 0.5; }
  return s;
}
// returns (F1, F2, cell hash)
fn voronoi(p: vec3<f32>) -> vec3<f32> {
  let ip = floor(p); let fp = p - ip; var f1 = 8.0; var f2 = 8.0; var id = 0.0;
  for (var k = -1; k <= 1; k++) { for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let o = vec3<f32>(f32(i), f32(j), f32(k)); let h = hash33(ip + o);
    let d = length(o + h - fp);
    if (d < f1) { f2 = f1; f1 = d; id = h.x; } else if (d < f2) { f2 = d; }
  } } }
  return vec3<f32>(f1, f2, id);
}
fn blackbody(T0: f32) -> vec3<f32> {
  let t = clamp(T0, 800.0, 60000.0) / 100.0;
  var r = 255.0; var g = 0.0; var b = 255.0;
  if (t <= 66.0) { g = 99.4708 * log(t) - 161.1196; } else { r = 329.6987 * pow(t - 60.0, -0.1332); g = 288.1222 * pow(t - 60.0, -0.07551); }
  if (t < 66.0) { if (t <= 19.0) { b = 0.0; } else { b = 138.5177 * log(t - 10.0) - 305.0448; } }
  return pow(clamp(vec3<f32>(r, g, b) / 255.0, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(2.2));
}
// ray / sphere (centre origin): returns (t0, t1) or (-1,-1)
fn raySphere(ro: vec3<f32>, rd: vec3<f32>, r: f32) -> vec2<f32> {
  let b = dot(ro, rd); let c = dot(ro, ro) - r * r; let d = b * b - c;
  if (d < 0.0) { return vec2<f32>(-1.0, -1.0); }
  let s = sqrt(d); return vec2<f32>(-b - s, -b + s);
}
fn rayleighPhase(mu: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
fn hgPhase(mu: f32, g: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }
fn luma(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }
// Atmosphere single scattering. ro = camera relative to planet centre (km), rd unit, tmax = distance limit (km).
// coefficients are per km. Returns (in-scatter rgb, mean transmittance).
fn atmoScatter(ro: vec3<f32>, rd: vec3<f32>, tmax: f32, Rp: f32, Ha: f32, ray: vec3<f32>, mie: f32, g: f32, absorb: vec3<f32>, Hr: f32, Hm: f32, sunDir: vec3<f32>, sunCol: vec3<f32>) -> vec4<f32> {
  let Ra = Rp + Ha;
  let hit = raySphere(ro, rd, Ra);
  if (hit.y < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  var t0 = max(hit.x, 0.0); var t1 = min(hit.y, tmax);
  let ph = raySphere(ro, rd, Rp);
  if (ph.x > 0.0) { t1 = min(t1, ph.x); }
  if (t1 <= t0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  let N = 14;
  let dt = (t1 - t0) / f32(N);
  var odR = vec3<f32>(0.0); var odM = 0.0; var sumR = vec3<f32>(0.0); var sumM = vec3<f32>(0.0);
  let mu = dot(rd, sunDir);
  for (var i = 0; i < N; i++) {
    let p = ro + rd * (t0 + (f32(i) + 0.5) * dt);
    let h = max(length(p) - Rp, 0.0);
    let dR = exp(-h / Hr) * dt; let dM = exp(-h / Hm) * dt;
    odR += vec3<f32>(dR); odM += dM;
    // light march
    let ls = raySphere(p, sunDir, Ra);
    let lp = raySphere(p, sunDir, Rp);
    if (!(lp.x > 0.0)) {
      let ldt = max(ls.y, 0.0) / 4.0; var lR = 0.0; var lM = 0.0;
      for (var j = 0; j < 4; j++) { let q = p + sunDir * ((f32(j) + 0.5) * ldt); let hh = max(length(q) - Rp, 0.0); lR += exp(-hh / Hr) * ldt; lM += exp(-hh / Hm) * ldt; }
      let tau = ray * (odR.x + lR) + vec3<f32>(mie * 1.11 * (odM + lM)) + absorb * (odR.x + lR);
      let att = exp(-tau);
      sumR += att * dR; sumM += att * dM;
    }
  }
  let inS = (sumR * ray * rayleighPhase(mu) + sumM * mie * hgPhase(mu, g)) * sunCol;
  let T = exp(-(ray * odR.x + vec3<f32>(mie * 1.11 * odM) + absorb * odR.x));
  return vec4<f32>(inS, (T.x + T.y + T.z) / 3.0);
}
fn aces(x: vec3<f32>) -> vec3<f32> { let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0)); }
`);
