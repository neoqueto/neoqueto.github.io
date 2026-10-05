// Quadtree cube-sphere LOD with worker-generated terrain chunks.
import * as THREE from 'three/webgpu';
import { CHUNK_N, chunkIndices, faceDir, terrainHeight } from '../terrain.js';
import { qrot, qconj } from '../core.js';

let sharedIndex = null;
class Pool {
  constructor(n) {
    this.workers = []; this.jobs = new Map(); this.q = []; this.next = 1; this.busy = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('../terrain-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { const j = this.jobs.get(e.data.id); this.jobs.delete(e.data.id); this.busy[i]--; if (j) j(e.data.c); this.pump(); };
      this.workers.push(w); this.busy.push(0);
    }
  }
  submit(T, face, level, i, j, prio) { return new Promise((res) => { this.q.push({ T, face, level, i, j, res, prio }); this.pump(); }); }
  pump() {
    while (this.q.length) {
      let k = -1, best = 1e9; for (let w = 0; w < this.workers.length; w++) if (this.busy[w] < 1 && this.busy[w] < best) { best = this.busy[w]; k = w; }
      if (k < 0) return;
      // pick highest priority (smallest prio number = closest)
      let bi = 0; for (let i = 1; i < this.q.length; i++) if (this.q[i].prio < this.q[bi].prio) bi = i; const it = this.q.splice(bi, 1)[0];
      if (it.cancelled) { continue; }
      const id = this.next++; this.jobs.set(id, it.res); this.busy[k]++; this.workers[k].postMessage({ id, T: it.T, face: it.face, level: it.level, i: it.i, j: it.j });
    }
  }
}
let pool = null; export function getPool() { if (!pool) pool = new Pool(Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1))); return pool; }

class Node {
  constructor(lod, face, level, i, j, parent) {
    this.lod = lod; this.face = face; this.level = level; this.i = i; this.j = j; this.parent = parent; this.children = null; this.state = 0; this.mesh = null; this.lastUsed = 0;
    const n = 1 << level; faceDir(face, -1 + (2 * i + 1) / n, -1 + (2 * j + 1) / n, this.dir = [0, 0, 0]);
    this.edge = lod.T.radius * (Math.PI / 2) / n; this.visible = false; this.req = null;
  }
  request(prio) {
    if (this.state !== 0) return; this.state = 1; const lod = this.lod;
    const p = getPool().submit(lod.T, this.face, this.level, this.i, this.j, prio); this.req = p;
    p.then((c) => { if (this.state === 3) return; this.build(c); });
  }
  build(c) {
    const g = new THREE.BufferGeometry(); const S = 0.001;
    for (let i = 0; i < c.pos.length; i++) c.pos[i] *= S;
    g.setAttribute('position', new THREE.BufferAttribute(c.pos, 3)); g.setAttribute('nrm', new THREE.BufferAttribute(c.nrm, 3)); g.setAttribute('dir', new THREE.BufferAttribute(c.dir, 3)); g.setAttribute('aux', new THREE.BufferAttribute(c.aux, 3));
    if (!sharedIndex) sharedIndex = new THREE.BufferAttribute(chunkIndices(), 1); g.setIndex(sharedIndex);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.edge * 0.0011 + 20); 
    const m = new THREE.Mesh(g, this.lod.material); m.frustumCulled = true; m.visible = false; m.matrixAutoUpdate = false;
    this.center = c.center; this.mesh = m; this.state = 2; this.lod.group.add(m);
  }
  dispose() { this.state = 3; if (this.mesh) { this.lod.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; } }
}
export class PlanetLOD {
  constructor(T, material, group, maxLevel) {
    this.T = T; this.material = material; this.group = group; this.maxLevel = maxLevel; this.roots = []; this.frame = 0; this.pending = 0;
    for (let f = 0; f < 6; f++) { const n = new Node(this, f, 0, 0, 0, null); this.roots.push(n); n.request(0); }
  }
  // camL: camera position in planet-local metres. Returns nothing; toggles chunk visibility and sets chunk transforms (km) relative to group.
  update(camL, quatUnused) {
    this.frame++; const R = this.T.radius; const cl = Math.hypot(camL[0], camL[1], camL[2]); const ch = [camL[0] / cl, camL[1] / cl, camL[2] / cl];
    const horizon = Math.acos(Math.min(1, R / Math.max(cl, R))) ; this.pending = 0;
    this.shown = 0;
    const visit = (n) => {
      n.lastUsed = this.frame;
      // horizon cull
      if (n.level >= 2) { const ang = Math.acos(Math.max(-1, Math.min(1, n.dir[0] * ch[0] + n.dir[1] * ch[1] + n.dir[2] * ch[2]))); if (ang > horizon + n.edge * 0.9 / R + 0.02) { this.hide(n); return; } }
      const cx = n.dir[0] * R, cy = n.dir[1] * R, cz = n.dir[2] * R;
      const d = Math.hypot(camL[0] - cx, camL[1] - cy, camL[2] - cz) - n.edge * 0.5;
      const want = n.level < this.maxLevel && d < n.edge * 2.4;
      if (want) {
        if (!n.children) { const l = n.level + 1; n.children = [new Node(this, n.face, l, n.i * 2, n.j * 2, n), new Node(this, n.face, l, n.i * 2 + 1, n.j * 2, n), new Node(this, n.face, l, n.i * 2, n.j * 2 + 1, n), new Node(this, n.face, l, n.i * 2 + 1, n.j * 2 + 1, n)]; }
        let ready = true; for (let k = 0; k < 4; k++) { let c = n.children[k]; if (c.state === 3) c = n.children[k] = new Node(this, c.face, c.level, c.i, c.j, n); if (c.state === 0) c.request(d); if (c.state !== 2 && !(c.children && c.state === 2)) ready = false; }
        if (ready) { this.hide(n); for (const c of n.children) visit(c); return; }
        this.pending++;
      }
      if (n.children) for (const c of n.children) this.hideSub(c);
      if (n.state === 2) { this.show(n); } else if (n.state === 0) n.request(d);
    };
    for (const r of this.roots) visit(r);
    if (this.frame % 60 === 0) this.gc();
  }
  show(n) { if (n.mesh) { n.mesh.visible = true; n.visible = true; this.shown++; } }
  hide(n) { if (n.mesh) { n.mesh.visible = false; n.visible = false; } }
  hideSub(n) { this.hide(n); if (n.children) for (const c of n.children) this.hideSub(c); }
  gc() { const old = this.frame - 240; const walk = (n) => { if (n.children) { let any = false; for (const c of n.children) { walk(c); if (c.children || c.state === 2 || c.state === 1) any = true; } if (!any) n.children = null; } if (n.level > 0 && n.lastUsed < old && !n.children && n.state !== 3) { n.dispose(); if (n.parent) { /* parent drops child list lazily */ } } }; for (const r of this.roots) walk(r); }
  placeChunks(Q) { // set mesh matrices (children are relative to the group at origin; group handles rotation)
    for (const r of this.roots) this._place(r);
  }
  _place(n) { if (n.mesh && n.visible && n.mesh.matrixAutoUpdate === false) { if (!n.mesh._placed) { n.mesh.position.set(n.center[0] * 0.001, n.center[1] * 0.001, n.center[2] * 0.001); n.mesh.updateMatrix(); n.mesh._placed = true; } } if (n.children) for (const c of n.children) this._place(c); }
  dispose() { const walk = (n) => { n.state = 3; if (n.mesh) { this.group.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh = null; } if (n.children) n.children.forEach(walk); }; this.roots.forEach(walk); }
}
