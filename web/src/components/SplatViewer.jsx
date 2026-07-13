import { useEffect, useRef, useState } from 'react';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

// Renders a Gaussian Splatting scene (.splat / .ply) — free 3D movement, works
// on mobile. sharedMemoryForWorkers:false so it runs without COOP/COEP headers.
export default function SplatViewer({ url }) {
  const ref = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ref.current || !url) return;
    let viewer = new GaussianSplats3D.Viewer({
      rootElement: ref.current,
      sharedMemoryForWorkers: false,
      dynamicScene: false,
      useBuiltInControls: true,
    });
    let disposed = false;

    viewer
      .addSplatScene(url, { showLoadingUI: true, progressiveLoad: true })
      .then(() => {
        if (!disposed) viewer.start();
      })
      .catch((e) => {
        console.error('splat load failed', e);
        if (!disposed) setError(String(e?.message || e));
      });

    return () => {
      disposed = true;
      try {
        viewer.dispose();
      } catch {
        /* ignore */
      }
      viewer = null;
    };
  }, [url]);

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-300">
          Не удалось загрузить 3D-сцену: {error}
        </div>
      )}
    </div>
  );
}
