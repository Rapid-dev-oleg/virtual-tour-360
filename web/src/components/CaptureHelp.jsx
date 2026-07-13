import { useState } from 'react';

// Honest capture guidance: a normal phone photo is NOT a 360 panorama.
// Cheapest smartphone-only way = capture the sphere with Google's free app,
// which stitches it into an equirectangular image, then import it here.
export default function CaptureHelp({ defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 text-left">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-amber-200"
      >
        <span>❓ Как снять 360°-фото телефоном (без 360-камеры)</span>
        <span className="text-amber-300/70">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-amber-400/10 px-4 py-3 text-sm text-gray-300">
          <ol className="ml-4 list-decimal space-y-1.5">
            <li>
              Установи бесплатное приложение <b>Google Street View</b> (iOS/Android) или открой
              режим <b>«Фотосфера»</b> в Камере на Android.
            </li>
            <li>
              «Создать фотосферу» → наводи телефон на кружки-точки, приложение <b>само склеит</b> полную
              сферу 360°×180°.
            </li>
            <li>Сохрани готовое фото в галерею телефона.</li>
            <li>
              Вернись сюда, нажми <b>«+ точка»</b> и выбери это фото — оно встанет как панорама.
            </li>
          </ol>
          <p className="mt-2 text-xs text-amber-300/80">
            ⚠️ Обычное фото или режим «Панорама» (широкая полоса) не подойдут — нужна именно сфера
            (соотношение сторон 2:1).
          </p>
        </div>
      )}
    </div>
  );
}
