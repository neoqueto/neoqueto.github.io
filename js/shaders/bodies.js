import { wgslFn } from 'three/tsl';
import { LIB } from './lib.js';

// ---- shared helper: multi-scale surface detail height (km) and Mikkelsen bump ------------
export const DETAIL = wgslFn(`
fn detailH(dir: vec3<f32>, R: f32, camDist: f32, seed: f32, rough: f32) -> f32 {
  // wavelengths in km; fade out scales smaller than the pixel footprint
  let foot = max(camDist, 0.05) * 0.0016;
  var h = 0.0;
  var wl = 90.0;
  for (var i = 0; i < 6; i++) {
    let amp = wl * 0.09 * rough;
    let vis = sstep(foot * 1.5, foot * 6.0, wl);
    if (vis > 0.001) { h += amp * vis * gnoise(dir * (R / wl) + vec3<f32>(seed * 13.7 + f32(i) * 7.3)); }
    wl = wl * 0.2;
  }
  return h;
}`, [LIB]);

export const BUMP = wgslFn(`
fn bumpNormal(p: vec3<f32>, n: vec3<f32>, h: f32, strength: f32) -> vec3<f32> {
  let dpx = dpdx(p); let dpy = dpdy(p); let dhx = dpdx(h); let dhy = dpdy(h);
  let r1 = cross(dpy, n); let r2 = cross(n, dpx);
  let det = dot(dpx, r1);
  let grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - grad * strength);
}`);

export const OCCLUDE = wgslFn(`
fn occlude(p: vec3<f32>, L: vec3<f32>, oc: vec4<f32>) -> f32 {
  if (oc.w <= 0.0) { return 1.0; }
  let t = dot(oc.xyz - p, L);
  if (t <= 0.0) { return 1.0; }
  let d = length(p + L * t - oc.xyz);
  let pen = t * 0.0093 + oc.w * 0.04;
  return sstep(oc.w - pen, oc.w + pen, d);
}`, [LIB]);

export const CLOUDD = wgslFn(`
fn cloudDensity(dir: vec3<f32>, cld: vec4<f32>, time: f32, oct: i32) -> f32 {
  let ang = time * 0.00006 * cld.z;
  let ca = cos(ang); let sa = sin(ang);
  var q = vec3<f32>(dir.x * ca - dir.z * sa, dir.y, dir.x * sa + dir.z * ca) + vec3<f32>(cld.w);
  q.x += 0.10 * sin(dir.y * 11.0 + cld.w) + 0.05 * sin(dir.y * 27.0);
  q.y += time * 0.000012 * cld.z;
  let warp = fbm(q * 3.0, 3) * 0.35;
  var d = fbm((q + vec3<f32>(warp)) * 4.2, oct) * 0.5 + 0.5;
  d += 0.15 * fbm(q * 14.0, 2);
  return sstep(1.0 - cld.x, 1.0 - cld.x + 0.3, d);
}`, [LIB]);

// ---- rocky planet ----------------------------------------------------------------------
export const ROCKY = wgslFn(`
fn rockyFrag(
  dirL: vec3<f32>, nW: vec3<f32>, posW: vec3<f32>, elev: f32, pc: vec3<f32>,
  uA: vec4<f32>, uB: vec4<f32>, uC: vec4<f32>,
  cLow: vec3<f32>, cMid: vec3<f32>, cDry: vec3<f32>, cHigh: vec3<f32>, cSnow: vec3<f32>, cSand: vec3<f32>, cWS: vec3<f32>, cWD: vec3<f32>, cLava: vec3<f32>,
  sd0: vec3<f32>, sc0: vec3<f32>, sd1: vec3<f32>, sc1: vec3<f32>, sL0: vec3<f32>,
  aRay: vec3<f32>, aAbs: vec3<f32>, aP: vec4<f32>, aH: vec2<f32>,
  cld: vec4<f32>, time: f32, o0: vec4<f32>, o1: vec4<f32>, o2: vec4<f32>
) -> vec4<f32> {
  let R = uA.z; let biome = i32(uA.x + 0.5); let seed = uA.y; let relief = max(uA.w, 0.001) * 1000.0;
  let dir = normalize(dirL);
  let up = normalize(posW - pc);
  let ng = normalize(nW);
  let camDist = length(posW);
  let V = -normalize(posW);
  let alat = abs(dir.y);
  let sdir = dir + vec3<f32>(seed * 0.31);
  let hasAtm = aH.y;
  let moist = fbm(sdir * 3.1, 4) * 0.5 + 0.5;
  let patchN = fbm(sdir * 8.3 + vec3<f32>(4.0), 4) * 0.5 + 0.5;
  let hN = clamp(elev / relief, -1.0, 1.5);
  let slope = clamp(1.0 - dot(ng, up), 0.0, 1.0);
  var alb = cMid; var emis = vec3<f32>(0.0); var spec = 0.0; var rough = 1.0; var isWater = false; var waterDepth = 0.0;
  let dH = detailH(dir, R, camDist, seed, 1.0);
  var bumpH = dH;
  let hasOcean = uB.x > 0.5;
  var snowAmt = 0.0;

  if (biome == 0 || biome == 1) { // terran / ocean
    var land = mix(cLow, cMid, sstep(0.25, 0.7, moist + 0.25 * patchN));
    let band = exp(-pow((alat - 0.32) / 0.2, 2.0));
    land = mix(land, cDry, clamp(band * sstep(0.35, 0.7, 1.0 - moist) * 1.4, 0.0, 1.0));
    land = mix(land, cHigh, sstep(0.22, 0.55, hN + 0.1 * (patchN - 0.5)));
    land = mix(land, cHigh * 0.85, sstep(0.1, 0.32, slope));
    land = mix(land, cSand, sstep(0.06, 0.0, hN) * 0.7);
    land *= 0.85 + 0.3 * fbm(sdir * 30.0, 3);
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
      let foam = sstep(90.0, 0.0, waterDepth) * (0.5 + 0.5 * gnoise(sdir * 600.0 + vec3<f32>(time * 0.15)));
      alb = mix(alb, vec3<f32>(0.9), foam * 0.5 * (1.0 - seaIce));
      // waves
      bumpH = 0.0012 * gnoise(dir * (R / 0.12) + vec3<f32>(time * 0.6, 0.0, time * 0.4)) + 0.0004 * gnoise(dir * (R / 0.03) - vec3<f32>(0.0, time * 0.9, 0.0));
    }
  } else if (biome == 2) { // desert
    let dune = ridged(vec3<f32>(sdir.x * 30.0 + 0.8 * fbm(sdir * 7.0, 3), sdir.y * 30.0, sdir.z * 30.0), 3);
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cDry, sstep(0.35, 0.75, patchN));
    c = mix(c, cSand, sstep(0.35, 0.8, dune) * uC.y * 0.8);
    c = mix(c, cHigh, sstep(0.3, 0.7, hN) + sstep(0.12, 0.35, slope) * 0.6);
    let strata = 0.9 + 0.12 * sin(elev * 0.02 + 3.0 * gnoise(sdir * 5.0));
    alb = c * strata;
    snowAmt = clamp(sstep(0.88, 0.97, alat + 0.05 * patchN) * uB.y * 2.0, 0.0, 1.0);
    alb = mix(alb, cSnow, snowAmt);
    bumpH = dH + 0.02 * dune;
  } else if (biome == 3 || biome == 9) { // barren / asteroid
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist + 0.3 * (patchN - 0.5)));
    c = mix(c, cDry, sstep(0.5, 0.8, patchN));
    c = mix(c, cHigh, sstep(0.35, 0.7, hN));
    let maria = sstep(0.52, 0.42, fbm(sdir * 1.6 + vec3<f32>(9.0), 4) * 0.5 + 0.5);
    c *= mix(1.0, 0.55, maria * uC.w);
    c *= 0.8 + 0.4 * fbm(sdir * 55.0, 3) * 0.5 + 0.4 * sstep(0.15, 0.35, slope);
    if (biome == 9) { c *= uC.z * 0.4 + 0.6 * (0.7 + 0.5 * fbm(sdir * 4.0, 3)); }
    alb = c;
  } else if (biome == 4) { // ice
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cDry, sstep(0.45, 0.8, patchN));
    let lin = pow(ridged(sdir * 6.0 + vec3<f32>(fbm(sdir * 2.0, 3) * 0.5), 4), 5.0);
    c = mix(c, cSand, clamp(lin * uC.z * 2.2, 0.0, 0.85));
    c = mix(c, cHigh, sstep(0.4, 0.8, hN));
    alb = c * (0.9 + 0.15 * fbm(sdir * 40.0, 3));
    spec = 0.15;
  } else if (biome == 5) { // lava
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cDry, sstep(0.45, 0.8, patchN));
    c = mix(c, cHigh, sstep(0.3, 0.7, hN));
    let cr = ridged(sdir * 5.0 + vec3<f32>(fbm(sdir * 3.0, 3) * 0.4), 5);
    let glowMask = sstep(0.62, 0.9, cr);
    let sea = sstep(0.03, -0.12, hN);
    let pulse = 0.75 + 0.25 * sin(time * 0.7 + 6.0 * fbm(sdir * 12.0, 3));
    let g = clamp(max(glowMask * 0.85, sea) * uB.w, 0.0, 1.0);
    c = mix(c, cLava * 0.15, g);
    emis = cLava * g * 7.0 * pulse * (0.7 + 0.5 * fbm(sdir * 40.0 + vec3<f32>(time * 0.02), 3));
    alb = c;
  } else if (biome == 6) { // volcanic (Io-like)
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cDry, sstep(0.4, 0.8, patchN));
    let v = voronoi(sdir * 14.0);
    let paterae = sstep(0.16, 0.09, v.x) * step(0.55, v.z);
    c = mix(c, vec3<f32>(0.05, 0.03, 0.02), paterae * 0.9);
    c = mix(c, cHigh, sstep(0.35, 0.7, patchN) * 0.5 * sstep(0.2, 0.5, hN + 0.3));
    emis = cLava * sstep(0.1, 0.03, v.x) * step(0.7, v.z) * uB.w * 4.0;
    alb = c;
  } else if (biome == 7) { // venus-like greenhouse
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cHigh, sstep(0.3, 0.7, hN));
    alb = c * (0.85 + 0.3 * patchN);
  } else { // tholin
    var c = mix(cLow, cMid, sstep(0.3, 0.7, moist));
    c = mix(c, cSand, sstep(0.4, 0.8, ridged(sdir * 18.0, 3)) * 0.7);
    c = mix(c, cHigh, sstep(0.3, 0.7, hN));
    alb = c;
    if (elev <= 0.0) { isWater = true; waterDepth = -elev; alb = mix(cWS, cWD, 1.0 - exp(-waterDepth / 200.0)); spec = 0.8; bumpH = 0.0004 * gnoise(dir * (R / 0.05) + vec3<f32>(time * 0.4)); }
  }
  // bump mapping from the multi-scale detail
  var n = ng;
  if (isWater) { n = bumpNormal(posW, ng, bumpH, 1.5); } else { n = bumpNormal(posW, ng, bumpH + dH * 0.0, 1.0); }
  // lighting
  let cs = 0.0;
  var col = vec3<f32>(0.0);
  var specCol = vec3<f32>(0.0);
  let pr = posW - pc;
  var shadow0 = occlude(pr, sd0, o0) * occlude(pr, sd0, o1) * occlude(pr, sd0, o2);
  var shadow1 = occlude(pr, sd1, o0) * occlude(pr, sd1, o1) * occlude(pr, sd1, o2);
  // cloud shadow
  if (cld.x > 0.01) {
    let sp = normalize(dir + normalize(sL0) * (cld.y / R) * 1.4);
    let cd = cloudDensity(sp, cld, time, 4);
    shadow0 = shadow0 * (1.0 - 0.55 * cd);
  }
  let wrap = 0.12 * hasAtm;
  let nd0 = dot(n, sd0); let nd1 = dot(n, sd1);
  let diff0 = max((nd0 + wrap) / (1.0 + wrap), 0.0) * shadow0 * sstep(-0.05, 0.1, dot(ng, sd0) + 0.1);
  let diff1 = max((nd1 + wrap) / (1.0 + wrap), 0.0) * shadow1 * sstep(-0.05, 0.1, dot(ng, sd1) + 0.1);
  col = alb * (sc0 * diff0 + sc1 * diff1);
  // water: sun glints + fresnel sky reflection
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
  // airless: faint opposition surge / ambient from planetshine
  col += alb * (sc0 + sc1) * 0.0008;
  col += specCol + emis;
  // atmospheric aerial perspective
  if (hasAtm > 0.5) {
    let rd = normalize(posW);
    let s0 = atmoScatter(-pc, rd, camDist, R, aH.x, aRay, aP.x, aP.y, aAbs, aP.z, aP.w, sd0, sc0 * 6.0);
    var inS = s0.rgb; var T = s0.a;
    if (luma(sc1) > 0.001) { let s1 = atmoScatter(-pc, rd, camDist, R, aH.x, aRay, aP.x, aP.y, aAbs, aP.z, aP.w, sd1, sc1 * 6.0); inS += s1.rgb; }
    col = col * T + inS;
  }
  return vec4<f32>(col, 1.0);
}`, [LIB, DETAIL, BUMP, OCCLUDE, CLOUDD]);

// ---- gas giant -----------------------------------------------------------------------------
export const GAS = wgslFn(`
fn gasFrag(
  dirL: vec3<f32>, nW: vec3<f32>, posW: vec3<f32>, pc: vec3<f32>,
  uA: vec4<f32>, uB: vec4<f32>, uC: vec4<f32>,
  p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, p4: vec3<f32>, stormCol: vec3<f32>, storm: vec4<f32>,
  sd0: vec3<f32>, sc0: vec3<f32>, sd1: vec3<f32>, sc1: vec3<f32>,
  aRay: vec3<f32>, aAbs: vec3<f32>, aP: vec4<f32>, aH: vec2<f32>,
  time: f32, o0: vec4<f32>, o1: vec4<f32>, o2: vec4<f32>
) -> vec4<f32> {
  let R = uA.z; let seed = uA.y; let bands = uA.w; let contrast = uB.x; let turb = uB.y; let hot = uB.z; let haze = uB.w;
  let dir = normalize(dirL); let n = normalize(nW);
  let lat = dir.y;
  let V = -normalize(posW);
  let pr = posW - pc;
  // differential rotation: each band drifts
  let bandId = floor(lat * bands * 0.5 + 0.5);
  let drift = time * 0.00004 + (hash11(bandId + seed) - 0.5) * 0.00006 * time;
  let cd = cos(drift); let sdr = sin(drift);
  let p = vec3<f32>(dir.x * cd - dir.z * sdr, dir.y, dir.x * sdr + dir.z * cd);
  let sp = p + vec3<f32>(seed * 0.113);
  // flow-warped band coordinate
  let w1 = fbm(vec3<f32>(sp.x * 3.0, sp.y * 7.0, sp.z * 3.0), 4);
  let w2 = fbm(vec3<f32>(sp.x * 9.0 + 3.0, sp.y * 24.0, sp.z * 9.0), 4);
  let b = lat * bands * 0.5 + turb * (0.55 * w1 + 0.18 * w2);
  let s1 = 0.5 + 0.5 * sin(b * PI * 2.0 + 1.3 * w1);
  let s2 = 0.5 + 0.5 * sin(b * PI * 4.3 + 2.0 * w2);
  let zone = sstep(0.35, 0.65, s1);
  var c = mix(p0, p1, zone);
  c = mix(c, p2, sstep(0.55, 0.9, s2) * 0.6);
  c = mix(c, p3, sstep(0.6, 0.95, 1.0 - s1) * 0.55 * contrast);
  c = mix(c, p4, clamp(w2 * 1.4, 0.0, 0.5));
  // fine eddies & streaks
  let eddy = fbm(vec3<f32>(sp.x * 14.0, sp.y * 60.0, sp.z * 14.0) + vec3<f32>(w1 * 2.0), 5);
  c *= 1.0 + eddy * 0.55 * contrast;
  c *= 1.0 + (s1 - 0.5) * 0.85 * contrast + (s2 - 0.5) * 0.25 * contrast;
  // white ammonia clouds on bright zones (turbulent edges)
  let curl = ridged(vec3<f32>(sp.x * 10.0, sp.y * 34.0, sp.z * 10.0) + vec3<f32>(w2 * 3.0), 4);
  c = mix(c, vec3<f32>(0.95, 0.93, 0.88), sstep(0.55, 0.9, curl) * 0.45 * zone * contrast * haze);
  // big storm + vortices
  let lon = atan2(dir.z, dir.x);
  if (storm.w > 0.5) {
    var d = vec2<f32>((lon - storm.z + 3.14159) - floor((lon - storm.z + 3.14159) / 6.28318) * 6.28318 - 3.14159, asin(clamp(lat, -1.0, 1.0)) - storm.x);
    d = vec2<f32>(d.x * cos(storm.x) / (storm.y * 1.7), d.y / storm.y);
    let r = length(d);
    let ang = atan2(d.y, d.x) + r * 4.0 - time * 0.00008;
    let sw = 0.5 + 0.5 * sin(ang * 3.0 + fbm(vec3<f32>(d * 3.0, 1.0), 3) * 4.0);
    let m = sstep(1.0, 0.55, r);
    c = mix(c, mix(stormCol, stormCol * 1.35 + vec3<f32>(0.05), sw), m);
    c = mix(c, vec3<f32>(0.9, 0.88, 0.8), sstep(1.25, 1.0, r) * sstep(0.85, 1.0, r) * 0.4);
  }
  let vv = voronoi(vec3<f32>(sp.x * 9.0, sp.y * 16.0, sp.z * 9.0));
  c = mix(c, mix(stormCol, vec3<f32>(0.95, 0.95, 0.92), step(0.5, hash11(vv.z * 91.0))), sstep(0.1, 0.04, vv.x) * step(0.93, vv.z) * 0.8);
  // lighting
  let mu = max(dot(n, V), 0.0);
  c *= 0.55 + 0.45 * pow(mu, 0.5);
  let shadow0 = occlude(pr, sd0, o0) * occlude(pr, sd0, o1) * occlude(pr, sd0, o2);
  let shadow1 = occlude(pr, sd1, o0) * occlude(pr, sd1, o1) * occlude(pr, sd1, o2);
  let d0 = max((dot(n, sd0) + 0.1) / 1.1, 0.0) * shadow0; let d1 = max((dot(n, sd1) + 0.1) / 1.1, 0.0) * shadow1;
  var col = c * (sc0 * d0 + sc1 * d1);
  // thermal glow (hot jupiters / young giants)
  let night = 1.0 - clamp(d0 * 1.5, 0.0, 1.0);
  col += vec3<f32>(1.0, 0.28, 0.06) * hot * (0.4 + 4.0 * (1.0 - night * 0.75)) * (0.6 + 0.8 * fbm(sp * 8.0 + vec3<f32>(time * 0.0002), 4)) * (0.5 + 0.5 * mu);
  // limb haze
  let rd = normalize(posW);
  let s0 = atmoScatter(-pc, rd, length(posW), R, aH.x, aRay, aP.x, aP.y, aAbs, aP.z, aP.w, sd0, sc0 * 6.0);
  var inS = s0.rgb; var T = s0.a;
  if (luma(sc1) > 0.001) { inS += atmoScatter(-pc, rd, length(posW), R, aH.x, aRay, aP.x, aP.y, aAbs, aP.z, aP.w, sd1, sc1 * 6.0).rgb; }
  col = col * T + inS;
  return vec4<f32>(col, 1.0);
}`, [LIB, OCCLUDE]);

// ---- cloud shell (rocky planets) -------------------------------------------------------------------
export const CLOUD = wgslFn(`
fn cloudFrag(dirL: vec3<f32>, nW: vec3<f32>, posW: vec3<f32>, pc: vec3<f32>, cld: vec4<f32>, cCol: vec3<f32>,
  sd0: vec3<f32>, sc0: vec3<f32>, sd1: vec3<f32>, sc1: vec3<f32>, time: f32, R: f32, o0: vec4<f32>, o1: vec4<f32>, o2: vec4<f32>) -> vec4<f32> {
  let dir = normalize(dirL); let n = normalize(nW);
  let V = -normalize(posW);
  let pr = posW - pc;
  let dens = cloudDensity(dir, cld, time, 6);
  if (dens < 0.003) { return vec4<f32>(0.0); }
  let shadow0 = occlude(pr, sd0, o0) * occlude(pr, sd0, o1) * occlude(pr, sd0, o2);
  let nd0 = dot(n, sd0); let nd1 = dot(n, sd1);
  let l0 = max((nd0 + 0.18) / 1.18, 0.0) * shadow0; let l1 = max((nd1 + 0.18) / 1.18, 0.0);
  // thicker cloud -> brighter, silver lining at thin edges
  let thick = sstep(0.0, 0.8, dens);
  let lit = (0.25 + 0.75 * thick);
  var col = cCol * (sc0 * l0 + sc1 * l1) * (0.55 + 0.45 * lit);
  col += cCol * sc0 * pow(max(dot(reflect(-sd0, n), V), 0.0), 8.0) * 0.12 * shadow0;
  col += cCol * (sc0 + sc1) * 0.0006;
  let a = dens * 0.92;
  return vec4<f32>(col * a, a);
}`, [LIB, OCCLUDE, CLOUDD]);

// ---- atmosphere shell (back faces) -----------------------------------------------------------------------
export const ATMOS = wgslFn(`
fn atmosFrag(posW: vec3<f32>, pc: vec3<f32>, R: f32, aRay: vec3<f32>, aAbs: vec3<f32>, aP: vec4<f32>, aH: f32,
  sd0: vec3<f32>, sc0: vec3<f32>, sd1: vec3<f32>, sc1: vec3<f32>) -> vec4<f32> {
  let rd = normalize(posW);
  let s0 = atmoScatter(-pc, rd, 1.0e12, R, aH, aRay, aP.x, aP.y, aAbs, aP.z, aP.w, sd0, sc0 * 6.0);
  var inS = s0.rgb; var T = s0.a;
  if (luma(sc1) > 0.001) { let s1 = atmoScatter(-pc, rd, 1.0e12, R, aH, aRay, aP.x, aP.y, aAbs, aP.z, aP.w, sd1, sc1 * 6.0); inS += s1.rgb; T = min(T, s1.a); }
  return vec4<f32>(inS, T);
}`, [LIB]);

// ---- rings ----------------------------------------------------------------------------------------------------
export const RING = wgslFn(`
fn ringFrag(posL: vec3<f32>, posW: vec3<f32>, pc: vec3<f32>, R: f32, uA: vec4<f32>, uB: vec4<f32>, c1: vec3<f32>, c2: vec3<f32>,
  sd0: vec3<f32>, sc0: vec3<f32>, sd1: vec3<f32>, sc1: vec3<f32>, sdL0: vec3<f32>, normalW: vec3<f32>) -> vec4<f32> {
  // uA = (inner, outer, seed, opacity) in planet radii; uB = (gaps, dust, 0, 0)
  let r = length(posL.xz) / R;
  let t = (r - uA.x) / (uA.y - uA.x);
  if (t < 0.0 || t > 1.0) { return vec4<f32>(0.0); }
  let s = uA.z;
  // radial density: layered 1-D noise, sharp gaps, fine ringlets
  let x = vec3<f32>(r * 60.0 + s, s * 0.7, 3.1);
  var dens = 0.55 + 0.45 * fbm(x * vec3<f32>(0.5, 1.0, 1.0), 5);
  dens *= 0.6 + 0.8 * sstep(0.35, 0.65, fbm(vec3<f32>(r * 220.0, s, 7.7), 3) * 0.5 + 0.5);
  var gaps = 1.0;
  let ng = i32(uB.x);
  for (var i = 0; i < 5; i++) { if (i < ng) { let gc = 0.12 + 0.76 * hash11(s + f32(i) * 3.3); let gw = 0.012 + 0.03 * hash11(s + f32(i) * 9.1); gaps *= 1.0 - sstep(gw, gw * 0.4, abs(t - gc)) * 0.97; } }
  let edge = sstep(0.0, 0.04, t) * sstep(1.0, 0.94, t);
  dens = clamp(dens * gaps * edge, 0.0, 1.0);
  let col0 = mix(c1, c2, sstep(0.3, 0.8, fbm(vec3<f32>(r * 40.0, s, 1.3), 3) * 0.5 + 0.5));
  // lighting & planet shadow
  let rel = posW - pc;
  let ps0 = raySphere(rel, sd0, R); let ps1 = raySphere(rel, sd1, R);
  let sh0 = select(1.0, 0.04, ps0.x > 0.0);
  let sh1 = select(1.0, 0.04, ps1.x > 0.0);
  let V = -normalize(posW);
  let lit0 = sh0; let lit1 = sh1;
  // forward scattering when the sun is behind the ring (we look through)
  let fw0 = pow(max(dot(-V, sd0), 0.0), 4.0);
  let sideSun = abs(dot(normalW, sd0));
  var col = col0 * (sc0 * lit0 * (0.35 + 0.65 * sideSun) + sc1 * lit1 * 0.3) * (0.6 + 0.4 * dens);
  col += col0 * sc0 * lit0 * fw0 * uB.y * 1.5;
  let a = dens * uA.w;
  return vec4<f32>(col * a, a);
}`, [LIB]);

// ---- star surface ---------------------------------------------------------------------------------------------------
export const STARSURF = wgslFn(`
fn starFrag(dirL: vec3<f32>, nW: vec3<f32>, posW: vec3<f32>, uA: vec4<f32>, uB: vec4<f32>, col: vec3<f32>, time: f32) -> vec4<f32> {
  // uA = (radPx, seed, conv, spots) ; uB = (radiance, flare, kind, 0)
  let dir = normalize(dirL); let n = normalize(nW); let V = -normalize(posW);
  let mu = clamp(dot(n, V), 0.0, 1.0);
  let sd = dir + vec3<f32>(uA.y * 0.173);
  let radPx = uA.x;
  let gs = clamp(radPx / 5.0, 5.0, 420.0);
  let kind = i32(uB.z + 0.5);
  var gran = 0.0; var spot = 0.0;
  let tt = time * 0.0004;
  if (kind != 6) { // not a compact object
    let big = voronoi(sd * (3.0 + 4.0 * uA.z) + vec3<f32>(tt * 0.15));
    let cells = sstep(0.0, 0.7, big.x);
    gran = (cells - 0.45) * (0.25 + 0.55 * uA.z);
    if (radPx > 40.0 && uA.z < 0.9) { let g2 = voronoi(sd * gs + vec3<f32>(tt, tt * 0.7, 0.0)); gran += (sstep(0.0, 0.8, g2.x) - 0.5) * 0.22 * sstep(40.0, 240.0, radPx); }
    let sn = fbm(sd * 2.2 + vec3<f32>(11.0), 4);
    let lat = abs(dir.y);
    let sm = sstep(0.62, 0.85, sn * 1.6 + 0.5 - lat * 0.4 - 0.35 + uA.w * 0.45) * sstep(0.95, 0.5, lat) * uA.w;
    let umbra = sstep(0.78, 0.95, sn * 1.6 + 0.5 - lat * 0.4 - 0.35 + uA.w * 0.45) ;
    spot = sm * 0.55 + umbra * 0.35 * sm;
    // faculae near the limb
    gran += sstep(0.1, 0.5, 1.0 - mu) * uA.w * 0.15 * (fbm(sd * 12.0, 3) * 0.5 + 0.5);
  }
  let limb = 1.0 - 0.62 * (1.0 - mu) - 0.18 * (1.0 - mu) * (1.0 - mu);
  var I = limb * (1.0 + gran - spot);
  I = max(I, 0.02);
  var c = col * uB.x * I;
  // hotter, whiter core for very hot stars; limb reddening for cool
  c = mix(c, c * vec3<f32>(1.05, 0.95, 0.85), (1.0 - mu) * 0.4 * (1.0 - clamp(col.b, 0.0, 1.0)));
  // flare spots
  let fl = sstep(0.82, 0.95, fbm(sd * 5.0 + vec3<f32>(tt * 6.0), 3) * 0.5 + 0.5) * uB.y;
  c += col * uB.x * fl * 0.9;
  return vec4<f32>(c, 1.0);
}`, [LIB]);

// ---- billboard glows (stars, flares) ------------------------------------------------------------------------------------
export const GLOW = wgslFn(`
fn glowFrag(q: vec2<f32>, col: vec3<f32>, inten: f32, core: f32, time: f32, seed: f32, spikes: f32) -> vec4<f32> {
  let r = length(q);
  if (r > 1.0) { return vec4<f32>(0.0); }
  let edge = sstep(1.0, 0.7, r);
  var g = exp(-r * r * 90.0) * 6.0 + exp(-r * 10.0) * 0.5 + 0.035 / (r * r * 30.0 + 0.12) * sstep(1.0, 0.2, r);
  // streaks / diffraction spikes
  let ax = abs(q.x); let ay = abs(q.y);
  let sp = (exp(-ay * 60.0 / (0.25 + r * 0.8)) * sstep(1.0, 0.1, ax) + exp(-ax * 60.0 / (0.25 + r * 0.8)) * sstep(1.0, 0.1, ay)) * 0.5;
  let d45 = abs(q.x - q.y) * 0.7071; let d45b = abs(q.x + q.y) * 0.7071;
  let sp2 = (exp(-d45 * 90.0) + exp(-d45b * 90.0)) * 0.15 * sstep(1.0, 0.1, r);
  g += (sp + sp2) * spikes;
  return vec4<f32>(col * g * inten * edge, 1.0);
}`, [LIB]);

export const CORONA = wgslFn(`
fn coronaFrag(q: vec2<f32>, col: vec3<f32>, inten: f32, rStar: f32, time: f32, seed: f32, act: f32) -> vec4<f32> {
  // q in [-1,1], star disc has radius rStar (0..1)
  let r = length(q);
  if (r < rStar * 0.985 || r > 1.0) { return vec4<f32>(0.0); }
  let x = (r - rStar) / (1.0 - rStar);
  let ang = atan2(q.y, q.x);
  let streams = fbm(vec3<f32>(cos(ang) * 2.5, sin(ang) * 2.5, time * 0.0003 + seed), 4) * 0.5 + 0.5;
  let rays = 0.5 + 0.7 * streams + 0.4 * fbm(vec3<f32>(ang * 6.0, x * 2.0 - time * 0.0006, seed), 3);
  let fall = exp(-x * 7.0) * 1.6 + exp(-x * 2.2) * 0.35;
  let prom = sstep(0.0, 0.08, x) * exp(-x * 30.0) * (0.6 + 1.4 * sstep(0.55, 0.75, fbm(vec3<f32>(ang * 3.0, seed, time * 0.0004), 3) * 0.5 + 0.5)) * act;
  let a = (fall * rays + prom * 4.0) * sstep(1.0, 0.75, r);
  return vec4<f32>(col * a * inten, 1.0);
}`, [LIB]);
