import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getTour, saveTour } from '../lib/store.js';
import { fileToPhotoDataURL, fileToPanoramaDataURL } from '../lib/image.js';
import { stitchRoom, countPhotoPlanes } from '../lib/panoStitch.js';
import { TopBar, Button } from '../components/ui.jsx';

const PLANES = {
  ceiling: 'Ceiling',
  left: 'Left wall',
  front: 'Front wall',
  right: 'Right wall',
  back: 'Back wall',
  floor: 'Floor',
};

function ensureRoom(t) {
  if (!t.dims) t.dims = { w: 4, l: 5, h: 2.7 };
  if (!t.planes) t.planes = { front: [], back: [], left: [], right: [], floor: [], ceiling: [] };
}

export default function RoomEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tour, setTour] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState('front');
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState(null); // { state:'run'|'ok'|'err', msg }
  const fileInput = useRef(null);
  const panoInput = useRef(null);
  const saveSeq = useRef(0);

  useEffect(() => {
    getTour(id).then((t) => {
      if (t) ensureRoom(t);
      setTour(t);
      setLoaded(true);
    });
  }, [id]);

  if (!loaded) return <div className="p-8 text-center text-gray-400">Loading…</div>;
  if (!tour) {
    return (
      <div className="p-8 text-center text-gray-400">
        Tour not found. <button onClick={() => nav('/')} className="text-indigo-400">Home</button>
      </div>
    );
  }

  // persist to server; swap local data-URL media → server URLs (only for the latest save → no races)
  const persist = (next) => {
    const seq = ++saveSeq.current;
    saveTour(next).then((saved) => {
      if (!saved) { alert('Failed to save the tour on the server.'); return; }
      if (seq === saveSeq.current) setTour((cur) => (cur && cur.id === saved.id ? { ...saved } : cur));
    });
  };

  const update = (mutator) => {
    setTour((prev) => {
      const next = structuredClone(prev);
      ensureRoom(next);
      mutator(next);
      persist(next);
      return next;
    });
  };

  const setDim = (k, v) => update((t) => (t.dims[k] = Math.max(0.5, Number(v) || 0)));

  const addPhotos = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const urls = await Promise.all(files.map((f) => fileToPhotoDataURL(f)));
      update((t) => {
        t.planes[sel].push(...urls);
        if (!t.cover) t.cover = urls[0];
      });
    } catch {
      alert('Failed to process the photo.');
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = (i) =>
    update((t) => {
      t.planes[sel].splice(i, 1);
    });

  const addPano = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const url = await fileToPanoramaDataURL(file, 4096);
      update((t) => {
        t.panorama = url;
        if (!t.cover) t.cover = url;
      });
    } catch {
      alert('Failed to process the panorama.');
    } finally {
      setBusy(false);
    }
  };
  const removePano = () => update((t) => delete t.panorama);

  const stitchAI = async () => {
    if (busy) return;
    setBusy(true);
    setAi({ state: 'run', msg: 'AI is building a 360° from the wall photos… (~30 s)' });
    try {
      const { image, cost } = await stitchRoom(tour);
      update((t) => {
        t.panorama = image;
        t.cover = image;
      });
      setAi({ state: 'ok', msg: `Done! Stitched into 360°${cost != null ? ` · $${cost.toFixed(3)}` : ''}` });
    } catch (e) {
      setAi({ state: 'err', msg: `Failed: ${String(e.message || e)}` });
    } finally {
      setBusy(false);
    }
  };

  const count = (k) => tour.planes[k]?.length || 0;
  const totalPhotos = Object.keys(PLANES).reduce((s, k) => s + count(k), 0);
  const canView = totalPhotos > 0 || !!tour.panorama;
  const photoPlanes = countPhotoPlanes(tour);

  const PlaneCell = ({ k }) => (
    <button
      onClick={() => setSel(k)}
      className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border p-2 text-center text-xs ${
        sel === k ? 'border-indigo-400 bg-indigo-500/15 text-white' : 'border-white/10 bg-white/5 text-gray-300'
      }`}
    >
      <span className="leading-tight">{PLANES[k]}</span>
      <span className={count(k) ? 'text-indigo-300' : 'text-gray-500'}>{count(k)} photos</span>
    </button>
  );

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col">
      <TopBar
        title={tour.name}
        back="/"
        right={
          <button
            onClick={() => nav(`/t/${tour.id}`)}
            disabled={!canView}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            View
          </button>
        }
      />

      <div className="flex flex-col gap-5 p-4">
        {/* dimensions */}
        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">Room dimensions, m</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['w', 'Width'],
              ['l', 'Length'],
              ['h', 'Height'],
            ].map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1 text-xs text-gray-400">
                {label}
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  value={tour.dims[k]}
                  onChange={(e) => setDim(k, e.target.value)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-base text-white outline-none focus:border-indigo-400"
                />
              </label>
            ))}
          </div>
        </div>

        {/* panorama projection (Yandex-like) */}
        <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/5 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">360° panorama → onto box</span>
            {tour.panorama ? (
              <button onClick={removePano} className="text-xs font-semibold text-red-300">
                remove
              </button>
            ) : (
              <button
                onClick={() => panoInput.current?.click()}
                disabled={busy}
                className="text-xs font-semibold text-indigo-300 disabled:opacity-50"
              >
                {busy ? 'processing…' : '+ Panorama'}
              </button>
            )}
          </div>
          {tour.panorama ? (
            <div className="flex items-center gap-3">
              <img src={tour.panorama} alt="" className="h-12 w-24 rounded object-cover" />
              <span className="text-xs text-emerald-300">
                projection on — adds depth from a single panorama
              </span>
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">
              A single 360° panorama (2:1) from the center of the room is projected onto the walls/floor/ceiling →
              parallax appears. If set, it is used instead of the per-plane photos.
            </p>
          )}

          {/* AI stitch: build a seamless 360 from the per-wall photos */}
          {photoPlanes > 0 && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <button
                onClick={stitchAI}
                disabled={busy}
                className="w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {ai?.state === 'run' ? '✨ Stitching…' : '✨ Stitch into 360° (AI)'}
              </button>
              <p className="mt-1 text-[11px] text-gray-400">
                Sends photos from {photoPlanes} plane{photoPlanes === 1 ? '' : 's'} in one job — the AI builds a
                seamless 360° of the room and fills in the ceiling/floor/corners. ~$0.14 per stitch. The AI may invent details.
              </p>
              {ai && (
                <p
                  className={`mt-1 text-[11px] ${
                    ai.state === 'ok' ? 'text-emerald-300' : ai.state === 'err' ? 'text-red-300' : 'text-indigo-300'
                  }`}
                >
                  {ai.msg}
                </p>
              )}
            </div>
          )}
        </div>

        {/* box net */}
        <div className={tour.panorama ? 'opacity-50' : ''}>
          <div className="mb-2 text-sm font-medium text-gray-300">Planes (box unfolded)</div>
          <div className="grid grid-cols-4 gap-2">
            <div />
            <PlaneCell k="ceiling" />
            <div />
            <div />
            <PlaneCell k="left" />
            <PlaneCell k="front" />
            <PlaneCell k="right" />
            <PlaneCell k="back" />
            <div />
            <PlaneCell k="floor" />
            <div />
            <div />
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Tap a plane → add photos of that wall/floor/ceiling. You can add several photos per plane.
          </p>
        </div>

        {/* selected plane photos */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-white">{PLANES[sel]}</span>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="text-sm font-semibold text-indigo-400 disabled:opacity-50"
            >
              {busy ? 'processing…' : '+ Photo'}
            </button>
          </div>
          {count(sel) === 0 ? (
            <p className="text-xs text-gray-500">No photos yet. Tap "+ Photo".</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {tour.planes[sel].map((src, i) => (
                <div key={i} className="relative overflow-hidden rounded-lg">
                  <img src={src} alt="" className="aspect-square w-full object-cover" />
                  <button
                    onClick={() => removePhoto(i)}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={addPhotos}
      />
      <input
        ref={panoInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={addPano}
      />

      <div className="sticky bottom-0 mt-auto border-t border-white/10 bg-gray-950/90 p-4 backdrop-blur">
        <Button className="w-full" onClick={() => nav(`/t/${tour.id}`)} disabled={!canView}>
          View 3D room
        </Button>
      </div>
    </div>
  );
}
