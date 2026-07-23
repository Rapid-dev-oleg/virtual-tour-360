import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listTours, deleteTour } from '../lib/store.js';
import { listVideoTours } from '../lib/api.js';
import { Screen, Button } from '../components/ui.jsx';

const STATUS_LABEL = {
  uploading: 'uploading…',
  queued: 'queued…',
  processing: 'processing…',
  ready: 'ready',
  failed: 'failed',
  expired: 'expired',
};

export default function HomePage() {
  const nav = useNavigate();
  const [local, setLocal] = useState([]);
  const [server, setServer] = useState([]);

  useEffect(() => {
    listTours().then(setLocal);
    listVideoTours().then((t) => setServer(t.map((x) => ({ ...x, remote: true }))));
  }, []);

  const remove = async (id) => {
    if (!confirm('Delete tour?')) return;
    await deleteTour(id);
    setLocal(await listTours());
  };

  const tours = [...server, ...local];

  const badge = (t) =>
    t.type === 'splat'
      ? '🧊 3D from video'
      : t.type === 'video'
        ? '🎬 Video'
        : t.type === 'room'
          ? '🧱 Room'
          : '🖼 Panoramas';
  const subtitle = (t) =>
    t.type === 'splat'
      ? STATUS_LABEL[t.status] || '3D tour'
      : t.type === 'video'
        ? 'video walkthrough'
        : t.type === 'room'
          ? 'volume by dimensions'
          : `${t.scenes?.length || 0} points`;

  return (
    <Screen>
      <div className="px-5 pb-4 pt-8">
        <div className="text-sm font-medium text-indigo-400">360° Tours</div>
        <h1 className="mt-1 text-2xl font-bold text-white">My tours</h1>
        <p className="mt-1 text-sm text-gray-400">
          A 3D tour from video or a panoramic one — from your phone, no special gear.
        </p>
      </div>

      {/* two stages: panorama library + tours */}
      <div className="grid grid-cols-2 gap-3 px-5 pb-3">
        <button
          onClick={() => nav('/panoramas')}
          className="flex flex-col items-start gap-1 rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10"
        >
          <span className="text-2xl">🖼️</span>
          <span className="font-semibold text-white">My panoramas</span>
          <span className="text-xs text-gray-400">create / pick a 360</span>
        </button>
        <button
          onClick={() => nav('/create')}
          className="flex flex-col items-start gap-1 rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10"
        >
          <span className="text-2xl">🧭</span>
          <span className="font-semibold text-white">Create tour</span>
          <span className="text-xs text-gray-400">from panoramas / video</span>
        </button>
      </div>

      <div className="flex flex-col gap-3 px-5">
        {tours.map((t) => (
          <div key={t.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <Link to={`/t/${t.id}`} className="block">
              <div className="relative flex aspect-[16/10] w-full items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                {t.cover ? (
                  <img src={t.cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-4xl opacity-60">{t.type === 'splat' ? '🧊' : '🖼'}</div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
                  {badge(t)}
                </span>
                {t.seed && (
                  <span className="absolute right-3 top-3 rounded-full bg-indigo-500/90 px-2.5 py-1 text-xs font-semibold text-white">
                    demo
                  </span>
                )}
                {t.type === 'splat' && t.status !== 'ready' && (
                  <span className="absolute right-3 top-3 rounded-full bg-amber-500/90 px-2.5 py-1 text-xs font-semibold text-white">
                    {STATUS_LABEL[t.status] || '…'}
                  </span>
                )}
              </div>
            </Link>
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-white">{t.name}</div>
                <div className="text-xs text-gray-400">{subtitle(t)}</div>
              </div>
              {!t.seed && !t.remote && (
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => nav(`/tour/${t.id}/${t.type === 'room' ? 'room' : 'edit'}`)}
                    className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => remove(t.id)}
                    className="rounded-lg px-2 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10"
                  >
                    🗑
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 mt-4 border-t border-white/10 bg-gray-950/90 p-4 backdrop-blur">
        <Button className="w-full" onClick={() => nav('/create')}>
          + Create tour
        </Button>
      </div>
    </Screen>
  );
}
