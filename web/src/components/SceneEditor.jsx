import { useEffect, useRef } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';

const dotHtml = (label) =>
  `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;transform:translateY(-6px)">
     <div style="width:26px;height:26px;border-radius:50%;background:#6366f1;border:3px solid #fff;box-shadow:0 0 0 4px rgba(99,102,241,.35)"></div>
     <div style="font:600 12px system-ui;color:#fff;background:rgba(0,0,0,.6);padding:2px 8px;border-radius:999px;white-space:nowrap">${label}</div>
   </div>`;

// Single-scene panorama editor. Shows existing links as markers and, when
// `placing` is true, reports where the user taps so the parent can add a link.
export default function SceneEditor({ scene, sceneName, placing, onPlace }) {
  const ref = useRef(null);
  const viewerRef = useRef(null);
  const markersRef = useRef(null);
  const placingRef = useRef(placing);
  const onPlaceRef = useRef(onPlace);
  placingRef.current = placing;
  onPlaceRef.current = onPlace;

  // (re)build the viewer when the panorama changes
  useEffect(() => {
    if (!ref.current || !scene?.panorama) return;
    const viewer = new Viewer({
      container: ref.current,
      panorama: scene.panorama,
      caption: sceneName,
      navbar: ['zoom', 'move', 'caption'],
      defaultZoomLvl: 20,
      plugins: [[MarkersPlugin, {}]],
    });
    viewerRef.current = viewer;
    markersRef.current = viewer.getPlugin(MarkersPlugin);

    const onClick = ({ data }) => {
      if (placingRef.current) onPlaceRef.current?.({ yaw: data.yaw, pitch: data.pitch });
    };
    viewer.addEventListener('click', onClick);

    return () => {
      viewer.removeEventListener('click', onClick);
      viewer.destroy();
      viewerRef.current = null;
      markersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, scene?.panorama]);

  // refresh markers when links change
  useEffect(() => {
    const mp = markersRef.current;
    if (!mp) return;
    mp.setMarkers(
      (scene?.links || []).map((l, i) => ({
        id: 'link-' + i,
        position: l.position,
        html: dotHtml(l.label || '→'),
        anchor: 'center center',
        size: { width: 120, height: 60 },
      })),
    );
  }, [scene?.links]);

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full" />
      {placing && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
          <span className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            Нажми на точку, куда поставить переход
          </span>
        </div>
      )}
    </div>
  );
}
