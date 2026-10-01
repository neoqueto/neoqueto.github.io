// Entity graph: universe > galaxy > (system | nebula | core black hole) > bodies. Ids are deterministic and resolvable (used for favourites).
import { C, qrot, v3, TAU } from './core.js';
import { galaxyById, clustersInCell, GTYPES } from './gen/cosmos.js';
import { starById, nebulaById, STAR_CELL } from './gen/galaxy.js';
import { generateSystem, bodyPos, starSpec } from './gen/system.js';

export const UNIVERSE = { id: 'u', kind: 'universe', name: 'Observable Universe', container: null, level: -1, radius: 1e30, localPos: () => [0, 0, 0], children: [] };
const cache = new Map();

class Galaxy {
  constructor(g) { this.g = g; this.id = g.id; this.kind = 'galaxy'; this.name = g.name; this.container = UNIVERSE; this.level = 0; this.radius = g.radius; this.pos = g.pos; this.children = []; }
  localPos() { return this.pos; }
  get core() { return this._core || (this._core = new Core(this)); }
}
class Cluster {
  constructor(c) { this.c = c; this.id = c.id; this.kind = 'cluster'; this.name = c.name; this.container = UNIVERSE; this.level = 0; this.radius = c.sigma * 2; this.pos = c.pos; }
  localPos() { return this.pos; }
}
class Core { // supermassive black hole at the galactic centre
  constructor(ge) {
    const g = ge.g; this.galaxy = ge; this.id = ge.id + '/core'; this.kind = 'smbh'; this.container = ge; this.level = 1; this.g = g;
    this.mass = Math.pow(10, g.smbhLog) * C.MSUN; this.radius = 2 * C.G * this.mass / (C.c * C.c); this.name = ge.name + ' Core'; this.spinA = 0.5 + (g.seed % 100) / 250;
    this.disk = { rin: 3 - 2.4 * this.spinA, rout: g.agn ? 120 : 40, temp: g.agn ? 20000 : 6000, inten: g.agn ? 1.4 : 0.5 };
  }
  localPos() { return [0, 0, 0]; }
}
class Nebula {
  constructor(ge, n) { this.n = n; this.galaxy = ge; this.id = n.id; this.kind = 'nebula'; this.name = n.name; this.container = ge; this.level = 1; this.radius = n.radius * C.PC; this._p = qrot(ge.g.orient, [n.pos[0] * C.PC, n.pos[1] * C.PC, n.pos[2] * C.PC]); }
  localPos() { return this._p; }
}
class System {
  constructor(ge, s) {
    this.galaxy = ge; this.s = s; this.id = s.id; this.kind = 'system'; this.container = ge; this.level = 1; this.spec = s.spec;
    this._p = qrot(ge.g.orient, [s.pos[0] * C.PC, s.pos[1] * C.PC, s.pos[2] * C.PC]); this.radius = Math.max(s.spec.R * C.RSUN, 1e5); this.children = [];
    this.name = null; this._sys = null;
  }
  localPos() { return this._p; }
  get sys() {
    if (!this._sys) {
      const sys = generateSystem(this.galaxy.id, this.s, this._p); this._sys = sys; this.name = sys.name; this.extent = sys.extent; this.radius = sys.extent;
      sys.entity = this;
      for (const b of sys.bodies) { b.container = this; b.level = 2; b.localPos = (t) => bodyPos(b, t); b.system = this; if (b.kind === 'belt') b.radius = b.a0; }
    }
    return this._sys;
  }
  get title() { return this._sys ? this._sys.name : (this.name || this.nameGuess()); }
  nameGuess() { if (!this._sys) { this.sys; } return this._sys.name; }
}
export function systemEntity(ge, s) {
  let e = cache.get(s.id); if (!e) { e = new System(ge, s); cache.set(s.id, e); if (cache.size > 3000) { for (const k of cache.keys()) { cache.delete(k); if (cache.size < 2000) break; } } } return e;
}
export function galaxyEntity(g) { let e = cache.get(g.id); if (!e) { e = new Galaxy(g); cache.set(g.id, e); } return e; }
export function nebulaEntity(ge, n) { let e = cache.get(n.id); if (!e) { e = new Nebula(ge, n); cache.set(n.id, e); } return e; }
export function clusterEntity(c) { let e = cache.get(c.id); if (!e) { e = new Cluster(c); cache.set(c.id, e); } return e; }

export function resolve(id) {
  if (!id || id === 'u') return UNIVERSE;
  if (id.startsWith('cl:')) { const p = id.split(':'); const c = clustersInCell(+p[1], +p[2], +p[3]); return c ? clusterEntity(c) : UNIVERSE; }
  const parts = id.split('/'); const g = galaxyById(parts[0]); const ge = galaxyEntity(g); if (parts.length === 1) return ge;
  if (parts[1] === 'core') return ge.core;
  if (parts[1].startsWith('n:')) { const n = nebulaById(g, id); return n ? nebulaEntity(ge, n) : ge; }
  if (parts[1].startsWith('s:')) {
    const sid = parts[0] + '/' + parts[1]; const s = starById(g, sid); const se = systemEntity(ge, s);
    if (parts.length === 2) return se; const m = parts[2].match(/^b:(\d+)$/); const sys = se.sys; return sys.bodies[+m[1]] || se;
  }
  return ge;
}
// position of entity e in the frame of ancestor F (metres), at sim time t
export function posIn(e, F, t) {
  const p = [0, 0, 0]; let cur = e; let guard = 0;
  while (cur && cur !== F && guard++ < 8) { const l = cur.localPos(t); p[0] += l[0]; p[1] += l[1]; p[2] += l[2]; cur = cur.container; }
  return p;
}
export function chainOf(e) { const a = []; let c = e; while (c) { a.push(c); c = c.container; } return a; }
export function inChain(e, F) { let c = e; while (c) { if (c === F) return true; c = c.container; } return false; }
export function galaxyOf(e) { let c = e; while (c) { if (c.kind === 'galaxy') return c; c = c.container; } return null; }
export function systemOf(e) { let c = e; while (c) { if (c.kind === 'system') return c; c = c.container; } return null; }
export const GAL_TYPES = GTYPES;
