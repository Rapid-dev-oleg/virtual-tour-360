import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPanoramas, deletePanorama } from '../lib/panoramas.js';
import RoomViewer from '../components/RoomViewer.jsx';
import { TopBar, Screen, Button } from '../components/ui.jsx';

export default function PanoramasPage() {
  const nav = useNavigate();
  const [items, setItems] = useState(null); // null = loading
  const [view, setView] = useState(null); // panorama being viewed

  const load = () => listPanoramas().then(setItems);
  useEffect(() => { load(); }, []);

  const remove = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Delete panorama? It will also be removed from any tours that use it.')) return;
    await deletePanorama(id);
    load();
  };

  // ---- fullscreen-ish viewer for one panorama ----
  if (view) {
    return (
      <Screen>
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/10 bg-gray-950/80 px-4 py-3 backdrop-blur">
          <button onClick={() => setView(null)} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white">← Back</button>
          <span className="min-w-0 truncate text-sm font-semibold text-white">{view.name}</span>
          <a href={view.url} download={`${view.name}.jpg`} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white">⬇ Download</a>
        </header>
        <div className="flex flex-col items-center gap-2 p-4">
          <div className="mx-auto w-full max-w-[720px] overflow-hidden rounded-xl border border-white/10 bg-black" style={{ height: 'min(46vh, 360px)' }}>
            <RoomViewer room={{ panorama: view.url, dims: { w: 4, l: 5, h: 2.7 } }} />
          </div>
          <span className="text-xs text-gray-500">Drag to look around · {view.resolution || ''}</span>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="My panoramas" back="/" />
      <div className="flex flex-col gap-4 p-4">
        {items === null ? (
          <div className="p-8 text-center text-gray-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-gray-400">
            <div className="text-5xl">🖼️</div>
            <p className="text-sm">No panoramas yet.<br />Create your first one from room photos.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {items.map((p) => (
              <button
                key={p.id}
                onClick={() => setView(p)}
                className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 text-left"
              >
                <img src={p.url} alt="" className="aspect-[2/1] w-full object-cover" />
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span className="truncate text-xs text-gray-200">{p.name}</span>
                  <span className="shrink-0 text-[10px] text-gray-500">{p.resolution || ''}</span>
                </div>
                <span
                  onClick={(e) => remove(p.id, e)}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-xs text-white"
                >
                  🗑
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 mt-auto flex gap-2 border-t border-white/10 bg-gray-950/90 p-4 backdrop-blur">
        <Button className="flex-1" onClick={() => nav('/panorama')}>
          ✨ AI panorama
        </Button>
        <Button className="flex-1" onClick={() => nav('/panorama/stitch')}>
          🧩 Real stitch
        </Button>
      </div>
    </Screen>
  );
}
