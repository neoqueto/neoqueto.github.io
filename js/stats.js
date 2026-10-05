// Per-object statistics for the info panel.
import { C, fmtDist, fmtMass, fmtRadius, fmtSci, fmtTime, TAU } from './core.js';
import { GTYPES, clusterAt } from './gen/cosmos.js';
import { galaxyOf, posIn } from './entities.js';
import { bodyPos } from './gen/system.js';

const f2 = (x, d = 2) => (+x).toFixed(d);
const pct = (x) => (x * 100).toFixed(0) + '%';
const KELV = (T) => Math.round(T).toLocaleString('en-US') + ' K (' + Math.round(T - 273.15).toLocaleString('en-US') + ' °C)';
const NEB_NAMES_X = {}; const NEB_NAMES = { emission: 'Emission nebula (H II region)', reflection: 'Reflection nebula', dark: 'Dark absorption nebula', planetary: 'Planetary nebula', snr: 'Supernova remnant' };
const STAR_COLOR_NAME = (T) => (T > 30000 ? 'blue' : T > 10000 ? 'blue-white' : T > 7500 ? 'white' : T > 6000 ? 'yellow-white' : T > 5200 ? 'yellow' : T > 3700 ? 'orange' : T > 2300 ? 'red' : 'infrared-dim');

export function colorFor(e) {
  switch (e.kind) {
    case 'galaxy': return '#9db8ff'; case 'cluster': return '#b0a0ff'; case 'smbh': return '#ffb060'; case 'nebula': return '#ff7ab0'; case 'system': return starCss(e.spec); case 'star': return starCss(e.spec);
    case 'planet': return e.cls === 'gas' ? '#e8c28a' : e.biome === 'terran' || e.biome === 'ocean' ? '#5fb0ff' : e.biome === 'lava' ? '#ff6a3a' : e.biome === 'ice' ? '#bfe8ff' : '#d8b88c';
    case 'moon': return '#b9c0cc'; case 'belt': return '#a89a88'; default: return '#cccccc';
  }
}
export function starCss(sp) { const c = sp.color || [1, 1, 1]; const g = (v) => Math.round(Math.pow(Math.min(1, v), 1 / 2.2) * 255); return sp.kind === 'bh' ? '#9a7aff' : `rgb(${g(c[0])},${g(c[1])},${g(c[2])})`; }
export function kindLabel(e) {
  switch (e.kind) {
    case 'galaxy': return GTYPES[e.g.type] + ' galaxy'; case 'cluster': return 'Galaxy cluster'; case 'smbh': return 'Supermassive black hole'; case 'nebula': return NEB_NAMES[e.n.nkind];
    case 'system': return e.spec.name + ' · ' + e.spec.spectral; case 'star': return e.spec.name + ' · ' + e.spec.spectral;
    case 'planet': return e.biomeName; case 'moon': return e.asteroid ? 'Irregular moon' : e.biomeName.replace('world', 'moon'); case 'belt': return e.icy ? 'Icy asteroid belt' : 'Asteroid belt'; default: return e.kind;
  }
}
export function statsFor(e, world) {
  const out = []; const sec = (h, rows) => out.push({ h, rows: rows.filter((r) => r && r[1] !== undefined && r[1] !== null) });
  const t = world ? world.t : 0;
  const camDist = () => { if (!world) return null; try { const F = galaxyOf(e) || null; const camU = world.camUniverse(); const eu = posIn(e, null, t); return fmtDist(Math.hypot(camU[0] - eu[0], camU[1] - eu[1], camU[2] - eu[2])); } catch { return null; } };
  switch (e.kind) {
    case 'galaxy': {
      const g = e.g;
      sec('Overview', [['Type', GTYPES[g.type]], ['Diameter', fmtDist(g.radius * 2)], ['Stellar mass', fmtMass(g.mass)], ['Stars (est.)', fmtSci(g.stars * 1, 2)], ['Age', f2(g.age, 1) + ' Gyr'], ['Metallicity', f2(g.met, 2) + ' Z☉']]);
      sec('Structure', [['Spiral arms', g.arms || '—'], g.arms ? ['Pitch angle', f2(g.pitch * 180 / Math.PI, 0) + '°'] : null, ['Bar', g.bar ? 'Yes (' + fmtDist(g.bar * g.radius * 2) + ')' : 'No'], ['Bulge fraction', pct(g.bulge)], ['Disc thickness', fmtDist(g.thick * g.radius * 2)], ['Star formation', f2(g.sfr, 2) + ' M☉/yr'], ['Dust content', pct(g.dust)]]);
      sec('Core', [['Central black hole', fmtMass(Math.pow(10, g.smbhLog) * C.MSUN)], ['Active nucleus', g.agn ? (g.jets ? 'Yes, with relativistic jets' : 'Yes') : 'Quiescent']]);
      sec('Environment', [['Cluster', g.clusterName || 'Field galaxy'], ['Distance from you', camDist()]]); break;
    }
    case 'cluster': {
      const c = e.c; sec('Overview', [['Richness', f2(c.rich, 2)], ['Core radius', fmtDist(c.sigma)], ['Member galaxies (est.)', Math.round(c.rich * 900).toLocaleString('en-US')], ['Mass', fmtMass(c.rich * 3e14 * C.MSUN)], ['Intracluster gas', Math.round(2 + c.rich * 6) + ' million K'], ['Distance from you', camDist()]]); break;
    }
    case 'smbh': {
      sec('Black hole', [['Mass', fmtMass(e.mass)], ['Schwarzschild radius', fmtDist(e.radius)], ['Event-horizon diameter', fmtDist(e.radius * 2)], ['Spin parameter a*', f2(e.spinA, 2)], ['ISCO', fmtDist(e.radius * e.disk.rin)], ['Accretion disc', e.g.agn ? 'Bright (active nucleus)' : 'Faint (quiescent)'], ['Photon sphere', fmtDist(e.radius * 1.5)], ['Host galaxy', e.galaxy.name]]); break;
    }
    case 'nebula': {
      const n = e.n; sec('Nebula', [['Type', NEB_NAMES[n.nkind]], ['Diameter', f2(n.radius * 2, 1) + ' pc'], ['Mass (est.)', fmtMass(Math.pow(n.radius, 2.4) * 60 * C.MSUN)], ['Ionising temperature', n.nkind === 'dark' ? '—' : Math.round(n.temp).toLocaleString('en-US') + ' K'], ['Host galaxy', e.galaxy.name], ['Distance from you', camDist()]]); break;
    }
    case 'system': case 'star': {
      const sys = e.kind === 'system' ? e.sys : e.sys; const st = e.kind === 'system' ? sys.stars[0] : e;
      if (e.kind === 'system') sec('System', [['Layout', { single: 'Single star', binary: 'Binary', triple: 'Hierarchical triple', accreting: 'Accreting binary', compactbin: 'Compact binary' }[sys.layout]], ['Stars', sys.stars.length], ['Planets', sys.planets.length], ['Moons', sys.bodies.filter((b) => b.kind === 'moon').length], ['Asteroid belts', sys.belts.length], ['Outer extent', fmtDist(sys.extent)], ['Distance from you', camDist()]]);
      const s = st; const sp = s.spec;
      sec(e.kind === 'system' ? 'Primary star: ' + s.name : 'Star', [['Class', sp.spectral + ' — ' + sp.name], ['Colour', sp.kind === 'bh' ? 'black' : STAR_COLOR_NAME(sp.T)], ['Mass', fmtMass(s.mass)], [sp.kind === 'bh' ? 'Schwarzschild radius' : 'Radius', fmtRadius(s.radius)], sp.kind !== 'bh' ? ['Surface temperature', Math.round(sp.T).toLocaleString('en-US') + ' K'] : null, sp.kind !== 'bh' ? ['Luminosity', fmtSci(sp.L, 2) + ' L☉'] : null, ['Rotation period', fmtTime(s.rot.period)], ['Age', f2(sp.age, 2) + ' Gyr'], !sp.compact ? ['Surface gravity', f2(C.G * s.mass / (s.radius ** 2) / 9.81, 1) + ' g'] : null, !sp.compact ? ['Starspot coverage', pct(s.spots * 0.2)] : null]);
      if (sp.kind === 'pulsar' || sp.kind === 'magnetar' || sp.kind === 'ns') sec('Compact object', [['Spin period', sp.spin < 0.1 ? f2(sp.spin * 1000, 2) + ' ms' : f2(sp.spin, 3) + ' s'], ['Magnetic field', fmtSci(sp.B * 1e4, 2) + ' G'], ['Density', fmtSci(s.mass / (4 / 3 * Math.PI * s.radius ** 3), 2) + ' kg/m³'], ['Escape velocity', f2(Math.sqrt(2 * C.G * s.mass / s.radius) / C.c * 100, 0) + '% c'], sp.kind === 'pulsar' ? ['Beam', 'Lighthouse, ' + f2(1 / Math.max(sp.spin, 1e-3), 1) + ' pulses/s'] : null]);
      if (sp.kind === 'bh') sec('Black hole', [['Event-horizon radius', fmtDist(s.radius)], ['Spin a*', f2(sp.flags.spinA, 2)], ['Photon sphere', fmtDist(s.radius * 1.5)], ['ISCO', fmtDist(s.radius * (3 - 2.4 * sp.flags.spinA))], ['Accretion disc', s.accretion ? (s.accretion.faint ? 'Faint, cold' : 'Active, hot') : 'None']]);
      if (sp.kind === 'wd') sec('White dwarf', [['Density', fmtSci(s.mass / (4 / 3 * Math.PI * s.radius ** 3), 2) + ' kg/m³'], ['Cooling age', f2(sp.age, 1) + ' Gyr']]);
      if (sys.stars.length > 1) { const others = sys.stars.filter((x) => x !== s); sec('Multiple system', [['Companions', others.map((o) => o.name + ' (' + o.spec.spectral + ')').join(', ')], ['Separation', fmtDist(sys.binarySep)], ['Orbital period', fmtTime(sys.binaryP)], sys.tripleSep ? ['Outer separation', fmtDist(sys.tripleSep)] : null]); }
      if (sp.L > 0.0001 && !sp.compact) { const hz = Math.sqrt(sp.L); sec('Habitable zone', [['Inner edge', f2(hz * 0.95, 2) + ' AU'], ['Outer edge', f2(hz * 1.7, 2) + ' AU'], ['Frost line', f2(hz * 2.7, 2) + ' AU']]); }
      break;
    }
    case 'planet': case 'moon': {
      const b = e; const o = b.orbit; const P = b.parent;
      sec('Overview', [['Type', b.biomeName], ['Radius', fmtRadius(b.radius)], ['Mass', fmtMass(b.mass)], ['Surface gravity', f2(b.gravity / 9.81, 2) + ' g'], ['Density', Math.round(b.density).toLocaleString('en-US') + ' kg/m³'], ['Escape velocity', f2(Math.sqrt(2 * C.G * b.mass / b.radius) / 1000, 2) + ' km/s'], ['Orbits', P ? P.name : 'barycentre']]);
      sec('Orbit', [['Semi-major axis', fmtDist(o.a)], ['Eccentricity', f2(o.e, 3)], ['Inclination', f2((o.inc - (b.sys.incBase || 0)) * 180 / Math.PI, 1) + '°'], ['Orbital period', fmtTime(o.P)], ['Current distance', world ? fmtDist(Math.hypot(...bodyPos(b, t).map((x, i) => x - (P ? bodyPos(P, t)[i] : 0)))) : null]]);
      sec('Rotation', [['Day length', fmtTime(b.rot.period) + (b.locked ? ' (tidally locked)' : '')], ['Axial tilt', f2(b.rot.tilt * 180 / Math.PI, 1) + '°']]);
      const hot = b.Tsurf || b.Teq;
      sec('Climate & atmosphere', [['Equilibrium temperature', KELV(b.Teq)], ['Surface temperature', KELV(hot)], ['Atmosphere', b.atmName], b.pressure > 0.0005 && b.cls !== 'gas' ? ['Surface pressure', f2(b.pressure, b.pressure < 1 ? 3 : 1) + ' bar'] : null, b.visual && b.visual.clouds && b.visual.clouds.cover > 0.05 ? ['Cloud cover', pct(b.visual.clouds.cover)] : null, b.visual && b.visual.ocean && b.visual.type !== 'tholin' ? ['Liquid water', 'Surface oceans'] : null, b.hasLife ? ['Biosphere', 'Vegetation detected'] : null]);
      const rows = []; if (b.visual && b.visual.T && b.cls === 'rocky') { const T = b.visual.T; rows.push(['Relief (max)', fmtDist((T.contAmp || 0) * 0.6 + (T.mountAmp || 0) + (T.craterAmp || 0) * 0.5)]); if (T.irregular) rows.push(['Shape', 'Irregular (' + b.visual.T.axes.map((x) => x.toFixed(2)).join(' × ') + ')']); }
      if (b.cls === 'gas') { rows.push(['Composition', 'H₂ / He envelope']); rows.push(['Metallic-hydrogen ocean at', fmtRadius(b.radius * b.coreFrac) + ' radius']); rows.push(['Dive depth to ocean', fmtDist(b.radius * (1 - b.coreFrac))]); rows.push(['Cloud bands', b.visual.bands]); rows.push(['Storm systems', (b.visual.storm ? 1 : 0) + b.visual.vortices]); }
      if (b.ring) { rows.push(['Ring system', f2(b.ring.inner, 2) + '–' + f2(b.ring.outer, 2) + ' R (' + fmtDist(b.ring.outer * b.radius) + ')']); rows.push(['Ring gaps', b.ring.gaps]); }
      if (b.moons) rows.push(['Moons', b.moons.length]);
      sec('Features', rows);
      break;
    }
    case 'belt': sec('Belt', [['Orbital radius', fmtDist(e.a0)], ['Width', fmtDist(e.width)], ['Total mass', fmtMass(e.mass)], ['Composition', e.icy ? 'Ice & carbonaceous rock' : 'Silicate & metal'], ['Equilibrium temperature', KELV(e.Teq)], ['Orbital period', fmtTime(e.orbit.P)], ['Resolved bodies (est.)', fmtSci(e.mass / (C.MEARTH * 1e-10), 1)]]); break;
  }
  return out;
}
