// Star-system layer: stars, planets (LOD terrain / gas), moons, rings, belts, orbit lines. Units: km, camera at origin.
import { THREE, uniform, attribute, varying, positionGeometry, positionLocal, positionWorld, normalWorld, modelWorldMatrix, cameraViewMatrix, cameraProjectionMatrix, vec2, vec3, vec4, float, V3, V4, F, C3, G, transparentMat, billboardMaterial, billboardMesh, instancedQuads, ribbonMaterial, ribbonGeometry } from './mat.js';
import { ROCKY, GAS, CLOUD, ATMOS, RING, STARSURF, GLOW, CORONA } from '../shaders/bodies.js';
import { PlanetLOD } from './lod.js';
import { C, TAU, qrot, qconj, qfromAxisAngle, qmul, v3, orbitPos, clamp, blackbody } from '../core.js';
import { bodyPos } from '../gen/system.js';
import { terrainHeight } from '../terrain.js';
import { wgslFn } from 'three/tsl';
import { LIB } from '../shaders/lib.js';

const BIOME_ID = { terran: 0, ocean: 1, desert: 2, barren: 3, moon: 3, ice: 4, lava: 5, volcanic: 6, venus: 7, tholin: 8 };
const ZERO3 = [0, 0, 0];
const KM = 0.001;

import { spinQuat } from '../spin.js';
export { spinQuat };
function lightsFor(sys, pos, t, out) { // up to 2 strongest stars: {dir, col}
  const arr = [];
  for (const s of sys.lights) { const sp = bodyPos(s, t); const dx = sp[0] - pos[0], dy = sp[1] - pos[1], dz = sp[2] - pos[2]; const d = Math.hypot(dx, dy, dz) || 1; const E = (s.spec.L) / ((d / C.AU) ** 2); arr.push({ dir: [dx / d, dy / d, dz / d], E, col: s.color, d }); }
  arr.sort((a, b) => b.E - a.E); return arr;
}

class Base { constructor(view, body) { this.view = view; this.body = body; this.group = new THREE.Group(); this.group.matrixAutoUpdate = true; view.scene.add(this.group); this.dead = false; }
  dispose() { this.view.scene.remove(this.group); this.group.traverse((o) => { if (o.geometry && o.geometry.dispose && !o.geometry.userData?.shared) o.geometry.dispose(); }); this.dead = true; } }

// shared light/atmosphere uniform bundle -------------------------------------------------
function lightUniforms() { return { sd0: V3(1, 0, 0), sc0: V3(1, 1, 1), sd1: V3(0, 1, 0), sc1: V3(0, 0, 0), sL0: V3(1, 0, 0), pc: V3(), o0: V4(), o1: V4(), o2: V4() }; }
function atmUniforms(atm, R) {
  const a = atm || { ray: [0, 0, 0], absorb: [0, 0, 0], mie: 0, g: 0.7, Hr: 8000, Hm: 1200, height: 1 };
  return { aRay: C3(a.ray.map((x) => x * 1000)), aAbs: C3(a.absorb.map((x) => x * 1000)), aP: V4(a.mie * 1000, a.g, a.Hr * KM, a.Hm * KM), aH: uniform(new THREE.Vector2((a.height || 1) * KM, atm ? 1 : 0)) };
}
function applyLights(U, sys, body, pos, t, Q, bodiesNear) {
  const L = lightsFor(sys, pos, t); const dirs = [[1, 0, 0], [0, 1, 0]]; const cols = [[0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 2 && i < L.length; i++) { dirs[i] = L[i].dir; const e = Math.min(L[i].E, 5e4); cols[i] = [L[i].col[0] * e, L[i].col[1] * e, L[i].col[2] * e]; }
  U.sd0.value.set(...dirs[0]); U.sc0.value.set(...cols[0]); U.sd1.value.set(...dirs[1]); U.sc1.value.set(...cols[1]);
  const sl = qrot(qconj(Q), dirs[0]); U.sL0.value.set(sl[0], sl[1], sl[2]);
  // occluders (moons / parent planet), relative to planet centre, km
  const occ = [U.o0, U.o1, U.o2]; for (const o of occ) o.value.set(0, 0, 0, 0);
  let k = 0; for (const o of bodiesNear) { if (k >= 3) break; const p = bodyPos(o, t); occ[k++].value.set((p[0] - pos[0]) * KM, (p[1] - pos[1]) * KM, (p[2] - pos[2]) * KM, o.radius * KM); }
  return L;
}

// ---- rocky planet / moon / asteroid -----------------------------------------------------
class Rocky extends Base {
  constructor(view, body) {
    super(view, body); const v = body.visual, T = { ...v.T }; this.T = T; const R = body.radius;
    const U = this.U = { ...lightUniforms(), ...atmUniforms(v.atm, R) };
    U.uA = V4(BIOME_ID[body.asteroid ? 'barren' : body.biome] ?? 3, (body.seed % 9973) / 97, R * KM, ((T.contAmp || 0) + (T.mountAmp || 0) + (T.craterAmp || 0) + 800) * KM);
    if (body.asteroid) U.uA.value.x = 9;
    U.uB = V4(v.ocean ? 1 : 0, v.polar || 0, v.veg || 0, v.lava || 0);
    U.uC = V4(v.snowLine || 0.85, v.dune || 0, v.crack || 0, v.maria ?? 0.4); if (body.asteroid) U.uC.value.z = v.dark || 1;
    const p = v.pal; const col = (c, d = [0.5, 0.5, 0.5]) => C3(c || d);
    U.cLow = col(p.low); U.cMid = col(p.mid); U.cDry = col(p.dry); U.cHigh = col(p.high); U.cSnow = col(p.snow); U.cSand = col(p.sand);
    U.cWS = col(v.ocean && v.ocean.shallow, [0, 0.2, 0.3]); U.cWD = col(v.ocean && v.ocean.deep, [0, 0.03, 0.1]); U.cLava = col(v.lavaCol, [1, 0.3, 0.05]);
    U.cld = V4(v.clouds ? v.clouds.cover : 0, (v.clouds ? v.clouds.alt : 0) * KM, v.clouds ? v.clouds.speed : 0, (body.seed % 777) * 0.01);
    U.cCol = C3(v.clouds ? v.clouds.color : [1, 1, 1]);
    const mat = new THREE.NodeMaterial();
    const nA = attribute('nrm', 'vec3');
    const vN = varying(modelWorldMatrix.mul(vec4(nA, 0.0)).xyz, 'vNW'); const vD = varying(attribute('dir', 'vec3'), 'vDL'); const vE = varying(attribute('elev', 'float'), 'vEl');
    mat.fragmentNode = ROCKY({ dirL: vD, nW: vN, posW: positionWorld, elev: vE, pc: U.pc, uA: U.uA, uB: U.uB, uC: U.uC, cLow: U.cLow, cMid: U.cMid, cDry: U.cDry, cHigh: U.cHigh, cSnow: U.cSnow, cSand: U.cSand, cWS: U.cWS, cWD: U.cWD, cLava: U.cLava, sd0: U.sd0, sc0: U.sc0, sd1: U.sd1, sc1: U.sc1, sL0: U.sL0, aRay: U.aRay, aAbs: U.aAbs, aP: U.aP, aH: U.aH, cld: U.cld, time: G.time, o0: U.o0, o1: U.o1, o2: U.o2 });
    mat.side = THREE.FrontSide; this.mat = mat;
    const spacing = body.asteroid ? 2 : 6; let maxLevel = Math.max(1, Math.min(15, Math.ceil(Math.log2(R * Math.PI / 2 / (32 * spacing)))));
    this.lod = new PlanetLOD(T, mat, this.group, maxLevel); this.axes = T.axes || [1, 1, 1];
    if (v.atm && body.cls === 'rocky') this.addShells(v, R);
    if (body.ring) this.addRing(body, R);
  }
  addShells(v, R) {
    const U = this.U; const Ha = v.atm.height;
    if (v.clouds && v.clouds.cover > 0.02) {
      const m = new THREE.NodeMaterial(); const dl = varying(positionLocal.normalize(), 'cDL'); const nw = varying(normalWorld, 'cNW');
      m.fragmentNode = CLOUD({ dirL: dl, nW: nw, posW: positionWorld, pc: U.pc, cld: U.cld, cCol: U.cCol, sd0: U.sd0, sc0: U.sc0, sd1: U.sd1, sc1: U.sc1, time: G.time, R: float(R * KM), o0: U.o0, o1: U.o1, o2: U.o2 });
      transparentMat(m, 'premult', true); m.side = THREE.DoubleSide;
      const g = new THREE.SphereGeometry((R + v.clouds.alt) * KM, 96, 64); this.cloud = new THREE.Mesh(g, m); this.cloud.renderOrder = 3; this.cloud.frustumCulled = false; this.group.add(this.cloud);
    }
    const m2 = new THREE.NodeMaterial(); m2.fragmentNode = ATMOS({ posW: positionWorld, pc: U.pc, R: float(R * KM), aRay: U.aRay, aAbs: U.aAbs, aP: U.aP, aH: float(Ha * KM), sd0: U.sd0, sc0: U.sc0, sd1: U.sd1, sc1: U.sc1 });
    transparentMat(m2, 'atmo', true); m2.side = THREE.BackSide;
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry((R + Ha) * KM, 96, 64), m2); this.atmo.renderOrder = 4; this.atmo.frustumCulled = false; this.group.add(this.atmo);
  }
  addRing(body, R) { this.ringMesh = makeRing(body, R, this.U); this.group.add(this.ringMesh); }
  update(ctx, posRel, pos, t) {
    const b = this.body, sys = b.sys; const Q = spinQuat(b, t); this.Q = Q;
    this.group.position.set(posRel[0], posRel[1], posRel[2]); this.group.quaternion.set(Q[0], Q[1], Q[2], Q[3]);
    this.U.pc.value.set(posRel[0], posRel[1], posRel[2]);
    const near = []; if (b.moons) for (const m of b.moons) near.push(m); if (b.parent && b.kind === 'moon') near.push(b.parent);
    applyLights(this.U, sys, b, pos, t, Q, near);
    const cl = qrot(qconj(Q), [-posRel[0] * 1000, -posRel[1] * 1000, -posRel[2] * 1000]);
    this.camL = cl; if (this.axes[1] !== 1 || this.axes[0] !== 1) { cl[0] /= this.axes[0]; cl[1] /= this.axes[1]; cl[2] /= this.axes[2]; }
    this.lod.update(cl); this.lod.placeChunks();
    this.altitude = Math.hypot(cl[0], cl[1], cl[2]) - this.T.radius;
    if (this.ringMesh) this.ringMesh.userData.update(Q);
  }
  dispose() { this.lod.dispose(); super.dispose(); }
}
function makeRing(body, R, U) {
  const rg = body.ring; const m = new THREE.NodeMaterial();
  const pl = varying(positionLocal, 'rPL');
  const uA = V4(rg.inner, rg.outer, rg.seed * 0.37, rg.opacity), uB = V4(rg.gaps, rg.dust, 0, 0);
  const nrmW = V3(0, 1, 0);
  m.fragmentNode = RING({ posL: pl, posW: positionWorld, pc: U.pc, R: float(R * KM), uA, uB, c1: C3(rg.col1), c2: C3(rg.col2), sd0: U.sd0, sc0: U.sc0, sd1: U.sd1, sc1: U.sc1, sdL0: U.sL0, normalW: nrmW });
  m.side = THREE.DoubleSide; transparentMat(m, 'premult', true);
  const g = new THREE.RingGeometry(rg.inner * R * KM, rg.outer * R * KM, 192, 8); g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 2; mesh.frustumCulled = false;
  mesh.userData.update = (Q) => { const n = qrot(Q, [0, 1, 0]); nrmW.value.set(n[0], n[1], n[2]); };
  return mesh;
}
// R given in metres inside RING() (positionLocal is km): handled by pl*1000 & R in metres => both metres. uniforms (pc/posW) are km; ring uses raySphere with R(m) vs rel(km) - fix by passing R in km:
// (see makeRing: R param is metres, but shader compares rel(km) against R, so we pass R*KM below.)

// ---- gas giant -------------------------------------------------------------------------------
class Gas extends Base {
  constructor(view, body) {
    super(view, body); const v = body.visual, R = body.radius; const U = this.U = { ...lightUniforms(), ...atmUniforms(v.atm, R) };
    U.uA = V4(0, v.seed, R * KM, v.bands); U.uB = V4(v.contrast, v.turb, v.hot, v.haze); U.uC = V4();
    const pal = v.pal; ['p0', 'p1', 'p2', 'p3', 'p4'].forEach((k, i) => (U[k] = C3(pal[i])));
    const st = v.storm; U.storm = V4(st ? st.lat : 0, st ? st.size : 0.05, st ? st.lon : 0, st ? 1 : 0); U.stormCol = C3(st ? st.col : [0.8, 0.4, 0.3]);
    const mat = new THREE.NodeMaterial(); const dl = varying(positionLocal.normalize(), 'gDL'); const nw = varying(normalWorld, 'gNW');
    mat.fragmentNode = GAS({ dirL: dl, nW: nw, posW: positionWorld, pc: U.pc, uA: U.uA, uB: U.uB, uC: U.uC, p0: U.p0, p1: U.p1, p2: U.p2, p3: U.p3, p4: U.p4, stormCol: U.stormCol, storm: U.storm, sd0: U.sd0, sc0: U.sc0, sd1: U.sd1, sc1: U.sc1, aRay: U.aRay, aAbs: U.aAbs, aP: U.aP, aH: U.aH, time: G.time, o0: U.o0, o1: U.o1, o2: U.o2 });
    const geo = new THREE.SphereGeometry(R * KM, 128, 96); this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.group.add(this.mesh);
    const Ha = v.atm.height; const m2 = new THREE.NodeMaterial(); m2.fragmentNode = ATMOS({ posW: positionWorld, pc: U.pc, R: float(R * KM), aRay: U.aRay, aAbs: U.aAbs, aP: U.aP, aH: float(Ha * KM), sd0: U.sd0, sc0: U.sc0, sd1: U.sd1, sc1: U.sc1 });
    transparentMat(m2, 'atmo', true); m2.side = THREE.BackSide; this.atmo = new THREE.Mesh(new THREE.SphereGeometry((R + Ha) * KM, 96, 64), m2); this.atmo.renderOrder = 4; this.atmo.frustumCulled = false; this.group.add(this.atmo);
    this.oblate = 0.02 + Math.min(0.1, (v.seed % 11) * 0.007); this.mesh.scale.y = 1 - this.oblate;
    if (body.ring) { this.ringMesh = makeRing(body, R, U); this.group.add(this.ringMesh); }
  }
  update(ctx, posRel, pos, t) {
    const b = this.body; const Q = spinQuat(b, t); this.Q = Q;
    this.group.position.set(posRel[0], posRel[1], posRel[2]); this.group.quaternion.set(Q[0], Q[1], Q[2], Q[3]); this.U.pc.value.set(posRel[0], posRel[1], posRel[2]);
    const near = []; if (b.moons) for (const m of b.moons) near.push(m);
    applyLights(this.U, b.sys, b, pos, t, Q, near);
    if (this.ringMesh) this.ringMesh.userData.update(Q);
    this.altitude = Math.hypot(posRel[0], posRel[1], posRel[2]) * 1000 - b.radius;
  }
}
// ---- star -----------------------------------------------------------------------------------------
const KIND_ID = { ms: 0, subgiant: 1, giant: 2, rsg: 3, bsg: 4, wr: 5, wd: 6, ns: 6, pulsar: 6, magnetar: 6, bh: 7, bd: 0 };
class Star extends Base {
  constructor(view, body) {
    super(view, body); const sp = body.spec; const U = this.U = { uA: V4(100, (sp.seed % 1000) / 7, body.conv, body.spots), uB: V4(sp.radiance, body.flare, sp.compact ? 6 : 0, 0), col: C3(sp.color), glowCol: C3(sp.color), glowCenter: V3(), glowHalf: F(1), glowInten: F(1), cCenter: V3(), cHalf: F(1), cInten: F(1), cRStar: F(0.2) };
    this.isBH = sp.kind === 'bh'; if (this.isBH) U.glowCol = C3(blackbody(body.accretion ? body.accretion.temp : 3500).map((x) => x * 1.0));
    if (!this.isBH) {
      const mat = new THREE.NodeMaterial(); const dl = varying(positionLocal.normalize(), 'sDL'); const nw = varying(normalWorld, 'sNW');
      { const so = STARSURF({ dirL: dl, nW: nw, posW: positionWorld, uA: U.uA, uB: U.uB, col: U.col, time: G.time }); mat.fragmentNode = vec4(so.rgb.mul(G.invExp), 1.0); }
      this.mesh = new THREE.Mesh(new THREE.SphereGeometry(body.radius * KM, 96, 64), mat); this.mesh.frustumCulled = false; this.group.add(this.mesh);
    }
    const gm = billboardMaterial((q) => { const o = GLOW({ q, col: U.glowCol, inten: U.glowInten, core: float(1), time: G.time, seed: float(0), spikes: float(sp.compact ? 0.6 : 1) }); return vec4(o.rgb.mul(G.invExp), 1.0); }, U.glowCenter, U.glowHalf); transparentMat(gm, 'add', true);
    this.glow = billboardMesh(gm, 20); view.scene.add(this.glow);
    if (!sp.compact || sp.kind === 'wd') {
      const cm = billboardMaterial((q) => { const o = CORONA({ q, col: U.glowCol, inten: U.cInten, rStar: U.cRStar, time: G.time, seed: float((sp.seed % 100) * 0.1), act: float(0.3 + body.flare) }); return vec4(o.rgb.mul(G.invExp), 1.0); }, U.cCenter, U.cHalf); transparentMat(cm, 'add', true);
      this.corona = billboardMesh(cm, 21); view.scene.add(this.corona);
    }
    if (sp.kind === 'pulsar' || sp.kind === 'magnetar') { this.addBeams(body); this.addField(body); }
  }
  addField(body) {
    this.fieldN = 8 * 40; this.fU = { center: V3(), alpha: F(0.0) };
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    this.fP0 = new Float32Array(this.fieldN * 3); this.fP1 = new Float32Array(this.fieldN * 3);
    g.setAttribute('p0', new THREE.InstancedBufferAttribute(this.fP0, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('p1', new THREE.InstancedBufferAttribute(this.fP1, 3).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = this.fieldN; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e30);
    const m = ribbonMaterial(this.fU.center, C3([0.35, 0.65, 1.0]), this.fU.alpha, 1.2); this.fieldMesh = new THREE.Mesh(g, m); this.fieldMesh.frustumCulled = false; this.fieldMesh.renderOrder = 9; this.view.scene.add(this.fieldMesh);
  }
  updateField(posRel, axis, Rkm, alpha) {
    this.fU.center.value.set(posRel[0], posRel[1], posRel[2]); this.fU.alpha.value = alpha; this.fieldMesh.visible = alpha > 0.01; if (alpha <= 0.01) return;
    const up = new THREE.Vector3(0, 1, 0); const q = new THREE.Quaternion().setFromUnitVectors(up, axis); const v = new THREE.Vector3(); let k = 0;
    for (let j = 0; j < 8; j++) { const ph = j * Math.PI / 4, L = Rkm * (30 + 14 * (j % 3)); let prev = null;
      for (let i = 0; i <= 40; i++) { const th = 0.12 + (Math.PI - 0.24) * (i / 40); const r = L * Math.sin(th) ** 2; v.set(r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph)).applyQuaternion(q); const cur = [v.x, v.y, v.z]; if (prev && k < this.fieldN) { this.fP0.set(prev, k * 3); this.fP1.set(cur, k * 3); k++; } prev = cur; } }
    this.fieldMesh.geometry.instanceCount = k; this.fieldMesh.geometry.getAttribute('p0').needsUpdate = true; this.fieldMesh.geometry.getAttribute('p1').needsUpdate = true;
  }
  addBeams(body) {
    const m = new THREE.NodeMaterial(); const t = varying(positionGeometry.y.mul(0.5).add(0.5), 'bt'); const ang = varying(positionGeometry.x, 'ba');
    this.beamU = { gain: F(1), col: C3([0.55, 0.75, 1]) };
    m.fragmentNode = vec4(this.beamU.col.mul(float(1).sub(t).pow(1.6)).mul(this.beamU.gain).mul(G.invExp), 1.0);
    transparentMat(m, 'add', true); m.side = THREE.DoubleSide;
    const g = new THREE.ConeGeometry(0.06, 1, 28, 1, true); g.translate(0, 0.5, 0);
    // radial fade from the star outward via uv.y: cone tip at +y, base at 0 -> flip so bright at star
    this.beams = []; for (let s = -1; s <= 1; s += 2) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 22; this.group.add(mesh); this.beams.push(mesh); }
  }
  update(ctx, posRel, pos, t, dist) {
    const b = this.body, sp = b.spec; const d = Math.max(dist, 1);
    this.group.position.set(posRel[0], posRel[1], posRel[2]);
    const Q = spinQuat(b, t); this.group.quaternion.set(Q[0], Q[1], Q[2], Q[3]);
    const Rkm = b.radius * KM; const radPx = (Rkm / (d * KM)) * ctx.focal; this.radPx = radPx;
    if (this.mesh) {
      this.mesh.visible = radPx > 0.4;
      const ob = 1 - b.oblate; let sx = 1, sz = 1;
      if (b.tidal && ctx.partner) { /* egg shape toward companion */ const to = v3.norm(v3.sub(ctx.partner, pos)); const loc = qrot(qconj(Q), to); this.mesh.lookAt; this.mesh.scale.set(1 - 0.1 * b.tidal, 1 - 0.1 * b.tidal, 1 + 0.35 * b.tidal); const q2 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(loc[0], loc[1], loc[2])); this.mesh.quaternion.copy(q2); }
      else { this.mesh.scale.set(1, ob, 1); this.mesh.quaternion.identity(); }
      this.U.uA.value.x = radPx;
    }
    // glare billboard: angular size from flux
    const Lrel = Math.max(sp.vis, 1e-6) / ((d / C.AU) ** 2);
    const glarePx = clamp(34 * Math.pow(Math.max(Lrel, 1e-12), 0.2), sp.compact ? 10 : 8, Math.min(ctx.screenMin * 0.6, 520));
    const halfPx = Math.max(glarePx, radPx * 2.2);
    const kmPerPx = (d * KM) / ctx.focal; const halfKm = halfPx * kmPerPx;
    this.U.glowCenter.value.set(posRel[0], posRel[1], posRel[2]); this.U.glowHalf.value = halfKm;
    let intens = clamp(Math.pow(Math.max(Lrel, 1e-9), 0.12) * 0.55, 0.08, 1.6) * clamp(1 - radPx / 400, 0.15, 1);
    if (this.isBH) { const dpx = (b.accretion ? b.accretion.rout : b.radius * 3) / d * ctx.focal; this.glow.visible = dpx < 9; intens *= (b.accretion ? (b.accretion.faint ? 0.25 : 1) : 0.12) * clamp(1 - dpx / 9, 0, 1); }
    this.U.glowInten.value = (sp.compact ? 1.4 : 1) * intens * Math.min(1, halfPx / glarePx); this.glow.visible = true;
    if (this.corona) {
      const ch = Math.max(radPx * 6.0, 1);
      this.corona.visible = radPx > 6; this.U.cCenter.value.set(posRel[0], posRel[1], posRel[2]); this.U.cHalf.value = Rkm * 6.0; this.U.cRStar.value = 1 / 6.0;
      this.U.cInten.value = 0.9 * sp.radiance * 0.35;
    }
    if (this.beams) {
      const period = Math.max(0.35, sp.spin) * 1; const a = TAU * (((t / period) % 1)); const incl = 0.5 + (sp.seed % 100) / 100;
      const axis = new THREE.Vector3(Math.sin(incl) * Math.cos(a), Math.cos(incl), Math.sin(incl) * Math.sin(a)).normalize();
      const len = clamp(d * 0.3 * KM, 3e5 * KM * 10, 4e8) ; const w = len;
      this.beams[0].position.set(0, 0, 0); this.beams[1].position.set(0, 0, 0);
      const up = new THREE.Vector3(0, 1, 0); const q = new THREE.Quaternion().setFromUnitVectors(up, axis); const q2 = new THREE.Quaternion().setFromUnitVectors(up, axis.clone().negate());
      this.beams[0].quaternion.copy(q); this.beams[1].quaternion.copy(q2); this.beams[0].scale.set(len, len, len); this.beams[1].scale.set(len, len, len);
      this.group.quaternion.identity(); this.beamU.gain.value = 0.9;
      const rk = b.radius * KM; const loopPx = rk * 40 / (d * KM) * ctx.focal; this.updateField(posRel, axis, rk, clamp((loopPx - 3) / 20, 0, 0.7));
    }
  }
}
// ---- belts -------------------------------------------------------------------------------------------
const BELTPOS = wgslFn(`
fn beltPos(a: vec4<f32>, b: vec4<f32>, t: f32, rows: vec3<f32>) -> vec3<f32> {
  // a = (radius, phase, yoff, size) ; b = (period, ecc, argp, 0)
  let M = a.y + 6.28318530718 * fract(t / b.x);
  var E = M; for (var i = 0; i < 3; i++) { E = E - (E - b.y * sin(E) - M) / (1.0 - b.y * cos(E)); }
  let x = a.x * (cos(E) - b.y); let z = a.x * sqrt(1.0 - b.y * b.y) * sin(E);
  let cw = cos(b.z); let sw = sin(b.z);
  let px = x * cw - z * sw; let pz = x * sw + z * cw;
  return vec3<f32>(px, a.z, pz);
}`);
class Belt extends Base {
  constructor(view, body) {
    super(view, body); const N = 14000; const rng = (function* () { let s = body.seed >>> 0 || 1; while (true) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; yield s / 4294967296; } })();
    const q = instancedQuads(N, { ia: 4, ib: 4 }); this.q = q; const a0 = body.a0 * KM, w = body.width * KM;
    for (let i = 0; i < N; i++) {
      const r = a0 + (rng.next().value - 0.5 + (rng.next().value - 0.5)) * w; const ecc = rng.next().value * 0.12; const P = TAU * Math.sqrt(Math.pow(r * 1000, 3) / (C.G * (body.parent ? body.parent.mass : body.sys.stars[0].mass)));
      q.arrays.ia.set([r, rng.next().value * TAU, (rng.next().value + rng.next().value - 1) * w * body.thick * 2.0, Math.pow(rng.next().value, 4) * 40 + 1.2], i * 4);
      q.arrays.ib.set([P, ecc, rng.next().value * TAU, rng.next().value], i * 4);
    }
    q.setCount(N); this.U = { center: V3(), inc: V4(), tint: C3(body.icy ? [0.75, 0.78, 0.8] : [0.32, 0.27, 0.23]), sun: V3(1, 0, 0), brightness: F(1), rotA: V3(1, 0, 0), rotB: V3(0, 1, 0), rotC: V3(0, 0, 1), sunCol: V3(1, 1, 1) };
    const m = new THREE.NodeMaterial(); const ia = attribute('ia', 'vec4'), ib = attribute('ib', 'vec4');
    const loc = BELTPOS({ a: ia, b: ib, t: G.time, rows: this.U.rotA });
    const world = this.U.rotA.mul(loc.x).add(this.U.rotB.mul(loc.y)).add(this.U.rotC.mul(loc.z)).add(this.U.center);
    const vp = cameraViewMatrix.mul(vec4(world, 1.0));
    const dist = vp.z.negate().max(1e-3); const sizePx = ia.w.mul(float(1).div(dist)).mul(G.focal);
    const px = sizePx.max(1.0); const half = px.mul(dist).div(G.focal);
    m.vertexNode = cameraProjectionMatrix.mul(vec4(vp.xy.add(positionGeometry.xy.mul(half)), vp.z, 1.0));
    const qv = varying(positionGeometry.xy, 'bq'); const fade = varying(sizePx.clamp(0.0, 1.0), 'bf'); const rh = varying(ib.w, 'bh');
    m.fragmentNode = wgslFn(`fn beltFrag(q: vec2<f32>, tint: vec3<f32>, fade: f32, h: f32, k: f32) -> vec4<f32> { let r = dot(q, q); if (r > 1.0) { return vec4<f32>(0.0); } let nz = sqrt(1.0 - r); let l = clamp(dot(vec3<f32>(q, nz), normalize(vec3<f32>(0.4, 0.5, 0.75))) * 0.8 + 0.25, 0.0, 1.0); let a = mix(0.5, 1.0, fade); return vec4<f32>(tint * (0.5 + h) * (0.15 + l) * k * a, a); }`)({ q: qv, tint: this.U.tint, fade, h: rh, k: this.U.brightness });
    m.side = THREE.DoubleSide; this.mesh = new THREE.Mesh(q.geometry, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.group.add(this.mesh);
  }
  update(ctx, posRel, pos, t) {
    const b = this.body; const o = b.orbit; // plane orientation from inc & node
    const ci = Math.cos(o.inc), si = Math.sin(o.inc), cO = Math.cos(o.node), sO = Math.sin(o.node);
    // columns: x axis (in-plane), y axis (normal), z axis; matches orbitPos rotation (argp handled in shader)
    const ex = [cO, 0, -sO], ey = [sO * si, ci, cO * si], ez = [sO * ci, -si, cO * ci];
    this.U.rotA.value.set(...ex); this.U.rotB.value.set(...ey); this.U.rotC.value.set(...ez);
    this.U.center.value.set(posRel[0], posRel[1], posRel[2]);
    const L = lightsFor(b.sys, pos, t); this.U.brightness.value = L.length ? Math.min(3, L[0].E * 0.6 + 0.02) : 0.1;
  }
}
// ---- dots (sub-pixel bodies) ---------------------------------------------------------------------------
class Dots {
  constructor(view, N = 96) {
    this.N = N; const q = this.q = instancedQuads(N, { ic: 3, ik: 4 });
    const m = new THREE.NodeMaterial(); const ic = attribute('ic', 'vec3'), ik = attribute('ik', 'vec4');
    const vp = cameraViewMatrix.mul(vec4(ic, 1.0)); const dist = vp.z.negate().max(1e-3);
    const half = ik.w.mul(dist).div(G.focal);
    m.vertexNode = cameraProjectionMatrix.mul(vec4(vp.xy.add(positionGeometry.xy.mul(half)), vp.z, 1.0));
    const qv = varying(positionGeometry.xy, 'dq'); const kc = varying(ik.xyz, 'dk');
    m.fragmentNode = wgslFn(`fn dotFrag(q: vec2<f32>, c: vec3<f32>) -> vec4<f32> { let r2 = dot(q, q); if (r2 > 1.0) { return vec4<f32>(0.0); } let a = exp(-r2 * 3.2); return vec4<f32>(c * a, 1.0); }`)({ q: qv, c: kc });
    transparentMat(m, 'add', true); m.side = THREE.DoubleSide; this.mesh = new THREE.Mesh(q.geometry, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 15; view.scene.add(this.mesh); this.n = 0;
  }
  begin() { this.n = 0; }
  add(x, y, z, r, g, b, px) { if (this.n >= this.N) return; const i = this.n++; this.q.arrays.ic.set([x, y, z], i * 3); this.q.arrays.ik.set([r, g, b, px], i * 4); }
  end() { this.q.setCount(this.n); this.q.touch(); }
}
// ---- accretion stream (companion star -> compact object) ----------------------------------------------
class Stream {
  constructor(view, sys) { this.view = view; this.sys = sys; this.dots = new Dots(view, 900); this.N = 800; this.A = sys.stars[0]; this.B = sys.stars[1]; this.seeds = new Float32Array(this.N * 3); for (let i = 0; i < this.N * 3; i++) this.seeds[i] = Math.random(); }
  update(ctx, t) {
    const A = this.A, B = this.B; if (!A.accretion) { this.dots.begin(); this.dots.end(); return; }
    const pa = bodyPos(A, t), pb = bodyPos(B, t); const sep = v3.dist(pa, pb); const dir = v3.norm(v3.sub(pa, pb)); // from companion to compact
    const L1 = v3.madd(pb, dir, B.radius * 0.95); const rout = A.accretion.rout * 1.0;
    const nrm = v3.norm(v3.cross(dir, [0, 1, 0])); const nz = v3.norm(v3.cross(nrm, dir)); const hit = v3.madd(pa, v3.norm(v3.add(v3.scale(dir, -1), v3.scale(nrm, 0.6))), rout);
    const cp = v3.madd(v3.madd(L1, dir, sep * 0.35), nrm, sep * 0.22);
    const d = this.dots; d.begin(); const col = blackbody(A.accretion.temp * 0.8);
    for (let i = 0; i < this.N; i++) {
      const s = ((i / this.N) + t * 2.5e-5 * (1 + this.seeds[i * 3] * 0.0) / (sep / 1e9 + 1)) % 1; const u = 1 - s;
      let p = [u * u * L1[0] + 2 * u * s * cp[0] + s * s * hit[0], u * u * L1[1] + 2 * u * s * cp[1] + s * s * hit[1], u * u * L1[2] + 2 * u * s * cp[2] + s * s * hit[2]];
      const jit = (this.seeds[i * 3 + 1] - 0.5) * sep * 0.018 * (0.2 + s); p = v3.madd(p, nrm, jit); p = v3.madd(p, nz, (this.seeds[i * 3 + 2] - 0.5) * sep * 0.012);
      const rel = [(p[0] - ctx.cam[0]) * KM, (p[1] - ctx.cam[1]) * KM, (p[2] - ctx.cam[2]) * KM]; const dist = Math.hypot(...rel);
      const b = clamp(Math.sin(s * Math.PI), 0.1, 1) * (0.5 + s) * 0.9; d.add(rel[0], rel[1], rel[2], col[0] * b, col[1] * b, col[2] * b, 2.2);
    }
    d.end();
  }
}
// ---- orbit line -----------------------------------------------------------------------------------------------
class OrbitLine {
  constructor(view, body) {
    this.body = body; const o = body.orbit; const N = 220; const pts = new Float32Array(N * 3);
    // sample the orbit in the parent's frame (no parent motion): body positions relative to parent
    for (let i = 0; i < N; i++) { const M = (i / N) * TAU; const oo = { ...o, M0: M, P: 1 }; const p = orbitPos(oo, 0); pts[i * 3] = p[0] * KM; pts[i * 3 + 1] = p[1] * KM; pts[i * 3 + 2] = p[2] * KM; }
    this.center = V3(); this.alpha = F(0.5); const col = body.kind === 'star' ? [1, 0.9, 0.6] : body.kind === 'moon' ? [0.5, 0.7, 1] : [0.45, 0.85, 1];
    this.mat = ribbonMaterial(this.center, C3(col), this.alpha, 1.1);
    this.mesh = new THREE.Mesh(ribbonGeometry(pts, true), this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 8; view.scene.add(this.mesh);
    this.view = view;
  }
  dispose() { this.view.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}

// ---- the view ------------------------------------------------------------------------------------------------
export class SystemView {
  constructor() { this.scene = new THREE.Scene(); this.items = new Map(); this.sys = null; this.dots = new Dots(this); this.orbits = new Map(); this.showOrbits = true; this.lastAltitude = Infinity; }
  setSystem(sys) { if (this.stream) { this.scene.remove(this.stream.dots.mesh); this.stream = null; } for (const it of this.items.values()) it.dispose(); this.items.clear(); for (const o of this.orbits.values()) o.dispose(); this.orbits.clear(); this.sys = sys; }
  // ctx: {t, cam:[m], focal(px per unit tan), res, screenMin, selected}
  update(ctx) {
    const sys = this.sys; if (!sys) return; const t = ctx.t; const cam = ctx.cam; this.dots.begin(); let nearest = Infinity; let nearestBody = null;
    ctx.lights = sys.lights;
    for (const b of sys.bodies) {
      const pos = bodyPos(b, t); const rel = [(pos[0] - cam[0]) * KM, (pos[1] - cam[1]) * KM, (pos[2] - cam[2]) * KM];
      const dist = Math.hypot(rel[0], rel[1], rel[2]) * 1000; b._dist = dist;
      const R = b.kind === 'belt' ? b.a0 : b.radius; const radPx = R / Math.max(dist, 1) * ctx.focal;
      const surf = b.kind === 'belt' ? Math.abs(dist - 0) : dist - R; if (b.kind !== 'belt' && surf < nearest) { nearest = surf; nearestBody = b; }
      let it = this.items.get(b.id);
      const need = b.kind === 'star' ? true : b.kind === 'belt' ? dist < b.a0 * 6 + b.width * 3 : (radPx > 1.2 || dist < R * 12);
      if (!it && need) { try { it = b.kind === 'star' ? new Star(this, b) : b.kind === 'belt' ? new Belt(this, b) : b.cls === 'gas' ? new Gas(this, b) : new Rocky(this, b); } catch (e) { console.error('item create failed', b.name, e); it = null; b._broken = true; } if (it) this.items.set(b.id, it); }
      if (it && !need && b.kind !== 'star') { b._idle = (b._idle || 0) + 1; if (b._idle > 240) { it.dispose(); this.items.delete(b.id); } } else if (it) b._idle = 0;
      if (it) {
        if (b.kind === 'star') { ctx.partner = sys.stars.length > 1 ? bodyPos(sys.stars[b.idx === 0 ? 1 : 0], t) : null; it.update(ctx, rel, pos, t, dist); }
        else it.update(ctx, rel, pos, t);
        if (it.group) it.group.visible = b.kind === 'belt' || radPx > 0.35 || b.kind === 'star';
        if (it.altitude !== undefined && b === nearestBody) this.lastAltitude = it.altitude;
      }
      // dots for sub-pixel bodies
      if ((b.kind === 'planet' || b.kind === 'moon') && radPx < 1.6) { const vis = Math.max(radPx, 0.3); const e = b.cls === 'gas' ? 0.9 : 0.6; const L = lightsFor(sys, pos, t); const lit = L.length ? clamp(L[0].E, 0.002, 4) : 0.01; const k = clamp(Math.pow(lit, 0.35) * e * (vis / 1.6) ** 2, 0.04, 1.2); this.dots.add(rel[0], rel[1], rel[2], k, k * 0.95, k * 0.9, 1.7); }
    }
    this.dots.end();
    // orbit lines
    for (const b of sys.bodies) {
      if (!b.orbit || b.kind === 'belt') continue; let ol = this.orbits.get(b.id);
      if (!ol) { if (!this.showOrbits) continue; ol = new OrbitLine(this, b); this.orbits.set(b.id, ol); }
      const parentPos = b.parent ? bodyPos(b.parent, t) : [0, 0, 0]; const pb = b.parentBary ? orbitPos(b.parentBary, t) : [0, 0, 0];
      ol.center.value.set((parentPos[0] + pb[0] - cam[0]) * KM, (parentPos[1] + pb[1] - cam[1]) * KM, (parentPos[2] + pb[2] - cam[2]) * KM);
      const pd = b.parent ? (b.parent._dist || 1e12) : Math.hypot(parentPos[0] - cam[0], parentPos[1] - cam[1], parentPos[2] - cam[2]);
      const size = b.orbit.a; const sel = ctx.selected && (ctx.selected === b || ctx.selected.parent === b || b.parent === ctx.selected);
      const apparent = size / Math.max(pd, 1) ; // angular size
      let a = this.showOrbits ? clamp(1.2 - Math.abs(Math.log10(apparent + 1e-9) - 0.3) * 0.25, 0, 1) * (apparent < 0.004 ? 0 : 1) : 0;
      if (sel) a = Math.max(a, 0.9); ol.alpha.value = a * (b.kind === 'moon' ? 0.55 : 0.5); ol.mesh.visible = a > 0.01;
    }
    this.nearest = nearest; this.nearestBody = nearestBody;
    if (sys.layout === 'accreting') { if (!this.stream) this.stream = new Stream(this, sys); this.stream.update(ctx, t); }
    let E = 0; for (const s of sys.lights) { const sp = bodyPos(s, t); const d = Math.max(Math.hypot(sp[0] - cam[0], sp[1] - cam[1], sp[2] - cam[2]), s.radius * 1.0); E += s.spec.L / ((d / C.AU) ** 2); } this.E = E;
  }
  surfaceAltitude(ctx) { return this.lastAltitude; }
}
