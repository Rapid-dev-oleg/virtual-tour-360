import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getTour, saveTour } from '../lib/store.js';
import { listPanoramas } from '../lib/panoramas.js';
import { fileToPanoramaDataURL } from '../lib/image.js';
import { TopBar, Button } from '../components/ui.jsx';
import SceneEditor from '../components/SceneEditor.jsx';

export default function EditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tour, setTour] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [placingTarget, setPlacingTarget] = useState(null);
  const [pickTarget, setPickTarget] = useState(false);
  const [busy, setBusy] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [lib, setLib] = useState([]);
  const fileInput = useRef(null);
  const saveSeq = useRef(0);

  const openLib = () => { listPanoramas().then(setLib); setLibOpen(true); };
  const addFromLib = (p) => {
    const sid = 's-' + Math.random().toString(36).slice(2, 8);
    update((t) => {
      t.scenes.push({ id: sid, name: p.name || `Point ${t.scenes.length + 1}`, panorama: p.url, links: [] });
      if (!t.startSceneId) t.startSceneId = sid;
      if (!t.cover) t.cover = p.url;
    });
    setSelectedId(sid);
    setLibOpen(false);
  };

  useEffect(() => {
    getTour(id).then((t) => {
      setTour(t);
      setSelectedId(t?.scenes?.[0]?.id || null);
      setLoaded(true);
    });
  }, [id]);

  const selected = useMemo(
    () => tour?.scenes?.find((s) => s.id === selectedId) || null,
    [tour, selectedId],
  );

  if (!loaded) return <div className="p-8 text-center text-gray-400">Loading…</div>;
  if (!tour) {
    return (
      <div className="p-8 text-center text-gray-400">
        Tour not found. <button onClick={() => nav('/')} className="text-indigo-400">Home</button>
      </div>
    );
  }

  // clone → mutate → persist to server (swap media → URLs only for the latest save)
  const update = (mutator) => {
    setTour((prev) => {
      const next = structuredClone(prev);
      mutator(next);
      const seq = ++saveSeq.current;
      saveTour(next).then((saved) => {
        if (!saved) { alert('Failed to save the tour on the server.'); return; }
        if (seq === saveSeq.current) setTour((cur) => (cur && cur.id === saved.id ? { ...saved } : cur));
      });
      return next;
    });
  };

  const addScene = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToPanoramaDataURL(file);
      const sid = 's-' + Math.random().toString(36).slice(2, 8);
      update((t) => {
        const scene = {
          id: sid,
          name: `Point ${t.scenes.length + 1}`,
          panorama: dataUrl,
          links: [],
        };
        t.scenes.push(scene);
        if (!t.startSceneId) t.startSceneId = sid;
        if (!t.cover) t.cover = dataUrl;
      });
      setSelectedId(sid);
    } catch {
      alert('Failed to process the photo. A 360° panorama (2:1 ratio) is required.');
    } finally {
      setBusy(false);
    }
  };

  const renameScene = (name) =>
    update((t) => {
      const s = t.scenes.find((x) => x.id === selectedId);
      if (s) s.name = name;
      // keep link labels in sync (labels pointing to this scene)
      t.scenes.forEach((sc) =>
        sc.links.forEach((l) => {
          if (l.nodeId === selectedId) l.label = name;
        }),
      );
    });

  const removeScene = () => {
    if (!confirm('Delete this point?')) return;
    update((t) => {
      t.scenes = t.scenes.filter((s) => s.id !== selectedId);
      t.scenes.forEach((s) => (s.links = s.links.filter((l) => l.nodeId !== selectedId)));
      if (t.startSceneId === selectedId) t.startSceneId = t.scenes[0]?.id || null;
      t.cover = t.scenes[0]?.panorama || null;
    });
    setSelectedId((prev) => {
      const rest = tour.scenes.filter((s) => s.id !== prev);
      return rest[0]?.id || null;
    });
  };

  const startPlacing = (targetId) => {
    setPickTarget(false);
    setPlacingTarget(targetId);
  };

  const onPlace = (position) => {
    const target = tour.scenes.find((s) => s.id === placingTarget);
    update((t) => {
      const s = t.scenes.find((x) => x.id === selectedId);
      if (s) s.links.push({ nodeId: placingTarget, position, label: target?.name || '→' });
    });
    setPlacingTarget(null);
  };

  const removeLink = (nodeId) =>
    update((t) => {
      const s = t.scenes.find((x) => x.id === selectedId);
      if (s) s.links = s.links.filter((l) => l.nodeId !== nodeId);
    });

  const setStart = () => update((t) => (t.startSceneId = selectedId));

  const otherScenes = tour.scenes.filter((s) => s.id !== selectedId);
  const linkedIds = new Set((selected?.links || []).map((l) => l.nodeId));

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col">
      <TopBar
        title={tour.name}
        back="/"
        right={
          <button
            onClick={() => nav(`/t/${tour.id}`)}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white"
          >
            View
          </button>
        }
      />

      {/* preview */}
      <div className="relative h-[46vh] w-full bg-gray-900">
        {selected ? (
          <SceneEditor
            key={selected.id}
            scene={selected}
            sceneName={selected.name}
            placing={!!placingTarget}
            onPlace={onPlace}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-gray-400">
            <div className="text-4xl">🖼</div>
            <p>Add your first point — a panorama from the library</p>
            <div className="flex gap-2">
              <Button onClick={openLib}>📚 From library</Button>
              <Button variant="ghost" onClick={() => fileInput.current?.click()}>Upload file</Button>
            </div>
          </div>
        )}
        {placingTarget && (
          <button
            onClick={() => setPlacingTarget(null)}
            className="absolute bottom-3 right-3 z-10 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white"
          >
            Cancel
          </button>
        )}
      </div>

      {/* scenes strip */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {tour.scenes.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 ${
              s.id === selectedId ? 'border-indigo-400' : 'border-transparent'
            }`}
          >
            <img src={s.panorama} alt="" className="h-full w-full object-cover" />
            {t_isStart(tour, s.id) && (
              <span className="absolute left-1 top-1 rounded bg-indigo-500 px-1 text-[10px] font-bold text-white">
                start
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-[10px] text-white">
              {s.name}
            </span>
          </button>
        ))}
        <button
          onClick={openLib}
          className="flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-lg border-2 border-white/20 bg-white/5 text-gray-200"
        >
          <span className="text-xl leading-none">📚</span>
          <span className="text-[10px]">from library</span>
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed border-white/20 text-gray-400 disabled:opacity-50"
        >
          {busy ? '…' : <span className="text-2xl leading-none">+</span>}
          <span className="text-[10px]">{busy ? 'processing' : 'file'}</span>
        </button>
      </div>

      {/* selected scene controls */}
      {selected && (
        <div className="flex flex-col gap-4 border-t border-white/10 p-4">
          <div>
            <label className="mb-1 block text-xs text-gray-400">Point name</label>
            <input
              value={selected.name}
              onChange={(e) => renameScene(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-indigo-400"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-gray-400">Links from here</span>
              <button
                onClick={() => setPickTarget((v) => !v)}
                disabled={otherScenes.length === 0}
                className="text-xs font-semibold text-indigo-400 disabled:text-gray-600"
              >
                + Link
              </button>
            </div>

            {pickTarget && (
              <div className="mb-2 flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 p-2">
                <div className="px-1 pb-1 text-[11px] text-gray-500">Where does the link lead?</div>
                {otherScenes.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => startPlacing(s.id)}
                    className="rounded-md px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                  >
                    {s.name}
                    {linkedIds.has(s.id) && <span className="ml-2 text-[11px] text-gray-500">(already added)</span>}
                  </button>
                ))}
              </div>
            )}

            {selected.links.length === 0 ? (
              <p className="text-xs text-gray-500">None yet. Tap "+ Link" and mark a spot on the panorama.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {selected.links.map((l) => (
                  <div
                    key={l.nodeId}
                    className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm"
                  >
                    <span className="text-gray-200">→ {l.label || nameOf(tour, l.nodeId)}</span>
                    <button onClick={() => removeLink(l.nodeId)} className="text-red-300">
                      delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={setStart}
              disabled={t_isStart(tour, selected.id)}
            >
              {t_isStart(tour, selected.id) ? '✓ Start point' : 'Set as start'}
            </Button>
            <Button variant="danger" onClick={removeScene}>
              Delete point
            </Button>
          </div>
        </div>
      )}

      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={addScene} />

      <div className="sticky bottom-0 mt-auto border-t border-white/10 bg-gray-950/90 p-4 backdrop-blur">
        <Button className="w-full" onClick={() => nav(`/t/${tour.id}`)} disabled={!tour.scenes.length}>
          View tour
        </Button>
      </div>

      {libOpen && (
        <div className="fixed inset-0 z-30 flex flex-col bg-black/80 p-4" onClick={() => setLibOpen(false)}>
          <div
            className="mx-auto flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 p-3">
              <span className="font-semibold text-white">Choose a panorama</span>
              <button onClick={() => setLibOpen(false)} className="px-2 text-gray-400">✕</button>
            </div>
            <div className="overflow-y-auto p-3">
              {lib.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">
                  No saved panoramas.
                  <button onClick={() => nav('/panorama')} className="mt-2 block w-full text-indigo-400">
                    Create panorama
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {lib.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addFromLib(p)}
                      className="overflow-hidden rounded-lg border border-white/10 text-left"
                    >
                      <img src={p.url} alt="" className="aspect-[2/1] w-full object-cover" />
                      <div className="truncate px-2 py-1 text-xs text-gray-200">{p.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function t_isStart(tour, id) {
  return tour.startSceneId === id;
}
function nameOf(tour, id) {
  return tour.scenes.find((s) => s.id === id)?.name || '→';
}
