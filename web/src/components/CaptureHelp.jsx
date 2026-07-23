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
        <span>❓ How to capture a 360° photo with your phone (no 360 camera)</span>
        <span className="text-amber-300/70">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-amber-400/10 px-4 py-3 text-sm text-gray-300">
          <ol className="ml-4 list-decimal space-y-1.5">
            <li>
              Install the free <b>Google Street View</b> app (iOS/Android), or open
              the <b>«Photo Sphere»</b> mode in the Android Camera.
            </li>
            <li>
              «Create photo sphere» → point your phone at the dots, and the app will <b>stitch</b> a full
              360°×180° sphere for you.
            </li>
            <li>Save the finished photo to your phone's gallery.</li>
            <li>
              Come back here, tap <b>«+ point»</b> and pick this photo — it will load as a panorama.
            </li>
          </ol>
          <p className="mt-2 text-xs text-amber-300/80">
            ⚠️ A regular photo or «Panorama» mode (a wide strip) won't work — you need an actual sphere
            (2:1 aspect ratio).
          </p>
        </div>
      )}
    </div>
  );
}
