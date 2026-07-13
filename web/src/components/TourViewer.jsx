import { useEffect, useRef } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { VirtualTourPlugin } from '@photo-sphere-viewer/virtual-tour-plugin';
import { GyroscopePlugin } from '@photo-sphere-viewer/gyroscope-plugin';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/virtual-tour-plugin/index.css';

// Full multi-scene tour player: floor arrows between scenes + gyroscope.
export default function TourViewer({ tour, onSceneChange }) {
  const ref = useRef(null);
  const viewerRef = useRef(null);

  useEffect(() => {
    if (!ref.current || !tour?.scenes?.length) return;

    const nodes = tour.scenes.map((s) => ({
      id: s.id,
      panorama: s.panorama,
      name: s.name,
      caption: s.name,
      links: (s.links || []).map((l) => ({
        nodeId: l.nodeId,
        position: l.position,
      })),
    }));

    const viewer = new Viewer({
      container: ref.current,
      loadingImg: undefined,
      navbar: ['zoom', 'move', 'gyroscope', 'caption', 'fullscreen'],
      defaultZoomLvl: 30,
      touchmoveTwoFingers: false,
      plugins: [
        [GyroscopePlugin, {}],
        [
          VirtualTourPlugin,
          {
            positionMode: 'manual',
            renderMode: '3d',
            nodes,
            startNodeId: tour.startSceneId || tour.scenes[0].id,
          },
        ],
      ],
    });
    viewerRef.current = viewer;

    const vt = viewer.getPlugin(VirtualTourPlugin);
    const handler = ({ node }) => onSceneChange?.(node.id);
    vt.addEventListener('node-changed', handler);

    return () => {
      vt.removeEventListener('node-changed', handler);
      viewer.destroy();
      viewerRef.current = null;
    };
    // rebuild only when the tour identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.id]);

  return <div ref={ref} className="h-full w-full" />;
}
