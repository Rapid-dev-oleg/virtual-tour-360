import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getTour, isSeed } from '../lib/store.js';
import TourViewer from '../components/TourViewer.jsx';

export default function ViewerPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const tour = getTour(id);
  const [copied, setCopied] = useState(false);
  const [sceneName, setSceneName] = useState(null);

  if (!tour) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-gray-400">
        <div className="text-4xl">🔍</div>
        <p>Тур не найден на этом устройстве.</p>
        <p className="text-xs text-gray-500">
          Туры, созданные на другом телефоне, пока хранятся локально. Демо-туры доступны всем.
        </p>
        <button onClick={() => nav('/')} className="mt-2 rounded-lg bg-indigo-500 px-4 py-2 text-white">
          На главную
        </button>
      </div>
    );
  }

  const share = async () => {
    const url = window.location.href;
    const shareData = { title: tour.name, text: `Виртуальный тур: ${tour.name}`, url };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      /* user cancelled — fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      prompt('Скопируй ссылку:', url);
    }
  };

  const isLocal = !isSeed(tour.id);

  return (
    <div className="fixed inset-0 bg-gray-950">
      {/* content */}
      {tour.type === 'video' ? (
        tour.videoUrl ? (
          <video src={tour.videoUrl} controls autoPlay playsInline className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-gray-400">
            Видео этого тура доступно только в сессии, где оно было загружено (демо-ограничение).
          </div>
        )
      ) : tour.scenes?.length ? (
        <TourViewer tour={tour} onSceneChange={(nid) => setSceneName(tour.scenes.find((s) => s.id === nid)?.name)} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
          <p>В туре пока нет точек.</p>
          <button onClick={() => nav(`/tour/${tour.id}/edit`)} className="rounded-lg bg-indigo-500 px-4 py-2 text-white">
            Открыть редактор
          </button>
        </div>
      )}

      {/* top overlay */}
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
        </div>
        <button
          onClick={share}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm font-semibold text-white backdrop-blur"
        >
          {copied ? '✓ Скопировано' : '↗ Поделиться'}
        </button>
      </div>

      {isLocal && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3">
          <span className="rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/70 backdrop-blur">
            локальный тур — ссылка откроется на этом устройстве
          </span>
        </div>
      )}
    </div>
  );
}
