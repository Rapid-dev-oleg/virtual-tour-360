import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fileToPhotoDataURL } from '../lib/image.js';
import RoomViewer from '../components/RoomViewer.jsx';
import { TopBar, Screen, Button } from '../components/ui.jsx';

const MAX = 16;
const STAGES = [
  'Uploading photos…',
  'AI is building the 360° panorama…',
];

export default function PanoramaPage() {
  const nav = useNavigate();
  const fileInput = useRef(null);
  const [photos, setPhotos] = useState([]); // data URLs, in order
  const [quality, setQuality] = useState('4K'); // 1K | 2K | 4K
  const [phase, setPhase] = useState('pick'); // pick | working | done | error
  const [stage, setStage] = useState(0);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null); // { url, cost }
  const dragFrom = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const [prompt, setPrompt] = useState(''); // the instruction sent to the AI (editable)
  const [promptDirty, setPromptDirty] = useState(false); // user edited it → stop auto-syncing
  const [showPrompt, setShowPrompt] = useState(false);
  const [models, setModels] = useState([]); // OpenRouter image models for the dropdown
  const [model, setModel] = useState('google/gemini-3-pro-image'); // current default

  useEffect(() => {
    fetch('/api/image-models').then((r) => r.json()).then((m) => { if (Array.isArray(m) && m.length) setModels(m); }).catch(() => {});
  }, []);

  // advance the progress message while working (single request, staged UX)
  useEffect(() => {
    if (phase !== 'working') return undefined;
    setStage(0);
    const t1 = setTimeout(() => setStage(1), 1200);
    return () => { clearTimeout(t1); };
  }, [phase]);

  // keep the editable prompt in sync with the default for the current photo count,
  // until the user edits it manually
  useEffect(() => {
    if (promptDirty) return undefined;
    const n = Math.max(2, photos.length);
    let alive = true;
    fetch(`/api/panorama/prompt?n=${n}`)
      .then((r) => r.json())
      .then((j) => { if (alive && j?.prompt) setPrompt(j.prompt); })
      .catch(() => {});
    return () => { alive = false; };
  }, [photos.length, promptDirty]);

  const resetPrompt = () => { setPromptDirty(false); };

  const addFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const room = MAX - photos.length;
    const take = files.slice(0, room);
    const urls = await Promise.all(take.map((f) => fileToPhotoDataURL(f, 1600)));
    setPhotos((p) => [...p, ...urls]);
  };
  const removeAt = (i) => setPhotos((p) => p.filter((_, k) => k !== i));
  const move = (i, d) => setPhotos((p) => {
    const j = i + d;
    if (j < 0 || j >= p.length) return p;
    const n = [...p];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  // drag-and-drop reorder (order of `photos` === order sent to OpenRouter)
  const reorder = (from, to) => setPhotos((p) => {
    if (from == null || to == null || from === to || from < 0 || to < 0) return p;
    const n = [...p];
    const [it] = n.splice(from, 1);
    n.splice(to, 0, it);
    return n;
  });

  const create = async () => {
    if (photos.length < 2) { setErr('At least 2 photos are required'); return; }
    setErr('');
    setPhase('working');
    try {
      const r = await fetch('/api/panorama', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: photos, resolution: quality, model, ...(prompt.trim() ? { prompt } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `error ${r.status}`);
      setResult(j);
      setPhase('done');
    } catch (e) {
      setErr(String(e.message || e));
      setPhase('error');
    }
  };

  const reset = () => { setResult(null); setPhase('pick'); };

  // ---- result view ----
  if (phase === 'done' && result) {
    return (
      <Screen>
        <TopBar
          title="Panorama"
          back="/panoramas"
          right={
            <a
              href={result.url}
              download="panorama.jpg"
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white"
            >
              ⬇ Download
            </a>
          }
        />
        <div className="flex flex-col items-center gap-3 p-4">
          {/* compact viewer: not fullscreen, ≤760px, 2:1 aspect ratio */}
          <div
            className="mx-auto w-full max-w-[720px] overflow-hidden rounded-xl border border-white/10 bg-black"
            style={{ height: 'min(46vh, 360px)' }}
          >
            <RoomViewer room={{ panorama: result.url, dims: { w: 4, l: 5, h: 2.7 } }} />
          </div>
          <div className="w-full max-w-[760px] text-xs text-gray-400">
            Drag to look around. {result.model ? `Model: ${result.model.split('/').pop()}. ` : ''}{result.cost != null ? `$${result.cost.toFixed(3)}` : ''}
          </div>

          {/* regenerate on the SAME photos with a (possibly different) model */}
          <div className="flex w-full max-w-[760px] flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-sm font-medium text-gray-300">Regenerate — same photos, pick a model</div>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-gray-950/60 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400"
            >
              {(models.length ? models : [{ id: model, name: model }]).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button onClick={create} className="flex-1 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white">🔄 Regenerate</button>
              <button onClick={reset} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white">New photos</button>
            </div>
          </div>

          <a href={result.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 underline">
            Open the image at full size
          </a>
        </div>
      </Screen>
    );
  }

  // ---- working (progress) ----
  if (phase === 'working') {
    return (
      <Screen>
        <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-white/15 border-t-indigo-400" />
          <div>
            <div className="text-lg font-semibold text-white">{STAGES[stage]}</div>
            <div className="mt-2 text-sm text-gray-400">Usually 30–60 seconds. Don't close the page.</div>
          </div>
          <div className="flex gap-1.5">
            {STAGES.map((_, i) => (
              <div key={i} className={`h-1.5 w-10 rounded-full ${i <= stage ? 'bg-indigo-400' : 'bg-white/15'}`} />
            ))}
          </div>
        </div>
      </Screen>
    );
  }

  // ---- pick / error ----
  return (
    <Screen>
      <TopBar title="Panorama from photos" back="/panoramas" />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/5 p-3 text-sm text-gray-300">
          Upload <b>2–16 photos</b> of one room (wide angle, from the corners or while turning, with
          overlap). The AI will build a 360° sphere. Delivered exactly as is, without post-processing.
          <div className="mt-1 text-xs text-gray-500">Photo order = around the room. Use ◀ ▶ to reorder. Sharp shots = better result.</div>
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
              className={`relative cursor-move overflow-hidden rounded-lg ${dragOver === i ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <img src={src} alt="" draggable={false} className="aspect-square w-full object-cover" />
              <div className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white">{i + 1}</div>
              <button
                onClick={() => removeAt(i)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white"
              >✕</button>
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-3">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white disabled:opacity-30"
                >◀</button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === photos.length - 1}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white disabled:opacity-30"
                >▶</button>
              </div>
            </div>
          ))}
          {photos.length < MAX && (
            <button
              onClick={() => fileInput.current?.click()}
              className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-white/20 text-3xl text-white/40"
            >+</button>
          )}
        </div>
        <div className="text-xs text-gray-500">{photos.length}/{MAX} photos</div>

        {/* model */}
        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">Model</div>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400"
          >
            {(models.length ? models : [{ id: model, name: model }]).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        {/* quality */}
        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">Quality</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['1K', 'draft', '~$0.14'],
              ['2K', 'medium', '~$0.19'],
              ['4K', 'sharp', '~$0.25'],
            ].map(([q, label, price]) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={`rounded-lg border p-2 text-center ${
                  quality === q ? 'border-indigo-400 bg-indigo-500/15 text-white' : 'border-white/10 bg-white/5 text-gray-300'
                }`}
              >
                <div className="text-sm font-semibold">{q}</div>
                <div className="text-[11px] text-gray-400">{label}</div>
                <div className="text-[11px] text-gray-500">{price}</div>
              </button>
            ))}
          </div>
        </div>

        {/* editable AI prompt */}
        <div className="rounded-xl border border-white/10 bg-white/5">
          <button
            onClick={() => setShowPrompt((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-300"
          >
            <span>AI prompt {promptDirty && <span className="text-indigo-400">(edited)</span>}</span>
            <span className="text-gray-500">{showPrompt ? '▲' : '▼'}</span>
          </button>
          {showPrompt && (
            <div className="border-t border-white/10 p-3">
              <textarea
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); setPromptDirty(true); }}
                rows={8}
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-white/10 bg-gray-950/60 p-2 font-mono text-xs text-gray-200 outline-none focus:border-indigo-400"
                placeholder="Instruction sent to the AI…"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-gray-500">
                  This exact text is sent to the model. Edit to steer the result.
                </span>
                {promptDirty && (
                  <button onClick={resetPrompt} className="rounded-md bg-white/10 px-2 py-1 text-xs text-gray-300">
                    Reset to default
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {err && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{err}</div>}
      </div>

      <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={addFiles} />

      <div className="sticky bottom-0 border-t border-white/10 bg-gray-950/90 p-4 backdrop-blur">
        <Button className="w-full" onClick={create} disabled={photos.length < 2}>
          ✨ Create 360° panorama ({photos.length})
        </Button>
      </div>
    </Screen>
  );
}
