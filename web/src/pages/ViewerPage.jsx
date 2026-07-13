import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getTour, isSeed } from '../lib/store.js';
import { getVideoTour } from '../lib/api.js';
import TourViewer from '../components/TourViewer.jsx';
import SplatViewer from '../components/SplatViewer.jsx';
import RoomViewer from '../components/RoomViewer.jsx';

const PROC_TEXT = {
  uploading: 'Загрузка на сервер реконструкции…',
  queued: 'В очереди на GPU…',
  processing: 'KIRI считает 3D-сцену… обычно 7–20 минут',
  processingDefault: 'Идёт реконструкция…',
};

export default function ViewerPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const localTour = getTour(id);
  const [serverTour, setServerTour] = useState(undefined); // undefined=loading, null=not found
  const [copied, setCopied] = useState(false);
  const [sceneName, setSceneName] = useState(null);

  // poll the backend for server-side (splat) tours
  useEffect(() => {
    if (localTour) return;
    let stop = false;
    let timer;
    const tick = async () => {
      const t = await getVideoTour(id);
      if (stop) return;
      setServerTour(t);
      if (t && !['ready', 'failed', 'expired'].includes(t.status)) timer = setTimeout(tick, 8000);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, localTour]);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) return await navigator.share({ title: 'Тур', url });
    } catch {
      /* cancelled */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      prompt('Скопируй ссылку:', url);
    }
  };

  // resolve
  if (!localTour && serverTour === undefined) return <Center>Загрузка…</Center>;
  if (!localTour && serverTour === null)
    return (
      <Center>
        <div className="text-4xl">🔍</div>
        <p>Тур не найден.</p>
        <button onClick={() => nav('/')} className="mt-2 rounded-lg bg-indigo-500 px-4 py-2 text-white">
          На главную
        </button>
      </Center>
    );

  const tour = localTour || serverTour;
  const isLocalOnly = !!localTour && !isSeed(tour.id); // server & seed tours are shareable

  let body;
  if (localTour && tour.type === 'room') {
    body = <RoomViewer room={tour} />;
  } else if (localTour && tour.type === 'video') {
    body = tour.videoUrl ? (
      <video src={tour.videoUrl} controls autoPlay playsInline className="h-full w-full object-contain" />
    ) : (
      <Center>Видео доступно только в сессии, где было загружено.</Center>
    );
  } else if (localTour) {
    body = tour.scenes?.length ? (
      <TourViewer tour={tour} onSceneChange={(nid) => setSceneName(tour.scenes.find((s) => s.id === nid)?.name)} />
    ) : (
      <Center>В туре нет точек.</Center>
    );
  } else if (tour.status === 'ready' && tour.splatUrl) {
    body = <SplatViewer url={tour.splatUrl} />;
  } else if (tour.status === 'failed') {
    body = (
      <Center>
        <div className="text-4xl">⚠️</div>
        <p>Реконструкция не удалась.</p>
        <p className="text-xs text-gray-500">Обычно причина — мало покрытия/резкие движения. Пересними медленнее, 2–3 круга.</p>
      </Center>
    );
  } else if (tour.status === 'expired') {
    body = <Center>Результат истёк. Запусти реконструкцию заново.</Center>;
  } else {
    body = (
      <Center>
        <Spinner />
        <p className="mt-3 font-medium text-white">{PROC_TEXT[tour.status] || PROC_TEXT.processingDefault}</p>
        <p className="text-xs text-gray-500">Можно закрыть — тур появится по этой ссылке, когда будет готов.</p>
        {tour.refreshError && <p className="mt-2 text-[11px] text-red-400/70">{tour.refreshError}</p>}
      </Center>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-950">
      {body}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent p-3">
        <button
          onClick={() => nav('/')}
          className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"
          aria-label="Назад"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="pointer-events-none flex-1 truncate">
          <div className="truncate text-sm font-semibold text-white drop-shadow">{tour.name}</div>
          {sceneName && <div className="truncate text-xs text-white/70 drop-shadow">{sceneName}</div>}
          {!localTour && (
            <div className="truncate text-xs text-white/70 drop-shadow">
              🧊 3D-тур{tour.status !== 'ready' ? ` · ${tour.status}` : ''}
            </div>
          )}
        </div>
        <button
          onClick={share}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm font-semibold text-white backdrop-blur"
        >
          {copied ? '✓ Скопировано' : '↗ Поделиться'}
        </button>
      </div>

      {isLocalOnly && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3">
          <span className="rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/70 backdrop-blur">
            локальный тур — ссылка откроется на этом устройстве
          </span>
        </div>
      )}
    </div>
  );
}

function Center({ children }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-gray-300">
      {children}
    </div>
  );
}
function Spinner() {
  return (
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-indigo-400" />
  );
}
