import { wgslFn } from 'three/tsl';
import { LIB } from './lib.js';
import { OCCLUDE, CLOUDD } from './bodies.js';

// ---- multi-scale surface detail: returns (height km, albedo modulation). Octaves fade out below the pixel footprint (no aliasing). ----
export const DETAIL = wgslFn(`
fn detailH(dir: vec3<f32>, R: f32, foot: f32, seed: f32) -> vec2<f32> {
  var h = 0.0; var c = 0.0; var wl = 70.0; var a = 1.0;
  for (var i = 0; i < 7; i++) {
    let vis = sstep(foot * 3.0, foot * 14.0, wl);
    if (vis > 0.002) { let g = gnoise(dir * (R / wl) + vec3<f32>(seed * 13.7 + f32(i) * 7.3)); h += wl * 0.055 * vis * g; c += a * vis * g; }
    wl = wl * 0.24; a *= 0.62;
  }
  return vec2<f32>(h, c);
}`, [LIB]);

export const WAVES = wgslFn(`
fn waveH(dir: vec3<f32>, R: f32, time: f32) -> f32 {
  return 0.0016 * gnoise(dir * (R / 0.14) + vec3<f32>(time * 0.5, 0.0, time * 0.35)) + 0.0006 * gnoise(dir * (R / 0.035) - vec3<f32>(0.0, time * 0.8, 0.0));
}`, [LIB]);

// ---- rocky planet surface -------------------------------------------------------------------------------------------
export const ROCKY = wgslFn(`
fn rockyFrag(
  dirL: vec3<f32>, nW: vec3<f32>, tW: vec3<f32>, bW: vec3<f32>, tL: vec3<f32>, bL: vec3<f32>, posW: vec3<f32>, aux: vec3<f32>, pc: vec3<f32>,
  uA: vec4<f32>, uB: vec4<f32>, uC: vec4<f32>, uD: vec4<f32>,
  cLow: vec3<f32>, cMid: vec3<f32>, cDry: vec3<f32>, cHigh: vec3<f32>, cSnow: vec3<f32>, cSand: vec3<f32>, cWS: vec3<f32>, cWD: vec3<f32>, cLava: vec3<f32>, cF: vec3<f32>,
  sd0: vec3<f32>, sc0: vec3<f32>, sd1: vec3<f32>, sc1: vec3<f32>, sL0: vec3<f32>,
  aRay: vec3<f32>, aAbs: vec3<f32>, aP: vec4<f32>, aH: vec2<f32>,
  cld: vec4<f32>, time: f32, o0: vec4<f32>, o1: vec4<f32>, o2: vec4<f32>
) -> vec4<f32> {
  let R = uA.z; let biome = i32(uA.x + 0.5); let seed = uA.y; let relief = max(uA.w, 0.001) * 1000.0;
  let elev = aux.x; let river = aux.y; let lake = aux.z;
  let dir = normalize(dirL);
  let up = normalize(posW - pc);
  let ng = normalize(nW);
  let camDist = length(posW);
  let V = -normalize(posW);
  let alat = abs(dir.y);
  let sdir = dir + vec3<f32>(seed * 0.31);
  let hasAtm = aH.y;
  let foot = max(camDist, 0.05) * 0.0012;
  let moist = fbm(sdir * 3.1, 4) * 0.5 + 0.5;
  let patchN = fbm(sdir * 8.3 + vec3<f32>(4.0), 4) * 0.5 + 0.5;
  let hN = clamp(elev / relief, -1.0, 1.5);
  let slope = clamp(1.0 - dot(ng, up), 0.0, 1.0);
  var alb = cMid; var emis = vec3<f32>(0.0); var spec = 0.0; var isWater = false; var waterDepth = 0.0;
  let det = detailH(dir, R, foot, seed);
  var snowAmt = 0.0;
  let fluidT = i32(uD.x + 0.5);

  if (biome == 0 || biome == 1) { // terran / ocean
    var land = mix(cLow, cMid, sstep(0.25, 0.7, moist + 0.25 * patchN));
    let bq = (alat - 0.32) / 0.2; let band = exp(-bq * bq);
    land = mix(land, cDry, clamp(band * sstep(0.35, 0.7, 1.0 - moist) * 1.4, 0.0, 1.0));
    land = mix(land, cHigh, sstep(0.22, 0.55, hN + 0.1 * (patchN - 0.5)));
    land = mix(land, cHigh * 0.85, sstep(0.1, 0.32, slope));
    land = mix(land, cSand, sstep(0.0, 0.06, 0.06 - hN) * 0.7);
    land *= 0.85 + 0.3 * fbm(sdir * 30.0, 3) + 0.22 * det.y;
    alb = land;
    let polar = sstep(1.0 - uB.y * 0.75, 1.0 - uB.y * 0.75 + 0.1, alat + 0.12 * (patchN - 0.5) + 0.06 * hN);
    let mtn = sstep(uC.x, uC.x + 0.25, hN + 0.18 * (patchN - 0.5) - 0.25 * alat * 0.5);
    snowAmt = clamp(max(polar, mtn) * (1.0 - sstep(0.35, 0.65, slope)), 0.0, 1.0);
    alb = mix(alb, cSnow, snowAmt);
    if (elev <= 0.0) {
      isWater = true; waterDepth = -elev;
      let wc = mix(cWS, cWD, 1.0 - exp(-waterDepth / 1400.0));
      let seaIce = sstep(1.0 - uB.y * 0.6, 1.0 - uB.y * 0.6 + 0.06, alat + 0.1 * (patchN - 0.5));
      alb = mix(wc, cSnow * 0.95, seaIce); spec = (1.0 - seaIce);
      let foam = sstep(0.0, 90.0, 90.0 - waterDepth) * (0.5 + 0.5 * gnoise(sdir * 600.0 + vec3<f32>(time * 0.15)));
      alb = mix(alb, vec3<f32>(0.9), foam * 0.5 * (1.0 - seaIce));
    }
  } else if (biome == 2) { // desert
    let dune = ridged(vec3<f32>(sdir.x * 30.0 + 0.8 * fbm(sdir * 7.0, 3), sdir.y * 30.0, sdir.z * 30.0), 3);
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cDry, sstep(0.35, 0.75, patchN));
    c = mix(c, cSand, sstep(0.35, 0.8, dune) * uC.y * 0.8);
    c = mix(c, cHigh, sstep(0.3, 0.7, hN) + sstep(0.12, 0.35, slope) * 0.6);
    // layered rock strata on canyon walls and mesas
    let strata = 0.88 + 0.16 * sin(elev * 0.012 + 3.0 * gnoise(sdir * 5.0)) + 0.06 * sin(elev * 0.07);
    alb = c * strata * (1.0 + 0.2 * det.y);
    snowAmt = clamp(sstep(0.88, 0.97, alat + 0.05 * patchN) * uB.y * 2.0, 0.0, 1.0);
    alb = mix(alb, cSnow, snowAmt);
  } else if (biome == 3 || biome == 9) { // barren / asteroid
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist + 0.3 * (patchN - 0.5)));
    c = mix(c, cDry, sstep(0.5, 0.8, patchN));
    c = mix(c, cHigh, sstep(0.35, 0.7, hN));
    let maria = sstep(0.42, 0.52, 1.0 - (fbm(sdir * 1.6 + vec3<f32>(9.0), 4) * 0.5 + 0.5));
    c *= mix(1.0, 0.55, maria * uC.w);
    c *= 0.82 + 0.35 * fbm(sdir * 55.0, 3) * 0.5 + 0.3 * sstep(0.15, 0.35, slope) + 0.25 * det.y;
    if (biome == 9) { c *= uC.z * 0.4 + 0.6 * (0.7 + 0.5 * fbm(sdir * 4.0, 3)); }
    alb = c;
  } else if (biome == 4) { // ice
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cDry, sstep(0.45, 0.8, patchN));
    let lin = pow(ridged(sdir * 6.0 + vec3<f32>(fbm(sdir * 2.0, 3) * 0.5), 4), 5.0);
    c = mix(c, cSand, clamp(lin * uC.z * 2.2, 0.0, 0.85));
    c = mix(c, cHigh, sstep(0.4, 0.8, hN));
    alb = c * (0.9 + 0.15 * fbm(sdir * 40.0, 3) + 0.12 * det.y);
    spec = 0.15;
  } else if (biome == 5) { // lava
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cDry, sstep(0.45, 0.8, patchN));
    c = mix(c, cHigh, sstep(0.3, 0.7, hN));
    let cr = ridged(sdir * 5.0 + vec3<f32>(fbm(sdir * 3.0, 3) * 0.4), 5);
    let glowMask = sstep(0.62, 0.9, cr);
    let pulse = 0.75 + 0.25 * sin(time * 0.7 + 6.0 * fbm(sdir * 12.0, 3));
    let g = clamp(glowMask * 0.8 * uB.w, 0.0, 1.0);
    c = mix(c, cLava * 0.15, g);
    emis = cLava * g * 6.0 * pulse * (0.7 + 0.5 * fbm(sdir * 40.0 + vec3<f32>(time * 0.02), 3));
    alb = c * (0.9 + 0.25 * det.y);
  } else if (biome == 6) { // volcanic (Io-like)
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cDry, sstep(0.4, 0.8, patchN));
    let v = voronoi(sdir * 14.0);
    let paterae = sstep(0.09, 0.16, 0.25 - v.x) * step(0.55, v.z);
    c = mix(c, vec3<f32>(0.05, 0.03, 0.02), paterae * 0.9);
    c = mix(c, cHigh, sstep(0.35, 0.7, patchN) * 0.5 * sstep(0.2, 0.5, hN + 0.3));
    emis = cLava * sstep(0.03, 0.1, 0.13 - v.x) * step(0.7, v.z) * uB.w * 4.0;
    alb = c * (0.9 + 0.2 * det.y);
  } else if (biome == 7) { // greenhouse
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cHigh, sstep(0.3, 0.7, hN));
    alb = c * (0.85 + 0.3 * patchN + 0.2 * det.y);
  } else { // tholin
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cSand, sstep(0.4, 0.8, ridged(sdir * 18.0, 3)) * 0.7);
    c = mix(c, cHigh, sstep(0.3, 0.7, hN));
    alb = c * (1.0 + 0.2 * det.y);
    if (elev <= 0.0) { isWater = true; waterDepth = -elev; alb = mix(cWS, cWD, 1.0 - exp(-waterDepth / 200.0)); spec = 0.8; }
  }

  // ---- rivers, lakes, lava flows, ravine floors (features baked into the terrain) ----
  let wetM = max(sstep(0.28, 0.62, river), sstep(0.3, 0.55, lake));
  if (wetM > 0.001 && !isWater) {
    if (fluidT == 0 || fluidT == 3) {
      let fc = mix(cF, cWD, clamp(lake * 0.9 + river * 0.35, 0.0, 1.0));
      alb = mix(alb, fc, wetM); spec = max(spec, wetM);
      if (wetM > 0.5) { isWater = true; waterDepth = 60.0 + 700.0 * lake; }
    } else if (fluidT == 1) {
      let pulse = 0.7 + 0.3 * sin(time * 0.6 + 9.0 * fbm(sdir * 25.0, 3));
      let crust = 0.5 + 0.5 * fbm(sdir * 90.0 + vec3<f32>(time * 0.01), 3);
      emis += cLava * wetM * (3.0 + 5.0 * crust) * pulse;
      alb = mix(alb, vec3<f32>(0.02, 0.012, 0.01), wetM);
    } else {
      alb = mix(alb, cF, wetM * 0.75);
    }
  }
  alb *= 1.0 - 0.28 * sstep(0.04, 0.4, river) * (1.0 - wetM);

  // ---- lighting normal: analytic detail gradient (no screen-space derivatives -> no aliasing) ----
  var n = ng;
  if (isWater) {
    let e = 0.01; let visW = 1.0 - sstep(0.02, 0.12, foot);
    if (visW > 0.01) {
      let w0 = waveH(dir, R, time);
      let wt = waveH(normalize(dir + tL * (e / R)), R, time); let wb = waveH(normalize(dir + bL * (e / R)), R, time);
      n = normalize(ng - ((wt - w0) / e * tW + (wb - w0) / e * bW) * visW * 1.6);
    }
  } else if (foot < 6.0) {
    let eps = max(foot * 1.5, 0.003);
    let hT = detailH(normalize(dir + tL * (eps / R)), R, foot, seed).x; let hB = detailH(normalize(dir + bL * (eps / R)), R, foot, seed).x;
    n = normalize(ng - ((hT - det.x) / eps * tW + (hB - det.x) / eps * bW) * 1.1);
  }
  // lighting
  let pr = posW - pc;
  var shadow0 = occlude(pr, sd0, o0) * occlude(pr, sd0, o1) * occlude(pr, sd0, o2);
  var shadow1 = occlude(pr, sd1, o0) * occlude(pr, sd1, o1) * occlude(pr, sd1, o2);
  if (cld.x > 0.01) {
    let sp = normalize(dir + normalize(sL0) * (cld.y / R) * 1.4);
    let cd = cloudDensity(sp, cld, time, 4);
    shadow0 = shadow0 * (1.0 - 0.55 * cd);
  }
  let wrap = 0.12 * hasAtm;
  let nd0 = dot(n, sd0); let nd1 = dot(n, sd1);
  let diff0 = max((nd0 + wrap) / (1.0 + wrap), 0.0) * shadow0 * sstep(-0.05, 0.1, dot(ng, sd0) + 0.1);
  let diff1 = max((nd1 + wrap) / (1.0 + wrap), 0.0) * shadow1 * sstep(-0.05, 0.1, dot(ng, sd1) + 0.1);
  var col = alb * (sc0 * diff0 + sc1 * diff1);
  var specCol = vec3<f32>(0.0);
  if (isWater) {
    let h0 = normalize(sd0 + V); let h1 = normalize(sd1 + V);
    let fr = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    let g0 = pow(max(dot(n, h0), 0.0), 380.0) * 20.0 * shadow0; let g1 = pow(max(dot(n, h1), 0.0), 380.0) * 20.0 * shadow1;
    specCol = (sc0 * g0 + sc1 * g1) * spec * (0.3 + fr);
    let skyc = vec3<f32>(0.25, 0.4, 0.7) * (0.4 + 0.6 * hasAtm);
    col = mix(col, skyc * (sc0 * max(dot(up, sd0), 0.0) + sc1 * max(dot(up, sd1), 0.0)), fr * 0.6 * hasAtm);
  } else if (spec > 0.0) {
    let h0 = normalize(sd0 + V); specCol = sc0 * pow(max(dot(n, h0), 0.0), 40.0) * spec * 0.4 * shadow0;
  }
  col += alb * (sc0 + sc1) * 0.0008;
  col += specCol + emis;
  if (hasAtm > 0.5) {
    let rd = normalize(posW);
    let s0 = atmoScatter(-pc, rd, camDist, R, aH.x, aRay, aP.x, aP.y, aAbs, aP.z, aP.w, sd0, sc0 * 6.0);
    var inS = s0.rgb; var T = s0.a;
    if (luma(sc1) > 0.001) { let s1 = atmoScatter(-pc, rd, camDist, R, aH.x, aRay, aP.x, aP.y, aAbs, aP.z, aP.w, sd1, sc1 * 6.0); inS += s1.rgb; }
    col = col * T + inS;
  }
  return vec4<f32>(col, 1.0);
}`, [LIB, DETAIL, WAVES, OCCLUDE, CLOUDD]);

// ---- volumetric cloud deck for rocky planets -----------------------------------------------------------------------------
export const CLOUD = wgslFn(`
fn cloudVol(posW: vec3<f32>, pc: vec3<f32>, m0: vec3<f32>, m1: vec3<f32>, m2: vec3<f32>, cld: vec4<f32>, cCol: vec3<f32>,
  sd0: vec3<f32>, sc0: vec3<f32>, sd1: vec3<f32>, sc1: vec3<f32>, time: f32, R: f32, thick: f32, pix: f32) -> vec4<f32> {
  let ro = -pc; let rd = normalize(posW);
  let rIn = R + cld.y; let rOut = rIn + thick;
  let ho = raySphere(ro, rd, rOut);
  if (ho.y <= 0.0) { return vec4<f32>(0.0); }
  let hi = raySphere(ro, rd, rIn);
  var t0 = max(ho.x, 0.0); var t1 = ho.y;
  if (length(ro) < rIn) { t0 = max(hi.y, 0.0); } else if (hi.x > 0.0) { t1 = min(t1, hi.x); }
  if (t1 <= t0) { return vec4<f32>(0.0); }
  let pm = ro + rd * (0.5 * (t0 + t1));
  let dm = normalize(vec3<f32>(dot(m0, pm), dot(m1, pm), dot(m2, pm)));
  if (cloudDensity(dm, cld, time, 3) < 0.02) { return vec4<f32>(0.0); }
  let fp = max(t0, 0.5) * pix;
  var N = 14; if (fp > thick * 0.5) { N = 8; }
  let dt = (t1 - t0) / f32(N);
  let jit = hash21(posW.xy * 71.3 + vec2<f32>(posW.z * 9.1, 3.3));
  var T = 1.0; var acc = vec3<f32>(0.0);
  let seedv = vec3<f32>(cld.w * 3.7, cld.w * 1.3, cld.w * 2.1);
  let muv = dot(rd, sd0);
  let ph = 0.4 + 0.9 * hgPhase(muv, 0.55);
  for (var i = 0; i < N; i++) {
    let p = ro + rd * (t0 + (f32(i) + jit) * dt);
    let r = length(p); let up = p / r;
    let h01 = clamp((r - rIn) / thick, 0.0, 1.0);
    let pL = vec3<f32>(dot(m0, p), dot(m1, p), dot(m2, p));
    let c2 = cloudDensity(pL / r, cld, time, 3);
    let prof = sstep(0.0, 0.22, h01) * sstep(0.0, 0.45, 1.0 - h01);
    let oct = i32(clamp(log2(thick * 0.8 / (fp * 2.0 + 0.05)), 1.0, 3.0));
    let n3 = fbm(pL * (0.9 / thick) + seedv, oct) * 0.5 + 0.5;
    let d = max(c2 * prof - (1.0 - n3) * 0.5, 0.0) * 1.7;
    if (d > 0.004) {
      let ps = p + sd0 * (thick * 0.6); let rs = length(ps);
      let pLs = vec3<f32>(dot(m0, ps), dot(m1, ps), dot(m2, ps));
      let cs = cloudDensity(pLs / rs, cld, time, 2);
      let lt = exp(-cs * 2.0);
      let sunF = sstep(-0.18, 0.32, dot(up, sd0));
      let l1 = sstep(-0.18, 0.32, dot(up, sd1));
      let col = cCol * (sc0 * (lt * ph * sunF) + sc1 * 0.25 * l1) * (0.5 + 0.5 * h01) + cCol * (sc0 + sc1) * 0.0008;
      let sig = d * 4.5 / thick;
      let a = 1.0 - exp(-sig * dt);
      acc += T * col * a; T *= (1.0 - a);
      if (T < 0.02) { break; }
    }
  }
  return vec4<f32>(acc, 1.0 - T);
}`, [LIB, CLOUDD]);

// ---- gas giant: shared colour/density field -------------------------------------------------------------------------------------
export const GASFIELD = wgslFn(`
fn gasField(dir: vec3<f32>, seed: f32, bands: f32, contrast: f32, turb: f32, haze: f32,
  p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, p4: vec3<f32>, stormCol: vec3<f32>, storm: vec4<f32>, time: f32, oct: i32) -> vec4<f32> {
  let lat = dir.y;
  let bandId = floor(lat * bands * 0.5 + 0.5);
  let drift = time * 0.00004 + (hash11(bandId + seed) - 0.5) * 0.00006 * time;
  let cd = cos(drift); let sdr = sin(drift);
  let p = vec3<f32>(dir.x * cd - dir.z * sdr, dir.y, dir.x * sdr + dir.z * cd);
  let sp = p + vec3<f32>(seed * 0.113);
  let o4 = min(oct, 4);
  let w1 = fbm(vec3<f32>(sp.x * 3.0, sp.y * 7.0, sp.z * 3.0), o4);
  let w2 = fbm(vec3<f32>(sp.x * 9.0 + 3.0, sp.y * 24.0, sp.z * 9.0), o4);
  let b = lat * bands * 0.5 + turb * (0.55 * w1 + 0.18 * w2);
  let s1 = 0.5 + 0.5 * sin(b * PI * 2.0 + 1.3 * w1);
  let s2 = 0.5 + 0.5 * sin(b * PI * 4.3 + 2.0 * w2);
  let zone = sstep(0.35, 0.65, s1);
  var c = mix(p0, p1, zone);
  c = mix(c, p2, sstep(0.55, 0.9, s2) * 0.6);
  c = mix(c, p3, sstep(0.6, 0.95, 1.0 - s1) * 0.55 * contrast);
  c = mix(c, p4, clamp(w2 * 1.4, 0.0, 0.5));
  let eddy = fbm(vec3<f32>(sp.x * 14.0, sp.y * 60.0, sp.z * 14.0) + vec3<f32>(w1 * 2.0), min(oct + 1, 5));
  c *= 1.0 + eddy * 0.55 * contrast;
  c *= 1.0 + (s1 - 0.5) * 0.85 * contrast + (s2 - 0.5) * 0.25 * contrast;
  if (oct >= 3) {
    let curl = ridged(vec3<f32>(sp.x * 10.0, sp.y * 34.0, sp.z * 10.0) + vec3<f32>(w2 * 3.0), 4);
    c = mix(c, vec3<f32>(0.95, 0.93, 0.88), sstep(0.55, 0.9, curl) * 0.45 * zone * contrast * haze);
  }
  let lon = atan2(dir.z, dir.x);
  if (storm.w > 0.5) {
    var d = vec2<f32>((lon - storm.z + 3.14159) - floor((lon - storm.z + 3.14159) / 6.28318) * 6.28318 - 3.14159, asin(clamp(lat, -1.0, 1.0)) - storm.x);
    d = vec2<f32>(d.x * cos(storm.x) / (storm.y * 1.7), d.y / storm.y);
    let r = length(d);
    let ang = atan2(d.y, d.x) + r * 4.0 - time * 0.00008;
    let sw = 0.5 + 0.5 * sin(ang * 3.0 + fbm(vec3<f32>(d * 3.0, 1.0), 3) * 4.0);
    let m = sstep(0.55, 1.0, 1.55 - r);
    c = mix(c, mix(stormCol, stormCol * 1.35 + vec3<f32>(0.05), sw), m);
    c = mix(c, vec3<f32>(0.9, 0.88, 0.8), sstep(1.0, 1.25, 2.25 - r) * sstep(0.85, 1.0, r) * 0.4);
  }
  if (oct >= 3) {
    let vv = voronoi(vec3<f32>(sp.x * 9.0, sp.y * 16.0, sp.z * 9.0));
    c = mix(c, mix(stormCol, vec3<f32>(0.95, 0.95, 0.92), step(0.5, hash11(vv.z * 91.0))), sstep(0.04, 0.1, 0.14 - vv.x) * step(0.93, vv.z) * 0.8);
  }
  return vec4<f32>(c, zone);
}`, [LIB]);

// ---- gas giant outer surface (cloud tops seen from space) ------------------------------------------------------------------------------
export const GAS = wgslFn(`
fn gasFrag(
  dirL: vec3<f32>, nW: vec3<f32>, posW: vec3<f32>, pc: vec3<f32>,
  uA: vec4<f32>, uB: vec4<f32>,
  p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, p4: vec3<f32>, stormCol: vec3<f32>, storm: vec4<f32>,
  sd0: vec3<f32>, sc0: vec3<f32>, sd1: vec3<f32>, sc1: vec3<f32>,
  aRay: vec3<f32>, aAbs: vec3<f32>, aP: vec4<f32>, aH: vec2<f32>,
  time: f32, o0: vec4<f32>, o1: vec4<f32>, o2: vec4<f32>
) -> vec4<f32> {
  let R = uA.z; let seed = uA.y; let bands = uA.w; let hot = uB.z;
  let dir = normalize(dirL); let n = normalize(nW);
  let V = -normalize(posW);
  let pr = posW - pc;
  let f = gasField(dir, seed, bands, uB.x, uB.y, uB.w, p0, p1, p2, p3, p4, stormCol, storm, time, 4);
  var c = f.xyz;
  let mu = max(dot(n, V), 0.0);
  c *= 0.55 + 0.45 * pow(mu, 0.5);
  let shadow0 = occlude(pr, sd0, o0) * occlude(pr, sd0, o1) * occlude(pr, sd0, o2);
  let shadow1 = occlude(pr, sd1, o0) * occlude(pr, sd1, o1) * occlude(pr, sd1, o2);
  let d0 = max((dot(n, sd0) + 0.1) / 1.1, 0.0) * shadow0; let d1 = max((dot(n, sd1) + 0.1) / 1.1, 0.0) * shadow1;
  var col = c * (sc0 * d0 + sc1 * d1);
  let night = 1.0 - clamp(d0 * 1.5, 0.0, 1.0);
  col += vec3<f32>(1.0, 0.28, 0.06) * hot * (0.4 + 4.0 * (1.0 - night * 0.75)) * (0.6 + 0.8 * fbm(dir * 8.0 + vec3<f32>(time * 0.0002), 4)) * (0.5 + 0.5 * mu);
  let rd = normalize(posW);
  let s0 = atmoScatter(-pc, rd, length(posW), R, aH.x, aRay, aP.x, aP.y, aAbs, aP.z, aP.w, sd0, sc0 * 6.0);
  var inS = s0.rgb; var T = s0.a;
  if (luma(sc1) > 0.001) { inS += atmoScatter(-pc, rd, length(posW), R, aH.x, aRay, aP.x, aP.y, aAbs, aP.z, aP.w, sd1, sc1 * 6.0).rgb; }
  col = col * T + inS;
  return vec4<f32>(col, 1.0);
}`, [LIB, GASFIELD, OCCLUDE]);

// ---- gas giant volume: ray-marched atmosphere from the cloud tops down to the metallic-hydrogen ocean ------------------------------------
// Extinction grows exponentially with depth (then saturates in a dense, hot, dark gas), cloud decks are stacked 3-D layers,
// and the march ends early once the ray is opaque, so deep views are cheaper than shallow ones.
export const GASVOL = wgslFn(`
fn gasVolume(posW: vec3<f32>, pc: vec3<f32>, m0: vec3<f32>, m1: vec3<f32>, m2: vec3<f32>,
  uV: vec4<f32>, uB: vec4<f32>, p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, p4: vec3<f32>,
  stormCol: vec3<f32>, storm: vec4<f32>, sd0: vec3<f32>, sc0: vec3<f32>, sd1: vec3<f32>, sc1: vec3<f32>,
  time: f32, volMix: f32, thermK: f32, pix: f32, coreCol: vec3<f32>) -> vec4<f32> {
  let R = uV.x; let seed = uV.y; let bands = uV.z; let Rm = R * uV.w;
  let rd = normalize(posW); let ro = -pc;
  let Rv = R * 1.006;
  let hv = raySphere(ro, rd, Rv);
  if (hv.y <= 0.0) { return vec4<f32>(0.0); }
  var t0 = max(hv.x, 0.0); var t1 = hv.y; var hitCore = false;
  let hm = raySphere(ro, rd, Rm);
  if (hm.x > t0) { t1 = min(t1, hm.x); hitCore = true; }
  let dmin = clamp(max(t0, 1.0) * pix * 1.4, R * 0.0003, R * 0.004);
  let jit = hash21(posW.xy * 97.3 + vec2<f32>(posW.z * 13.1, 1.7));
  var t = t0 + jit * dmin;
  var T = 1.0; var acc = vec3<f32>(0.0);
  let sunL = vec3<f32>(dot(m0, sd0), dot(m1, sd0), dot(m2, sd0));
  let muv = dot(rd, sd0);
  let phase = 0.30 + 0.7 * hgPhase(muv, 0.55);
  let heatCol = vec3<f32>(1.0, 0.42, 0.12);
  for (var i = 0; i < 56; i++) {
    if (t >= t1 || T < 0.012) { break; }
    let dt = dmin + 0.055 * (t - t0);
    let dd = min(dt, t1 - t);
    let tm = t + dd * 0.5;
    let pw = ro + rd * tm;
    let r = length(pw);
    let dn = (R - r) / R;
    var sg = 2.0 * exp(dn / 0.004) / R;
    if (dn >= 0.0) { sg = min(2.0 * exp(dn / 0.02), 40.0) / R; }
    let up = pw / r;
    let mu = dot(up, sd0);
    let dg = max(dn, 0.0);
    let tauG = 0.04 * (exp(min(dg, 0.06) / 0.02) - 1.0) + 40.0 * max(dg - 0.06, 0.0);
    let lightG = exp(-tauG / max(mu, 0.07)) * sstep(-0.12, 0.14, mu);
    var sC = 0.0; var scol = vec3<f32>(0.0); var shadow = 1.0;
    if (dn > -0.012 && dn < 0.05) {
      let pL = vec3<f32>(dot(m0, pw), dot(m1, pw), dot(m2, pw));
      let fpu = tm * pix;
      let lodO = i32(clamp(log2(R * 0.02 / (fpu * 3.0 + 1.0)), 1.0, 4.0));
      let dirp = pL / r;
      let ang = dn * 5.0 * sin(dirp.y * 3.0 + seed) + dn * 1.2;
      let ca = cos(ang); let sa = sin(ang);
      let dsh = vec3<f32>(dirp.x * ca - dirp.z * sa, dirp.y, dirp.x * sa + dirp.z * ca);
      let f = gasField(dsh, seed, bands, uB.x, uB.y, uB.w, p0, p1, p2, p3, p4, stormCol, storm, time, lodO);
      let q1 = dn / 0.0045; let q2 = (dn - 0.013) / 0.006; let q3 = (dn - 0.032) / 0.011; let w1 = exp(-q1 * q1); let w2 = exp(-q2 * q2); let w3 = exp(-q3 * q3);
      let n3 = fbm(pL * (260.0 / R) * vec3<f32>(1.0, 1.5, 1.0) + vec3<f32>(seed), min(lodO, 3)) * 0.5 + 0.5;
      var dens = (w1 * (0.45 + 0.9 * f.w) + w2 * (0.55 + 0.5 * (1.0 - f.w)) + w3 * 0.6) * (0.25 + 1.1 * n3);
      dens = max(dens - 0.18, 0.0);
      sC = dens * 300.0 / R;
      let c2 = mix(f.xyz * 0.7, p3, 0.45); let c3 = vec3<f32>(0.34, 0.44, 0.6);
      scol = (w1 * f.xyz + w2 * c2 + w3 * c3) / (w1 + w2 + w3 + 1.0e-3);
      if (dens > 0.01) {
        let pLs = pL + sunL * (0.005 * R);
        let n3s = fbm(pLs * (260.0 / R) * vec3<f32>(1.0, 1.5, 1.0) + vec3<f32>(seed), 2) * 0.5 + 0.5;
        let ds = (w1 * 0.9 + w2 * 0.8 + w3 * 0.6) * (0.25 + 1.1 * n3s);
        shadow = exp(-ds * 1.7);
      }
    }
    let sT = sg + sC;
    let fogCol = mix(vec3<f32>(0.55, 0.65, 0.95), vec3<f32>(0.32, 0.17, 0.08), clamp(dg / 0.05, 0.0, 1.0));
    let heat = pow(clamp(dg / 0.3, 0.0, 1.0), 1.8);
    var J = sc0 * lightG * (scol * (sC * shadow * phase + sC * 0.06) + fogCol * sg * 0.3);
    J += heatCol * thermK * (0.04 + 0.5 * heat) * sg;
    if (luma(sc1) > 0.001) { J += sc1 * lightG * (scol * sC * 0.4 + fogCol * sg * 0.1); }
    let ex = exp(-sT * dd);
    acc += T * J * (1.0 - ex) / max(sT, 1.0e-9);
    T *= ex;
    t += dt;
  }
  if (hitCore && T > 0.012) {
    let pm = ro + rd * t1; let nm = normalize(pm);
    let dL = normalize(vec3<f32>(dot(m0, pm), dot(m1, pm), dot(m2, pm)));
    let cell = voronoi(dL * 7.0 + vec3<f32>(time * 0.00012, 0.0, seed));
    let lane = sstep(0.0, 0.2, cell.y - cell.x);
    let flow = fbm(dL * 5.0 + vec3<f32>(0.0, time * 0.00018, seed), 4) * 0.5 + 0.5;
    let plate = mix(coreCol, vec3<f32>(0.95, 0.85, 0.7), 0.5) * (0.55 + 0.6 * flow);
    let hot = vec3<f32>(1.0, 0.38, 0.08) * (1.4 + 1.6 * flow);
    let shimmer = 0.65 + 0.35 * sq(1.0 - max(dot(nm, -rd), 0.0));
    acc += T * mix(hot, plate, lane) * shimmer * thermK;
    T = 0.0;
  }
  return vec4<f32>(acc * volMix, (1.0 - T) * volMix);
}`, [LIB, GASFIELD]);
