import { Engine } from './render/engine.js';
import { CosmosView } from './render/cosmosview.js';
import { GalaxyView } from './render/galaxyview.js';
import { SystemView } from './render/sysview.js';
import { G } from './render/mat.js';
import { World, lookQuat, qslerp } from './world.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { store } from './store.js';
import { C, v3, qrot, qconj, clamp, smooth, makeRng, fmtDist } from './core.js';
import { UNIVERSE, galaxyOf, systemOf, galaxyEntity, systemEntity, nebulaEntity, clusterEntity, resolve, inChain, posIn } from './entities.js';
import { galaxiesInCell, nearbyClusters, CELL0 } from './gen/cosmos.js';
import { starCell, nearestStar, STAR_CELL, nebulaeNear } from './gen/galaxy.js';
import { bodyPos } from './gen/system.js';
import { colorFor, kindLabel, starCss } from './stats.js';

const $ = (id) => document.getElementById(id);
const S = store.settings;
const QUAL = { low: { scale: 0.6, cloud: 0.35, msaa: false }, balanced: { scale: 0.8, cloud: 0.6, msaa: false }, high: { scale: 1.0, cloud: 1.0, msaa: false }, ultra: { scale: 1.0, cloud: 1.3, msaa: true } };

document.addEventListener('gesturestart', (e) => e.preventDefault());
async function boot() {
  const msg = (m) => { const e = $('ld-msg'); if (e) e.textContent = m; };
  if (!navigator.gpu) { $('loading').classList.add('hidden'); $('nogpu').classList.remove('hidden'); return; }
  const q = QUAL[S.quality] || QUAL.high; const canvas = $('gl');
  const engine = new Engine(canvas, { msaa: q.msaa, scale: q.scale });
  try { await engine.init(); } catch (e) { console.error(e); $('loading').classList.add('hidden'); $('nogpu').classList.remove('hidden'); $('nogpu-detail').textContent = String(e && e.message || e); return; }
  if (!engine.isWebGPU) { $('loading').classList.add('hidden'); $('nogpu').classList.remove('hidden'); $('nogpu-detail').textContent = 'The renderer fell back to a non-WebGPU backend (' + engine.backendName + ').'; return; }
  msg('Building the universe…');
  const world = new World(); const cosmos = new CosmosView(); const galaxyView = new GalaxyView(q.cloud); const sysView = new SystemView();
  const app = { world, engine, cosmos, galaxyView, sysView, input: null, ui: null, lastSystem: null };
  window.__app = app;
  function resize() { const dpr = Math.min(window.devicePixelRatio || 1, 2.5); engine.setSize(window.innerWidth, window.innerHeight, dpr); G.res.value.set(engine.size[0], engine.size[1]); }
  window.addEventListener('resize', resize); resize();

  // ---- helpers ----------------------------------------------------------------------------------------
  const focalCss = () => 0.5 * window.innerHeight / Math.tan(engine.camera.fov * Math.PI / 360);
  app.applySettings = (reload) => {
    engine.setFov(S.fov); app.input.fovRad = S.fov * Math.PI / 180; app.input.sens = S.sens; app.input.invertY = S.invertY; engine.U.bloomK.value = S.bloom ? 0.6 : 0; sysView.showOrbits = S.orbits;
    for (const o of sysView.orbits.values()) o.mesh.visible = S.orbits; $('labels').style.display = S.labels ? '' : 'none'; $('fps').classList.toggle('hidden', !S.showFps);
    engine.U.grain.value = 0; if (reload) { store.saveSession({ snap: world.snapshot() }); location.reload(); }
  };
  app.userMove = () => { if (world.mode === 'orbit' || world.mode === 'travel') world.releaseToFree(); };
  app.toggleMode = () => {
    if (world.mode === 'orbit') { world.releaseToFree(); ui.toast('Free flight'); return; }
    if (world.mode === 'travel') { world.releaseToFree(); return; }
    const e = world.target || sysView.nearestBody || galaxyOf(world.anchor); if (e) app.flyTo(e);
  };
  app.levelHorizon = () => { const f = qrot(world.q, [0, 0, -1]); const up = world.surface ? v3.norm(world.rel) : [0, 1, 0]; world._levelTo = lookQuat(f, up); ui.toast('Horizon levelled'); };
  app.flyTo = (e) => { if (!e) return; if (e.kind === 'universe') return; world.focusOn(e); ui.toast('Travelling to ' + (e.kind === 'system' ? e.sys.name : e.name)); };
  app.where = () => chainNames(world.anchor).join(' › ');
  const chainNames = (a) => { const n = []; let c = a; while (c) { n.push(c === UNIVERSE ? 'Universe' : c.kind === 'system' ? c.sys.name : c.name); c = c.container; } return n.reverse(); };
  app.addFavorite = (e) => {
    const snap = world.snapshot(); const t = e || world.target || world.anchor; const nm = t === UNIVERSE ? 'Deep space' : (t.kind === 'system' ? t.sys.name : t.name);
    store.addFavorite({ name: nm + (world.mode === 'free' ? ' (view)' : ''), where: chainNames(world.anchor).slice(-2).join(' › '), snap }); ui.toast('★ Saved to favourites'); $('a-fav').textContent = '★'; setTimeout(() => ($('a-fav').textContent = '☆'), 1200);
  };
  app.goFavorite = (id) => { const f = store.favorites.find((x) => x.id === id); if (!f) return; if (world.restore(f.snap)) { ui.select(world.target); ui.toast('Teleported to ' + f.name); } };
  app.share = async (e) => { const url = location.origin + location.pathname + store.hashFor(world.snapshot()); try { await navigator.clipboard.writeText(url); ui.toast('Link copied'); } catch { prompt('Copy this link', url); } };
  app.nearby = () => { const out = []; for (const p of gather(true)) out.push({ e: p.e, d: p.dist }); out.sort((a, b) => a.d - b.d); return out.slice(0, 40); };

  // ---- gathering pickable entities (camera-relative metres) ------------------------------------------------------------
  const ctx = { sysActive: false, se: null, ge: null, camG: null, camS: null, camU: null };
  function gather(full) {
    const out = []; const t = world.t; const lim = full ? 1e9 : 1e9;
    if (ctx.sysActive) {
      const sys = ctx.se.sys; for (const b of sys.bodies) { const p = bodyPos(b, t); const rel = [p[0] - ctx.camS[0], p[1] - ctx.camS[1], p[2] - ctx.camS[2]]; out.push({ e: b, rel, rad: b.kind === 'belt' ? b.width * 0.5 : b.radius, dist: v3.len(rel), pri: b.kind === 'star' ? 3 : b.kind === 'planet' ? 2 : 1 }); }
    }
    if (ctx.ge && ctx.camG) {
      const ge = ctx.ge, g = ge.g; const o = g.orient;
      const core = ge.core; out.push({ e: core, rel: [-ctx.camG[0], -ctx.camG[1], -ctx.camG[2]], rad: Math.max(core.radius * 8, 1e12), dist: v3.len(ctx.camG), pri: 2 });
      const camPc = galaxyView.camPc; if (camPc && v3.len(ctx.camG) < g.radius * 1.2) {
        for (const nb of galaxyView.nebList) { const w = qrot(o, [nb.pos[0] * C.PC, nb.pos[1] * C.PC, nb.pos[2] * C.PC]); const rel = [w[0] - ctx.camG[0], w[1] - ctx.camG[1], w[2] - ctx.camG[2]]; out.push({ e: nebulaEntity(ge, nb), rel, rad: nb.radius * C.PC, dist: v3.len(rel), pri: 2 }); }
        const objs = galaxyView.stars.objs; if (objs) {
          const cand = []; for (const s of objs) { const dx = s.pos[0] - camPc[0], dy = s.pos[1] - camPc[1], dz = s.pos[2] - camPc[2]; const d2 = dx * dx + dy * dy + dz * dz; if (d2 < 1e-9) continue; const dAU = Math.sqrt(d2) * 206265; const flux = s.spec.vis / (dAU * dAU) / 2.36e-13; if (flux > (full ? 0.15 : 0.7)) cand.push([flux, s, dx, dy, dz]); }
          cand.sort((a, b) => b[0] - a[0]); for (const c of cand.slice(0, full ? 600 : 40)) { const [fl, s, dx, dy, dz] = c; const w = qrot(o, [dx * C.PC, dy * C.PC, dz * C.PC]); out.push({ e: systemEntity(ge, s), rel: w, rad: s.spec.R * C.RSUN + 1e8, dist: v3.len(w), pri: 1, flux: fl, star: true }); }
        }
      }
    }
    if (!ctx.sysActive) {
      const cu = ctx.camU; if (cosmos.galaxies) for (const g of cosmos.galaxies) { const rel = [g.pos[0] - cu[0], g.pos[1] - cu[1], g.pos[2] - cu[2]]; const d = v3.len(rel); if (d > 0.6e25) continue; if (ctx.ge && g === ctx.ge.g) continue; out.push({ e: galaxyEntity(g), rel, rad: g.radius, dist: d, pri: 1 }); }
      for (const c of nearbyClusters(cu, 120 * C.MPC)) { const rel = [c.pos[0] - cu[0], c.pos[1] - cu[1], c.pos[2] - cu[2]]; out.push({ e: clusterEntity(c), rel, rad: c.sigma * 1.5, dist: v3.len(rel), pri: 1.5 }); }
    }
    return out;
  }
  const _q = [0, 0, 0, 1];
  function project(p, qinv, W, H, f) { const v = qrot(qinv, p.rel); if (v[2] >= -1e-9) return null; const k = f / -v[2]; const x = W / 2 + v[0] * k, y = H / 2 - v[1] * k; const dist = Math.hypot(v[0], v[1], v[2]); return { x, y, rpx: p.rad / dist * f }; }
  function pick(x, y) {
    const W = window.innerWidth, H = window.innerHeight, f = focalCss(); const qi = qconj(world.worldQ()); let best = null, bs = 1e9;
    for (const p of gather(true)) { const pr = project(p, qi, W, H, f); if (!pr) continue; const d = Math.hypot(pr.x - x, pr.y - y); const reach = Math.max(30, Math.min(pr.rpx, 220)); if (d > reach) continue; const score = d - Math.min(pr.rpx, 80) * 0.6 - p.pri * 3; if (score < bs) { bs = score; best = p; } }
    return best ? best.e : null;
  }
  function pickCloud(x, y) {
    const ge = ctx.ge, gv = galaxyView; if (!ge || !gv.cloudData || ctx.sysActive) return null; const g = ge.g; const camPc = gv.camPc; if (!camPc) return null;
    const W = window.innerWidth, H = window.innerHeight, f = focalCss(); const qi = qconj(world.worldQ()); const inv = qconj(g.orient); const pts = gv.cloudData.pts, n = gv.cloudData.n;
    let best = -1, bs = 1e9; const camLoc = camPc;
    for (let i = 0; i < n; i++) { const o = i * 8; const rel = [(pts[o] - camLoc[0]) * C.PC, (pts[o + 1] - camLoc[1]) * C.PC, (pts[o + 2] - camLoc[2]) * C.PC]; const w = qrot(g.orient, rel); const v = qrot(qi, w); if (v[2] >= 0) continue; const k = f / -v[2]; const sx = W / 2 + v[0] * k, sy = H / 2 - v[1] * k; const d = Math.hypot(sx - x, sy - y); if (d < 38) { const sc = d - pts[o + 7] * 2; if (sc < bs) { bs = sc; best = i; } } }
    if (best < 0) return null; const o = best * 8; const p = [pts[o], pts[o + 1], pts[o + 2]]; const s = nearestStar(g, p, 1); return s ? systemEntity(ge, s) : null;
  }
  // ---- input & UI ---------------------------------------------------------------------------------------------------------------
  const input = new Input(canvas, {
    tap: (x, y, dbl) => { const e = pick(x, y) || pickCloud(x, y); if (e) { ui.select(e); if (dbl) app.flyTo(e); } else if (!dbl) ui.select(null); },
    togglePlay: () => { world.playing = !world.playing; ui.updateTime(); }, escape: () => { ui.openInfo(null, false); ui.toggleMenu(false); ui.toggleTree(false); },
    userInput: () => { if (world.mode === 'travel') { world.travel = null; world.releaseToFree(); } },
  });
  app.input = input; const ui = new UI(app); app.ui = ui; app.applySettings();

  // ---- discovery --------------------------------------------------------------------------------------------------------------------
  const rng = makeRng('discover', Date.now() & 0xffff);
  function nearestGalaxy(types) { let best = null, bd = 1e30; const cu = world.camUniverse(); for (const g of cosmos.galaxies || []) { if (types && !types.includes(g.type)) continue; const d = v3.dist(g.pos, cu); if (d < bd) { bd = d; best = g; } } return best; }
  function randomGalaxy(types) { const cu = world.camUniverse(); const out = []; const ix = Math.floor(cu[0] / CELL0), iy = Math.floor(cu[1] / CELL0), iz = Math.floor(cu[2] / CELL0); const R = 7; for (let t = 0; t < 60 && out.length < 3; t++) { const x = ix + rng.int(-R, R), y = iy + rng.int(-R, R), z = iz + rng.int(-R, R); for (const g of galaxiesInCell(x, y, z)) if (!types || types.includes(g.type)) out.push(g); } return out.length ? rng.pick(out) : nearestGalaxy(types); }
  function ensureGalaxy() {
    let ge = galaxyOf(world.anchor); if (ge && v3.len(world.camIn(ge)) < ge.radius * 1.6) return ge;
    const g = nearestGalaxy(['spiral', 'barred', 'ring', 'active']) || randomGalaxy(['spiral', 'barred']); if (!g) return null; ge = galaxyEntity(g); world.jumpTo(ge, ge.radius * 0.8); return ge;
  }
  const QUICK = { bh: (sp) => sp.kind === 'bh', pulsar: (sp) => sp.kind === 'pulsar' || sp.kind === 'magnetar', wd: (sp) => sp.kind === 'wd', giant: (sp) => ['giant', 'rsg', 'bsg', 'wr'].includes(sp.kind) };
  const PRED = {
    terran: (sys) => sys.planets.find((p) => p.hasLife) || sys.planets.find((p) => p.biome === 'terran' || p.biome === 'ocean'), ringed: (sys) => sys.planets.find((p) => p.ring && p.cls === 'gas'), binary: (sys) => sys.stars.length > 1 && sys.planets.length > 1 && sys.stars[0], bh: (sys) => sys.stars.find((s) => s.spec.kind === 'bh'),
    accreting: (sys) => sys.layout === 'accreting' && sys.stars[0], pulsar: (sys) => sys.stars.find((s) => s.spec.kind === 'pulsar' || s.spec.kind === 'magnetar'), wd: (sys) => sys.stars.find((s) => s.spec.kind === 'wd'), giant: (sys) => sys.stars.find((s) => ['giant', 'rsg', 'bsg', 'wr'].includes(s.spec.kind)),
    lava: (sys) => sys.planets.find((p) => p.biome === 'lava'), moons: (sys) => sys.planets.find((p) => p.moons && p.moons.length >= 4 && p.moons.some((m) => m.asteroid)),
  };
  function searchSystem(kind, ge, centerPc) {
    const g = ge.g; const cx = Math.floor(centerPc[0] / STAR_CELL), cy = Math.floor(centerPc[1] / STAR_CELL), cz = Math.floor(centerPc[2] / STAR_CELL); const found = []; let checked = 0;
    const quick = QUICK[kind], pred = PRED[kind];
    for (let r = 0; r <= 7 && found.length < 4; r++) for (let z = -r; z <= r; z++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue;
      for (const s of starCell(g, cx + x, cy + y, cz + z)) {
        if (quick && !quick(s.spec)) { if (kind !== 'bh' && kind !== 'pulsar' && kind !== 'wd' && kind !== 'giant') { } else continue; }
        if (!quick && ++checked > 4000) { r = 99; break; }
        const se = systemEntity(ge, s); const hit = pred ? pred(se.sys) : se.sys.stars[0]; if (hit) { found.push({ se, body: hit }); if (found.length >= 4) break; }
      }
    }
    return found.length ? rng.pick(found) : null;
  }
  app.discover = (kind) => {
    ui.toast('Searching the cosmos…', 1500);
    setTimeout(() => {
      if (kind === 'home') { startView(); return; }
      if (kind === 'galaxy') { const g = randomGalaxy(['spiral', 'barred', 'elliptical', 'ring', 'lenticular', 'irregular', 'active']); if (g) { world.releaseToFree(); world.reanchor(UNIVERSE); world.rel = v3.add(g.pos, [g.radius * 3, g.radius * 1.2, g.radius * 2.6]); world.focusOn(galaxyEntity(g)); } return; }
      const ge = ensureGalaxy(); if (!ge) return ui.toast('No galaxy nearby');
      const g = ge.g; const camD = qrot(qconj(g.orient), world.camIn(ge)); const inside = v3.len(camD) < g.radius * 1.3; const R = g.radius / C.PC;
      if (kind === 'core') { world.focusOn(ge.core); return; }
      if (kind === 'nebula') {
        let cen = inside ? camD.map((x) => x / C.PC) : [R * 0.4, 0, 0]; let nb = null;
        for (let k = 0; k < 8 && !nb; k++) { const list = nebulaeNear(g, cen, 1500).filter((n) => n.nkind !== 'dark'); if (list.length) nb = rng.pick(list); else { const a = rng() * 6.283, r = R * (0.2 + 0.5 * rng()); cen = [Math.cos(a) * r, 0, Math.sin(a) * r]; } }
        if (nb) { const ne = nebulaEntity(ge, nb); world.jumpTo(ge, 1e18); world.focusOn(ne); } else ui.toast('No nebula found, try again'); return;
      }
      let cen = inside ? camD.map((x) => x / C.PC) : [R * 0.42, 0, 0];
      if (kind === 'star') { const s = nearestStar(g, cen, 1) ; const se = s && systemEntity(ge, s); if (se) { world.jumpTo(ge, v3.len(camD) || g.radius); world.reanchor(ge); world.focusOn(se); } return; }
      let hit = null; for (let k = 0; k < 6 && !hit; k++) { hit = searchSystem(kind, ge, cen); if (!hit) { const a = rng() * 6.283, r = R * (0.15 + 0.6 * rng()); cen = [Math.cos(a) * r, 0, Math.sin(a) * r]; } }
      if (!hit) return ui.toast('Nothing matching nearby — try again');
      world.jumpTo(hit.se, hit.se.sys.extent * 2.5); ui.select(hit.body.kind === 'star' || hit.body.kind === 'planet' ? hit.body : hit.se); world.focusOn(hit.body.kind ? hit.body : hit.se); ui.toast(hit.se.sys.name + ' system');
    }, 30);
  };
  function startView() {
    ui.select(null); world.releaseToFree(); world.reanchor(UNIVERSE); world.rate = 1; world.playing = true; ui.syncRateSlider(); ui.updateTime();
    let best = null, bs = 1e30; for (let z = -3; z <= 3; z++) for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) for (const g of galaxiesInCell(x, y, z)) { if (g.type !== 'spiral' && g.type !== 'barred') continue; const sc = Math.hypot(x, y, z) - g.Rkpc * 0.08; if (sc < bs && g.Rkpc > 22) { bs = sc; best = g; } }
    if (!best) best = nearestGalaxy(); const ge = galaxyEntity(best); world.jumpTo(ge, ge.radius * 3.4); ui.select(ge);
  }
  // ---- boot state --------------------------------------------------------------------------------------------------------------------------
  const hashSnap = store.fromHash(location.hash); const sess = store.loadSession();
  let restored = false; if (hashSnap) restored = world.restore(hashSnap); else if (sess && sess.snap) restored = world.restore(sess.snap);
  if (!restored) startView(); else { if (world.target) ui.select(world.target); }
  if (hashSnap) history.replaceState(null, '', location.pathname);
  setInterval(() => store.saveSession({ snap: world.snapshot() }), 2000);
  window.addEventListener('pagehide', () => store.saveSession({ snap: world.snapshot() })); document.addEventListener('visibilitychange', () => { if (document.hidden) store.saveSession({ snap: world.snapshot() }); });

  // ---- frame loop ---------------------------------------------------------------------------------------------------------------------------------
  let last = performance.now(), exposure = 1, fAcc = 0, fN = 0, fpsT = 0, lowT = 0, hiT = 0, labelTick = 0, labelList = [], baseScale = q.scale;
  const lens0 = { dir: [0, 0, -1], D: 1e6, axis: [0, 1, 0], rin: 3, rout: 60, temp: 9000, inten: 5, time: 0, spin: 1 };
  function pickLens() {
    let best = null, bpx = 1.5; const f = engine.size[1] * 0.5 / Math.tan(engine.camera.fov * Math.PI / 360); const t = world.t;
    const consider = (rel, rs, disk, axis, key) => { const D = v3.len(rel); const px = rs * Math.max(disk.rout, 4) / D * f; if (px > bpx) { bpx = px; best = { dir: v3.scale(rel, 1 / D), D: D / rs, axis, rin: disk.rin, rout: disk.rout, temp: disk.temp, inten: disk.inten, time: G.time.value, spin: disk.spin ?? 0.8, key }; } };
    if (ctx.sysActive) {
      const sys = ctx.se.sys; for (const b of sys.stars) if (b.spec.kind === 'bh') { const p = bodyPos(b, t); const rel = [p[0] - ctx.camS[0], p[1] - ctx.camS[1], p[2] - ctx.camS[2]]; const ac = b.accretion; const o = { inc: sys.incBase, node: sys.nodeBase }; const ci = Math.cos(o.inc), si = Math.sin(o.inc), cO = Math.cos(o.node), sO = Math.sin(o.node);
        consider(rel, b.radius, ac ? { rin: 3 - 2.4 * b.spec.flags.spinA, rout: ac.rout / b.radius, temp: ac.temp, inten: (ac.faint ? 0.15 : 1.0) * 6, spin: 0.5 + 0.5 * b.spec.flags.spinA } : { rin: 3, rout: 0.5, temp: 3000, inten: 0 }, [sO * si, ci, cO * si], b.id); }
    }
    if (ctx.ge && ctx.camG) { const core = ctx.ge.core; const ax = qrot(ctx.ge.g.orient, [0, 1, 0]); consider([-ctx.camG[0], -ctx.camG[1], -ctx.camG[2]], core.radius, { rin: core.disk.rin, rout: core.disk.rout, temp: core.disk.temp, inten: core.disk.inten * 4, spin: 0.5 + 0.5 * core.spinA }, ax, core.id); }
    return best;
  }
  const smoothk = (dt, r) => 1 - Math.exp(-dt * r);
  let firstFrame = true; let dGalRglobal = 1e9;
  function frame(now) {
    requestAnimationFrame(frame); if (window.__pause) { last = now; return; } window.__frames = (window.__frames || 0) + 1;
    let dt = (now - last) / 1000; last = now; if (!(dt > 0)) dt = 0.016; dt = Math.min(dt, 0.1);
    const inp = input.frame(dt, world.mode);
    if (world.mode !== 'free' && (Math.hypot(inp.move[0], inp.move[1], inp.move[2]) > 0.12)) world.releaseToFree();
    if (world._levelTo) { world.q = qslerp(world.q, world._levelTo, smoothk(dt, 6)); if (Math.abs(world.q[0] * world._levelTo[0] + world.q[1] * world._levelTo[1] + world.q[2] * world._levelTo[2] + world.q[3] * world._levelTo[3]) > 0.99999) world._levelTo = null; }
    world.cosmosGalaxies = cosmos.galaxies;
    world.step(dt, inp);
    for (const ev of world.events.splice(0)) { if (ev.startsWith('enter:')) { const e = resolve(ev.slice(6)); ui.toast('Entering ' + (e.kind === 'system' ? e.sys.name + ' system' : e.name)); } else if (ev === 'arrived') ui.toast('Arrived'); }
    const t = world.t; const qCam = world.worldQ();
    // ---- context ----
    ctx.camU = world.camUniverse(); let ge = galaxyOf(world.anchor); ctx.camG = null;
    if (!ge) { let bd = 1e30, bg = null; for (const g of cosmos.galaxies || []) { const dx = g.pos[0] - ctx.camU[0], dy = g.pos[1] - ctx.camU[1], dz = g.pos[2] - ctx.camU[2]; const d = Math.hypot(dx, dy, dz) / g.radius; if (d < bd) { bd = d; bg = g; } } if (bg && bd < 22) ge = galaxyEntity(bg); }
    ctx.ge = ge; let dGalR = 1e9;
    if (ge) { ctx.camG = world.camInGalaxy(ge); dGalR = v3.len(ctx.camG) / ge.radius; }
    const se = systemOf(world.anchor); ctx.se = se; ctx.sysActive = false; ctx.camS = null;
    if (se) { const cs = world.camIn(se); if (v3.len(cs) < se.sys.extent * 10) { ctx.sysActive = true; ctx.camS = cs; app.lastSystem = se; } }
    // ---- layers ----
    dGalRglobal = dGalR; const spriteFade = ge ? smooth(2, 8, dGalR) : 1; const cloudFade = ge ? 1 - smooth(3.5, 9, dGalR) : 0;
    cosmos.update({ camU: ctx.camU, focus: ge && dGalR < 22 ? ge.g : null, focusFade: spriteFade });
    const layers = [{ scene: cosmos.scene, near: 1e-3, far: 1e10 }];
    if (ge && (dGalR < 10)) { galaxyView.setGalaxy(ge.g); galaxyView.U.cloudFade.value = cloudFade; galaxyView.update({ camG: ctx.camG }); galaxyView.setHidden(ctx.sysActive ? ctx.se.s : null); layers.push({ scene: galaxyView.scene, near: 1e-9, far: 1e9 }); }
    // system
    const W = engine.size[0], H = engine.size[1]; const focalPx = 0.5 * H / Math.tan(engine.camera.fov * Math.PI / 360); G.focal.value = focalPx; const wallT = (G.time.value = t % 1e5);
    let E = 0, nearM = 1e30;
    if (ctx.sysActive) {
      if (sysView.sys !== se.sys) sysView.setSystem(se.sys);
      { const nb0 = sysView.nearestBody; if (nb0 && nb0.kind !== 'belt') { world.collideWith(nb0, ctx.camS); ctx.camS = world.camIn(se); } }
      sysView.update({ t, cam: ctx.camS, focal: focalPx, screenMin: Math.min(W, H), selected: ui.sel && ui.sel.kind !== 'system' ? ui.sel : null });
      E = sysView.E || 0; nearM = sysView.nearest; const nb = sysView.nearestBody;
      // altitude over terrain & collisions
      if (nb && nb.kind !== 'belt') { const alt = world.collideWith(nb, ctx.camS); nearM = Math.max(alt, 0.2); world.altitude = alt;
        if (S.autoLevel !== false && world.mode !== 'travel') {
          if (!world.surface && nb.cls === 'rocky' && alt < nb.radius * 0.7 && world.mode === 'free') world.attachTo(nb);
          else if (!world.surface && nb.cls === 'rocky' && world.mode === 'orbit' && world.anchor === nb && alt < nb.radius * 0.5) world.attachSurface(nb);
          else if (world.surface && alt > world.surface.radius * 2.2) { world.detachSurface(); }
        }
      }
      layers.push({ scene: sysView.scene, near: clamp(nearM / 1000 * 0.04, 2e-5, 1e5), far: 1e13 });
    } else if (ge && dGalR < 1.3 && ctx.camG) {
      const camPc = galaxyView.camPc; const s = camPc && nearestStar(ge.g, camPc, 1); if (s) nearM = Math.hypot(s.pos[0] - camPc[0], s.pos[1] - camPc[1], s.pos[2] - camPc[2]) * C.PC; else nearM = ge.radius * dGalR * 0.5;
    } else if (ge) nearM = Math.max((dGalR - 1) * ge.radius * 0.8, ge.radius * 0.02); else { let bd = 3e22; for (const g of cosmos.galaxies || []) { const d = Math.hypot(g.pos[0] - ctx.camU[0], g.pos[1] - ctx.camU[1], g.pos[2] - ctx.camU[2]) - g.radius; if (d < bd) bd = d; } nearM = Math.max(bd, 1e20 * 0.3); }
    world.nearestOverride = nearM; world.nearestDist = nearM;
    // ---- exposure ----
    const exT = ctx.sysActive ? clamp(0.9 / (Math.pow(E, 0.85) + 0.004), 0.0005, 600) : 1; exposure *= Math.pow(exT / exposure, smoothk(dt, 2.5)); if (firstFrame) exposure = exT;
    engine.U.exposure.value = exposure; G.invExp.value = 1 / exposure; G.skyGain.value = (ctx.sysActive ? clamp(1 / (1 + 4 * E), 0.12, 1) : 1) / exposure;
    // ---- lens ----
    const lens = pickLens(); if (lens) lens.inten *= G.invExp.value;
    // ---- render ----
    engine.render(layers, qCam, lens);
    // ---- UI ----
    if (S.labels || true) updateLabels(dt, qCam);
    ui.update(dt, { crumbsKey: world.anchor.id + '|' + (ctx.sysActive ? 1 : 0), nearest: nearM < 1e29 ? nearM : 0 });
    // fps / adaptive resolution
    fAcc += dt; fN++; fpsT += dt; if (fpsT > 1) { const fps = fN / fAcc; if (S.showFps) $('fps').textContent = fps.toFixed(0) + ' fps · ' + engine.size[0] + '×' + engine.size[1] + ' · ' + (sysView.sys ? 'sys' : '') + (S.quality); fAcc = 0; fN = 0; fpsT = 0;
      if (S.quality !== 'ultra') { if (fps < 28) { lowT++; hiT = 0; } else if (fps > 52) { hiT++; lowT = 0; } else { lowT = 0; hiT = 0; } if (lowT >= 2 && engine.scale > 0.5) { engine.setScale(Math.max(0.5, engine.scale * 0.88)); G.res.value.set(engine.size[0], engine.size[1]); lowT = 0; } if (hiT >= 6 && engine.scale < baseScale) { engine.setScale(Math.min(baseScale, engine.scale * 1.08)); G.res.value.set(engine.size[0], engine.size[1]); hiT = 0; } } }
    if (firstFrame) { firstFrame = false; setTimeout(() => { $('loading').style.opacity = 0; setTimeout(() => $('loading').classList.add('hidden'), 900); }, 400); }
  }
  // labels --------------------------------------------------------------------------------------------------------------------------------------------------
  function updateLabels(dt, qCam) {
    labelTick++; if (labelTick % 6 === 1) {
      const items = gather(false); const sel = ui.sel; const W = window.innerWidth, H = window.innerHeight, f = focalCss(); const qi = qconj(qCam); const list = [];
      for (const p of items) { const pr = project(p, qi, W, H, f); if (!pr) continue; if (pr.x < -40 || pr.x > W + 40 || pr.y < -20 || pr.y > H + 20) continue; let score = p.pri * 10 + Math.min(pr.rpx, 60); if (p.e === sel) score += 1000; if (p.e.kind === 'moon' && pr.rpx < 3) continue; if (p.e.kind === 'belt') continue; if (p.star && p.flux < 3) continue; if (p.e.kind === 'galaxy' && pr.rpx < 4) continue; if (p.e.kind === 'cluster' && (ctx.ge || dGalRglobal < 30)) continue; list.push({ p, score }); }
      list.sort((a, b) => b.score - a.score); labelList = list.slice(0, 14).map((x) => x.p);
    }
    const W = window.innerWidth, H = window.innerHeight, f = focalCss(); const qi = qconj(qCam); const out = []; const sel = ui.sel;
    const placed = [];
    for (const p of labelList) {
      // recompute relative position each frame for moving bodies
      let rel = p.rel; if (p.e.level === 2 && ctx.sysActive) { const b = p.e; const bp = bodyPos(b, world.t); rel = [bp[0] - ctx.camS[0], bp[1] - ctx.camS[1], bp[2] - ctx.camS[2]]; } 
      const pr = project({ rel, rad: p.rad }, qi, W, H, f); if (!pr || pr.x < -40 || pr.x > W + 40 || pr.y < -20 || pr.y > H + 20) continue;
      if (placed.some((q) => Math.abs(q[0] - pr.x) < 80 && Math.abs(q[1] - pr.y) < 16)) { if (p.e !== sel) continue; }
      placed.push([pr.x, pr.y]); const e = p.e; out.push({ key: e.id, x: pr.x, y: pr.y, text: e.kind === 'system' ? e.sys.name : e.name, sub: '', color: colorFor(e), sel: e === sel });
    }
    ui.setLabels(out);
    // reticle on selection
    if (sel) { let rel = null; if (sel.level === 2 && ctx.sysActive) { const bp = bodyPos(sel, world.t); rel = [bp[0] - ctx.camS[0], bp[1] - ctx.camS[1], bp[2] - ctx.camS[2]]; } else { const f2 = labelList.find((x) => x.e === sel); if (f2) rel = f2.rel; else { const u = ctx.camU; const eu = posIn(sel, UNIVERSE, world.t); rel = [eu[0] - u[0], eu[1] - u[1], eu[2] - u[2]]; if (ctx.ge && inChain(sel, ctx.ge)) { const sg = posIn(sel, ctx.ge, world.t); rel = [sg[0] - ctx.camG[0], sg[1] - ctx.camG[1], sg[2] - ctx.camG[2]]; } } }
      const pr = rel && project({ rel, rad: sel.radius || 1 }, qi, W, H, f); ui.setReticle(pr ? pr.x : 0, pr ? pr.y : 0, !!pr && pr.x > 0 && pr.x < W && pr.y > 0 && pr.y < H && world.mode !== 'travel');
    } else ui.setReticle(0, 0, false);
  }
  requestAnimationFrame(frame);
  try { if (!localStorage.getItem('cosmos.hint.v1')) { localStorage.setItem('cosmos.hint.v1', '1'); setTimeout(() => ui.toast('Drag to look · pinch to zoom · tap an object to select · double-tap to travel', 6000), 2500); } } catch {}
}
boot().catch((e) => { console.error(e); const m = document.getElementById('ld-msg'); if (m) m.textContent = 'Error: ' + (e && e.message || e); });
