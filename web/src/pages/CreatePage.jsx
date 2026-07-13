import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTour, saveTour } from '../lib/store.js';
import { TopBar, Screen, Button } from '../components/ui.jsx';

export default function CreatePage() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [type, setType] = useState('panorama');
  const videoInput = useRef(null);

  const onContinue = () => {
    if (type === 'panorama') {
      const tour = createTour({ name: name.trim() || 'Новый тур', type });
      nav(`/tour/${tour.id}/edit`);
    } else {
      videoInput.current?.click();
    }
  };

  const onVideoPicked = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const tour = createTour({ name: name.trim() || 'Видео-тур', type: 'video' });
    tour.videoUrl = URL.createObjectURL(file); // session-only for the demo
    tour.sessionOnly = true;
    saveTour(tour);
    nav(`/t/${tour.id}`);
  };

  const TypeCard = ({ value, emoji, title, desc, note }) => (
    <button
      onClick={() => setType(value)}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        type === value
          ? 'border-indigo-400 bg-indigo-500/10'
          : 'border-white/10 bg-white/5 hover:bg-white/10'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl">{emoji}</div>
        <div className="flex-1">
          <div className="font-semibold text-white">{title}</div>
          <div className="mt-0.5 text-sm text-gray-400">{desc}</div>
          {note && <div className="mt-2 text-xs text-amber-300/80">{note}</div>}
        </div>
        <div
          className={`mt-1 h-5 w-5 shrink-0 rounded-full border-2 ${
            type === value ? 'border-indigo-400 bg-indigo-400' : 'border-white/30'
          }`}
        />
      </div>
    </button>
  );

  return (
    <Screen>
      <TopBar title="Новый тур" back="/" />
      <div className="flex flex-col gap-5 p-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-300">Название</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: 2-комн. на Ленина"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-gray-500 focus:border-indigo-400"
          />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">Тип тура</div>
          <div className="flex flex-col gap-3">
            <TypeCard
              value="panorama"
              emoji="🖼"
              title="Панорамный тур"
              desc="360° фото каждой комнаты, переходы между точками. Работает везде, быстро."
            />
            <TypeCard
              value="video"
              emoji="🎬"
              title="Видео-проходка"
              desc="Пройдись по квартире с телефоном, снимая видео."
              note="Скоро: 3D-реконструкция (Gaussian Splatting) — свободное перемещение по сцене."
            />
          </div>
        </div>
      </div>

      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={onVideoPicked}
      />

      <div className="sticky bottom-0 mt-auto border-t border-white/10 bg-gray-950/90 p-4 backdrop-blur">
        <Button className="w-full" onClick={onContinue}>
          {type === 'panorama' ? 'Далее — добавить точки' : 'Снять / выбрать видео'}
        </Button>
      </div>
    </Screen>
  );
}
