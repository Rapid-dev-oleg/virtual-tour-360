import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as THREE from 'three';
import { getTour, saveTour } from '../lib/store.js';
import { rlog, rerr } from '../lib/rlog.js';
import {
  orientationToQuaternion,
  screenAngle,
  makeTargets,
  framesToEquirect,
} from '../lib/sphereCapture.js';

// Like Google's Lightcycle: the camera PREVIEW is a centred window at the camera's
// native aspect (NOT stretched fullscreen → no fake zoom), and the guidance dots/arrow
// are drawn on a fullscreen overlay around it, with angles scaled so a dot centred in
// the preview means the phone points at that direction.
const AXIS_FOV = 66; // camera FOV along the LONGER image dimension (calibration knob)
const PREVIEW_W = 0.72; // preview window width as fraction of screen width
const PREVIEW_H = 0.46; // ...capped by this fraction of screen height
const CAPTURE_DEG = 7;
const STEADY_DEG = 1.2; // per-frame orientation change (deg) under which we count as "still"
const HOLD_FRAMES = 14; // must stay still on the dot this many frames (~0.4s) → sharp, focused frame
const rad = Math.PI / 180;

export default function CapturePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const tourRef = useRef(null);
  useEffect(() => { getTour(id).then((t) => { tourRef.current = t; }); }, [id]);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const arrowRef = useRef(null);
  const holdRef = useRef(null);
  const orient = useRef({ alpha: 0, beta: 0, gamma: 0 });
  const prevAngles = useRef({ a: 0, b: 0, g: 0 });
  const frames = useRef([]);
  const doneRef = useRef([]);

  const [phase, setPhase] = useState('intro');
  const [err, setErr] = useState('');
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);

  const start = async () => {
    setErr('');
    rlog('start:click', { secure: window.isSecureContext });
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const p = await DeviceOrientationEvent.requestPermission();
        rlog('gyro:permission', { result: p });
        if (p !== 'granted') throw new Error('no access to the gyroscope');
      } else rlog('gyro:noPermissionApi');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable (HTTPS required)');
      // 4:3 = full sensor FOV (native-camera-like). 16:9/9:16 crops the sensor → looks "zoomed".
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1600 }, height: { ideal: 1200 },
          aspectRatio: { ideal: 4 / 3 },
        },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      const st = track?.getSettings?.() || {};
      const caps = track?.getCapabilities?.() || {};
      rlog('camera:stream', { w: st.width, h: st.height, facing: st.facingMode, zoom: st.zoom });
      rlog('camera:caps', {
        focus: caps.focusMode, zoomMin: caps.zoom?.min, zoomMax: caps.zoom?.max, wMax: caps.width?.max,
      });
      // force continuous autofocus + widest (no digital zoom) when supported
      const adv = [];
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) adv.push({ focusMode: 'continuous' });
      if (caps.zoom && caps.zoom.min != null) adv.push({ zoom: caps.zoom.min });
      if (adv.length) {
        try { await track.applyConstraints({ advanced: adv }); rlog('camera:constraints', adv); }
        catch (e) { rerr('camera:constraintsFail', { msg: String(e.message || e) }); }
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      rlog('camera:playing', { vw: videoRef.current.videoWidth, vh: videoRef.current.videoHeight });
      setPhase('capturing');
    } catch (e) {
      rerr('start:error', { name: e.name, msg: String(e.message || e) });
      setErr(String(e.message || e));
      setPhase('error');
    }
  };

  useEffect(() => {
    if (phase !== 'capturing') return undefined;

    const targets = makeTargets({ pitches: [0, -35, 35], perRing: 6, poles: true });
    doneRef.current = targets.map(() => false);
    frames.current = [];
    setTotal(targets.length);
    setCount(0);

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    cam.rotation.order = 'YXZ';

    let camVFovDeg = 50; // camera's TRUE vertical FOV (for the stitch)
    let laidW = 0, laidH = 0;
    const layout = () => {
      if (!video.videoWidth) return;
      const sw = window.innerWidth, sh = window.innerHeight;
      const vAsp = video.videoWidth / video.videoHeight;
      const pw = Math.min(sw * PREVIEW_W, sh * PREVIEW_H * vAsp);
      const ph = pw / vAsp;
      const left = (sw - pw) / 2, top = (sh - ph) / 2;
      video.style.cssText =
        `position:absolute;left:${left}px;top:${top}px;width:${pw}px;height:${ph}px;` +
        `object-fit:fill;border-radius:14px;box-shadow:0 0 0 2px rgba(255,255,255,.35);`;
      canvas.style.cssText = `position:absolute;left:0;top:0;width:${sw}px;height:${sh}px;`;
      renderer.setSize(sw, sh, false);
      // camera true FOVs — AXIS_FOV is along the LONGER dimension (fixes portrait 98° bug)
      const longFov = AXIS_FOV * rad;
      let camHFov, camVFov;
      if (video.videoWidth >= video.videoHeight) { // landscape frame
        camHFov = longFov;
        camVFov = 2 * Math.atan(Math.tan(longFov / 2) * video.videoHeight / video.videoWidth);
      } else { // portrait frame (Huawei etc.)
        camVFov = longFov;
        camHFov = 2 * Math.atan(Math.tan(longFov / 2) * video.videoWidth / video.videoHeight);
      }
      camVFovDeg = camVFov / rad;
      // preview window (pw) shows camHFov; scale overlay so full screen width spans camHFov*sw/pw
      const overlayHFov = camHFov * (sw / pw);
      const overlayVFov = 2 * Math.atan(Math.tan(overlayHFov / 2) / (sw / sh));
      cam.fov = overlayVFov / rad;
      cam.aspect = sw / sh;
      cam.updateProjectionMatrix();
      laidW = video.videoWidth; laidH = video.videoHeight;
      rlog('layout', { sw, sh, vw: video.videoWidth, vh: video.videoHeight, pw: Math.round(pw), ph: Math.round(ph), camVFov: Math.round(camVFovDeg), overlayFov: Math.round(cam.fov) });
    };
    layout();
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', layout);

    const dots = targets.map((dir) => {
      const grp = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 20, 20),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }),
      );
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.24, 0.3, 28),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      grp.add(core, ring);
      grp.position.copy(dir.clone().multiplyScalar(5));
      grp.userData = { core, ring };
      scene.add(grp);
      return grp;
    });

    let orientCount = 0;
    const onOrient = (e) => {
      orientCount += 1;
      if (orientCount === 1) rlog('gyro:first', { a: e.alpha, b: e.beta, g: e.gamma, abs: e.absolute });
      orient.current = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
    };
    window.addEventListener('deviceorientation', onOrient, true);
    rlog('capture:start', { targets: targets.length });
    const noGyroTimer = setTimeout(() => {
      if (orientCount === 0) rerr('gyro:noEvents', { note: 'deviceorientation silent for 4s' });
    }, 4000);
    const heartbeat = setInterval(() => {
      const o = orient.current;
      rlog('capture:hb', { gyro: orientCount, cap: frames.current.length, a: Math.round(o.alpha), b: Math.round(o.beta), g: Math.round(o.gamma) });
    }, 3000);

    const q = new THREE.Quaternion();
    const invQ = new THREE.Quaternion();
    const fwd = new THREE.Vector3();
    const local = new THREE.Vector3();
    const grab = document.createElement('canvas');
    let raf;
    let steadyFrames = 0; // consecutive "still" frames → only shoot when held still (kills motion blur)

    const tick = () => {
      if (video.videoWidth && (laidW !== video.videoWidth || laidH !== video.videoHeight)) layout();

      const { alpha, beta, gamma } = orient.current;
      orientationToQuaternion(alpha, beta, gamma, screenAngle(), q);
      cam.quaternion.copy(q);
      cam.updateMatrixWorld();
      invQ.copy(q).invert();

      const d = Math.abs(alpha - prevAngles.current.a) + Math.abs(beta - prevAngles.current.b) + Math.abs(gamma - prevAngles.current.g);
      prevAngles.current = { a: alpha, b: beta, g: gamma };
      const steady = d < STEADY_DEG;
      steadyFrames = steady ? steadyFrames + 1 : 0;

      fwd.set(0, 0, -1).applyQuaternion(q);
      let nearest = -1, nearestAng = 999;
      for (let i = 0; i < targets.length; i++) {
        const ang = THREE.MathUtils.radToDeg(fwd.angleTo(targets[i]));
        const done = doneRef.current[i];
        const active = !done && ang < CAPTURE_DEG;
        const { core, ring } = dots[i].userData;
        const col = done ? 0x22c55e : active ? 0xfacc15 : 0xffffff;
        core.material.color.setHex(col); ring.material.color.setHex(col);
        core.material.opacity = done ? 0.85 : 0.95;
        dots[i].scale.setScalar(active ? 1.5 : 1);
        dots[i].quaternion.copy(q);
        if (!done && ang < nearestAng) { nearestAng = ang; nearest = i; }
      }

      const arrow = arrowRef.current;
      if (arrow) {
        if (nearest >= 0 && nearestAng > CAPTURE_DEG) {
          local.copy(targets[nearest]).applyQuaternion(invQ); // target dir in camera space
          const p = targets[nearest].clone().project(cam); // NDC
          const onScreen = p.z < 1 && Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9;
          if (onScreen) {
            arrow.style.opacity = '0'; // the dot itself is visible → it guides, no arrow
          } else {
            const ang = Math.atan2(local.x, local.y); // rad, 0=up, clockwise
            const R = Math.min(window.innerWidth, window.innerHeight) * 0.36; // offset from centre → not over the reticle
            const dx = Math.sin(ang) * R, dy = -Math.cos(ang) * R;
            arrow.style.opacity = '0.95';
            arrow.style.transform =
              `translate(calc(-50% + ${dx.toFixed(0)}px), calc(-50% + ${dy.toFixed(0)}px)) rotate(${(ang / rad).toFixed(1)}deg)`;
          }
        } else arrow.style.opacity = '0';
      }

      // "hold still" feedback: reticle fills green as you keep the phone steady on a dot
      const aiming = nearest >= 0 && nearestAng < CAPTURE_DEG;
      const hold = holdRef.current;
      if (hold) hold.style.transform = `scale(${aiming ? Math.min(steadyFrames / HOLD_FRAMES, 1).toFixed(2) : 0})`;

      // shoot ONLY after the phone has been held still on the dot → sharp, focused frame
      if (aiming && steadyFrames >= HOLD_FRAMES && video.videoWidth) {
        const sw = 960, sh = Math.round(video.videoHeight * (960 / video.videoWidth));
        grab.width = sw; grab.height = sh;
        grab.getContext('2d').drawImage(video, 0, 0, sw, sh);
        const snap = document.createElement('canvas');
        snap.width = sw; snap.height = sh;
        snap.getContext('2d').drawImage(grab, 0, 0);
        frames.current.push({ image: snap, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w }, vFovDeg: camVFovDeg });
        doneRef.current[nearest] = true;
        steadyFrames = 0;
        rlog('capture:frame', { idx: nearest, ang: Math.round(nearestAng), total: frames.current.length });
        setCount((c) => c + 1);
      }

      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(noGyroTimer);
      clearInterval(heartbeat);
      window.removeEventListener('deviceorientation', onOrient, true);
      window.removeEventListener('resize', layout);
      window.removeEventListener('orientationchange', layout);
      dots.forEach((g) => g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }));
      renderer.dispose();
      const s = videoRef.current?.srcObject;
      if (s) s.getTracks().forEach((t) => t.stop());
    };
  }, [phase]);

  const finish = async () => {
    rlog('finish:click', { frames: frames.current.length });
    if (!frames.current.length) { setErr('No frames'); return; }
    setPhase('stitching');
    // save raw frames + poses to the server FIRST (so they're kept for OpenCV/AI re-stitching)
    try {
      const payload = frames.current.map((f) => ({
        image: f.image.toDataURL('image/jpeg', 0.85),
        q: f.quaternion,
        vFovDeg: f.vFovDeg,
      }));
      const r = await fetch('/api/frames', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames: payload }),
      });
      const j = await r.json();
      rlog('frames:uploaded', { id: j.id, n: payload.length, dir: j.dir });
    } catch (e) { rerr('frames:uploadErr', { msg: String(e.message || e) }); }
    try {
      const t0 = Date.now();
      const vf = frames.current[0]?.vFovDeg || 50;
      const dataUrl = await framesToEquirect(frames.current, { vFovDeg: vf });
      rlog('stitch:done', { ms: Date.now() - t0, urlKb: Math.round(dataUrl.length / 1024), vf: Math.round(vf) });
      // persist on the server (localStorage is too small for a full pano → save failed = empty cube)
      let pano = dataUrl;
      try {
        const r = await fetch('/api/pano', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl }),
        });
        const j = await r.json();
        if (j.ok && j.url) { pano = j.url; rlog('pano:uploaded', { url: j.url }); }
        else rerr('pano:uploadFail', { j });
      } catch (e) { rerr('pano:uploadErr', { msg: String(e.message || e) }); }
      const tour = tourRef.current;
      if (tour) {
        tour.panorama = pano; tour.cover = pano;
        const saved = await saveTour(tour);
        rlog('stitch:saved', { ok: !!saved, pano: pano.slice(0, 48) });
      } else rerr('stitch:noTour', { id });
      nav(`/t/${id}`);
    } catch (e) {
      rerr('stitch:error', { name: e.name, msg: String(e.message || e) });
      setErr('Stitching failed: ' + String(e.message || e));
      setPhase('error');
    }
  };

  const pct = total ? Math.round((count / total) * 100) : 0;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <video ref={videoRef} playsInline muted className="absolute" />
      <canvas ref={canvasRef} className="absolute" />

      {phase === 'capturing' && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.5)]">
              <div ref={holdRef} className="h-11 w-11 rounded-full bg-emerald-400/80" style={{ transform: 'scale(0)' }} />
            </div>
          </div>
          <div
            ref={arrowRef}
            className="pointer-events-none absolute left-1/2 top-1/2 text-6xl transition-opacity duration-150"
            style={{ opacity: 0, filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.9))' }}
          >
            ⬆️
          </div>
        </>
      )}

      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4">
        <button onClick={() => nav(-1)} className="rounded-lg bg-black/50 px-3 py-1.5 text-sm">← Exit</button>
        {phase === 'capturing' && (
          <div className="rounded-lg bg-black/50 px-3 py-1.5 text-sm">{count} / {total} points</div>
        )}
      </div>

      {phase === 'intro' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-black/85 p-8 text-center">
          <div className="text-5xl">🧭</div>
          <h2 className="text-xl font-bold">Capture a 360° sphere</h2>
          <p className="max-w-xs text-sm text-gray-300">
            The camera is the window in the center. The arrow shows which way to turn. Point the reticle at a dot and
            <b> hold the phone still</b> — the reticle fills green and captures a sharp frame.
            Cover all the points: around, up and down, standing in place.
          </p>
          <button onClick={start} className="rounded-xl bg-indigo-500 px-6 py-3 font-semibold">Start capture</button>
          <p className="text-xs text-gray-500">Camera and motion sensor access is required.</p>
        </div>
      )}

      {phase === 'capturing' && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 p-5">
          <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/20">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <button onClick={finish} disabled={!count} className="rounded-xl bg-white px-6 py-3 font-semibold text-black disabled:opacity-40">
            Build sphere ({count})
          </button>
        </div>
      )}

      {phase === 'stitching' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/85">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          <p className="text-sm text-gray-300">Stitching a sphere from {frames.current.length} frames…</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/85 p-8 text-center">
          <div className="text-4xl">⚠️</div>
          <p className="text-sm text-red-300">{err}</p>
          <button onClick={() => setPhase('intro')} className="rounded-xl bg-indigo-500 px-6 py-3 font-semibold">Try again</button>
        </div>
      )}
    </div>
  );
}
