import { makeRng } from './core.js';
const A = ['ka','ve','lo','ar','ni','zu','ta','el','or','si','mar','dan','rho','xi','pel','tor','ae','ul','ven','kor','sa','nu','ith','ys','bel','cas','dra','fen','gal','hy','il','jor','kel','lyr','mer','nox','os','pra','qua','rin','sol','tau','umb','vor','wyn','xan','yor','zeph'];
const E = ['a','is','on','us','ia','ar','ix','ea','um','or','ae','as','en','ul','ius','ora','ax','yn','el','ion'];
const GREEK = ['α','β','γ','δ','ε','ζ','η','θ','ι','κ','λ','μ','ν','ξ','ο','π','ρ','σ','τ','υ','φ','χ','ψ','ω'];
const CATS = ['HD','HIP','GJ','KOI','TOI','WR','PSR','SN','NGC','IC','UGC','M'];
const up = (s) => s[0].toUpperCase() + s.slice(1);
export function properName(rng) {
  const n = rng() < 0.6 ? 2 : rng() < 0.7 ? 3 : 1; let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(A);
  s += rng.pick(E);
  return up(s);
}
export function catalogName(rng, prefix) {
  const p = prefix || rng.pick(CATS);
  const n = rng.int(10, 99999);
  return p + ' ' + n;
}
export function greek(rng) { return rng.pick(GREEK); }
export function galaxyName(rng, type) {
  const r = rng();
  if (r < 0.45) return 'NGC ' + rng.int(100, 7999);
  if (r < 0.7) return 'UGC ' + rng.int(100, 12999);
  if (r < 0.85) return properName(rng) + ' Galaxy';
  return 'IC ' + rng.int(10, 5999);
}
export function nebulaName(rng, kind) {
  const base = rng() < 0.6 ? properName(rng) : 'NGC ' + rng.int(1000, 7999);
  return base + (kind === 'planetary' ? ' Planetary Nebula' : kind === 'snr' ? ' Remnant' : kind === 'dark' ? ' Dark Cloud' : kind === 'reflection' ? ' Reflection Nebula' : ' Nebula');
}
export function starSystemName(rng) {
  const r = rng();
  if (r < 0.5) return properName(rng);
  if (r < 0.75) return rng.pick(GREEK) + ' ' + properName(rng).slice(0, 5) + 'is';
  return catalogName(rng);
}
export const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
export const roman = (i) => ROMAN[i] || String(i + 1);
export const planetLetter = (i) => String.fromCharCode(98 + i); // b, c, d …
