import { C, fmtDist, fmtTime, fmtSci } from './core.js';
import { statsFor, colorFor, kindLabel } from './stats.js';
import { UNIVERSE, chainOf, galaxyOf, systemOf, resolve } from './entities.js';
import { store, DEFAULT_SETTINGS } from './store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtSpeed(v) {
  if (v < 1) return (v * 100).toFixed(0) + ' cm/s'; if (v < 1000) return v.toFixed(1) + ' m/s'; if (v < 3e6) return (v / 1000).toFixed(v < 1e4 ? 1 : 0) + ' km/s';
  if (v < C.c * 0.9) return (v / C.c).toFixed(3) + ' c'; if (v < C.c * 3e6) return (v / C.c).toFixed(v < C.c * 10 ? 1 : 0) + ' c';
  const ly = 9.4607e15; if (v < ly * 3e3) return (v / ly).toFixed(2) + ' ly/s'; return (v / C.PC).toFixed(v < C.PC * 100 ? 1 : 0) + ' pc/s'.replace('pc/s', v < C.KPC ? 'pc/s' : 'kpc/s');
}
export function rateLabel(r) {
  const a = Math.abs(r), s = r < 0 ? '−' : '';
  if (a < 1.5) return s + '1×'; if (a < 3600) return s + Math.round(a) + '×'; if (a < 86400 * 0.9) return s + (a / 3600).toFixed(1) + ' h/s'; if (a < 86400 * 30) return s + (a / 86400).toFixed(1) + ' d/s'; if (a < C.YEAR) return s + (a / (86400 * 30)).toFixed(1) + ' mo/s'; if (a < C.YEAR * 1e3) return s + (a / C.YEAR).toFixed(1) + ' yr/s'; return s + fmtSci(a / C.YEAR, 1) + ' yr/s';
}
export class UI {
  constructor(app) {
    this.app = app; this.world = app.world; this.sel = null; this.labelEls = new Map(); this.infoOpen = false; this.treeOpen = false; this.menuOpen = false; this.infoT = 0;
    this.bind(); this.renderMenu('discover');
  }
  bind() {
    const A = this.app, W = this.world;
    $('btn-menu').onclick = () => this.toggleMenu(); $('menu-x').onclick = () => this.toggleMenu(false);
    $('chip-go').onclick = () => A.flyTo(this.sel); $('chip-info').onclick = () => this.openInfo(this.sel); $('chip-x').onclick = () => this.select(null);
    $('info-x').onclick = () => this.openInfo(null, false); $('i-go').onclick = () => { A.flyTo(this.sel); this.openInfo(null, false); }; $('i-fav').onclick = () => A.addFavorite(this.sel); $('i-tree').onclick = () => this.toggleTree(true); $('i-copy').onclick = () => A.share(this.sel);
    $('a-fav').onclick = () => A.addFavorite(null); $('a-tree').onclick = () => this.toggleTree(); $('a-info').onclick = () => this.openInfo(this.sel || W.anchor, !this.infoOpen);
    $('a-mode').onclick = () => A.toggleMode(); $('a-level').onclick = () => A.levelHorizon();
    const boost = $('a-boost'); const setBoost = (v) => { A.input.boost = v; boost.classList.toggle('on', v); };
    boost.onpointerdown = (e) => { e.preventDefault(); setBoost(!A.input.boost); };
    $('tree-x').onclick = () => this.toggleTree(false);
    document.querySelectorAll('#tree-tabs button').forEach((b) => (b.onclick = () => { document.querySelectorAll('#tree-tabs button').forEach((x) => x.classList.toggle('on', x === b)); this.treeTab = b.dataset.t; this.renderTree(); }));
    document.querySelectorAll('#menu .tabs button').forEach((b) => (b.onclick = () => this.renderMenu(b.dataset.tab)));
    // time
    $('t-play').onclick = () => { W.playing = !W.playing; this.updateTime(); };
    $('t-rev').onclick = () => { W.rate = -W.rate || -1; W.playing = true; this.syncRateSlider(); this.updateTime(); };
    $('t-now').onclick = () => { W.rate = 1; W.playing = true; this.syncRateSlider(); this.updateTime(); };
    $('t-rate').oninput = (e) => { const v = +e.target.value; const sgn = Math.sign(v); const a = Math.abs(v); W.rate = sgn === 0 ? 1 : sgn * Math.pow(10, a / 100 * 9.2); if (a < 3) W.rate = Math.sign(v || 1); W.playing = true; this.updateTime(); };
    // joystick
    const st = $('stick'), knob = $('knob'); let sid = null; const R = 64;
    const setStick = (e) => { const r = st.getBoundingClientRect(); let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2); const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } A.input.stick = [Math.abs(x) < 0.08 ? 0 : x, Math.abs(y) < 0.08 ? 0 : y]; knob.style.transform = `translate(${x * 38}px,${y * 38}px)`; };
    st.onpointerdown = (e) => { sid = e.pointerId; st.setPointerCapture(e.pointerId); setStick(e); A.userMove(); };
    st.onpointermove = (e) => { if (e.pointerId === sid) { setStick(e); A.userMove(); } };
    const end = (e) => { if (e.pointerId === sid) { sid = null; A.input.stick = [0, 0]; knob.style.transform = ''; } }; st.onpointerup = end; st.onpointercancel = end;
    const vb = (id, v) => { const b = $(id); b.onpointerdown = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); A.input.vert = v; A.userMove(); }; b.onpointerup = b.onpointercancel = () => (A.input.vert = 0); };
    vb('b-up', 1); vb('b-down', -1);
    this.syncRateSlider(); this.updateTime();
  }
  toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), ms); }
  // ---- selection chip --------------------------------------------------------------------------------------------
  select(e) {
    this.sel = e; this.world.target = e; const chip = $('chip');
    if (!e) { chip.classList.add('hidden'); if (this.infoOpen) this.openInfo(null, false); return; }
    chip.classList.remove('hidden'); $('chip-dot').style.color = colorFor(e); $('chip-name').textContent = this.nameOf(e); $('chip-kind').textContent = kindLabel(e);
    if (this.infoOpen) this.openInfo(e, true); if (this.treeOpen) this.renderTree();
  }
  nameOf(e) { return e.kind === 'system' ? e.sys.name : e.name; }
  // ---- info sheet -------------------------------------------------------------------------------------------------
  openInfo(e, open = true) {
    const sh = $('info'); this.infoOpen = open && !!e; sh.classList.toggle('hidden', !this.infoOpen); if (!this.infoOpen) return;
    if (e.kind === 'universe') { $('info-title').textContent = 'Observable Universe'; $('info-kind').textContent = 'Procedural, unbounded'; $('info-body').innerHTML = '<div class="sec"><h4>About</h4><p class="dim">An infinite, deterministic universe: galaxy clusters and cosmic web, galaxies of every morphology, nebulae, stars of all types, and fully procedural planets. Every location is reproducible from its coordinates.</p></div>'; $('info-dot').style.color = '#9db8ff'; return; }
    this.infoEnt = e; $('info-title').textContent = this.nameOf(e); $('info-kind').textContent = kindLabel(e); $('info-dot').style.color = colorFor(e); this.renderStats(e);
  }
  renderStats(e) { const secs = statsFor(e, this.world); $('info-body').innerHTML = secs.filter((s) => s.rows.length).map((s) => `<div class="sec"><h4>${esc(s.h)}</h4>${s.rows.map((r) => `<div class="row"><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('')}</div>`).join(''); }
  // ---- tree explorer ------------------------------------------------------------------------------------------------------
  toggleTree(open = !this.treeOpen) { this.treeOpen = open; $('tree').classList.toggle('hidden', !open); if (open) { this.treeTab = this.treeTab || 'system'; this.renderTree(); } }
  renderTree() {
    const body = $('tree-body'); const W = this.world;
    const sysE = (this.sel && (this.sel.kind === 'system' ? this.sel : systemOf(this.sel))) || systemOf(W.anchor) || this.app.lastSystem;
    const tab = this.treeTab || 'system'; document.querySelectorAll('#tree-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === tab));
    if (tab === 'nearby') { $('tree-title').textContent = 'Nearby objects'; body.innerHTML = this.app.nearby().map((n, i) => `<div class="node" data-i="${i}"><span class="dot" style="color:${colorFor(n.e)}"></span><span class="nm">${esc(this.nameOf(n.e))}<div class="sm">${esc(kindLabel(n.e))} · ${fmtDist(n.d)}</div></span><button class="pill go">Go</button></div>`).join('') || '<p class="dim">Nothing in range.</p>'; const list = this.app.nearby(); body.querySelectorAll('.node').forEach((nd) => { const n = list[+nd.dataset.i]; nd.onclick = (ev) => { if (ev.target.classList.contains('go')) { this.app.flyTo(n.e); this.toggleTree(false); } else { this.select(n.e); } }; }); return; }
    if (!sysE) { $('tree-title').textContent = 'Star-system explorer'; body.innerHTML = '<p class="dim" style="padding:8px">Select a star (tap one in the sky) or fly into a system to explore its stars, planets and moons here.</p>'; return; }
    const sys = sysE.sys; $('tree-title').textContent = sys.name + ' system';
    const kids = (b) => sys.bodies.filter((x) => x.parent === b);
    const node = (b, depth) => {
      const ch = kids(b); const isSel = this.sel === b; const open = this.treeOpenSet?.has(b.id) ?? (b.kind === 'star' || depth < 1);
      const sub = b.kind === 'star' ? b.spec.spectral : b.kind === 'belt' ? 'belt' : b.biomeName || b.kind;
      let h = `<div class="node ${isSel ? 'sel' : ''}" data-id="${b.id}"><span class="tg">${ch.length ? (open ? '▾' : '▸') : ''}</span><span class="dot" style="color:${colorFor(b)}"></span><span class="nm">${esc(b.name)}<div class="sm">${esc(sub)}</div></span><button class="pill go">Go</button></div>`;
      if (ch.length && open) h += '<div class="kids">' + ch.map((c) => node(c, depth + 1)).join('') + '</div>'; return h;
    };
    const roots = sys.bodies.filter((b) => !b.parent && b.kind !== 'belt'); const belts = sys.bodies.filter((b) => b.kind === 'belt' && !b.parent);
    // stars that host planets: show planets under stars; circumbinary planets under a "barycentre" node
    let html = `<div class="node" data-sys="1"><span class="tg"></span><span class="dot" style="color:${colorFor(sysE)}"></span><span class="nm"><b>${esc(sys.name)}</b><div class="sm">${sys.stars.length} star${sys.stars.length > 1 ? 's' : ''} · ${sys.planets.length} planets · ${sys.bodies.filter((b) => b.kind === 'moon').length} moons</div></span></div><div class="kids">`;
    html += roots.filter((b) => b.kind === 'star').map((b) => node(b, 0)).join(''); html += roots.filter((b) => b.kind !== 'star').map((b) => node(b, 0)).join(''); html += belts.map((b) => node(b, 0)).join(''); html += '</div>';
    body.innerHTML = html;
    body.querySelectorAll('.node[data-id]').forEach((nd) => { const b = sys.bodies.find((x) => x.id === nd.dataset.id); nd.onclick = (ev) => { if (ev.target.classList.contains('go')) { this.select(b); this.app.flyTo(b); this.toggleTree(false); return; } if (ev.target.classList.contains('tg') && kids(b).length) { this.treeOpenSet = this.treeOpenSet || new Set(); if (this.treeOpenSet.has(b.id)) this.treeOpenSet.delete(b.id); else this.treeOpenSet.add(b.id); this.renderTree(); return; } this.select(b); }; });
    const sn = body.querySelector('.node[data-sys]'); if (sn) sn.onclick = () => this.select(sysE);
  }
  // ---- menu -------------------------------------------------------------------------------------------------------------------
  toggleMenu(open = !this.menuOpen) { this.menuOpen = open; $('menu').classList.toggle('hidden', !open); if (open) this.renderMenu(this.menuTab || 'discover'); }
  renderMenu(tab) {
    this.menuTab = tab; document.querySelectorAll('#menu .tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab)); const body = $('menu-body'); const A = this.app;
    if (tab === 'discover') {
      const items = [['galaxy', 'Random galaxy', 'Spirals, ellipticals, rings…'], ['star', 'Nearest star', 'Fly to a local system'], ['terran', 'Living world', 'Oceans, ice caps, life'], ['ringed', 'Ringed giant', 'Planet with ring system'], ['binary', 'Binary / triple stars', 'Barycentric orbits'], ['bh', 'Stellar black hole', 'Lensing & accretion'], ['accreting', 'Black hole + star', 'Stream into the disc'], ['pulsar', 'Pulsar / magnetar', 'Lighthouse beams'], ['wd', 'White dwarf', 'Stellar remnant'], ['giant', 'Giant star', 'Convective red giant'], ['nebula', 'Nebula', 'Volumetric gas clouds'], ['core', 'Galactic core', 'Supermassive black hole'], ['lava', 'Lava world', 'Magma oceans'], ['moons', 'Moon-rich giant', 'Many moons, tiny asteroids'], ['home', 'Reset view', 'Cosmic web overview']];
      body.innerHTML = '<div class="grid2">' + items.map((i) => `<button data-k="${i[0]}">${i[1]}<small>${i[2]}</small></button>`).join('') + '</div>';
      body.querySelectorAll('button').forEach((b) => (b.onclick = () => { this.toggleMenu(false); A.discover(b.dataset.k); }));
    } else if (tab === 'favs') {
      const f = store.favorites; body.innerHTML = `<div style="padding:4px 0 8px"><button class="pill accent" id="fav-add">☆ Save current location</button></div>` + (f.length ? f.map((x) => `<div class="card" data-id="${x.id}"><div class="t"><b>${esc(x.name)}</b><small>${esc(x.where || '')} · ${new Date(x.created).toLocaleDateString()}</small></div><button class="pill accent go">Go</button><button class="round small ren" aria-label="Rename">✎</button><button class="round small del" aria-label="Delete">🗑</button></div>`).join('') : '<p class="dim">No favourites yet. Locations are saved automatically in your browser the moment you add them.</p>');
      $('fav-add').onclick = () => { A.addFavorite(null); this.renderMenu('favs'); };
      body.querySelectorAll('.card').forEach((c) => { const id = c.dataset.id; c.querySelector('.go').onclick = () => { this.toggleMenu(false); A.goFavorite(id); }; c.querySelector('.del').onclick = () => { store.removeFavorite(id); this.renderMenu('favs'); }; c.querySelector('.ren').onclick = () => { const nm = prompt('Rename favourite', store.favorites.find((x) => x.id === id).name); if (nm) { store.renameFavorite(id, nm); this.renderMenu('favs'); } }; });
    } else if (tab === 'settings') {
      const s = store.settings; const sw = (k, label) => `<div class="set"><label>${label}</label><div class="switch ${s[k] ? 'on' : ''}" data-sw="${k}"></div></div>`;
      body.innerHTML = `<div class="set"><label>Render quality</label><select id="s-q"><option value="low">Low (battery)</option><option value="balanced">Balanced</option><option value="high">High</option><option value="ultra">Ultra (MSAA)</option></select></div>
      ${sw('bloom', 'Bloom & glare')}${sw('orbits', 'Orbit lines')}${sw('labels', 'Object labels')}${sw('volumetrics', 'Volumetric nebulae')}${sw('autoLevel', 'Auto-level horizon near planets')}${sw('showFps', 'Show FPS')}
      <div class="set"><label>Field of view <span class="dim" id="s-fov-v">${s.fov}°</span></label><input type="range" id="s-fov" min="40" max="100" value="${s.fov}"></div>
      <div class="set"><label>Look sensitivity</label><input type="range" id="s-sens" min="0.4" max="2.5" step="0.1" value="${s.sens}"></div>
      <div class="set"><label>Throttle <span class="dim">(flight speed ×)</span></label><input type="range" id="s-thr" min="-1" max="1.5" step="0.1" value="${Math.log10(this.world.speedMul)}"></div>
      <div style="padding:12px 0;display:flex;gap:8px;flex-wrap:wrap"><button class="pill" id="s-reset">Reset settings</button><button class="pill" id="s-clear">Clear saved session</button></div>`;
      $('s-q').value = s.quality;
      $('s-q').onchange = (e) => { s.quality = e.target.value; store.saveSettings(); A.applySettings(true); };
      body.querySelectorAll('.switch').forEach((el) => (el.onclick = () => { s[el.dataset.sw] = !s[el.dataset.sw]; el.classList.toggle('on', s[el.dataset.sw]); store.saveSettings(); A.applySettings(); }));
      $('s-fov').oninput = (e) => { s.fov = +e.target.value; $('s-fov-v').textContent = s.fov + '°'; store.saveSettings(); A.applySettings(); };
      $('s-sens').oninput = (e) => { s.sens = +e.target.value; store.saveSettings(); A.applySettings(); };
      $('s-thr').oninput = (e) => { this.world.speedMul = Math.pow(10, +e.target.value); };
      $('s-reset').onclick = () => { Object.assign(store.settings, DEFAULT_SETTINGS); store.saveSettings(); A.applySettings(true); this.renderMenu('settings'); };
      $('s-clear').onclick = () => { store.clearSession(); this.toast('Saved session cleared'); };
    } else {
      body.innerHTML = `<div class="help"><p><b>Look / orbit</b> — drag with one finger. In orbit mode you circle the selected object; in free flight you turn the camera.</p><p><b>Zoom / dolly</b> — pinch (or mouse wheel). Speed scales automatically with your distance to the nearest surface, so you can cross a galaxy cluster or skim a mountain range with the same gesture.</p><p><b>Roll</b> — twist two fingers.</p><p><b>Fly</b> — use the joystick (forward/back, strafe), ▲▼ to rise or sink, ⚡ for boost. Pushing the stick leaves orbit mode.</p><p><b>Select</b> — tap any galaxy, star, planet or nebula. <b>Double-tap</b> or press “Fly to” to travel there. Travel is seamless: galaxy → star → planet surface.</p><p><b>Explorer</b> — ⌥ opens the system tree (stars, planets, moons, belts). <b>Info</b> — ⓘ shows live stats.</p><p><b>Favourites</b> — ☆ saves your exact position and orientation. Everything autosaves; the app also resumes where you left off. “Share” copies a link to a location.</p><p><b>Time</b> — bottom bar: pause, reverse, and speed from real time to years per second. Orbits and rotations are deterministic Kepler motion.</p><p class="dim">Desktop: drag to look, wheel to dolly, <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly, <kbd>R</kbd>/<kbd>F</kbd> up/down, <kbd>Q</kbd>/<kbd>E</kbd> roll, <kbd>Shift</kbd> boost, <kbd>Space</kbd> pause.</p></div>`;
    }
  }
  // ---- per-frame ------------------------------------------------------------------------------------------------------------------
  syncRateSlider() { const r = this.world.rate; const a = Math.abs(r); $('t-rate').value = a < 1.5 ? 0 : Math.sign(r) * Math.round(Math.log10(a) / 9.2 * 100); }
  updateTime() { const W = this.world; $('t-play').textContent = W.playing ? '❚❚' : '▶'; $('t-rate-l').textContent = W.playing ? rateLabel(W.rate) : 'paused'; }
  update(dt, info) {
    const W = this.world;
    // breadcrumbs
    if (info.crumbsKey !== this._ck) {
      this._ck = info.crumbsKey; const chain = chainOf(W.anchor).reverse(); let parts = chain.map((e) => (e === UNIVERSE ? 'Universe' : e.kind === 'system' ? e.sys.name : e.name)); if (parts.length > 3) parts = ['…', ...parts.slice(-2)];
      $('crumbs').innerHTML = parts.map((p, i) => (i === parts.length - 1 ? `<b>${esc(p)}</b>` : `<span>${esc(p)}</span><i>›</i>`)).join('');
    }
    if (((this._sT = (this._sT || 0) + dt) > 0.1)) { this._sT = 0;
    $('speed').textContent = (W.mode === 'travel' ? '⇢ ' : '') + fmtSpeed(W.speed || 0) + (info.nearest ? ' · ' + fmtDist(info.nearest) + (W.altitude < 1e30 && W.surface ? ' alt' : '') : ''); }
    const mb = $('a-mode'); mb.textContent = W.mode === 'orbit' ? '◎' : W.mode === 'travel' ? '⇢' : '✈'; mb.classList.toggle('on', W.mode === 'orbit');
    // date
    if ((this.infoT += dt) > 0.25) {
      this.infoT = 0; const t = W.t; const yr = Math.floor(t / C.YEAR), d = Math.floor((t % C.YEAR) / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60);
      $('t-date').textContent = `Y${yr} · D${d} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; this.updateTime();
      if (this.infoOpen && this.infoEnt && this.sel) this.renderStats(this.infoEnt);
    }
    const fav = $('a-fav'); fav.textContent = '☆';
  }
  // labels: items {e,x,y,text,sub,sel}
  setLabels(items) {
    const root = $('labels'); const seen = new Set();
    for (const it of items) {
      let el = this.labelEls.get(it.key); if (!el) { el = document.createElement('div'); el.className = 'lbl'; el.innerHTML = `<span></span><small></small>`; root.appendChild(el); this.labelEls.set(it.key, el); el._t = ''; }
      seen.add(it.key); const txt = it.text; if (el._t !== txt) { el.children[0].textContent = txt; el.children[1].textContent = it.sub || ''; el._t = txt; }
      el.style.transform = `translate(${(it.x + 10).toFixed(1)}px,${(it.y - 8).toFixed(1)}px)`; el.style.color = it.color; el.classList.toggle('sel', !!it.sel);
    }
    for (const [k, el] of this.labelEls) if (!seen.has(k)) { el.remove(); this.labelEls.delete(k); }
  }
  setReticle(x, y, show) { const r = $('reticle'); r.classList.toggle('hidden', !show); if (show) r.style.transform = `translate(${x}px,${y}px)`; }
}
