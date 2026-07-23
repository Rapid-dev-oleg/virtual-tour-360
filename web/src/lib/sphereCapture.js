import * as THREE from 'three';

// Street-View-style guided 360 capture, done in the browser.
// - Phone orientation (gyro) → camera quaternion (like Lightcycle's IMU pose).
// - We show target dots on a virtual sphere; user aims a reticle at each; auto-capture.
// - Each captured frame carries its orientation → geometric stitch into an equirect
//   (no feature matching: we trust the IMU pose, then blend overlaps). See docs.

// ---- device orientation → three.js camera quaternion --------------------------
// Standard mapping (from three's old DeviceOrientationControls).
const _zee = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° about X (screen→world)
const deg2rad = Math.PI / 180;

// alpha,beta,gamma in DEGREES (from deviceorientation), screenAngle in DEGREES.
export function orientationToQuaternion(alpha, beta, gamma, screenAngle, out = new THREE.Quaternion()) {
  const a = (alpha || 0) * deg2rad;
  const b = (beta || 0) * deg2rad;
  const g = (gamma || 0) * deg2rad;
  const o = (screenAngle || 0) * deg2rad;
  _euler.set(b, a, -g, 'YXZ');
  out.setFromEuler(_euler);
  out.multiply(_q1);
  out.multiply(_q0.setFromAxisAngle(_zee, -o));
  return out;
}

export function screenAngle() {
  const so = (typeof screen !== 'undefined' && (screen.orientation?.angle ?? window.orientation)) || 0;
  return so;
}

// ---- target dots covering the sphere ------------------------------------------
// rings of yaw dots at several pitches + zenith/nadir. Returns unit direction vectors.
export function makeTargets({ pitches = [-45, 0, 45], perRing = 8, poles = true } = {}) {
  const targets = [];
  for (const pitchDeg of pitches) {
    const p = pitchDeg * deg2rad;
    const cp = Math.cos(p), sp = Math.sin(p);
    for (let i = 0; i < perRing; i++) {
      const y = (i / perRing) * Math.PI * 2;
      // forward = -z at yaw 0; yaw rotates around Y
      targets.push(new THREE.Vector3(-Math.sin(y) * cp, sp, -Math.cos(y) * cp));
    }
  }
  if (poles) {
    targets.push(new THREE.Vector3(0, 1, 0)); // zenith
    targets.push(new THREE.Vector3(0, -1, 0)); // nadir
  }
  return targets.map((v) => v.normalize());
}

// ---- geometric stitch: oriented frames → equirectangular ----------------------
// frames: [{ image: HTMLCanvasElement|ImageBitmap|HTMLImageElement, quaternion: {x,y,z,w} }]
// vFovDeg: vertical field of view of the phone camera (calibration).
// Returns a data URL (jpeg) equirect in the viewer convention
// (u = atan(dir.z, dir.x)/2π + 0.5, top row = zenith, flipY=false).
export async function framesToEquirect(frames, { vFovDeg = 60, width = 2048, faceSize = 1024 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const R = 10; // sphere radius for placing frame quads
  const vfov = vFovDeg * deg2rad;
  const quadH = 2 * R * Math.tan(vfov / 2);

  const disposables = [];
  for (const f of frames) {
    const tex = new THREE.Texture(f.image);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const iw = f.image.width || f.image.videoWidth || 1;
    const ih = f.image.height || f.image.videoHeight || 1;
    const aspect = iw / ih;
    const geo = new THREE.PlaneGeometry(quadH * aspect, quadH);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    const q = new THREE.Quaternion(f.quaternion.x, f.quaternion.y, f.quaternion.z, f.quaternion.w);
    // place quad in front of camera (camera looks -z) at distance R, facing the centre
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    mesh.position.copy(fwd.multiplyScalar(R));
    mesh.quaternion.copy(q);
    scene.add(mesh);
    disposables.push(geo, mat, tex);
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(width, width / 2);

  const cubeRT = new THREE.WebGLCubeRenderTarget(faceSize);
  const cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
  cubeCam.position.set(0, 0, 0);
  cubeCam.update(renderer, scene);

  const eqScene = new THREE.Scene();
  const eqCam = new THREE.Camera();
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { cube: { value: cubeRT.texture } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0);} `,
      fragmentShader: `
        precision highp float; varying vec2 vUv; uniform samplerCube cube;
        #define PI 3.141592653589793
        void main(){
          float u = vUv.x; float v = 1.0 - vUv.y;
          float lon = (u - 0.5) * 2.0 * PI;
          float phi = (0.5 - v) * PI;
          float cphi = cos(phi);
          vec3 dir = vec3(cphi*cos(lon), sin(phi), cphi*sin(lon));
          gl_FragColor = textureCube(cube, dir);
        }`,
    }),
  );
  eqScene.add(quad);

  const w = width, h = width / 2;
  const outRT = new THREE.WebGLRenderTarget(w, h);
  renderer.setRenderTarget(outRT);
  renderer.render(eqScene, eqCam);
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(outRT, 0, 0, w, h, buf);
  renderer.setRenderTarget(null);

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const si = (sy * w + x) * 4, di = (y * w + x) * 4;
      img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1]; img.data[di + 2] = buf[si + 2]; img.data[di + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.9);

  quad.geometry.dispose();
  quad.material.dispose();
  cubeRT.dispose();
  outRT.dispose();
  disposables.forEach((d) => d.dispose?.());
  renderer.dispose();
  return url;
}
