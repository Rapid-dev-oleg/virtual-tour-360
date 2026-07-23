import { useRef, useState } from 'react';
import { fileToPhotoDataURL } from '../lib/image.js';
import RoomViewer from '../components/RoomViewer.jsx';
import { TopBar, Screen, Button } from '../components/ui.jsx';

// Real OpenCV stitching (cv2.Stitcher) via the dockerized pano-stitch lib.
// Real pixels — no AI, no invention. Needs an overlapping 360 ring of photos.
const MAX = 24;

export default function RealStitchPage() {
  const fileInput = useRef(null);
  const dragFrom = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [post, setPost] = useState('none'); // none | repair | render (AI post-process)
  const [phase, setPhase] = useState('pick'); // pick | working | done | error
  const [err, setErr] = useState('');
  const [log, setLog] = useState('');
  const [result, setResult] = useState(null);

  const addFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const room = MAX - photos.length;
    const urls = await Promise.all(files.slice(0, room).map((f) => fileToPhotoDataURL(f, 2000)));
    setPhotos((p) => [...p, ...urls]);
  };
  const removeAt = (i) => setPhotos((p) => p.filter((_, k) => k !== i));
  const move = (i, d) => setPhotos((p) => {
    const j = i + d;
    if (j < 0 || j >= p.length) return p;
    const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const reorder = (from, to) => setPhotos((p) => {
    if (from == null || to == null || from === to) return p;
    const n = [...p]; const [it] = n.splice(from, 1); n.splice(to, 0, it); return n;
  });

  const stitch = async () => {
    if (photos.length < 2) { setErr('Need at least 2 photos'); return; }
    setErr(''); setLog(''); setPhase('working');
    try {
      const r = await fetch('/api/stitch-cv', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: photos, ...(post !== 'none' ? { post } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setErr(j.error || `error ${r.status}`);
        setLog(j.log || '');
        setPhase('error');
        return;
      }
      setResult(j); setLog(j.log || ''); setPhase('done');
    } catch (e) {
      setErr(String(e.message || e)); setPhase('error');
    }
  };

  const reset = () => { setResult(null); setLog(''); setErr(''); setPhase('pick'); };

  // ---- done ----
  if (phase === 'done' && result) {
    return (
      <Screen>
        <TopBar
          title="Real stitch"
          back="/panoramas"
          right={<a href={result.url} download="panorama.jpg" className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white">⬇ Download</a>}
        />
        <div className="flex flex-col items-center gap-3 p-4">
          <div className="mx-auto w-full max-w-[720px] overflow-hidden rounded-xl border border-white/10 bg-black" style={{ height: 'min(46vh, 360px)' }}>
            <RoomViewer room={{ panorama: result.url, dims: { w: 4, l: 5, h: 2.7 } }} />
          </div>
          <div className="flex w-full max-w-[760px] items-center justify-between">
            <span className="text-xs text-emerald-400">Real pixels — stitched with OpenCV, no AI.</span>
            <button onClick={reset} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white">Another</button>
          </div>
          {log && <details className="w-full max-w-[760px]"><summary className="cursor-pointer text-xs text-gray-500">Stitch log</summary><pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-[10px] text-gray-400">{log}</pre></details>}
        </div>
      </Screen>
    );
  }

  // ---- working ----
  if (phase === 'working') {
    return (
      <Screen>
        <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-white/15 border-t-emerald-400" />
          <div>
            <div className="text-lg font-semibold text-white">Stitching with OpenCV…</div>
            <div className="mt-2 text-sm text-gray-400">Real feature-matching — can take 1–3 minutes. Don't close the page.</div>
          </div>
        </div>
      </Screen>
    );
  }

  // ---- pick / error ----
  return (
    <Screen>
      <TopBar title="Real stitch (OpenCV)" back="/panoramas" />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3 text-sm text-gray-300">
          <b>Real stitching</b> — your actual pixels, no AI, nothing invented. It needs a proper <b>overlapping 360° ring</b>:
          <ul className="ml-4 mt-1 list-disc text-xs text-gray-400">
            <li>Stand in one spot, <b>rotate in place</b>, ~10–16 shots (turn ~25–30° each).</li>
            <li><b>≥40% overlap</b> between neighbours — when in doubt, take more.</li>
            <li>Keep the phone level, constant height; lock exposure if you can.</li>
          </ul>
          <div className="mt-1 text-xs text-amber-300/80">Photos without overlap will fail loudly (with a diagnostic) — that's expected, not a bug.</div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {photos.map((src, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => { dragFrom.current = i; }}
              onDragOver={(e) => { e.preventDefault(); if (dragOver !== i) setDragOver(i); }}
              onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
              onDrop={() => { reorder(dragFrom.current, i); dragFrom.current = null; setDragOver(null); }}
              onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
              className={`relative cursor-move overflow-hidden rounded-lg ${dragOver === i ? 'ring-2 ring-emerald-400' : ''}`}
            >
              <img src={src} alt="" draggable={false} className="aspect-square w-full object-cover" />
              <div className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white">{i + 1}</div>
              <button onClick={() => removeAt(i)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white">✕</button>
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-3">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white disabled:opacity-30">◀</button>
                <button onClick={() => move(i, 1)} disabled={i === photos.length - 1} className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white disabled:opacity-30">▶</button>
              </div>
            </div>
          ))}
          {photos.length < MAX && (
            <button onClick={() => fileInput.current?.click()} className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-white/20 text-3xl text-white/40">+</button>
          )}
        </div>
        <div className="text-xs text-gray-500">{photos.length}/{MAX} photos · order = shooting order (drag / ◀ ▶ to fix)</div>

        {/* AI post-process choice */}
        <div>
          <div className="mb-1 text-sm font-medium text-gray-300">AI post-process</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['none', 'None', 'raw stitch'],
              ['repair', 'Fix defects', 'fills gaps · keeps real pixels'],
              ['render', 'Full render', 'AI re-draws · fixes distortion'],
            ].map(([v, label, desc]) => (
              <button
                key={v}
                onClick={() => setPost(v)}
                className={`rounded-lg border p-2 text-center ${post === v ? 'border-emerald-400 bg-emerald-500/15 text-white' : 'border-white/10 bg-white/5 text-gray-300'}`}
              >
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-[10px] leading-tight text-gray-400">{desc}</div>
              </button>
            ))}
          </div>
          {post === 'repair' && <div className="mt-1 text-[11px] text-gray-500">Fills blank corners &amp; stretched poles with AI, real furniture untouched. Faithful.</div>}
          {post === 'render' && <div className="mt-1 text-[11px] text-amber-300/80">AI re-draws the whole panorama from the stitch — fixes warps/seams, but may restyle real details.</div>}
        </div>

        {err && (
          <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
            {err}
            {log && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[10px] text-red-200/80">{log}</pre>}
          </div>
        )}
      </div>

      <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={addFiles} />

      <div className="sticky bottom-0 border-t border-white/10 bg-gray-950/90 p-4 backdrop-blur">
        <Button className="w-full" onClick={stitch} disabled={photos.length < 2}>
          🧩 Stitch (real, OpenCV) ({photos.length})
        </Button>
      </div>
    </Screen>
  );
}
