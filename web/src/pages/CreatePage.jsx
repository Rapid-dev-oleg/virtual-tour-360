import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTour } from '../lib/store.js';
import { createVideoTour } from '../lib/api.js';
import { TopBar, Screen, Button } from '../components/ui.jsx';

export default function CreatePage() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [type, setType] = useState('splat');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoInput = useRef(null);

  const onContinue = () => {
    if (type === 'panorama') {
      const tour = createTour({ name: name.trim() || 'Новый тур', type });
      nav(`/tour/${tour.id}/edit`);
    } else {
      videoInput.current?.click();
    }
  };

  const onVideoPicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      const tour = await createVideoTour(file, name.trim(), setProgress);
      nav(`/t/${tour.id}`);
    } catch (err) {
      alert('Не удалось отправить видео на реконструкцию: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const TypeCard = ({ value, emoji, title, desc, note }) => (
    <button
      onClick={() => setType(value)}
      disabled={uploading}
      className={`w-full rounded-2xl border p-4 text-left transition disabled:opacity-50 ${
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
            disabled={uploading}
            placeholder="Например: 2-комн. на Ленина"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-gray-500 focus:border-indigo-400 disabled:opacity-50"
          />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">Тип тура</div>
          <div className="flex flex-col gap-3">
            <TypeCard
              value="splat"
              emoji="🧊"
              title="3D-тур из видео"
              desc="Пройдись по квартире с телефоном, снимая видео (несколько проходов, медленно). Соберём настоящую 3D-сцену — свободное перемещение."
              note="Реконструкция на GPU (KIRI, Gaussian Splatting): ~7–20 мин после загрузки."
            />
            <TypeCard
              value="panorama"
              emoji="🖼"
              title="Панорамный тур"
              desc="360°-фото каждой комнаты, переходы между точками. Быстро, работает везде."
            />
          </div>
        </div>

        {type === 'splat' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
            <div className="mb-1 font-semibold text-white">Как снимать для 3D</div>
            <ul className="ml-4 list-disc space-y-1 text-gray-400">
              <li>Медленно обойди комнату, снимая стены/мебель со всех сторон.</li>
              <li>Сделай 2–3 круга на разной высоте (низко / на уровне глаз / высоко).</li>
              <li>Ровный свет, без резких движений и смазов. 30–90 сек достаточно.</li>
            </ul>
          </div>
        )}
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
        {uploading ? (
          <div>
            <div className="mb-2 flex justify-between text-xs text-gray-400">
              <span>Загрузка видео…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <Button className="w-full" onClick={onContinue}>
            {type === 'panorama' ? 'Далее — добавить точки' : '🎬 Снять / выбрать видео'}
          </Button>
        )}
      </div>
    </Screen>
  );
}
