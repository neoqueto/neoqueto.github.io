// Persistence: favourites (autosaved on every change), session autosave, settings, shareable location hash.
const K_FAV = 'cosmos.favorites.v1', K_SES = 'cosmos.session.v1', K_SET = 'cosmos.settings.v1';
function read(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
export const DEFAULT_SETTINGS = { quality: 'high', bloom: true, orbits: true, labels: true, fov: 65, sens: 1, invertY: false, autoLevel: true, showFps: false, grain: false, volumetrics: true };
export const store = {
  favorites: read(K_FAV, []),
  settings: { ...DEFAULT_SETTINGS, ...read(K_SET, {}) },
  saveFavorites() { write(K_FAV, this.favorites); },
  addFavorite(f) { f.id = f.id || 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); f.created = f.created || Date.now(); this.favorites.unshift(f); this.saveFavorites(); return f; },
  removeFavorite(id) { this.favorites = this.favorites.filter((f) => f.id !== id); this.saveFavorites(); },
  renameFavorite(id, name) { const f = this.favorites.find((x) => x.id === id); if (f) { f.name = name; this.saveFavorites(); } },
  saveSettings() { write(K_SET, this.settings); },
  saveSession(s) { write(K_SES, s); },
  loadSession() { return read(K_SES, null); },
  clearSession() { try { localStorage.removeItem(K_SES); } catch {} },
  hashFor(snap) { try { return '#loc=' + btoa(unescape(encodeURIComponent(JSON.stringify(snap)))).replace(/=+$/, ''); } catch { return ''; } },
  fromHash(h) { try { const m = (h || '').match(/loc=([A-Za-z0-9+/_-]+)/); if (!m) return null; return JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch { return null; } },
};
