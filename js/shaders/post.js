import { wgslFn } from 'three/tsl';
import { LIB } from './lib.js';

// Black hole: Schwarzschild null-geodesic integration (rs = 1) with a Doppler-beamed thin accretion disk, sampling the scene for lensed background.
export const BHLENS = wgslFn(`
fn bhLens(tex: texture_2d<f32>, smp: sampler, uv: vec2<f32>,
  right: vec3<f32>, upv: vec3<f32>, fwd: vec3<f32>, aspTan: vec2<f32>,
  bhDir: vec3<f32>, D: f32, axis: vec3<f32>, disk: vec4<f32>, extra: vec4<f32>, expo: f32) -> vec4<f32> {
  // disk = (rin, rout, temperature K, intensity) ; extra = (time, active, spinFactor, faint)
  let base = textureSample(tex, smp, uv);
  if (extra.y < 0.5) { return vec4<f32>(base.rgb * expo, 1.0); }
  let ndc = uv * 2.0 - vec2<f32>(1.0);
  let ray = normalize(right * (ndc.x * aspTan.x) + upv * (ndc.y * aspTan.y) + fwd);
  let e1 = -bhDir;
  let cosT = clamp(dot(ray, bhDir), -1.0, 1.0);
  let sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
  let b = D * sinT;
  let rin = disk.x; let rout = disk.y;
  let bMax = max(rout * 1.25, 16.0);
  var dirOut = ray; var captured = false;
  var diskCol = vec3<f32>(0.0); var trans = 1.0; var glow = 0.0;
  var e2 = ray - e1 * dot(ray, e1);
  let e2l = length(e2);
  if (e2l < 1e-5) { e2 = normalize(cross(e1, axis + vec3<f32>(0.0013, 0.0021, 0.0007))); } else { e2 = e2 / e2l; }
  if (b < bMax || b < 80.0) {
    var u = 1.0 / D; var du = u * cosT / max(sinT, 1e-4);
    var phi = 0.0;
    var prev = e1 * D;
    let nS = 110;
    for (var i = 0; i < nS; i++) {
      let r0 = 1.0 / u;
      let dphi = 0.035 + 0.075 * clamp((r0 - 5.0) / 40.0, 0.0, 1.0);
      let a1 = -u + 1.5 * u * u;
      let um = u + du * dphi * 0.5; let dum = du + a1 * dphi * 0.5;
      let a2 = -um + 1.5 * um * um;
      u += dum * dphi; du += a2 * dphi; phi += dphi;
      if (u > 1.0) { captured = true; break; }
      let r = 1.0 / max(u, 1e-6);
      let pos = (e1 * cos(phi) + e2 * sin(phi)) * r;
      let s0 = dot(prev, axis); let s1 = dot(pos, axis);
      if (s0 * s1 < 0.0 && trans > 0.02) {
        let f = s0 / (s0 - s1); let pc = mix(prev, pos, f); let rc = length(pc);
        if (rc > rin && rc < rout) {
          let kb = normalize(pos - prev);          // backward-traced direction
          let tang = normalize(cross(axis, pc));   // prograde flow
          let beta = sqrt(0.5 / max(rc - 1.0, 0.2));
          let nph = -kb;                           // photon travel direction (towards the observer)
          let gam = 1.0 / sqrt(max(1.0 - beta * beta, 0.05));
          let gD = 1.0 / (gam * (1.0 - beta * dot(tang, nph) * (0.6 + 0.4 * extra.z)));
          let gR = sqrt(max(1.0 - 1.0 / rc, 0.02));
          let g = gD * gR;
          let Tem = disk.z * pow(rin / rc, 0.75) * (1.0 - sqrt(rin / rc) * 0.35);
          let ang = atan2(dot(pc, cross(axis, vec3<f32>(0.3, 0.9, 0.2))), dot(pc, normalize(cross(cross(axis, vec3<f32>(0.3, 0.9, 0.2)), axis))));
          let om = 0.9 / (rc * sqrt(rc));
          let tur = fbm(vec3<f32>(log(rc) * 6.0, (ang - om * extra.x * 6.0) * 2.0 , 3.7), 4) * 0.5 + 0.5;
          let tur2 = fbm(vec3<f32>(log(rc) * 20.0, (ang - om * extra.x * 6.0) * 7.0, 8.1), 3) * 0.5 + 0.5;
          let streak = 0.45 + 0.9 * tur * (0.6 + 0.8 * tur2);
          let I = pow(Tem / disk.z, 3.0) * pow(g, 3.6) * streak * disk.w * 2.6;
          let colr = blackbody(Tem * g * 0.82 + 600.0) ;
          let alpha = clamp(0.92 * sstep(rout, rout * 0.55, rc) * sstep(rin, rin * 1.08, rc), 0.0, 0.95);
          diskCol += colr * I * alpha * trans;
          trans *= (1.0 - alpha * 0.85);
        }
      }
      prev = pos;
      if (du < 0.0 && (u < 0.65 / D || phi > 7.0)) { break; }
    }
    if (!captured) { dirOut = normalize((e1 * cos(phi) + e2 * sin(phi)) * (1.0 / max(u, 1e-6)) - prev); if (!(length(dirOut) > 0.5)) { dirOut = ray; } }
    glow = exp(-sq((b - 2.6) / 0.35)) * 0.6;
  } else {
    // weak field: rotate ray towards the BH by 2/b
    let al = 2.0 / max(b, 1.0);
    dirOut = normalize(ray + normalize(bhDir - ray * cosT + vec3<f32>(1e-6)) * al);
  }
  // sample lensed background
  let dc = vec3<f32>(dot(dirOut, right), dot(dirOut, upv), dot(dirOut, fwd));
  var bg = vec3<f32>(0.0);
  if (!captured) {
    if (dc.z > 0.02) {
      let uvS = (dc.xy / (dc.z * aspTan)) * 0.5 + vec2<f32>(0.5);
      let inside = step(0.0, uvS.x) * step(uvS.x, 1.0) * step(0.0, uvS.y) * step(uvS.y, 1.0);
      let sm = textureSample(tex, smp, clamp(uvS, vec2<f32>(0.001), vec2<f32>(0.999)));
      bg = sm.rgb * mix(0.25, 1.0, inside);
    }
  }
  var out = bg * trans + diskCol;
  out += vec3<f32>(1.0, 0.8, 0.55) * glow * disk.w * 0.06 * sstep(0.0, 1.0, extra.y) * step(0.5, disk.w);
  // blend smoothly into the plain image far from the hole
  let mixk = sstep(bMax * 1.0, bMax * 0.8, b);
  let inner = mix(base.rgb, out, select(1.0, mixk, b >= bMax * 0.8));
  return vec4<f32>(inner * expo, 1.0);
}`, [LIB]);

export const COMPOSITE = wgslFn(`
fn composite(scene: vec4<f32>, bloomC: vec4<f32>, uv: vec2<f32>, exposure: f32, bloomK: f32, vig: f32, sat: f32, grainT: f32) -> vec4<f32> {
  var c = (scene.rgb + bloomC.rgb * bloomK) * exposure;
  let d = uv - vec2<f32>(0.5);
  c *= 1.0 - vig * dot(d, d) * 1.6;
  let l = luma(c);
  c = mix(vec3<f32>(l), c, sat);
  c = aces(c * 0.85) * 1.04;
  let g = (hash21(uv * 913.0 + vec2<f32>(grainT)) - 0.5) * 0.0025;
  c += vec3<f32>(g);
  return vec4<f32>(max(c, vec3<f32>(0.0)), 1.0);
}`, [LIB]);
