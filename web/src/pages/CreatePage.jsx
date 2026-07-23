import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTour } from '../lib/store.js';
import { createVideoTour } from '../lib/api.js';
import { TopBar, Screen, Button } from '../components/ui.jsx';

export default function CreatePage() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [type, setType] = useState('panorama');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoInput = useRef(null);

  const onContinue = async () => {
    if (type === 'pano') {
      nav('/panorama');
      return;
    }
    if (type === 'sphere') {
      const tour = await createTour({ name: name.trim() || '360° sphere', type: 'sphere' });
      if (tour) nav(`/tour/${tour.id}/capture`);
    } else if (type === 'panorama') {
      const tour = await createTour({ name: name.trim() || 'New tour', type });
      if (tour) nav(`/tour/${tour.id}/edit`);
    } else if (type === 'room') {
      const tour = await createTour({ name: name.trim() || 'Room', type: 'room' });
      if (tour) nav(`/tour/${tour.id}/room`);
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
      alert('Could not send video for reconstruction: ' + err.message);
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
      <TopBar title="New tour" back="/" />
      <div className="flex flex-col gap-5 p-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-300">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={uploading}
            placeholder="e.g. 2-bedroom on Main St."
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-gray-500 focus:border-indigo-400 disabled:opacity-50"
          />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">Tour type</div>
          <div className="flex flex-col gap-3">
            <TypeCard
              value="panorama"
              emoji="🖼"
              title="Panoramic tour"
              desc="A 360° photo of each room, with transitions between points. Fast, works everywhere."
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
        {uploading ? (
          <div>
            <div className="mb-2 flex justify-between text-xs text-gray-400">
              <span>Uploading video…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <Button className="w-full" onClick={onContinue}>
            {type === 'pano'
              ? '🖼️ Upload photos'
              : type === 'sphere'
              ? '📷 Start 360° capture'
              : type === 'panorama'
                ? 'Next — add points'
                : type === 'room'
                  ? 'Next — set dimensions'
                  : '🎬 Record / pick video'}
          </Button>
        )}
      </div>
    </Screen>
  );
}
