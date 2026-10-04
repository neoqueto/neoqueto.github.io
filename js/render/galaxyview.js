// Galaxy-interior layer. Units: parsecs. Camera at origin; group = galaxy (rotated by its orientation).
import { THREE, uniform, attribute, varying, positionGeometry, positionWorld, modelWorldMatrix, cameraViewMatrix, cameraProjectionMatrix, vec2, vec3, vec4, float, V3, V4, F, C3, G, transparentMat, instancedQuads, length, smoothstep, min, max, pow, exp, log, clamp, select } from './mat.js';
import { CLOUDFRAG, DUSTFRAG, STARPT, NEBULA, JET } from '../shaders/galaxy.js';
import { Streamer } from './streamer.js';
import { buildCloud, starCell, nebulaeNear, STAR_CELL, galaxyDensity, TIERS, ambientStars } from '../gen/galaxy.js';
import { C, qrot, qconj, clamp as cl } from '../core.js';

const PC = C.PC; const smoothJ = (d) => { const t = Math.min(1, Math.max(0, (d - 0.15) / 1.0)); return t * t * (3 - 2 * t) * (d > 8 ? Math.max(0, 1 - (d - 8) / 6) : 1); };
export class GalaxyView {
  constructor(quality = 1) {
    this.scene = new THREE.Scene(); this.group = new THREE.Group(); this.scene.add(this.group); this.g = null; this.quality = quality;
    this.cloudN = Math.floor(170000 * quality);
    this.U = { gain: F(1.0), cloudFade: F(1) };
    this.buildCloudMesh(); this.buildDustMesh(); this.buildStarMesh(); this.buildNebulae(); this.buildJet();
    this.stars = new Streamer({ cell: STAR_CELL, radius: 2, stride: 8, maxItems: 20000, budget: 14, hyst: 1, gen: (cx, cy, cz, out, origin, objs) => this.genStars(cx, cy, cz, out, origin, objs) });
    this.nebList = [];
  }
  buildCloudMesh() {
    const q = this.cloud = instancedQuads(this.cloudN, { ipos: 3, icol: 3, isz: 1, ibr: 1 });
    const m = new THREE.NodeMaterial(); const ipos = attribute('ipos', 'vec3'), icol = attribute('icol', 'vec3'), isz = attribute('isz', 'float'), ibr = attribute('ibr', 'float');
    const vp = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(ipos, 1.0))); const dist = length(vp.xyz).max(1e-6);
    const pxR = isz.div(dist).mul(G.focal); const px = pxR.max(0.8).min(2.2); const nearVis = smoothstep(isz.mul(1.0), isz.mul(4.0), dist); const half = px.mul(dist).div(G.focal).mul(nearVis.greaterThan(0.004).select(1.0, 0.0));
    m.vertexNode = cameraProjectionMatrix.mul(vec4(vp.xy.add(positionGeometry.xy.mul(half)), vp.z, 1.0));
    const area = pxR.div(px).pow(2.0).min(3.0).max(0.16);
    const I = ibr.mul(area).mul(nearVis).mul(this.U.gain).mul(G.skyGain).mul(this.U.cloudFade);
    m.fragmentNode = CLOUDFRAG({ q: varying(positionGeometry.xy, 'cq'), c: varying(icol.mul(I), 'cc') });
    transparentMat(m, 'add', false); m.side = THREE.DoubleSide;
    this.cloudMesh = new THREE.Mesh(q.geometry, m); this.cloudMesh.frustumCulled = false; this.cloudMesh.renderOrder = 1; this.group.add(this.cloudMesh);
  }
  buildDustMesh() {
    const q = this.dust = instancedQuads(6000, { ipos: 3, isz: 1, iop: 1 });
    const m = new THREE.NodeMaterial(); const ipos = attribute('ipos', 'vec3'), isz = attribute('isz', 'float'), iop = attribute('iop', 'float');
    const vp = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(ipos, 1.0))); const dist = length(vp.xyz).max(1e-6);
    const pxR = isz.div(dist).mul(G.focal); const px = pxR.max(1.0); const dNear = smoothstep(isz.mul(0.5), isz.mul(3.0), dist); const half = px.mul(dist).div(G.focal).mul(dNear.greaterThan(0.004).select(1.0, 0.0));
    m.vertexNode = cameraProjectionMatrix.mul(vec4(vp.xy.add(positionGeometry.xy.mul(half)), vp.z, 1.0));
    const op = iop.mul(dNear).mul(pxR.div(px).pow(2.0).min(1.0)).mul(0.9).mul(this.U.cloudFade);
    m.fragmentNode = DUSTFRAG({ q: varying(positionGeometry.xy, 'dq2'), o: varying(op, 'dop') });
    transparentMat(m, 'multiply', false); m.side = THREE.DoubleSide;
    this.dustMesh = new THREE.Mesh(q.geometry, m); this.dustMesh.frustumCulled = false; this.dustMesh.renderOrder = 2; this.group.add(this.dustMesh);
  }
  makeStarMesh(maxItems, nearA, nearB, farA, farB, order) {
    const q = instancedQuads(maxItems, { ipos: 3, icol: 3, ilum: 1, ia: 1 });
    const m = new THREE.NodeMaterial(); const ipos = attribute('ipos', 'vec3'), icol = attribute('icol', 'vec3'), ilum = attribute('ilum', 'float');
    const vp = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(ipos, 1.0))); const dist = length(vp.xyz).max(1e-9);
    const dAU = dist.mul(206264.8); const flux = ilum.div(dAU.mul(dAU)); const s = flux.div(2.36e-13);
    const rad = float(1.2).add(log(s.add(1.0)).mul(0.62)).min(11.0);
    const vis = smoothstep(0.03, 0.25, s).mul(smoothstep(nearA, nearB, dist)).mul(float(1.0).sub(smoothstep(farA, farB, dist)));
    const half = rad.mul(3.0).mul(vis.greaterThan(0.001).select(1.0, 0.0)).mul(dist).div(G.focal);
    m.vertexNode = cameraProjectionMatrix.mul(vec4(vp.xy.add(positionGeometry.xy.mul(half)), vp.z, 1.0));
    const I = s.pow(0.5).mul(0.42).min(7.0).mul(vis).mul(G.skyGain).mul(this.U.gain);
    m.fragmentNode = STARPT({ q: varying(positionGeometry.xy, 'sq' + order), c: varying(icol.mul(I), 'sc' + order), spike: varying(smoothstep(8.0, 400.0, s), 'ssp' + order) });
    transparentMat(m, 'add', false); m.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(q.geometry, m); mesh.frustumCulled = false; mesh.renderOrder = 3; this.group.add(mesh);
    return { q, mesh };
  }
  buildStarMesh() {
    const loc = this.makeStarMesh(20000, 0.0004, 0.002, STAR_CELL * 1.5, STAR_CELL * 2.2, 0); this.starQ = loc.q; this.starMesh = loc.mesh;
    this.tiers = TIERS.map((T, k) => {
      const mm = this.makeStarMesh(60000, T.near[0], T.near[1], T.far[0], T.far[1], k + 1);
      const stream = new Streamer({ cell: T.cell, radius: T.radius, stride: 8, maxItems: 60000, budget: 10, hyst: 1, gen: (cx, cy, cz, out, origin) => { if (this.g) ambientStars(this.g, k, cx, cy, cz, out, origin); } });
      return { ...mm, stream };
    });
  }
  buildNebulae() {
    this.nebs = [];
    for (let i = 0; i < 8; i++) {
      const U = { cen: V3(), R: F(1), kind: F(0), seed: F(0), hue: F(0), temp: F(9000), dens: F(1), ax: V3(1, 1, 1), r0: V3(1, 0, 0), r1: V3(0, 1, 0), r2: V3(0, 0, 1), mat: V3(1, 0.5, 0.2) };
      const m = new THREE.NodeMaterial(); m.fragmentNode = NEBULA({ posW: positionWorld, cen: U.cen, R: U.R, kind: U.kind, seed: U.seed, hue: U.hue, temp: U.temp, dens0: U.dens, time: G.time, pix: float(1).div(G.focal), ax: U.ax, r0: U.r0, r1: U.r1, r2: U.r2, nmat: U.mat }).mul(vec4(G.skyGain, G.skyGain, G.skyGain, 1.0));
      transparentMat(m, 'premult', false); m.side = THREE.BackSide;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), m); mesh.frustumCulled = false; mesh.renderOrder = 4; mesh.visible = false; this.group.add(mesh);
      this.nebs.push({ mesh, U, neb: null });
    }
  }
  buildJet() {
    this.jetU = { len: F(1), axisV: V3(0, 1, 0), gain: F(1), seed: F(0) };
    const m = new THREE.NodeMaterial(); const cenV = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(0, 0, 0, 1.0)));
    const axisV = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(0, 1, 0, 0.0))).xyz.normalize();
    const side = axisV.cross(cenV.xyz.normalize()).normalize();
    const L = this.jetU.len; const q = positionGeometry.xy; const s = q.y.abs();
    const pos = cenV.xyz.add(axisV.mul(q.y.mul(L))).add(side.mul(q.x.mul(L).mul(float(0.035).add(s.mul(0.16)))));
    m.vertexNode = cameraProjectionMatrix.mul(vec4(pos, 1.0));
    m.fragmentNode = JET({ q: varying(positionGeometry.xy, 'jq'), seed: this.jetU.seed, time: G.time, gain: this.jetU.gain.mul(G.skyGain) });
    transparentMat(m, 'add', false); m.side = THREE.DoubleSide;
    this.jet = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 1, 16), m); this.jet.frustumCulled = false; this.jet.renderOrder = 5; this.jet.visible = false; this.group.add(this.jet);
  }
  genStars(cx, cy, cz, out, origin, objs) {
    const g = this.g; if (!g) return; const list = starCell(g, cx, cy, cz);
    for (const s of list) {
      const sp = s.spec; const col = sp.color;
      out.push(s.pos[0] - origin[0], s.pos[1] - origin[1], s.pos[2] - origin[2], Math.min(1, col[0] * 1.1), Math.min(1, col[1] * 1.1), Math.min(1, col[2] * 1.1), sp.vis, 0); objs.push(s);
    }
  }
  setHidden(star) { // suppress the point-sprite of a star whose full system is being rendered
    if (this.hidden === star && this._hv === this.stars.version) return; this.hidden = star; this._hv = this.stars.version;
    const objs = this.stars.objs; if (!objs) return; const A = this.starQ.arrays; const d = this.stars.data;
    if (this._hi !== undefined && this._hi >= 0 && this._hi < this.stars.count) A.ilum[this._hi] = d[this._hi * 8 + 6];
    this._hi = star ? objs.indexOf(star) : -1; if (this._hi >= 0) A.ilum[this._hi] = 0; this.starQ.touch();
  }
  setGalaxy(g) {
    if (this.g === g) return; this.g = g; this.stars.reset(); this.starQ.setCount(0);
    const c = buildCloud(g, this.cloudN); this.cloudData = c;
    const a = this.cloud.arrays, pt = c.pts; for (let i = 0; i < c.n; i++) { const o = i * 8, k = i * 3; a.ipos[k] = pt[o]; a.ipos[k + 1] = pt[o + 1]; a.ipos[k + 2] = pt[o + 2]; a.icol[k] = pt[o + 3]; a.icol[k + 1] = pt[o + 4]; a.icol[k + 2] = pt[o + 5]; a.isz[i] = pt[o + 6]; a.ibr[i] = pt[o + 7] * 0.22; }
    this.cloud.setCount(c.n); this.cloud.touch();
    const d = this.dust.arrays; for (let i = 0; i < c.dn; i++) { const o = i * 5; d.ipos.set([c.dust[o], c.dust[o + 1], c.dust[o + 2]], i * 3); d.isz[i] = c.dust[o + 3]; d.iop[i] = c.dust[o + 4]; }
    this.dust.setCount(c.dn); this.dust.touch();
    this.nebList = [];
    this.jet.visible = !!g.jets; if (g.jets) { this.jetU.len.value = g.radius / PC * 0.55; this.jetU.seed.value = g.seed % 97; }
  }
  // ctx: {camG: camera in galaxy frame rel centre (m), t}
  update(ctx) {
    const g = this.g; if (!g) return; const cam = ctx.camG;
    this.group.position.set(-cam[0] / PC, -cam[1] / PC, -cam[2] / PC); const o = g.orient; this.group.quaternion.set(o[0], o[1], o[2], o[3]);
    if (g.jets) { const dr = Math.hypot(cam[0], cam[1], cam[2]) / g.radius; this.jetU.gain.value = 0.55 * smoothJ(dr); }
    const camD = qrot(qconj(o), cam); const camPc = [camD[0] / PC, camD[1] / PC, camD[2] / PC]; this.camPc = camPc;
    // local stars stream (only when inside / near the galaxy)
    const R = g.radius / PC; const rad = Math.hypot(camPc[0], camPc[1], camPc[2]);
    if (rad < R * 1.2) {
      if (this.stars.update(camPc)) { this.starQ.arrays.ipos.set(this.stars.data.subarray(0, 0)); const d = this.stars.data, n = this.stars.count, A = this.starQ.arrays; for (let i = 0; i < n; i++) { const k = i * 8; A.ipos[i * 3] = d[k]; A.ipos[i * 3 + 1] = d[k + 1]; A.ipos[i * 3 + 2] = d[k + 2]; A.icol[i * 3] = d[k + 3]; A.icol[i * 3 + 1] = d[k + 4]; A.icol[i * 3 + 2] = d[k + 5]; A.ilum[i] = d[k + 6]; } this.starQ.setCount(n); this.starQ.touch(); }
      if (this.stars.origin) { const so = this.stars.origin; this.starMesh.position.set(so[0], so[1], so[2]); this.starMesh.visible = true; }
    } else this.starMesh.visible = false;
    for (const t of this.tiers) {
      if (rad < R * 1.2) {
        if (t.stream.update(camPc)) { const d = t.stream.data, n = t.stream.count, A = t.q.arrays; for (let i = 0; i < n; i++) { const k = i * 8; A.ipos[i * 3] = d[k]; A.ipos[i * 3 + 1] = d[k + 1]; A.ipos[i * 3 + 2] = d[k + 2]; A.icol[i * 3] = d[k + 3]; A.icol[i * 3 + 1] = d[k + 4]; A.icol[i * 3 + 2] = d[k + 5]; A.ilum[i] = d[k + 6]; } t.q.setCount(n); t.q.touch(); }
        if (t.stream.origin) { const so = t.stream.origin; t.mesh.position.set(so[0], so[1], so[2]); t.mesh.visible = true; }
      } else t.mesh.visible = false;
    }
    // nebulae near the camera
    if (rad < R * 1.2) {
      if (!this._nebC || (this._nebF = (this._nebF || 0) + 1) % 8 === 0) this._nebC = nebulaeNear(g, camPc, 900);
      const near = this._nebC.map((n) => ({ n, d: Math.hypot(n.pos[0] - camPc[0], n.pos[1] - camPc[1], n.pos[2] - camPc[2]) - n.radius })).sort((a, b) => a.d - b.d).slice(0, 8);
      this.nebList = near.map((x) => x.n);
      const kindId = { emission: 0, reflection: 0, dark: 0, planetary: 3, snr: 4 };
      for (let i = 0; i < 8; i++) {
        const slot = this.nebs[i]; const nb = near[i] ? near[i].n : null; if (!nb) { slot.mesh.visible = false; continue; }
        slot.mesh.visible = true; slot.mesh.position.set(nb.pos[0], nb.pos[1], nb.pos[2]); slot.mesh.scale.setScalar(nb.radius);
        const w = qrot(o, [nb.pos[0] * PC, nb.pos[1] * PC, nb.pos[2] * PC]); slot.U.cen.value.set((w[0] - cam[0]) / PC, (w[1] - cam[1]) / PC, (w[2] - cam[2]) / PC);
        slot.U.R.value = nb.radius; slot.U.kind.value = kindId[nb.nkind]; slot.U.seed.value = nb.seed % 1000; slot.U.hue.value = nb.hue; slot.U.temp.value = nb.temp; slot.U.dens.value = nb.density; slot.U.ax.value.set(...nb.ax); slot.U.r0.value.set(...nb.rows[0]); slot.U.r1.value.set(...nb.rows[1]); slot.U.r2.value.set(...nb.rows[2]); slot.U.mat.value.set(nb.emit, nb.dust, nb.refl);
      }
    } else for (const s of this.nebs) s.mesh.visible = false;
  }
}
