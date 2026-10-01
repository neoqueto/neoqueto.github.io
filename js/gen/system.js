// Stars and planetary systems: deterministic generation from seeds.
import { C, makeRng, seedOf, clamp, lerp, TAU, blackbody, v3, orbitPos, qfromEuler } from '../core.js';
import { properName, starSystemName, roman, planetLetter, catalogName } from '../names.js';

const AU = C.AU;
export function spectralClass(T) {
  const cls = T > 30000 ? 'O' : T > 10000 ? 'B' : T > 7500 ? 'A' : T > 6000 ? 'F' : T > 5200 ? 'G' : T > 3700 ? 'K' : T > 2300 ? 'M' : T > 1300 ? 'L' : 'T';
  const ranges = { O: [30000, 52000], B: [10000, 30000], A: [7500, 10000], F: [6000, 7500], G: [5200, 6000], K: [3700, 5200], M: [2300, 3700], L: [1300, 2300], T: [500, 1300] };
  const [lo, hi] = ranges[cls]; const sub = clamp(Math.floor(9.99 * (1 - (T - lo) / (hi - lo))), 0, 9);
  return cls + sub;
}
const STAR_TABLE = [
  ['ms', 0.80], ['giant', 0.050], ['subgiant', 0.012], ['rsg', 0.0085], ['bsg', 0.004], ['wr', 0.0025], ['wd', 0.065], ['ns', 0.008], ['pulsar', 0.007], ['magnetar', 0.0015], ['bh', 0.011], ['bd', 0.025],
];
// Returns a star record. hot => embedded cluster star (young/massive)
export function starSpec(seed, opt) {
  const r = makeRng('spec', seed);
  let kind = opt && opt.hot ? r.weighted([['ms', 0.75], ['bsg', 0.05], ['wr', 0.02]]) : r.weighted(STAR_TABLE);
  if (opt && opt.force) kind = opt.force;
  const s = { seed, kind, M: 1, R: 1, T: 5772, L: 1, Rm: 0, spin: 0, flags: {} };
  switch (kind) {
    case 'ms': {
      const cls = opt && opt.hot ? r.weighted([['B', 6], ['O', 2], ['A', 2]]) : r.weighted([['M', 0.5], ['K', 0.17], ['G', 0.10], ['F', 0.07], ['A', 0.05], ['B', 0.045], ['O', 0.012]]);
      const rg = { M: [0.1, 0.6], K: [0.6, 0.85], G: [0.85, 1.1], F: [1.1, 1.5], A: [1.5, 2.5], B: [2.5, 16], O: [16, 60] }[cls];
      s.M = cls === 'M' || cls === 'B' || cls === 'O' ? r.logu(rg[0], rg[1]) : r.range(rg[0], rg[1]);
      s.R = s.M < 1 ? Math.pow(s.M, 0.8) : Math.pow(s.M, 0.57);
      s.L = s.M < 0.43 ? 0.23 * Math.pow(s.M, 2.3) : s.M < 2 ? Math.pow(s.M, 4) : s.M < 55 ? 1.4 * Math.pow(s.M, 3.5) : 32000 * s.M;
      s.T = C.TSUN * Math.pow(s.L / (s.R * s.R), 0.25); s.lclass = 'V'; break;
    }
    case 'subgiant': s.M = r.range(1, 2.4); s.R = r.range(1.8, 4); s.T = r.range(5000, 6200); s.lclass = 'IV'; break;
    case 'giant': s.M = r.range(0.8, 3); s.R = r.range(8, 60); s.T = r.range(3500, 5200); s.lclass = 'III'; break;
    case 'rsg': s.M = r.range(9, 25); s.R = r.logu(200, 1300); s.T = r.range(3200, 4000); s.lclass = 'I'; break;
    case 'bsg': s.M = r.range(15, 40); s.R = r.range(20, 70); s.T = r.range(12000, 26000); s.lclass = 'I'; break;
    case 'wr': s.M = r.range(10, 25); s.R = r.range(2, 6); s.T = r.range(45000, 120000); s.lclass = 'WR'; break;
    case 'wd': s.M = r.range(0.5, 1.3); s.R = 0.0126 * Math.pow(s.M / 0.6, -1 / 3); s.T = r.logu(4500, 45000); s.lclass = 'D'; break;
    case 'bd': s.M = r.range(0.013, 0.075); s.R = r.range(0.085, 0.125); s.T = r.range(700, 2300); s.lclass = 'BD'; break;
    case 'ns': case 'pulsar': case 'magnetar':
      s.M = r.range(1.2, 2.3); s.Rm = r.range(10e3, 13e3); s.R = s.Rm / C.RSUN; s.T = r.range(4e5, 1.2e6); s.lclass = 'NS';
      s.spin = kind === 'pulsar' ? r.logu(0.0016, 2.5) : kind === 'magnetar' ? r.range(2, 9) : r.range(5, 40);
      s.B = kind === 'magnetar' ? Math.pow(10, r.range(10, 11.2)) : kind === 'pulsar' ? Math.pow(10, r.range(4, 8.5)) : Math.pow(10, r.range(6, 8)); // tesla (1 T = 1e4 G)
      break;
    case 'bh': s.M = r.logu(3.2, 45); s.Rm = 2 * C.G * s.M * C.MSUN / (C.c * C.c); s.R = s.Rm / C.RSUN; s.T = 0; s.lclass = 'BH'; s.flags.spinA = r.range(0, 0.99); break;
  }
  if (!s.Rm) s.Rm = s.R * C.RSUN;
  if (kind !== 'bh') s.L = s.kind === 'ns' || s.kind === 'pulsar' || s.kind === 'magnetar' ? 4 * Math.PI * s.Rm * s.Rm * C.SIGMA * Math.pow(s.T, 4) / C.LSUN : s.R * s.R * Math.pow(s.T / C.TSUN, 4);
  else s.L = 0;
  s.compact = kind === 'wd' || kind === 'ns' || kind === 'pulsar' || kind === 'magnetar' || kind === 'bh';
  s.color = kind === 'bh' ? [0, 0, 0] : blackbody(s.T);
  s.spectral = kind === 'bh' ? 'BH' : kind === 'wr' ? 'WN' + r.int(3, 8) : kind === 'ns' || kind === 'pulsar' || kind === 'magnetar' ? (kind === 'magnetar' ? 'Magnetar' : kind === 'pulsar' ? 'Pulsar' : 'Neutron star') : kind === 'wd' ? 'D' + (s.T > 20000 ? 'O' : s.T > 10000 ? 'A' : 'C') : spectralClass(s.T) + (s.lclass === 'I' ? 'I' : s.lclass === 'III' ? 'III' : s.lclass === 'IV' ? 'IV' : kind === 'bd' ? '' : 'V');
  s.name = kind === 'bd' ? 'Brown dwarf' : { ms: 'Main-sequence star', subgiant: 'Subgiant', giant: 'Red giant', rsg: 'Red supergiant', bsg: 'Blue supergiant', wr: 'Wolf–Rayet star', wd: 'White dwarf', ns: 'Neutron star', pulsar: 'Pulsar', magnetar: 'Magnetar', bh: 'Stellar black hole' }[kind];
  // apparent glow luminosity for the star field (relative to Sun) — compact objects get an artificial minimum so they're findable
  s.vis = kind === 'bh' ? 4 : kind === 'ns' || kind === 'magnetar' ? 6 : kind === 'pulsar' ? 14 : Math.max(s.L, 1e-4);
  s.radiance = clamp(Math.pow(Math.max(s.T, 800) / C.TSUN, 2.0) * 0.95, 0.3, 4);
  s.age = r.range(0.05, 12); return s;
}

// ---- planets -----------------------------------------------------------------------
const ATM = {
  earth: { ray: [5.8e-6, 13.5e-6, 33.1e-6], mie: 3.8e-6, g: 0.76, absorb: [0.65e-6, 1.88e-6, 0.085e-6], Hr: 8000, Hm: 1200 },
  thick: { ray: [9e-6, 14e-6, 26e-6], mie: 60e-6, g: 0.65, absorb: [0, 0, 0], Hr: 15000, Hm: 6000 },
  mars: { ray: [4e-6, 3e-6, 2e-6], mie: 18e-6, g: 0.7, absorb: [0, 0, 0], Hr: 11000, Hm: 7000 },
  methane: { ray: [3e-6, 14e-6, 38e-6], mie: 6e-6, g: 0.7, absorb: [2.2e-6, 0.3e-6, 0.02e-6], Hr: 20000, Hm: 3000 },
  tholin: { ray: [10e-6, 8e-6, 5e-6], mie: 70e-6, g: 0.4, absorb: [0, 0.2e-6, 0.7e-6], Hr: 18000, Hm: 14000 },
  sulfur: { ray: [8e-6, 11e-6, 9e-6], mie: 40e-6, g: 0.7, absorb: [0, 0, 0.3e-6], Hr: 9000, Hm: 5000 },
};
const hsv = (h, s, v) => { const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [Math.pow(f(5), 2.2), Math.pow(f(3), 2.2), Math.pow(f(1), 2.2)]; };

function rockyVisual(p, r, Teq, starCol) {
  const R = p.radius, g = p.gravity;
  const T = { seed: p.seed % 100000, radius: R, seaLevel: -1e9, irregular: 0, axes: null, craterDensity: 0, craterAmp: 0, contAmp: 0, contFreq: 1.2, mountFreq: 4, mountAmp: 0, mountMask: -0.1, ridgeW: 1, rough: 0, terrace: 0 };
  const relief = 9000 * (9.81 / g) * r.range(0.6, 1.3) * Math.min(1.5, R / C.REARTH + 0.3);  // lower gravity -> taller mountains
  const v = { type: p.biome, pal: {}, clouds: null, atm: null, ocean: null, ice: 0, lava: 0, veg: 0, polar: 0, roughness: 0.7, crack: 0, dune: 0, snowLine: 0.9 };
  const hueV = r();
  switch (p.biome) {
    case 'terran': {
      T.contAmp = relief * 0.5; T.mountAmp = relief * 0.7; T.contFreq = r.range(0.9, 1.5); T.mountFreq = r.range(3, 5); T.rough = relief * 0.02; T.mountMask = r.range(0.0, 0.1);
      const wf = r.range(0.5, 0.78); T.seaLevel = relief * (wf - 0.5) * 0.9 - 0.06 * relief + (wf > 0.7 ? 600 : 0);
      v.ocean = { shallow: [0.03, 0.24 + 0.1 * r(), 0.32 + 0.1 * r()], deep: [0.005, 0.04, 0.12 + 0.05 * r()], level: 0, foam: 0.7 };
      const vegHue = starCol[2] < 0.5 ? r.range(0.0, 0.1) : r.pick([0.27, 0.3, 0.22, 0.18, 0.38]);
      v.pal = { low: hsv(vegHue, 0.75, 0.22 + r() * 0.1), mid: hsv(vegHue + 0.03, 0.5, 0.27), dry: hsv(0.1 + r() * 0.04, 0.45, 0.4), high: [0.3, 0.28, 0.26], snow: [0.9, 0.93, 0.97], sand: hsv(0.12, 0.35, 0.7) };
      v.veg = r.range(0.4, 1); v.polar = r.range(0.3, 0.9) * (Teq < 285 ? 1.3 : 0.7); v.snowLine = r.range(0.55, 0.85);
      v.atm = { ...ATM.earth, ray: ATM.earth.ray.map((x) => x * r.range(0.8, 1.3)) }; v.clouds = { cover: r.range(0.35, 0.65), color: [1, 1, 1], alt: 9000, speed: 1 };
      break;
    }
    case 'ocean': {
      T.contAmp = relief * 0.18; T.mountAmp = relief * 0.2; T.contFreq = 1.4; T.rough = relief * 0.01; T.seaLevel = relief * 0.15 + 500;
      v.ocean = { shallow: [0.04, 0.3, 0.38], deep: [0.003, 0.03, 0.1], level: 0, foam: 0.9 };
      v.pal = { low: [0.15, 0.2, 0.1], mid: [0.2, 0.25, 0.15], dry: [0.4, 0.35, 0.2], high: [0.3, 0.28, 0.26], snow: [0.9, 0.93, 0.97], sand: [0.7, 0.65, 0.5] }; v.polar = 0.5; v.atm = ATM.earth; v.clouds = { cover: r.range(0.55, 0.85), color: [1, 1, 1], alt: 9000, speed: 1.3 };
      break;
    }
    case 'desert': {
      T.contAmp = relief * 0.35; T.mountAmp = relief * 0.5; T.contFreq = r.range(1.4, 2.2); T.mountFreq = r.range(3, 6); T.rough = relief * 0.03; T.craterDensity = r.range(0, 0.12); T.craterAmp = 1500; T.mountMask = 0.05; T.terrace = relief * 0.04;
      const hueD = r.pick([0.06, 0.08, 0.1, 0.04, 0.12]);
      v.pal = { low: hsv(hueD, 0.55, 0.42), mid: hsv(hueD + 0.01, 0.5, 0.52), dry: hsv(hueD + 0.03, 0.4, 0.62), high: hsv(hueD - 0.01, 0.4, 0.3), snow: [0.85, 0.8, 0.75], sand: hsv(hueD + 0.02, 0.35, 0.75) };
      v.dune = r.range(0.4, 1); v.polar = Teq < 240 ? 0.4 : 0.1; v.atm = ATM.mars; v.clouds = { cover: r.range(0, 0.15), color: [0.95, 0.85, 0.8], alt: 12000, speed: 2 };
      break;
    }
    case 'barren': case 'moon': {
      T.contAmp = relief * 0.22; T.mountAmp = relief * 0.18; T.contFreq = 1.1; T.mountFreq = 5; T.mountMask = 0.2; T.rough = relief * 0.015; T.craterDensity = r.range(0.35, 0.8); T.craterAmp = 2500 * Math.min(2, R / 1.7e6 + 0.3) * (9.8 / g) ** 0.4;
      const l = r.range(0.2, 0.42), tint = r.range(-0.03, 0.05);
      v.pal = { low: [l * 0.55, l * 0.53, l * 0.5], mid: [l * 0.9 + tint, l * 0.85, l * 0.8], dry: [l * 1.2, l * 1.12 + tint, l * 1.0], high: [l * 1.4, l * 1.35, l * 1.3], snow: [0.7, 0.7, 0.7], sand: [l, l, l] };
      v.maria = r.range(0.2, 0.6); v.atm = null; break;
    }
    case 'ice': {
      T.contAmp = relief * 0.1; T.mountAmp = relief * 0.12; T.contFreq = 1.6; T.mountFreq = 6; T.rough = relief * 0.005; T.craterDensity = r.range(0.05, 0.4); T.craterAmp = 1200;
      const tint = r.range(0, 1);
      v.pal = { low: [0.62, 0.72 + 0.1 * tint, 0.82], mid: [0.8, 0.86, 0.9], dry: [0.9, 0.93, 0.96], high: [0.95, 0.96, 0.98], snow: [0.95, 0.97, 1], sand: [0.6, 0.45 + 0.1 * tint, 0.35] };
      v.crack = r.range(0.2, 1); v.ice = 1; v.atm = r() < 0.35 ? { ...ATM.mars, ray: [3e-6, 5e-6, 8e-6], mie: 8e-6 } : null; v.clouds = null; break;
    }
    case 'lava': {
      T.contAmp = relief * 0.3; T.mountAmp = relief * 0.5; T.contFreq = 1.8; T.mountFreq = 6; T.rough = relief * 0.03; T.mountMask = 0.0; T.craterDensity = r.range(0, 0.2); T.craterAmp = 1500;
      v.pal = { low: [0.015, 0.012, 0.012], mid: [0.05, 0.04, 0.035], dry: [0.1, 0.07, 0.05], high: [0.14, 0.11, 0.09], snow: [0.3, 0.25, 0.2], sand: [0.2, 0.1, 0.05] };
      v.lava = r.range(0.5, 1); v.lavaCol = [1.0, 0.25 + 0.2 * r(), 0.03]; v.atm = { ...ATM.sulfur, ray: [10e-6, 7e-6, 3e-6], mie: 7e-6 }; v.clouds = { cover: 0.85, color: [0.22, 0.12, 0.08], alt: 12000, speed: 1.5 }; break;
    }
    case 'volcanic': {
      T.contAmp = relief * 0.18; T.mountAmp = relief * 0.35; T.contFreq = 2.2; T.mountFreq = 5; T.rough = relief * 0.015; T.craterDensity = 0.03; T.craterAmp = 800;
      v.pal = { low: [0.45, 0.4, 0.08], mid: [0.6, 0.55, 0.15], dry: [0.7, 0.6, 0.25], high: [0.55, 0.28, 0.1], snow: [0.9, 0.9, 0.75], sand: [0.7, 0.62, 0.2] };
      v.lava = r.range(0.2, 0.6); v.lavaCol = [1.0, 0.35, 0.05]; v.atm = null; break;
    }
    case 'venus': {
      T.contAmp = relief * 0.3; T.mountAmp = relief * 0.5; T.contFreq = 1.3; T.mountFreq = 4; T.rough = relief * 0.02; T.mountMask = 0.1;
      v.pal = { low: [0.25, 0.14, 0.07], mid: [0.32, 0.2, 0.1], dry: [0.4, 0.28, 0.15], high: [0.45, 0.35, 0.25], snow: [0.7, 0.6, 0.45], sand: [0.5, 0.35, 0.2] };
      v.atm = ATM.thick; v.clouds = { cover: 1, color: [0.95, 0.82, 0.55], alt: 50000, speed: 4 }; v.thickAtm = 1; break;
    }
    case 'tholin': {
      T.contAmp = relief * 0.2; T.mountAmp = relief * 0.2; T.contFreq = 1.2; T.mountFreq = 4; T.rough = relief * 0.01; T.seaLevel = relief * -0.1;
      v.pal = { low: [0.18, 0.1, 0.04], mid: [0.25, 0.15, 0.06], dry: [0.35, 0.22, 0.1], high: [0.4, 0.3, 0.2], snow: [0.7, 0.6, 0.5], sand: [0.45, 0.3, 0.12] };
      v.ocean = { shallow: [0.06, 0.05, 0.03], deep: [0.01, 0.01, 0.01], level: 0, foam: 0.1 }; v.atm = ATM.tholin; v.clouds = { cover: 0.55, color: [0.9, 0.6, 0.3], alt: 30000, speed: 1 }; break;
    }
  }
  if (v.atm) { const k = p.pressure; v.atm = { ...v.atm, ray: v.atm.ray.map((x) => x * Math.max(0.15, Math.pow(k, 0.8))), mie: v.atm.mie * Math.max(0.2, Math.pow(k, 0.6)), Hr: v.atm.Hr * Math.pow(9.81 / g, 0.7) }; v.atm.height = v.atm.Hr * 7.5; }
  v.T = T; return v;
}
function rockyType(r, Teq, R, M, isMoon, icy) {
  if (R < 0.15 * C.REARTH || (M < 0.01 * C.MEARTH)) return Teq < 150 ? 'ice' : 'barren';
  if (isMoon) { if (icy) return r() < 0.3 ? 'ice' : 'ice'; if (Teq > 300 && r() < 0.1) return 'volcanic'; return r() < 0.35 && R > 1.5e6 && Teq > 80 && r() < 0.5 ? 'tholin' : r() < 0.7 ? 'barren' : 'ice'; }
  if (Teq > 900) return 'lava';
  if (Teq > 420) return r() < 0.55 ? 'venus' : 'desert';
  if (Teq > 255 && Teq < 330) return r() < 0.55 ? 'terran' : r() < 0.35 ? 'ocean' : 'desert';
  if (Teq >= 330) return r() < 0.5 ? 'desert' : 'venus';
  if (Teq > 190) return r() < 0.4 ? 'desert' : r() < 0.5 ? 'terran' : 'ice';
  return r() < 0.15 ? 'tholin' : 'ice';
}
const BIOME_NAME = { terran: 'Terran world', ocean: 'Ocean world', desert: 'Desert world', barren: 'Barren rocky world', moon: 'Cratered moon', ice: 'Ice world', lava: 'Lava world', volcanic: 'Volcanic world', venus: 'Greenhouse world', tholin: 'Hazy organic world' };

function makeRocky(r, o) { // o: {name, seed, radius, mass, Teq, isMoon, icy, starCol}
  const p = { seed: o.seed, kind: o.isMoon ? 'moon' : 'planet', cls: 'rocky', radius: o.radius, mass: o.mass };
  p.gravity = C.G * o.mass / (o.radius * o.radius); p.density = o.mass / (4 / 3 * Math.PI * o.radius ** 3);
  p.biome = o.biome || rockyType(r, o.Teq, o.radius, o.mass, o.isMoon, o.icy);
  p.pressure = p.biome === 'venus' ? r.range(30, 95) : p.biome === 'tholin' ? r.range(1.2, 2) : p.biome === 'terran' || p.biome === 'ocean' ? r.range(0.5, 2.5) : p.biome === 'desert' ? r.range(0.006, 0.6) : p.biome === 'lava' ? r.range(5, 60) : p.biome === 'ice' ? r.range(0, 0.01) : 0;
  if (p.gravity < 2.0 && p.biome !== 'tholin') { if (p.biome === 'terran' || p.biome === 'ocean') p.biome = 'desert'; if (p.biome === 'venus') p.biome = 'barren'; p.pressure = Math.min(p.pressure, 0.01); }
  p.Teq = o.Teq; p.albedo = p.biome === 'ice' ? 0.7 : p.biome === 'venus' ? 0.75 : p.biome === 'terran' ? 0.3 : 0.12 + r() * 0.15;
  p.Tsurf = o.Teq * (1 + (p.biome === 'venus' ? 1.6 : p.biome === 'terran' ? 0.06 : p.pressure > 0.1 ? 0.05 : 0));
  p.visual = rockyVisual(p, r, o.Teq, o.starCol);
  p.biomeName = BIOME_NAME[p.biome];
  p.hasLife = p.biome === 'terran' && p.Tsurf > 255 && p.Tsurf < 320 && r() < 0.65;
  if (!p.hasLife && p.visual.veg) p.visual.veg = 0;
  if (p.visual.atm) p.atmName = { terran: 'Nitrogen–oxygen', ocean: 'Nitrogen–water vapour', desert: 'Thin carbon dioxide', venus: 'Dense carbon dioxide / sulphuric haze', lava: 'Sulphur dioxide / silicate vapour', tholin: 'Nitrogen–methane haze' }[p.biome] || 'Thin atmosphere'; else p.atmName = 'None (vacuum)';
  return p;
}
function makeGas(r, o) {
  const p = { seed: o.seed, kind: 'planet', cls: 'gas', radius: o.radius, mass: o.mass };
  p.gravity = C.G * o.mass / (o.radius ** 2); p.density = o.mass / (4 / 3 * Math.PI * o.radius ** 3);
  const hot = o.Teq > 1000, ice = o.Teq < 120 || o.radius < 0.5 * C.RJUP;
  p.biome = hot ? 'hotjup' : o.radius < 0.2 * C.RJUP ? 'subnep' : ice ? 'neptunian' : r() < 0.5 ? 'jovian' : 'saturnian';
  p.Tsurf = o.Teq * 1.2;
  const bandN = r.int(8, 22), hue = r();
  const pals = {
    jovian: [[0.88, 0.8, 0.68], [0.7, 0.45, 0.28], [0.95, 0.9, 0.82], [0.55, 0.32, 0.2], [0.8, 0.62, 0.45]],
    saturnian: [[0.92, 0.82, 0.55], [0.78, 0.6, 0.34], [0.96, 0.9, 0.72], [0.62, 0.45, 0.28], [0.85, 0.7, 0.45]],
    neptunian: [[0.18, 0.35, 0.82], [0.25, 0.5, 0.9], [0.12, 0.25, 0.7], [0.4, 0.62, 0.95], [0.2, 0.42, 0.85]],
    subnep: [[0.45, 0.7, 0.8], [0.55, 0.78, 0.85], [0.4, 0.62, 0.75], [0.62, 0.82, 0.88], [0.5, 0.72, 0.8]],
    hotjup: [[0.08, 0.06, 0.05], [0.18, 0.1, 0.08], [0.3, 0.12, 0.06], [0.12, 0.08, 0.1], [0.22, 0.14, 0.1]],
  };
  let pal = pals[p.biome].map((c) => c.slice());
  const alt = r();
  if (p.biome === 'jovian' && alt < 0.2) pal = [[0.2, 0.5, 0.6], [0.3, 0.65, 0.7], [0.15, 0.4, 0.55], [0.5, 0.78, 0.8], [0.25, 0.55, 0.65]];
  else if (p.biome === 'jovian' && alt < 0.35) pal = [[0.55, 0.28, 0.4], [0.7, 0.4, 0.5], [0.85, 0.6, 0.65], [0.4, 0.2, 0.35], [0.65, 0.35, 0.45]];
  else if (p.biome === 'hotjup' && alt < 0.5) pal = [[0.8, 0.35, 0.1], [0.9, 0.5, 0.2], [0.6, 0.2, 0.08], [0.95, 0.65, 0.3], [0.7, 0.3, 0.12]];
  p.visual = { type: p.biome, pal, bands: bandN, contrast: p.biome === 'neptunian' || p.biome === 'subnep' ? r.range(0.2, 0.45) : r.range(0.6, 1.2), turb: r.range(0.5, 1.4), storm: r() < 0.7 ? { lat: r.range(-0.5, 0.5), size: r.range(0.03, 0.12), col: r() < 0.6 ? [0.75, 0.3, 0.18] : [0.95, 0.92, 0.88], lon: r() * TAU } : null, hot: hot ? clamp((o.Teq - 800) / 1200, 0.2, 1) : 0, haze: r.range(0.2, 0.7), vortices: r.int(0, 6), seed: o.seed % 9973 };
  const gp = { ray: p.biome === 'neptunian' || p.biome === 'subnep' ? [3e-6, 10e-6, 30e-6] : [8e-6, 12e-6, 20e-6], mie: 12e-6, g: 0.5, absorb: p.biome === 'neptunian' ? [3e-6, 0.5e-6, 0.0] : [0, 0, 0], Hr: o.radius * 0.0045, Hm: o.radius * 0.002 };
  const kScale = Math.min(1, 8000 / gp.Hr) * 2.6; gp.ray = gp.ray.map((x) => x * kScale); gp.mie *= kScale; gp.absorb = gp.absorb.map((x) => x * kScale);
  gp.height = gp.Hr * 7; p.visual.atm = gp;
  p.pressure = 1e5; p.atmName = p.biome === 'neptunian' ? 'Hydrogen–helium–methane' : p.biome === 'hotjup' ? 'Hydrogen–helium, vaporised metals' : 'Hydrogen–helium, ammonia clouds';
  p.biomeName = { jovian: 'Gas giant', saturnian: 'Gas giant (ringed type)', neptunian: 'Ice giant', subnep: 'Sub-Neptune', hotjup: 'Hot Jupiter' }[p.biome];
  return p;
}
function makeAsteroid(r, o) {
  const p = { seed: o.seed, kind: 'moon', cls: 'rocky', asteroid: true, radius: o.radius, mass: o.mass, biome: 'barren', Teq: o.Teq, albedo: 0.07 + r() * 0.1 };
  p.gravity = C.G * o.mass / (o.radius ** 2); p.density = o.mass / (4 / 3 * Math.PI * o.radius ** 3); p.pressure = 0; p.atmName = 'None (vacuum)'; p.Tsurf = o.Teq; p.biomeName = 'Irregular body (captured asteroid)';
  const v = rockyVisual({ ...p, biome: 'moon', gravity: Math.max(p.gravity, 0.002) }, r, o.Teq, [1, 1, 1]);
  const ax = [r.range(0.8, 1.2), r.range(0.55, 0.9), r.range(0.45, 0.8)]; v.T.irregular = r.range(0.12, 0.26); v.T.axes = ax; v.T.contAmp = 0; v.T.mountAmp = 0; v.T.rough = 0; v.T.craterDensity = r.range(0.5, 1); v.T.craterAmp = o.radius * 0.25; v.T.radius = o.radius; v.T.seaLevel = -1e9;
  v.type = 'barren'; v.dark = r.range(0.5, 1.1); p.visual = v; return p;
}

export function equilibriumT(L, a, albedo = 0.3) { return 278.5 * Math.pow(L, 0.25) / Math.sqrt(a / AU) * Math.pow(1 - albedo, 0.25); }

// ---- full system --------------------------------------------------------------------
export function generateSystem(galaxyId, starRef, galaxyPos) {
  const seed = starRef.seed;
  const rng = makeRng('sys', seed);
  const sys = { id: starRef.id, seed, galaxyId, name: starSystemName(rng), stars: [], bodies: [], planets: [], posGal: galaxyPos, spec: starRef.spec };
  const incBase = rng.range(-0.3, 0.3), nodeBase = rng() * TAU; sys.incBase = incBase; sys.nodeBase = nodeBase;
  // --- stars
  let a = starRef.spec; const specs = [a];
  let layout = 'single', sep = 0, eBin = 0;
  const compactA = a.compact;
  if (a.kind === 'bh' || a.kind === 'ns' || a.kind === 'pulsar' || a.kind === 'magnetar') {
    if (rng() < 0.55) { // companion star
      const comp = starSpec(seedOf(seed, 'comp'), { force: rng() < 0.7 ? 'ms' : rng() < 0.5 ? 'giant' : 'subgiant' }); if (comp.kind === 'ms') { comp.M = Math.max(comp.M, 0.6); comp.R = Math.pow(comp.M, comp.M < 1 ? 0.8 : 0.57); comp.L = Math.pow(comp.M, 4); comp.T = C.TSUN * Math.pow(comp.L / (comp.R ** 2), 0.25); comp.color = blackbody(comp.T); comp.spectral = spectralClass(comp.T) + 'V'; comp.radiance = clamp(Math.pow(comp.T / C.TSUN, 2.0) * 0.95, 0.3, 4); comp.vis = Math.max(comp.L, 1e-3); }
      specs.push(comp); layout = rng() < 0.7 ? 'accreting' : 'compactbin'; sep = layout === 'accreting' ? rng.logu(0.025, 0.12) * AU : rng.logu(0.5, 8) * AU; eBin = layout === 'accreting' ? rng.range(0, 0.08) : rng.range(0, 0.5);
    }
  } else if (rng() < 0.42 && a.kind !== 'bd') {
    const q = rng.range(0.15, 1); const comp = starSpec(seedOf(seed, 'comp'), { force: rng() < 0.9 ? 'ms' : rng() < 0.6 ? 'wd' : 'giant' });
    if (comp.kind === 'ms') { const M = Math.min(a.M, 3) * q + 0.08; comp.M = M; comp.R = Math.pow(M, M < 1 ? 0.8 : 0.57); comp.L = M < 0.43 ? 0.23 * Math.pow(M, 2.3) : Math.pow(M, M < 2 ? 4 : 3.5); comp.T = C.TSUN * Math.pow(comp.L / (comp.R ** 2), 0.25); comp.color = blackbody(comp.T); comp.spectral = spectralClass(comp.T) + 'V'; comp.radiance = clamp(Math.pow(comp.T / C.TSUN, 2.0) * 0.95, 0.3, 4); comp.vis = Math.max(comp.L, 1e-4); comp.Rm = comp.R * C.RSUN; }
    specs.push(comp); const rr = rng(); layout = 'binary';
    sep = rr < 0.35 ? rng.logu(0.03, 0.5) * AU : rr < 0.75 ? rng.logu(1, 40) * AU : rng.logu(80, 2500) * AU; eBin = rng.range(0, rr < 0.35 ? 0.15 : 0.7);
    if (rng() < 0.04 && specs.length === 2) { // triple: inner binary + distant third
      layout = 'triple'; const t = starSpec(seedOf(seed, 'third'), { force: 'ms' }); specs.push(t);
    }
  }
  sys.layout = layout;
  const orb0 = (aa, ee, P, phase) => ({ a: aa, e: ee, inc: incBase + rng.range(-0.05, 0.05), node: nodeBase, argp: rng() * TAU, M0: phase, P });
  const mkStar = (spec, idx, orbit, parent) => {
    const rs = makeRng('star', spec.seed, idx);
    const st = { id: '', kind: 'star', sys, spec, idx, name: '', parent, orbit, radius: spec.Rm, mass: spec.M * C.MSUN, lum: spec.L * C.LSUN, T: spec.T, color: spec.color, children: [] };
    const hot = spec.T > 12000; st.rot = { period: spec.compact ? (spec.kind === 'wd' ? rs.range(600, 86400 * 2) : spec.spin || 1) : (spec.T > 7500 ? rs.range(0.4, 3) : rs.range(8, 40)) * C.DAY, tilt: rs.range(0, 1.5), phase: rs() * TAU };
    st.spots = clamp((6200 - spec.T) / 3500, 0, 1) * rs.range(0.3, 1) + (spec.kind === 'rsg' ? 0.5 : 0);
    st.oblate = spec.compact ? 0 : clamp(0.0008 * (C.DAY * 25 / st.rot.period) * (spec.T > 7500 ? 6 : 1), 0, spec.T > 7500 ? 0.28 : 0.08);
    st.flare = clamp(rs.range(0, 1) * (spec.M < 0.5 ? 1 : spec.M < 1.2 ? 0.5 : 0.1), 0, 1);
    st.conv = spec.kind === 'giant' || spec.kind === 'rsg' ? 1 : spec.kind === 'bsg' || spec.kind === 'wr' ? 0.2 : 0.55;
    return st;
  };
  const Ms = specs.map((s) => s.M * C.MSUN);
  if (specs.length === 1) { const st = mkStar(a, 0, null, null); sys.stars.push(st); }
  else {
    const mA = Ms[0], mB = Ms[1], mt = mA + mB; const P = TAU * Math.sqrt(sep ** 3 / (C.G * mt));
    const ph = rng() * TAU;
    const oA = orb0(sep * mB / mt, eBin, P, ph), oB = { ...oA, a: sep * mA / mt, argp: oA.argp + Math.PI, M0: oA.M0 }; // opposite side
    sys.stars.push(mkStar(specs[0], 0, oA, null), mkStar(specs[1], 1, oB, null)); sys.binarySep = sep; sys.binaryP = P;
    if (specs.length === 3) {
      const mc = Ms[2]; const mt2 = mt + mc; const sep2 = sep * rng.range(25, 80); const P2 = TAU * Math.sqrt(sep2 ** 3 / (C.G * mt2)); const e2 = rng.range(0, 0.4); const ph2 = rng() * TAU;
      const inner = [sys.stars[0], sys.stars[1]];
      // nest: inner pair orbits the system barycentre at a*mc/mt2 ; third star opposite
      for (const s of inner) { s.parentBary = { a: sep2 * mc / mt2, e: e2, inc: incBase + 0.2, node: nodeBase, argp: oA.argp, M0: ph2, P: P2 }; }
      const t = mkStar(specs[2], 2, { a: sep2 * mt / mt2, e: e2, inc: incBase + 0.2, node: nodeBase, argp: oA.argp + Math.PI, M0: ph2, P: P2 }, null); sys.stars.push(t); sys.tripleSep = sep2;
    }
  }
  for (let i = 0; i < sys.stars.length; i++) sys.stars[i].name = sys.name + ' ' + String.fromCharCode(65 + i);
  const A = sys.stars[0], B = sys.stars[1];
  sys.lights = sys.stars.filter((s) => s.spec.L > 0 && !(s.spec.kind === 'bh'));
  // --- accretion details
  for (const s of sys.stars) if (s.spec.kind === 'bh' || s.spec.kind === 'ns' || s.spec.kind === 'pulsar' || s.spec.kind === 'magnetar') {
    if (layout === 'accreting' && s === A) { const comp = B; const roche = sep * 0.38 * Math.pow(comp.mass / (A.mass + comp.mass), 0.33) * 2; comp.rocheFill = clamp(comp.radius / (sep * 0.37 * Math.pow(comp.mass / A.mass, 0.33)), 0, 1.4); s.accretion = { rout: s.spec.kind === 'bh' ? s.spec.Rm * rng.range(70, 220) : s.radius * rng.range(100, 800), temp: s.spec.kind === 'bh' ? rng.range(5000, 14000) : rng.range(8000, 20000), rate: rng.logu(0.1, 3) }; if (comp.rocheFill > 0.75) comp.tidal = clamp(comp.rocheFill - 0.6, 0, 0.6); else comp.tidal = 0.0; if (comp.tidal < 0.15) { comp.tidal = 0.15; } }
    else if (s.spec.kind === 'bh' && (rng() < 0.4 || layout === 'single')) s.accretion = { rout: s.spec.Rm * rng.range(40, 140), temp: rng.range(3000, 7000), rate: 0.05, faint: layout === 'single' };
  }
  // --- planets
  const addPlanetsAround = (host, aMin, aMax, count, Lhost, isCirc, tag) => {
    const out = []; let aa = aMin * rng.range(1, 1.4);
    for (let i = 0; i < count && aa < aMax; i++) { out.push(aa); aa *= rng.range(1.45, 2.3); }
    return out;
  };
  const planetsFor = (host, hostMass, Lhost, aMin, aMax, count, circ, parentOrbit) => {
    const aList = addPlanetsAround(host, aMin, aMax, count, Lhost);
    const frost = 2.7 * AU * Math.sqrt(Math.max(Lhost, 0.001));
    const res = [];
    for (const aa of aList) {
      const pr = makeRng('planet', seed, host ? host.idx : 9, Math.floor(aa / 1e6));
      const e = Math.min(0.7, Math.abs(pr.gauss()) * 0.07 + (pr() < 0.1 ? pr.range(0.1, 0.5) : 0));
      const aphys = aa; const Teq = Lhost > 0 ? equilibriumT(Lhost, aa, 0.3) : 30;
      let cls; const beyond = aa > frost * 0.8;
      if (!beyond) cls = pr() < (Teq > 900 ? 0.18 : 0.07) ? 'gas' : 'rocky'; else cls = pr() < 0.6 ? 'gas' : 'rocky';
      let pl;
      const ps = seedOf(seed, 'p', host ? host.idx : 9, Math.floor(aa / 1e6));
      if (cls === 'rocky') {
        const Rr = pr.logu(0.25, 1.9) * C.REARTH; const Mm = C.MEARTH * Math.pow(Rr / C.REARTH, 3.4) * (0.5 + pr());
        pl = makeRocky(pr, { seed: ps, radius: Rr, mass: Mm, Teq, starCol: host ? host.color : [1, 1, 1] });
      } else {
        const sub = pr();
        let Rr, Mm; if (sub < 0.4) { Rr = pr.range(0.25, 0.45) * C.RJUP; Mm = pr.range(10, 25) * C.MEARTH; } else if (sub < 0.5) { Rr = pr.range(0.12, 0.24) * C.RJUP; Mm = pr.range(3, 10) * C.MEARTH; } else { Rr = pr.range(0.8, 1.25) * C.RJUP * (Teq > 1000 ? 1.25 : 1); Mm = pr.logu(0.15, 6) * C.MJUP; }
        pl = makeGas(pr, { seed: ps, radius: Rr, mass: Mm, Teq });
      }
      const P = TAU * Math.sqrt(aphys ** 3 / (C.G * (hostMass + pl.mass)));
      pl.orbit = { a: aphys, e, inc: incBase + pr.range(-0.045, 0.045), node: nodeBase + pr.range(-0.1, 0.1), argp: pr() * TAU, M0: pr() * TAU, P };
      pl.rot = { period: (Teq > 600 && aa < 0.1 * AU * Math.sqrt(Lhost + 0.01)) ? P : pr.range(7, 70) * 3600 * (pl.cls === 'gas' ? 0.25 : 1), tilt: pr() < 0.1 ? pr.range(0.8, 1.7) : Math.abs(pr.gauss()) * 0.28, phase: pr() * TAU };
      if (pl.cls === 'gas') pl.rot.period = pr.range(7, 20) * 3600;
      pl.locked = pl.rot.period === P; pl.host = host; pl.Lhost = Lhost; res.push(pl);
    }
    return res;
  };
  const primaryPlanetable = (st) => !(st.spec.kind === 'bh' || st.spec.kind === 'ns' || st.spec.kind === 'pulsar' || st.spec.kind === 'magnetar' || st.spec.kind === 'bd' && false);
  let planetDefs = []; // {pl, parentStar|null (barycentre)}
  const rIn = (st) => Math.max(st.radius * 2.2, 0.02 * AU * Math.sqrt(Math.max(st.spec.L, 0.001))) ;
  if (sys.stars.length === 1) {
    const st = A; const sp = st.spec;
    let count = sp.kind === 'ms' ? (sp.M < 0.6 ? rng.int(0, 6) : sp.M < 2 ? rng.int(2, 9) : rng.int(0, 5)) : sp.kind === 'giant' || sp.kind === 'subgiant' ? rng.int(1, 5) : sp.kind === 'wd' ? rng.int(0, 3) : sp.kind === 'bd' ? rng.int(0, 3) : sp.kind === 'pulsar' ? rng.int(0, 3) : sp.kind === 'rsg' ? rng.int(0, 2) : sp.kind === 'bsg' || sp.kind === 'wr' ? rng.int(0, 1) : sp.kind === 'ns' || sp.kind === 'magnetar' ? (rng() < 0.15 ? 1 : 0) : 0;
    if (sp.kind === 'bh') count = rng() < 0.15 ? rng.int(1, 2) : 0;
    let aMin = Math.max(rIn(st), (sp.M > 8 ? 4 : 0.03) * AU * Math.sqrt(Math.max(sp.L, 0.001)) * 0.4), aMax = (60 + 30 * Math.sqrt(Math.max(sp.L, 0.01) )) * AU;
    if (sp.kind === 'pulsar' || sp.kind === 'ns' || sp.kind === 'magnetar') { aMin = rng.range(0.15, 0.7) * AU; aMax = 3 * AU; }
    if (sp.kind === 'bh') { aMin = rng.range(2, 8) * AU; aMax = 40 * AU; }
    if (sp.kind === 'wd') { aMin = rng.range(0.4, 1.5) * AU; }
    if (['giant', 'subgiant'].includes(sp.kind)) aMin = Math.max(aMin, sp.R * C.RSUN * 2.5);
    if (sp.kind === 'rsg' || sp.kind === 'bsg' || sp.kind === 'wr') aMin = Math.max(aMin, st.radius * 2.0 + 5 * AU);
    for (const pl of planetsFor(st, st.mass, sp.kind === 'ms' || sp.L > 0.0001 ? Math.max(sp.L, 1e-4) : 0.0001, aMin, aMax, count, false)) planetDefs.push({ pl, parent: st });
  } else if (layout === 'accreting' || layout === 'compactbin') {
    if (rng() < 0.2) for (const pl of planetsFor(null, A.mass + B.mass, Math.max(B.spec.L, 1e-3), sep * 4.5, sep * 4.5 * 12, rng.int(1, 2), true)) planetDefs.push({ pl, parent: null });
  } else { // binary / triple
    if (sep < 1.0 * AU) { // circumbinary
      const L = A.spec.L + B.spec.L; const aMin = sep * rng.range(3.6, 5);
      for (const pl of planetsFor(null, A.mass + B.mass, Math.max(L, 1e-3), aMin, Math.max(aMin * 8, 30 * AU * Math.sqrt(Math.max(L, 0.01))), rng.int(0, 6), true)) planetDefs.push({ pl, parent: null });
    } else {
      for (const st of [A, B]) { if (!primaryPlanetable(st)) continue; const aMax = Math.min(sep * 0.28, 40 * AU * Math.sqrt(Math.max(st.spec.L, 0.01))); const aMin = Math.max(rIn(st), 0.04 * AU * Math.sqrt(Math.max(st.spec.L, 0.001))); if (aMax < aMin * 1.5) continue; const cnt = st === A ? rng.int(0, 6) : rng.int(0, 3); for (const pl of planetsFor(st, st.mass, Math.max(st.spec.L, 1e-3), aMin, aMax, cnt, false)) planetDefs.push({ pl, parent: st }); }
    }
  }
  // sort per parent by a and name
  const byParent = new Map();
  for (const d of planetDefs) { const k = d.parent ? d.parent.idx : -1; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(d); }
  const allBodies = [...sys.stars];
  let pIndex = 0;
  const lettersFor = (list) => list.sort((x, y) => x.pl.orbit.a - y.pl.orbit.a);
  for (const [k, list] of byParent) {
    lettersFor(list); const prefix = k < 0 ? sys.name : (sys.stars.length > 1 ? sys.stars[k].name : sys.name);
    list.forEach((d, i) => { d.pl.name = prefix + ' ' + planetLetter(i); d.pl.parent = d.parent; d.pl.sys = sys; d.pl.kind = 'planet'; allBodies.push(d.pl); sys.planets.push(d.pl); });
  }
  // rings
  for (const pl of sys.planets) {
    const pr = makeRng('ring', pl.seed);
    if (pl.cls === 'gas' ? pr() < (pl.biome === 'saturnian' ? 0.85 : pl.biome === 'hotjup' ? 0.02 : 0.28) : pr() < 0.012) {
      const inner = pr.range(1.25, 1.9), outer = inner + pr.range(0.4, 1.5) * (pl.cls === 'gas' ? 1 : 0.5);
      const icy = pl.Teq < 180; pl.ring = { inner, outer, seed: pl.seed % 7919, col1: icy ? [0.85, 0.82, 0.76] : [0.4, 0.34, 0.28], col2: icy ? [0.6, 0.55, 0.5] : [0.25, 0.2, 0.17], opacity: pr.range(0.45, 0.95), gaps: pr.int(1, 5), dust: pr.range(0, 1) };
    }
  }
  // moons
  for (const pl of sys.planets.slice()) {
    const pr = makeRng('moons', pl.seed); const hostM = pl.parent ? pl.parent.mass : sys.stars[0].mass;
    const rH = pl.orbit.a * Math.cbrt(pl.mass / (3 * hostM)) * (1 - pl.orbit.e);
    const lo = pl.radius * (pl.ring ? pl.ring.outer * 1.15 : 2.6), hi = rH * 0.38; if (hi < lo * 1.3) continue;
    const nMajor = pl.cls === 'gas' ? (pl.mass > 0.3 * C.MJUP ? pr.int(0, 5) : pr.int(0, 3)) : pr.weighted([[0, 6], [1, 2.5], [2, 0.5]]);
    const nMinor = pl.cls === 'gas' ? pr.int(0, 5) : pr() < 0.25 ? pr.int(1, 3) : 0;
    let aa = lo * pr.range(1, 1.6); const mlist = [];
    for (let i = 0; i < nMajor && aa < hi; i++) {
      const msd = makeRng('moon', pl.seed, i);
      const Rm = pl.cls === 'gas' ? msd.logu(2.5e5, 2.7e6) : Math.min(pl.radius * 0.35, msd.logu(2e5, 1.8e6)); const Mm = (4 / 3) * Math.PI * Rm ** 3 * msd.range(1500, 3500);
      const hostTeq = pl.Teq; const icy = hostTeq < 170;
      const mo = makeRocky(msd, { seed: seedOf(pl.seed, 'm', i), radius: Rm, mass: Mm, Teq: hostTeq, isMoon: true, icy });
      const P = TAU * Math.sqrt(aa ** 3 / (C.G * (pl.mass + Mm)));
      mo.orbit = { a: aa, e: msd.range(0, 0.06), inc: pl.rot.tilt * 0.3 + msd.range(-0.05, 0.05), node: msd() * TAU, argp: msd() * TAU, M0: msd() * TAU, P };
      mo.rot = { period: P, tilt: 0, phase: 0 }; mo.locked = true; mo.parent = pl; mo.sys = sys; mo.kind = 'moon'; mlist.push(mo); aa *= msd.range(1.55, 2.6);
    }
    for (let i = 0; i < nMinor; i++) {
      const msd = makeRng('minor', pl.seed, i); const aaM = hi * msd.range(0.35, 0.95); if (aaM < lo) continue; const Rm = msd.logu(2e3, 9e4); const Mm = (4 / 3) * Math.PI * Rm ** 3 * msd.range(1500, 2800);
      const mo = makeAsteroid(msd, { seed: seedOf(pl.seed, 'x', i), radius: Rm, mass: Mm, Teq: pl.Teq });
      const P = TAU * Math.sqrt(aaM ** 3 / (C.G * pl.mass)); const retro = msd() < 0.4;
      mo.orbit = { a: aaM, e: msd.range(0.05, 0.4), inc: msd.range(0, retro ? 3.0 : 1.2), node: msd() * TAU, argp: msd() * TAU, M0: msd() * TAU, P };
      mo.rot = { period: msd.range(3, 40) * 3600, tilt: msd() * 3, phase: msd() * TAU }; mo.parent = pl; mo.sys = sys; mo.kind = 'moon'; mlist.push(mo);
    }
    mlist.sort((x, y) => x.orbit.a - y.orbit.a); mlist.forEach((m, i) => { m.name = pl.name + roman(i); allBodies.push(m); pl.moons = mlist; });
  }
  // belts
  const pls = sys.planets.filter((p) => p.parent === sys.stars[0] || !p.parent).sort((x, y) => x.orbit.a - y.orbit.a);
  const belts = []; const br = makeRng('belts', seed);
  const mkBelt = (a0, w, nameSfx, host) => { const L = Math.max(host ? host.spec.L : 1, 1e-3); belts.push({ kind: 'belt', sys, parent: host || null, name: sys.name + ' ' + nameSfx, a0, width: w, seed: seedOf(seed, 'belt', belts.length), mass: br.logu(1e-5, 3e-2) * C.MEARTH, count: 9000, Teq: equilibriumT(L, a0), thick: br.range(0.02, 0.12), orbit: { a: a0, e: 0, inc: incBase, node: nodeBase, argp: 0, M0: 0, P: TAU * Math.sqrt(a0 ** 3 / (C.G * (host ? host.mass : sys.stars[0].mass))) }, icy: equilibriumT(L, a0) < 150 }); };
  if (sys.stars.length === 1 || layout === 'binary') {
    const host = pls.length && pls[0].parent ? pls[0].parent : sys.stars[0];
    if (host && !host.spec.compact || host && host.spec.kind === 'wd') {
      for (let i = 0; i + 1 < pls.length; i++) if (pls[i + 1].orbit.a / pls[i].orbit.a > 2.0 && br() < 0.5 && belts.length < 2) mkBelt(Math.sqrt(pls[i].orbit.a * pls[i + 1].orbit.a), Math.sqrt(pls[i].orbit.a * pls[i + 1].orbit.a) * br.range(0.15, 0.35), 'Belt ' + roman(belts.length), host);
      if (pls.length && br() < 0.55 && belts.length < 3) { const last = pls[pls.length - 1].orbit.a; mkBelt(last * br.range(1.6, 3), last * br.range(0.3, 0.8), 'Outer Belt', host); }
      if (!pls.length && br() < 0.6) mkBelt(AU * Math.sqrt(Math.max(host.spec.L, 0.01)) * br.range(1.5, 5), AU * br.range(0.3, 1.5), 'Debris Disc', host);
    }
  }
  belts.forEach((b, i) => { allBodies.push(b); });
  sys.belts = belts;
  sys.bodies = allBodies; allBodies.forEach((b, i) => { b.id = `${sys.id}/b:${i}`; b.index = i; if (!b.children) b.children = []; });
  for (const b of allBodies) if (b.parent) b.parent.children.push(b);
  // extent
  let ext = 0; for (const b of allBodies) { if (b.orbit) { const pa = b.parent ? b.parent.orbit ? b.parent.orbit.a : 0 : 0; ext = Math.max(ext, (b.orbit.a * (1 + b.orbit.e) + (b.kind === 'moon' ? pa : 0) + (b.kind === 'belt' ? b.width : 0))); } }
  sys.extent = Math.max(ext * 1.3, 2 * AU, sys.stars[0].radius * 20);
  if (sys.stars.length === 3) sys.extent = Math.max(sys.extent, sys.tripleSep * 1.4);
  sys.starKinds = sys.stars.map((s) => s.spec.kind);
  return sys;
}
// position of body relative to system barycentre
const _tmp = [0, 0, 0];
export function bodyPos(b, t) {
  if (b._t === t) return b._p;
  let p;
  if (b.kind === 'belt') p = b.parent ? bodyPos(b.parent, t) : [0, 0, 0];
  else if (!b.orbit) p = [0, 0, 0];
  else {
    const rel = orbitPos(b.orbit, t);
    if (b.parentBary) { const pb = orbitPos(b.parentBary, t); rel[0] += pb[0]; rel[1] += pb[1]; rel[2] += pb[2]; }
    if (b.parent) { const pp = bodyPos(b.parent, t); rel[0] += pp[0]; rel[1] += pp[1]; rel[2] += pp[2]; }
    p = rel;
  }
  b._t = t; b._p = p; return p;
}
