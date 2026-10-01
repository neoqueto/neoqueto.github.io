import * as THREE from 'three/webgpu';
import { uniform, texture, uv, vec3, vec4, vec2, float, sampler } from 'three/tsl';
import { bloom } from 'three/addons/BloomNode.js';
import { BHLENS, COMPOSITE } from '../shaders/post.js';

export class Engine {
  constructor(canvas, opts = {}) { this.canvas = canvas; this.opts = opts; this.layers = []; this.scale = opts.scale || 1; this.size = [1, 1]; }
  async init() {
    const r = this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: false, alpha: false, reversedDepthBuffer: true, powerPreference: 'high-performance' });
    await r.init();
    this.backendName = r.backend && r.backend.constructor.name;
    this.isWebGPU = !!(r.backend && r.backend.isWebGPUBackend);
    r.setClearColor(0x000000, 1);
    r.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1e9);
    this.camera.matrixAutoUpdate = true;
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true, samples: this.opts.msaa ? 4 : 0, colorSpace: THREE.LinearSRGBColorSpace };
    this.rtScene = new THREE.RenderTarget(4, 4, rtOpts);
    this.rtLens = new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    // lens pass
    this.U = {
      right: uniform(new THREE.Vector3(1, 0, 0)), up: uniform(new THREE.Vector3(0, 1, 0)), fwd: uniform(new THREE.Vector3(0, 0, -1)), aspTan: uniform(new THREE.Vector2(1, 1)),
      bhDir: uniform(new THREE.Vector3(0, 0, -1)), D: uniform(1e6), axis: uniform(new THREE.Vector3(0, 1, 0)), disk: uniform(new THREE.Vector4(3, 100, 9000, 1)), extra: uniform(new THREE.Vector4(0, 0, 1, 0)),
      exposure: uniform(1), bloomK: uniform(0.6), vig: uniform(0.3), sat: uniform(1.08), grain: uniform(0),
    };
    const sceneTex = texture(this.rtScene.texture);
    this.lensMat = new THREE.NodeMaterial();
    const U = this.U;
    this.lensMat.fragmentNode = BHLENS({ tex: sceneTex, smp: sampler(this.rtScene.texture), uv: uv(), right: U.right, upv: U.up, fwd: U.fwd, aspTan: U.aspTan, bhDir: U.bhDir, D: U.D, axis: U.axis, disk: U.disk, extra: U.extra, expo: U.exposure });
    this.lensQuad = new THREE.QuadMesh(this.lensMat);
    const lensTex = texture(this.rtLens.texture);
    this.bloomNode = bloom(lensTex, 0.85, 0.5, 1.05);
    this.post = new THREE.RenderPipeline(r);
    this.post.outputNode = COMPOSITE({ scene: lensTex, bloomC: this.bloomNode, uv: uv(), exposure: float(1.0), bloomK: U.bloomK, vig: U.vig, sat: U.sat, grainT: U.grain });
    this.lensActive = false;
  }
  setSize(w, h, dpr) {
    this.cssSize = [w, h]; this.dpr = dpr;
    const pr = Math.max(0.5, dpr * this.scale);
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    const pw = Math.max(2, Math.floor(w * pr)), ph = Math.max(2, Math.floor(h * pr));
    this.rtScene.setSize(pw, ph); this.rtLens.setSize(pw, ph); this.size = [pw, ph];
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
  }
  setScale(s) { this.scale = s; if (this.cssSize) this.setSize(this.cssSize[0], this.cssSize[1], this.dpr); }
  setFov(deg) { this.camera.fov = deg; this.camera.updateProjectionMatrix(); }
  // layers: [{scene, near, far}]
  render(layers, camQuat, lens) {
    const r = this.renderer, cam = this.camera;
    cam.quaternion.set(camQuat[0], camQuat[1], camQuat[2], camQuat[3]); cam.position.set(0, 0, 0); cam.updateMatrixWorld(true);
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 1); r.clear(true, true, false);
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i]; if (!L.scene || L.skip) continue;
      cam.near = L.near; cam.far = L.far; cam.updateProjectionMatrix();
      if (i > 0) r.clearDepth();
      r.render(L.scene, cam);
    }
    // lens pass
    const U = this.U; const e = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion), f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    U.right.value.copy(e); U.up.value.copy(u); U.fwd.value.copy(f);
    const th = Math.tan(cam.fov * Math.PI / 360); U.aspTan.value.set(th * cam.aspect, th);
    if (lens) { U.bhDir.value.set(...lens.dir); U.D.value = lens.D; U.axis.value.set(...lens.axis); U.disk.value.set(lens.rin, lens.rout, lens.temp, lens.inten); U.extra.value.set(lens.time, 1, lens.spin, lens.faint || 0); }
    else U.extra.value.y = 0;
    r.setRenderTarget(this.rtLens);
    this.lensQuad.render(r);
    r.setRenderTarget(null);
    this.post.render();
  }
}
