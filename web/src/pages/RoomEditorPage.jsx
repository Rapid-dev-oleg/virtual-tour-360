import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getTour, saveTour } from '../lib/store.js';
import { fileToPhotoDataURL } from '../lib/image.js';
import { TopBar, Button } from '../components/ui.jsx';

const PLANES = {
  ceiling: 'Потолок',
  left: 'Левая стена',
  front: 'Передняя стена',
  right: 'Правая стена',
  back: 'Задняя стена',
  floor: 'Пол',
};

function ensureRoom(t) {
  if (!t.dims) t.dims = { w: 4, l: 5, h: 2.7 };
  if (!t.planes) t.planes = { front: [], back: [], left: [], right: [], floor: [], ceiling: [] };
}

export default function RoomEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tour, setTour] = useState(() => {
    const t = getTour(id);
    if (t) ensureRoom(t);
    return t;
  });
  const [sel, setSel] = useState('front');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  if (!tour) {
    return (
      <div className="p-8 text-center text-gray-400">
        Тур не найден. <button onClick={() => nav('/')} className="text-indigo-400">На главную</button>
      </div>
    );
  }

  const update = (mutator) => {
    setTour((prev) => {
      const next = structuredClone(prev);
      ensureRoom(next);
      mutator(next);
      if (!saveTour(next))
        alert('Хранилище браузера переполнено. Уменьшите число/размер фото.');
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
      alert('Не удалось обработать фото.');
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = (i) =>
    update((t) => {
      t.planes[sel].splice(i, 1);
    });

  const count = (k) => tour.planes[k]?.length || 0;
  const totalPhotos = Object.keys(PLANES).reduce((s, k) => s + count(k), 0);

  const PlaneCell = ({ k }) => (
    <button
      onClick={() => setSel(k)}
      className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border p-2 text-center text-xs ${
        sel === k ? 'border-indigo-400 bg-indigo-500/15 text-white' : 'border-white/10 bg-white/5 text-gray-300'
      }`}
    >
      <span className="leading-tight">{PLANES[k]}</span>
      <span className={count(k) ? 'text-indigo-300' : 'text-gray-500'}>{count(k)} фото</span>
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
            disabled={totalPhotos === 0}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Смотреть
          </button>
        }
      />

      <div className="flex flex-col gap-5 p-4">
        {/* dimensions */}
        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">Размеры комнаты, м</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['w', 'Ширина'],
              ['l', 'Длина'],
              ['h', 'Высота'],
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

        {/* box net */}
        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">Плоскости (развёртка коробки)</div>
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
            Нажми плоскость → добавь фото этой стены/пола/потолка. Можно несколько фото на плоскость.
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
              {busy ? 'обработка…' : '+ Фото'}
            </button>
          </div>
          {count(sel) === 0 ? (
            <p className="text-xs text-gray-500">Пока нет фото. Нажми «+ Фото».</p>
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

      <div className="sticky bottom-0 mt-auto border-t border-white/10 bg-gray-950/90 p-4 backdrop-blur">
        <Button className="w-full" onClick={() => nav(`/t/${tour.id}`)} disabled={totalPhotos === 0}>
          Смотреть 3D-комнату
        </Button>
      </div>
    </div>
  );
}
