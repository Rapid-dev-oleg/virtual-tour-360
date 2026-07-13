import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listTours, deleteTour } from '../lib/store.js';
import { Screen, Button } from '../components/ui.jsx';

export default function HomePage() {
  const nav = useNavigate();
  const [tours, setTours] = useState(listTours());

  const remove = (id) => {
    if (!confirm('Удалить тур?')) return;
    deleteTour(id);
    setTours(listTours());
  };

  return (
    <Screen>
      <div className="px-5 pb-4 pt-8">
        <div className="text-sm font-medium text-indigo-400">360° Туры</div>
        <h1 className="mt-1 text-2xl font-bold text-white">Мои туры</h1>
        <p className="mt-1 text-sm text-gray-400">
          Виртуальные туры по квартире. Снимай на смартфон — без спецоборудования.
        </p>
      </div>

      <div className="flex flex-col gap-3 px-5">
        {tours.map((t) => (
          <div
            key={t.id}
            className="overflow-hidden rounded-2xl border border-white/10 bg-white/5"
          >
            <Link to={`/t/${t.id}`} className="block">
              <div className="relative aspect-[16/10] w-full bg-gray-800">
                {t.cover ? (
                  <img src={t.cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-gray-500">
                    без превью
                  </div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
                  {t.type === 'video' ? '🎬 Видео' : '🖼 Панорамы'}
                </span>
                {t.seed && (
                  <span className="absolute right-3 top-3 rounded-full bg-indigo-500/90 px-2.5 py-1 text-xs font-semibold text-white">
                    демо
                  </span>
                )}
              </div>
            </Link>
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-white">{t.name}</div>
                <div className="text-xs text-gray-400">
                  {t.type === 'video'
                    ? 'видео-проходка'
                    : `${t.scenes?.length || 0} точек`}
                </div>
              </div>
              {!t.seed && (
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => nav(`/tour/${t.id}/edit`)}
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
