// Cosmos layer: galaxy sprites + far-field structure. Units: kiloparsecs.
import { THREE, uniform, attribute, varying, positionGeometry, cameraViewMatrix, cameraProjectionMatrix, vec3, vec4, float, V3, F, G, transparentMat, instancedQuads, length, smoothstep, min, max } from './mat.js';
import { GALSPRITE, CLOUDFRAG } from '../shaders/galaxy.js';
import { Streamer } from './streamer.js';
import { galaxiesInCell, farFieldCell, CELL0, CELL1 } from '../gen/cosmos.js';
import { C, qrot } from '../core.js';

const KPC = C.KPC;
const TYPE_ID = { spiral: 0, barred: 1, elliptical: 2, lenticular: 3, dwarf: 4, irregular: 5, ring: 6, active: 7 };
export class CosmosView {
  constructor() {
    this.scene = new THREE.Scene(); this.U = { gain: F(1.0), farGain: F(1.0), focusFade: F(1), focusId: F(-1) };
    const q = this.gq = instancedQuads(6000, { ipos: 3, iaxis: 4, iprm: 4, iprm2: 4, iid: 1 });
    const m = new THREE.NodeMaterial(); const ipos = attribute('ipos', 'vec3'), iaxis = attribute('iaxis', 'vec4'), iprm = attribute('iprm', 'vec4'), iprm2 = attribute('iprm2', 'vec4'), iid = attribute('iid', 'float');
    const cenV = cameraViewMatrix.mul(vec4(ipos, 1.0)); const dist = length(cenV.xyz).max(1e-6);
    const Rk = iaxis.w; const pxR = Rk.mul(1.7).div(dist).mul(G.focal); const px = pxR.max(2.2); const half = px.mul(dist).div(G.focal);
    m.vertexNode = cameraProjectionMatrix.mul(vec4(cenV.xy.add(positionGeometry.xy.mul(half)), cenV.z, 1.0));
    const vpc = varying(vec3(cenV.xy.add(positionGeometry.xy.mul(half)), cenV.z), 'gv');
    const nV = varying(cameraViewMatrix.mul(vec4(iaxis.xyz, 0.0)).xyz, 'gn');
    const area = pxR.div(px).pow(2.0).min(1.0);
    const fade = area.mul(iid.equal(this.U.focusId).select(this.U.focusFade, 1.0));
    m.fragmentNode = GALSPRITE({ vpc, cen: varying(cenV.xyz, 'gc'), nv: nV, R: varying(Rk, 'gR'), prm: varying(iprm, 'gp'), prm2: varying(iprm2, 'gp2'), fade: varying(fade, 'gf'), gain: this.U.gain.mul(G.skyGain) });
    transparentMat(m, 'add', false); m.side = THREE.DoubleSide;
    this.gMesh = new THREE.Mesh(q.geometry, m); this.gMesh.frustumCulled = false; this.gMesh.renderOrder = 2; this.scene.add(this.gMesh);
    // far field
    const f = this.fq = instancedQuads(140000, { ipos: 3, ibr: 1 });
    const m2 = new THREE.NodeMaterial(); const fp = attribute('ipos', 'vec3'), fb = attribute('ibr', 'float');
    const fv = cameraViewMatrix.mul(vec4(fp, 1.0)); const fd = length(fv.xyz).max(1e-6);
    const fhalf = float(1.1).mul(fd).div(G.focal);
    m2.vertexNode = cameraProjectionMatrix.mul(vec4(fv.xy.add(positionGeometry.xy.mul(fhalf)), fv.z, 1.0));
    const ff = smoothstep(CELL0 * 7 / KPC, CELL0 * 11 / KPC, fd).mul(smoothstep(CELL1 * 7 / KPC, CELL1 * 5.2 / KPC, fd));
    m2.fragmentNode = CLOUDFRAG({ q: varying(positionGeometry.xy, 'fq2'), c: varying(vec3(0.7, 0.8, 1.0).mul(fb).mul(ff).mul(this.U.farGain).mul(G.skyGain), 'fc') });
    transparentMat(m2, 'add', false); m2.side = THREE.DoubleSide; this.fMesh = new THREE.Mesh(f.geometry, m2); this.fMesh.frustumCulled = false; this.fMesh.renderOrder = 1; this.scene.add(this.fMesh);
    this.tier0 = new Streamer({ cell: CELL0, radius: 7, stride: 19, maxItems: 6000, budget: 70, hyst: 2, gen: (cx, cy, cz, out, origin, objs) => {
      for (const g of galaxiesInCell(cx, cy, cz)) {
        const ax = qrot(g.orient, [0, 1, 0]);
        out.push((g.pos[0] - origin[0]) / KPC, (g.pos[1] - origin[1]) / KPC, (g.pos[2] - origin[2]) / KPC, ax[0], ax[1], ax[2], g.Rkpc, TYPE_ID[g.type] ?? 0, g.arms, g.pitch, g.hue, g.bulge, g.thick, g.ellip[0], g.dust, objs.length, 0, 0, 0); objs.push(g);
      }
    } });
    this.tier1 = new Streamer({ cell: CELL1, radius: 6, stride: 4, maxItems: 140000, budget: 14, hyst: 1, gen: (cx, cy, cz, out, origin) => {
      const tmp = []; farFieldCell(cx, cy, cz, tmp); for (let i = 0; i < tmp.length; i += 4) out.push((tmp[i] - origin[0]) / KPC, (tmp[i + 1] - origin[1]) / KPC, (tmp[i + 2] - origin[2]) / KPC, tmp[i + 3] * 0.55);
    } });
    this.galaxies = [];
  }
  // camU: camera in universe frame (m)
  update(ctx) {
    const cam = ctx.camU;
    if (this.tier0.update(cam)) {
      const d = this.tier0.data, n = this.tier0.count, A = this.gq.arrays;
      for (let i = 0; i < n; i++) { const k = i * 19; A.ipos.set([d[k], d[k + 1], d[k + 2]], i * 3); A.iaxis.set([d[k + 3], d[k + 4], d[k + 5], d[k + 6]], i * 4); A.iprm.set([d[k + 7], d[k + 8], d[k + 9], d[k + 10]], i * 4); A.iprm2.set([d[k + 11], d[k + 12], d[k + 13], d[k + 14]], i * 4); A.iid[i] = d[k + 15]; }
      this.gq.setCount(n); this.gq.touch(); this.galaxies = this.tier0.objs;
    }
    if (this.tier1.update(cam)) {
      const d = this.tier1.data, n = this.tier1.count, A = this.fq.arrays; for (let i = 0; i < n; i++) { const k = i * 4; A.ipos[i * 3] = d[k]; A.ipos[i * 3 + 1] = d[k + 1]; A.ipos[i * 3 + 2] = d[k + 2]; A.ibr[i] = d[k + 3]; }
      this.fq.setCount(n); this.fq.touch();
    }
    const o0 = this.tier0.origin; if (o0) { this.gMesh.position.set((o0[0] - cam[0]) / KPC, (o0[1] - cam[1]) / KPC, (o0[2] - cam[2]) / KPC); }
    const o1 = this.tier1.origin; if (o1) { this.fMesh.position.set((o1[0] - cam[0]) / KPC, (o1[1] - cam[1]) / KPC, (o1[2] - cam[2]) / KPC); }
    // focus galaxy cross-fade to the detailed cloud
    this.U.focusId.value = -1;
    if (ctx.focus) { const i = this.galaxies.indexOf(ctx.focus); this.U.focusId.value = i; this.U.focusFade.value = ctx.focusFade; }
  }
}
