import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listTours, deleteTour } from '../lib/store.js';
import { listVideoTours } from '../lib/api.js';
import { Screen, Button } from '../components/ui.jsx';

const STATUS_LABEL = {
  uploading: 'загрузка…',
  queued: 'в очереди…',
  processing: 'считается…',
  ready: 'готов',
  failed: 'ошибка',
  expired: 'истёк',
};

export default function HomePage() {
  const nav = useNavigate();
  const [local, setLocal] = useState(listTours());
  const [server, setServer] = useState([]);

  useEffect(() => {
    listVideoTours().then((t) => setServer(t.map((x) => ({ ...x, remote: true }))));
  }, []);

  const remove = (id) => {
    if (!confirm('Удалить тур?')) return;
    deleteTour(id);
    setLocal(listTours());
  };

  const tours = [...server, ...local];

  const badge = (t) =>
    t.type === 'splat'
      ? '🧊 3D из видео'
      : t.type === 'video'
        ? '🎬 Видео'
        : t.type === 'room'
          ? '🧱 Комната'
          : '🖼 Панорамы';
  const subtitle = (t) =>
    t.type === 'splat'
      ? STATUS_LABEL[t.status] || '3D-тур'
      : t.type === 'video'
        ? 'видео-проходка'
        : t.type === 'room'
          ? 'объём по размерам'
          : `${t.scenes?.length || 0} точек`;

  return (
    <Screen>
      <div className="px-5 pb-4 pt-8">
        <div className="text-sm font-medium text-indigo-400">360° Туры</div>
        <h1 className="mt-1 text-2xl font-bold text-white">Мои туры</h1>
        <p className="mt-1 text-sm text-gray-400">
          3D-тур из видео или панорамный — со смартфона, без спецоборудования.
        </p>
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
                    демо
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
          + Создать тур
        </Button>
      </div>
    </Screen>
  );
}
