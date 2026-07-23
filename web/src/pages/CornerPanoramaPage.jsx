import { useRef, useState, useEffect } from 'react';
import { fileToPhotoDataURL } from '../lib/image.js';
import RoomViewer from '../components/RoomViewer.jsx';
import { TopBar, Screen, Button } from '../components/ui.jsx';

// Wall-based capture with a known layout: stand in the room center, take 2 photos of each
// wall (Front/Right/Back/Left), plus Ceiling, Floor and a Center shot. The model is told
// exactly what each photo is → a real layout map, so the stitch is far more faithful.
const WALLS = ['front', 'right', 'back', 'left']; // clockwise
const WALL_LABEL = { front: 'Front', right: 'Right', back: 'Back', left: 'Left' };
const WALL_FACE = {
  front: 'the wall in FRONT of you (far wall)',
  right: 'the wall on your RIGHT',
  back: 'the wall BEHIND you (near wall)',
  left: 'the wall on your LEFT',
};
const EXTRAS = ['ceiling', 'floor', 'center'];
const EXTRA_LABEL = { ceiling: 'Ceiling', floor: 'Floor', center: 'Center' };
const EXTRA_ROLE = {
  ceiling: 'the CEILING, looking straight up',
  floor: 'the FLOOR, looking straight down',
  center: 'a general reference view from the room CENTER',
};

// full ordered slot list: front1,front2,right1,right2,...,ceiling,floor,center
const SLOTS = [];
WALLS.forEach((w) => SLOTS.push(`${w}1`, `${w}2`));
EXTRAS.forEach((e) => SLOTS.push(e));

const emptySlots = () => Object.fromEntries(SLOTS.map((k) => [k, null]));

function roleLabel(key) {
  const m = key.match(/^(front|right|back|left)([12])$/);
  if (m) return `${WALL_FACE[m[1]]} — photo ${m[2]}`;
  return EXTRA_ROLE[key] || key;
}

function buildWallPrompt(room, present) {
  const imgLines = present.map((k, i) => `[Image ${i + 1}] = ${roleLabel(k)}.`).join('\n');
  const size = room.size.trim() || 'as shown in the photos';
  const flooring = room.flooring.trim() || 'as seen in the photos';
  const ceiling = room.ceiling.trim() || 'as seen in the photos';
  const walls = room.walls.trim() || 'as seen in the photos';
  return `INPUT IMAGES — ROOM LAYOUT MAP (all photos taken from the room center):

${imgLines}

ROOM TYPE: Small apartment room, approximately ${size}.
FLOORING: ${flooring}
CEILING: ${ceiling}
WALLS: ${walls}

TASK: Stitch these photos into ONE seamless 360° equirectangular panorama (2:1 aspect ratio).

STITCHING RULES:
1. Arrange the walls left-to-right in this exact clockwise order: FRONT → RIGHT → BACK → LEFT → back to FRONT.
2. Two photos of the SAME wall are different views of that one wall — merge them, do NOT duplicate the wall or its objects.
3. Adjacent walls meet at a smooth inside corner: FRONT–RIGHT, RIGHT–BACK, BACK–LEFT, LEFT–FRONT.
4. The CEILING photo fills the top of the panorama; the FLOOR photo fills the bottom.
5. The left edge of the panorama = the right edge (circular wrap).

CONTENT RULES:
- KEEP every visible object, furniture, pattern, color EXACTLY as shown in the source photos.
- Do NOT add, remove, or replace any furniture.
- Do NOT change patterns on fabrics, wallpapers, or surfaces.
- The room size and proportions must match reality — do not expand or compress.

INVENTION RULES (strict):
- ONLY fill genuinely unseen areas: gaps between adjacent walls, and any ceiling/floor region not covered by a photo.
- Invented areas must be a PLAIN continuation of the nearest visible surface.
- NEVER add new furniture, objects, or patterns in invented areas.
- If a wall is plain white in photos, the invented continuation is plain white.
- If flooring is light oak laminate, the invented floor is light oak laminate.

GEOMETRY:
- Equirectangular projection: walls curve naturally, verticals stay straight, horizon level.
- Top = ceiling, bottom = floor.
- Left and right edges wrap seamlessly.

PROCESS:
Step 1 — Identify matching features where adjacent walls meet (corners, door frames, furniture edges).
Step 2 — Align and stitch visible content preserving exact colors and patterns.
Step 3 — Fill only unseen gaps with plain surface continuation.
Step 4 — Verify left-right edge continuity and correct any mismatch.
Step 5 — Output final 2:1 equirectangular image. No text, no borders, no UI elements.`;
}

const STAGES = ['Uploading photos…', 'AI is stitching the 360° panorama…'];

export default function CornerPanoramaPage() {
  const fileInput = useRef(null);
  const picking = useRef(null); // which slot we're assigning a photo to
  const [slots, setSlots] = useState(emptySlots);
  const [room, setRoom] = useState({ size: '', flooring: '', ceiling: '', walls: '' });
  const [quality, setQuality] = useState('4K');
  const [prompt, setPrompt] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [phase, setPhase] = useState('pick');
  const [stage, setStage] = useState(0);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const present = SLOTS.filter((k) => slots[k]); // ordered list of filled slots
  const wallsReady = WALLS.every((w) => slots[`${w}1`] || slots[`${w}2`]);

  // keep the editable prompt in sync until the user edits it
  useEffect(() => {
    if (promptDirty) return;
    setPrompt(buildWallPrompt(room, present));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, promptDirty, slots]);

  useEffect(() => {
    if (phase !== 'working') return undefined;
    setStage(0);
    const t = setTimeout(() => setStage(1), 1200);
    return () => clearTimeout(t);
  }, [phase]);

  const pick = (k) => { picking.current = k; fileInput.current?.click(); };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    const k = picking.current;
    picking.current = null;
    if (!f || !k) return;
    const url = await fileToPhotoDataURL(f, 1600);
    setSlots((s) => ({ ...s, [k]: url }));
  };

  const create = async () => {
    if (!wallsReady) { setErr('Add at least one photo for each wall (Front, Right, Back, Left).'); return; }
    setErr('');
    setPhase('working');
    try {
      const images = present.map((k) => slots[k]); // strict layout order
      const r = await fetch('/api/panorama', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, resolution: quality, prompt }),
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

  // ---- result ----
  if (phase === 'done' && result) {
    return (
      <Screen>
        <TopBar
          title="Wall panorama"
          back="/panoramas"
          right={<a href={result.url} download="panorama.jpg" className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white">⬇ Download</a>}
        />
        <div className="flex flex-col items-center gap-3 p-4">
          <div className="mx-auto w-full max-w-[720px] overflow-hidden rounded-xl border border-white/10 bg-black" style={{ height: 'min(46vh, 360px)' }}>
            <RoomViewer room={{ panorama: result.url, dims: { w: 4, l: 5, h: 2.7 } }} />
          </div>
          <div className="flex w-full max-w-[760px] items-center justify-between">
            <span className="text-xs text-gray-400">Drag to look around. {result.cost != null ? `$${result.cost.toFixed(3)}` : ''}</span>
            <button onClick={reset} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white">Another one</button>
          </div>
          <a href={result.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 underline">Open the image at full size</a>
        </div>
      </Screen>
    );
  }

  // ---- working ----
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

  // ---- a single photo slot ----
  const Slot = ({ k, label }) => (
    <button
      onClick={() => pick(k)}
      className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border-2 ${
        slots[k] ? 'border-indigo-400' : 'border-dashed border-white/20'
      }`}
    >
      {slots[k] ? (
        <img src={slots[k]} alt={label} className="h-full w-full object-cover" />
      ) : (
        <span className="text-xl text-white/40">+</span>
      )}
      <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-semibold text-white">{label}</span>
      {slots[k] && (
        <span
          onClick={(e) => { e.stopPropagation(); setSlots((s) => ({ ...s, [k]: null })); }}
          className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] text-white"
        >✕</span>
      )}
    </button>
  );

  const Field = ({ k, label, ph }) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-400">{label}</span>
      <input
        value={room[k]}
        onChange={(e) => setRoom((r) => ({ ...r, [k]: e.target.value }))}
        placeholder={ph}
        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-indigo-400"
      />
    </label>
  );

  // ---- pick / error ----
  return (
    <Screen>
      <TopBar title="Panorama by walls" back="/panoramas" />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/5 p-3 text-sm text-gray-300">
          Stand in the middle of the room. Take <b>2 photos of each wall</b> (Front / Right / Back / Left), plus the
          <b> ceiling</b>, the <b>floor</b> and one <b>center</b> shot. Assign each below — the AI gets the full layout,
          so the stitch is far more faithful. Only each wall is required; the rest are optional.
        </div>

        {/* walls: 2 photos each */}
        <div className="flex flex-col gap-2">
          {WALLS.map((w) => (
            <div key={w} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-sm font-medium text-gray-300">{WALL_LABEL[w]}</span>
              <div className="grid w-full grid-cols-2 gap-2">
                <Slot k={`${w}1`} label="1" />
                <Slot k={`${w}2`} label="2" />
              </div>
            </div>
          ))}
        </div>

        {/* ceiling / floor / center */}
        <div className="grid grid-cols-3 gap-2">
          {EXTRAS.map((e) => <Slot key={e} k={e} label={EXTRA_LABEL[e]} />)}
        </div>
        <div className="text-xs text-gray-500">{present.length} photos {wallsReady ? '· ready' : '· fill every wall'}</div>

        {/* room description (optional, fills the prompt) */}
        <div className="grid grid-cols-2 gap-2">
          <Field k="size" label="Size" ph="3m × 4m" />
          <Field k="flooring" label="Flooring" ph="light oak laminate" />
          <Field k="ceiling" label="Ceiling" ph="white, with a light" />
          <Field k="walls" label="Walls" ph="beige paint" />
        </div>

        {/* quality */}
        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">Quality</div>
          <div className="grid grid-cols-3 gap-2">
            {[['1K', 'draft', '~$0.14'], ['2K', 'medium', '~$0.19'], ['4K', 'sharp', '~$0.25']].map(([q, label, price]) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={`rounded-lg border p-2 text-center ${quality === q ? 'border-indigo-400 bg-indigo-500/15 text-white' : 'border-white/10 bg-white/5 text-gray-300'}`}
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
          <button onClick={() => setShowPrompt((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-300">
            <span>AI prompt {promptDirty && <span className="text-indigo-400">(edited)</span>}</span>
            <span className="text-gray-500">{showPrompt ? '▲' : '▼'}</span>
          </button>
          {showPrompt && (
            <div className="border-t border-white/10 p-3">
              <textarea
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); setPromptDirty(true); }}
                rows={10}
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-white/10 bg-gray-950/60 p-2 font-mono text-xs text-gray-200 outline-none focus:border-indigo-400"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-gray-500">Built from the photos + room fields. Edit to steer the result.</span>
                {promptDirty && (
                  <button onClick={() => setPromptDirty(false)} className="rounded-md bg-white/10 px-2 py-1 text-xs text-gray-300">Reset to default</button>
                )}
              </div>
            </div>
          )}
        </div>

        {err && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{err}</div>}
      </div>

      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <div className="sticky bottom-0 border-t border-white/10 bg-gray-950/90 p-4 backdrop-blur">
        <Button className="w-full" onClick={create} disabled={!wallsReady}>
          ✨ Stitch panorama ({present.length} photos)
        </Button>
      </div>
    </Screen>
  );
}
