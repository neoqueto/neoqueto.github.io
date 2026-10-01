import * as THREE from 'three/webgpu';
import { uniform, attribute, varying, positionGeometry, positionLocal, positionWorld, normalWorld, modelWorldMatrix, cameraViewMatrix, cameraProjectionMatrix, vec2, vec3, vec4, float, wgslFn } from 'three/tsl';
import { LIB } from '../shaders/lib.js';

export const V3 = (x = 0, y = 0, z = 0) => uniform(new THREE.Vector3(x, y, z));
export const V4 = (x = 0, y = 0, z = 0, w = 0) => uniform(new THREE.Vector4(x, y, z, w));
export const F = (x = 0) => uniform(x);
export const C3 = (c) => uniform(new THREE.Vector3(c[0], c[1], c[2]));

// Global uniforms shared by all materials in a frame.
export const G = { time: uniform(0), wall: uniform(0), res: uniform(new THREE.Vector2(1, 1)), invExp: uniform(1), skyGain: uniform(1), focal: uniform(500) };

export function transparentMat(mat, blend = 'normal', depthTest = true) {
  mat.transparent = true; mat.depthWrite = false; mat.depthTest = depthTest;
  if (blend === 'add') mat.blending = THREE.AdditiveBlending;
  else if (blend === 'premult') { mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor; mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor; }
  else if (blend === 'atmo') { mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.SrcAlphaFactor; mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.OneFactor; }
  else if (blend === 'multiply') { mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation; mat.blendSrc = THREE.ZeroFactor; mat.blendDst = THREE.SrcAlphaFactor; mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.OneFactor; }
  return mat;
}
let _quad = null;
export function quadGeometry() { if (!_quad) { _quad = new THREE.PlaneGeometry(2, 2); } return _quad; }

// Camera-facing quad: centre (camera-relative, world units), half-size in world units.
export function billboardMaterial(fragFn, center, half, extraVary) {
  const m = new THREE.NodeMaterial();
  const vp = cameraViewMatrix.mul(vec4(center, 1.0));
  m.vertexNode = cameraProjectionMatrix.mul(vec4(vp.xy.add(positionGeometry.xy.mul(half)), vp.z, 1.0));
  const q = varying(positionGeometry.xy, 'vq');
  m.fragmentNode = fragFn(q);
  m.side = THREE.DoubleSide;
  return m;
}
export function billboardMesh(mat, order = 10) {
  const mesh = new THREE.Mesh(quadGeometry(), mat); mesh.frustumCulled = false; mesh.renderOrder = order; return mesh;
}

// Instanced billboard field with per-instance attributes. attrs: {name: itemSize}. Returns {mesh, geometry, arrays, setCount}
export function instancedQuads(maxN, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const arrays = {};
  for (const [k, s] of Object.entries(attrs)) { arrays[k] = new Float32Array(maxN * s); const a = new THREE.InstancedBufferAttribute(arrays[k], s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); }
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e30);
  return { geometry: g, arrays, setCount(n) { g.instanceCount = n; }, touch() { for (const k in attrs) g.getAttribute(k).needsUpdate = true; } };
}

// Screen-space ribbon (orbit lines). Instanced segments with attributes p0,p1 (vec3, relative to centre).
const RIBBON = wgslFn(`
fn ribbonV(c0: vec4<f32>, c1: vec4<f32>, side: f32, along: f32, res: vec2<f32>, widthPx: f32) -> vec4<f32> {
  let w0 = max(c0.w, 1.0e-5); let w1 = max(c1.w, 1.0e-5);
  let a = c0.xy / w0; let b = c1.xy / w1;
  var d = (b - a) * res * 0.5; let l = length(d);
  if (l < 1.0e-6) { d = vec2<f32>(1.0, 0.0); } else { d = d / l; }
  let nrm = vec2<f32>(-d.y, d.x);
  let c = mix(c0, c1, along);
  let ok = select(0.0, 1.0, c0.w > 0.0 && c1.w > 0.0);
  let off = nrm * side * widthPx / res * 2.0;
  return vec4<f32>((c.xy / max(c.w, 1.0e-5) + off) * c.w * ok, c.z * ok, c.w * ok + (1.0 - ok) * -1.0);
}`);
export function ribbonMaterial(centerU, colorU, alphaU, widthPx = 1.3) {
  const m = new THREE.NodeMaterial();
  const p0 = attribute('p0', 'vec3'), p1 = attribute('p1', 'vec3');
  const vp = cameraProjectionMatrix.mul(cameraViewMatrix);
  const c0 = vp.mul(vec4(p0.add(centerU), 1.0)), c1 = vp.mul(vec4(p1.add(centerU), 1.0));
  m.vertexNode = RIBBON({ c0, c1, side: positionGeometry.y, along: positionGeometry.x.mul(0.5).add(0.5), res: G.res, widthPx: float(widthPx) });
  const sd = varying(positionGeometry.y, 'rs');
  m.fragmentNode = vec4(colorU, 1.0).mul(alphaU).mul(float(1.0).sub(sd.abs().pow(2.0)));
  m.side = THREE.DoubleSide; transparentMat(m, 'add');
  return m;
}
export function ribbonGeometry(points, closed = true) { // points: Float32Array xyz (km, relative to centre)
  const n = points.length / 3; const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const segs = closed ? n : n - 1; const p0 = new Float32Array(segs * 3), p1 = new Float32Array(segs * 3);
  for (let i = 0; i < segs; i++) { const j = (i + 1) % n; p0.set(points.subarray(i * 3, i * 3 + 3), i * 3); p1.set(points.subarray(j * 3, j * 3 + 3), i * 3); }
  g.setAttribute('p0', new THREE.InstancedBufferAttribute(p0, 3)); g.setAttribute('p1', new THREE.InstancedBufferAttribute(p1, 3));
  g.instanceCount = segs; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e30); return g;
}
import { length, smoothstep, min, max, pow, exp, log, tan, clamp, mix, select, sqrt } from 'three/tsl';
export { length, smoothstep, min, max, pow, exp, log, tan, clamp, mix, select, sqrt };
export { THREE, uniform, attribute, varying, positionGeometry, positionLocal, positionWorld, normalWorld, modelWorldMatrix, cameraViewMatrix, cameraProjectionMatrix, vec2, vec3, vec4, float };
