// Time-sliced streaming of items around a moving centre. Items are generated cell by cell, then swapped into GPU-ready arrays.
export class Streamer {
  // cfg: {cell (same units as positions), radius (cells), stride (floats per item), maxItems, gen(cx,cy,cz,out:number[]), budget(cells/frame), hysteresis}
  constructor(cfg) { this.cfg = cfg; this.origin = null; this.data = new Float32Array(cfg.maxItems * cfg.stride); this.count = 0; this.building = null; this.version = 0; this.centerCell = null; }
  update(pos) { // pos in the same units as cell; returns true if buffer swapped this frame
    const c = this.cfg; const cc = [Math.floor(pos[0] / c.cell), Math.floor(pos[1] / c.cell), Math.floor(pos[2] / c.cell)];
    const needNew = !this.centerCell || Math.max(Math.abs(cc[0] - this.centerCell[0]), Math.abs(cc[1] - this.centerCell[1]), Math.abs(cc[2] - this.centerCell[2])) >= (c.hyst || 1);
    if (needNew && (!this.building || this.building.cc[0] !== cc[0] || this.building.cc[1] !== cc[1] || this.building.cc[2] !== cc[2])) {
      const r = c.radius, cells = [];
      for (let z = -r; z <= r; z++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) cells.push([x, y, z, x * x + y * y + z * z]);
      cells.sort((a, b) => a[3] - b[3]);
      this.building = { cc, cells, i: 0, out: [], objs: [], origin: [cc[0] * c.cell, cc[1] * c.cell, cc[2] * c.cell] };
    }
    const b = this.building; if (!b) return false;
    let n = 0; const budget = c.budget || 200;
    while (b.i < b.cells.length && n < budget) { const cl = b.cells[b.i++]; c.gen(cc[0] + cl[0], cc[1] + cl[1], cc[2] + cl[2], b.out, b.origin, b.objs); n++; }
    if (b.i >= b.cells.length) {
      const stride = c.stride; const cnt = Math.min(b.out.length / stride, c.maxItems);
      for (let i = 0; i < cnt * stride; i++) this.data[i] = b.out[i];
      this.count = cnt; this.objs = b.objs; this.origin = b.origin; this.centerCell = b.cc; this.building = null; this.version++; return true;
    }
    return false;
  }
  reset() { this.origin = null; this.count = 0; this.building = null; this.centerCell = null; this.version++; }
}
