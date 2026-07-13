import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// A room modelled as a box (W×L×H) built from 6 inward-facing planes, each
// textured with its assigned photo(s). Camera moves inside → parallax → "объём".
// Empty planes show a labelled placeholder so orientation is always visible.

const PLANE_LABELS = {
  front: 'Передняя',
  back: 'Задняя',
  left: 'Левая',
  right: 'Правая',
  floor: 'Пол',
  ceiling: 'Потолок',
};

function loadImg(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

// composite one or more photos (side-by-side) OR a labelled placeholder
async function buildTexture(photos, texW, texH, label) {
  const canvas = document.createElement('canvas');
  canvas.width = texW;
  canvas.height = texH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1f2430';
  ctx.fillRect(0, 0, texW, texH);

  const imgs = (await Promise.all((photos || []).map(loadImg))).filter(Boolean);
  if (imgs.length) {
    const slot = texW / imgs.length;
    imgs.forEach((im, i) => {
      // cover-fit each photo into its slot
      const s = Math.max(slot / im.width, texH / im.height);
      const dw = im.width * s;
      const dh = im.height * s;
      ctx.drawImage(im, i * slot + (slot - dw) / 2, (texH - dh) / 2, dw, dh);
    });
  } else {
    // placeholder: grid + label + up arrow
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= texW; x += texW / 8) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, texH); ctx.stroke();
    }
    for (let y = 0; y <= texH; y += texH / 8) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(texW, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(texH / 10)}px system-ui`;
    ctx.fillText(label, texW / 2, texH / 2);
    ctx.font = `${Math.round(texH / 14)}px system-ui`;
    ctx.fillText('↑ верх', texW / 2, texH * 0.2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function RoomViewer({ room }) {
  const ref = useRef(null);
  const move = useRef({ f: 0, b: 0, l: 0, r: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const W = room?.dims?.w || 4;
    const L = room?.dims?.l || 5;
    const H = room?.dims?.h || 2.7;
    const S = 220; // texture px per meter
    const cap = (v) => Math.min(2048, Math.round(v));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.01, 100);
    camera.rotation.order = 'YXZ';

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // plane definitions: geometry size + transform + which room-plane key
    const defs = [
      { key: 'front', gw: W, gh: H, pos: [0, 0, -L / 2], rot: [0, 0, 0] },
      { key: 'back', gw: W, gh: H, pos: [0, 0, L / 2], rot: [0, Math.PI, 0] },
      { key: 'left', gw: L, gh: H, pos: [-W / 2, 0, 0], rot: [0, Math.PI / 2, 0] },
      { key: 'right', gw: L, gh: H, pos: [W / 2, 0, 0], rot: [0, -Math.PI / 2, 0] },
      { key: 'floor', gw: W, gh: L, pos: [0, -H / 2, 0], rot: [-Math.PI / 2, 0, 0] },
      { key: 'ceiling', gw: W, gh: L, pos: [0, H / 2, 0], rot: [Math.PI / 2, 0, 0] },
    ];

    const meshes = [];
    defs.forEach((d) => {
      const geo = new THREE.PlaneGeometry(d.gw, d.gh);
      const mat = new THREE.MeshBasicMaterial({ color: 0x2a3040, side: THREE.FrontSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...d.pos);
      mesh.rotation.set(...d.rot);
      scene.add(mesh);
      meshes.push(mesh);
      buildTexture(room?.planes?.[d.key], cap(d.gw * S), cap(d.gh * S), PLANE_LABELS[d.key]).then(
        (tex) => {
          mat.map = tex;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
        },
      );
    });

    // ---- look controls (drag) ----
    let yaw = 0;
    let pitch = 0;
    let dragging = false;
    let px = 0;
    let py = 0;
    const onDown = (e) => {
      dragging = true;
      const p = e.touches ? e.touches[0] : e;
      px = p.clientX; py = p.clientY;
    };
    const onMove = (e) => {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      yaw -= (p.clientX - px) * 0.004;
      pitch -= (p.clientY - py) * 0.004;
      pitch = Math.max(-1.4, Math.min(1.4, pitch));
      px = p.clientX; py = p.clientY;
    };
    const onUp = () => { dragging = false; };
    el.addEventListener('mousedown', onDown);
    el.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    el.addEventListener('touchstart', onDown, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onUp);

    const keys = {};
    const kd = (e) => (keys[e.key.toLowerCase()] = true);
    const ku = (e) => (keys[e.key.toLowerCase()] = false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    // ---- render loop ----
    let raf;
    let last = 0;
    const tmp = new THREE.Vector3();
    const render = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000 || 0);
      last = t;
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;

      const speed = 1.6 * dt;
      const fwd = keys['w'] || keys['arrowup'] || move.current.f;
      const back = keys['s'] || keys['arrowdown'] || move.current.b;
      const lft = keys['a'] || keys['arrowleft'] || move.current.l;
      const rgt = keys['d'] || keys['arrowright'] || move.current.r;
      // horizontal forward from yaw
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      if (fwd) { camera.position.x += fx * speed; camera.position.z += fz * speed; }
      if (back) { camera.position.x -= fx * speed; camera.position.z -= fz * speed; }
      if (lft) { camera.position.x += fz * speed; camera.position.z -= fx * speed; }
      if (rgt) { camera.position.x -= fz * speed; camera.position.z += fx * speed; }
      // clamp inside the room
      const m = 0.35;
      camera.position.x = Math.max(-W / 2 + m, Math.min(W / 2 - m, camera.position.x));
      camera.position.z = Math.max(-L / 2 + m, Math.min(L / 2 - m, camera.position.z));
      camera.position.y = 0;
      tmp; // noop keep ref
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.removeEventListener('touchstart', onDown);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onUp);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [room]);

  const Btn = ({ dir, label, x, y }) => (
    <button
      onPointerDown={() => (move.current[dir] = 1)}
      onPointerUp={() => (move.current[dir] = 0)}
      onPointerLeave={() => (move.current[dir] = 0)}
      className={`absolute ${x} ${y} flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur active:bg-indigo-500`}
    >
      {label}
    </button>
  );

  return (
    <div className="relative h-full w-full touch-none">
      <div ref={ref} className="h-full w-full" />
      {/* move pad */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 h-32 w-32 -translate-x-1/2">
        <div className="pointer-events-auto">
          <Btn dir="f" label="↑" x="left-1/2 -translate-x-1/2" y="top-0" />
          <Btn dir="b" label="↓" x="left-1/2 -translate-x-1/2" y="bottom-0" />
          <Btn dir="l" label="←" x="left-0" y="top-1/2 -translate-y-1/2" />
          <Btn dir="r" label="→" x="right-0" y="top-1/2 -translate-y-1/2" />
        </div>
      </div>
    </div>
  );
}
