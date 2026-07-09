import React, { useEffect, useRef, useState } from 'react';

/**
 * Pannellum-based 360° equirectangular viewer.
 * Props:
 *   - imageUrl: URL to equirectangular image
 *   - hotspots: array of { yaw, pitch, text, type }
 *   - onAddHotspot: (hotspot) => void (if provided, enables click-to-add)
 *   - editable: boolean (show hotspot editor UI)
 *   - height: string (CSS height, default '100%')
 */
export default function PanoramaViewer({
  imageUrl,
  hotspots = [],
  onAddHotspot,
  editable = false,
  height = '100%',
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [pannellumReady, setPannellumReady] = useState(false);
  const [viewerError, setViewerError] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [showHotspotForm, setShowHotspotForm] = useState(false);
  const [pendingHotspot, setPendingHotspot] = useState(null);
  const [hotspotText, setHotspotText] = useState('');
  const [hotspotType, setHotspotType] = useState('info');

  // Detect mobile
  useEffect(() => {
    const check = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    setIsMobile(check);
  }, []);

  // Load Pannellum script dynamically
  useEffect(() => {
    if (window.pannellum) {
      setPannellumReady(true);
      return;
    }

    const existing = document.querySelector('script[data-pannellum]');
    if (existing) {
      existing.addEventListener('load', () => setPannellumReady(true));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js';
    script.async = true;
    script.dataset.pannellum = 'true';
    script.onload = () => setPannellumReady(true);
    script.onerror = () => setViewerError('Failed to load 360° viewer library');
    document.head.appendChild(script);

    // Load CSS
    if (!document.querySelector('link[data-pannellum-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css';
      link.dataset.pannellumCss = 'true';
      document.head.appendChild(link);
    }
  }, []);

  // Initialize / update viewer
  useEffect(() => {
    if (!pannellumReady || !imageUrl || !containerRef.current) return;

    setViewerError('');

    try {
      // Destroy previous viewer
      if (viewerRef.current) {
        try { viewerRef.current.destroy(); } catch (e) { /* ignore */ }
        viewerRef.current = null;
      }

      const formattedHotspots = (hotspots || []).map((h, i) => ({
        id: h.id || `hotspot-${i}`,
        pitch: Number(h.pitch) || 0,
        yaw: Number(h.yaw) || 0,
        type: h.type || 'info',
        text: h.text || 'Hotspot',
        CSSClass: h.type === 'link' ? 'custom-hotspot-link' : 'custom-hotspot-info',
        clickHandlerFunc: h.type === 'link' && h.url
          ? () => window.open(h.url, '_blank')
          : null,
      }));

      viewerRef.current = window.pannellum.viewer(containerRef.current, {
        type: 'equirectangular',
        panorama: imageUrl,
        autoLoad: true,
        showControls: !isMobile,
        showFullscreenCtrl: true,
        showZoomCtrl: !isMobile,
        compass: true,
        northOffset: 0,
        haov: 360,
        vaov: 180,
        vOffset: 0,
        hfov: 130,
        minHfov: 50,
        maxHfov: 160,
        minPitch: -90,
        maxPitch: 90,
        minYaw: -180,
        maxYaw: 180,
        friction: 0.15,
        mouseZoom: true,
        doubleClickZoom: true,
        hotSpotDebug: false,
        hotSpots: formattedHotspots,
        ...((onAddHotspot && editable) ? {
          // Capture clicks for hotspot creation
        } : {}),
      });

      // Handle click-to-add hotspot
      if (onAddHotspot && editable) {
        const container = containerRef.current;
        const handleClick = (e) => {
          if (!viewerRef.current) return;
          try {
            const coords = viewerRef.current.mouseEventToCoords(e);
            setPendingHotspot({ pitch: coords[0], yaw: coords[1] });
            setShowHotspotForm(true);
          } catch (err) {
            console.error('Click conversion error:', err);
          }
        };
        container.addEventListener('click', handleClick);
        return () => {
          container.removeEventListener('click', handleClick);
          if (viewerRef.current) {
            try { viewerRef.current.destroy(); } catch (e) { /* ignore */ }
          }
        };
      }

      return () => {
        if (viewerRef.current) {
          try { viewerRef.current.destroy(); } catch (e) { /* ignore */ }
          viewerRef.current = null;
        }
      };
    } catch (err) {
      console.error('Panorama viewer error:', err);
      setViewerError(`Viewer error: ${err.message}`);
    }
  }, [pannellumReady, imageUrl, hotspots, isMobile, onAddHotspot, editable]);

  // Mobile zoom controls
  const zoomIn = () => {
    if (viewerRef.current) {
      const hfov = viewerRef.current.getHfov() - 15;
      viewerRef.current.setHfov(Math.max(50, hfov), 200);
    }
  };

  const zoomOut = () => {
    if (viewerRef.current) {
      const hfov = viewerRef.current.getHfov() + 15;
      viewerRef.current.setHfov(Math.min(160, hfov), 200);
    }
  };

  const toggleGyro = () => {
    if (viewerRef.current) {
      try {
        if (viewerRef.current.isOrientationActive && viewerRef.current.isOrientationActive()) {
          viewerRef.current.stopOrientation();
        } else {
          viewerRef.current.startOrientation();
        }
      } catch (e) {
        console.error('Gyro error:', e);
      }
    }
  };

  const saveHotspot = () => {
    if (pendingHotspot && onAddHotspot) {
      onAddHotspot({
        ...pendingHotspot,
        text: hotspotText || 'New hotspot',
        type: hotspotType,
      });
      setShowHotspotForm(false);
      setPendingHotspot(null);
      setHotspotText('');
    }
  };

  if (viewerError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900 text-red-400 p-4">
        <div className="text-center">
          <p>{viewerError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (!pannellumReady) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Mobile zoom controls */}
      {isMobile && (
        <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
          <button
            onClick={zoomIn}
            className="w-12 h-12 bg-black/60 backdrop-blur rounded-full flex items-center justify-center text-white text-xl hover:bg-black/80 transition"
          >
            +
          </button>
          <button
            onClick={zoomOut}
            className="w-12 h-12 bg-black/60 backdrop-blur rounded-full flex items-center justify-center text-white text-xl hover:bg-black/80 transition"
          >
            −
          </button>
          <button
            onClick={toggleGyro}
            className="w-12 h-12 bg-black/60 backdrop-blur rounded-full flex items-center justify-center text-white text-lg hover:bg-black/80 transition"
            title="Toggle gyroscope"
          >
            📱
          </button>
        </div>
      )}

      {/* Hotspot creation form */}
      {showHotspotForm && pendingHotspot && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20 p-4">
          <div className="bg-gray-800 p-4 rounded-xl w-full max-w-sm space-y-3">
            <h3 className="font-semibold">Add Hotspot</h3>
            <div className="text-xs text-gray-400">
              yaw: {pendingHotspot.yaw.toFixed(1)}, pitch: {pendingHotspot.pitch.toFixed(1)}
            </div>
            <input
              type="text"
              placeholder="Hotspot text..."
              value={hotspotText}
              onChange={(e) => setHotspotText(e.target.value)}
              className="w-full p-2 bg-gray-700 rounded text-sm"
              autoFocus
            />
            <select
              value={hotspotType}
              onChange={(e) => setHotspotType(e.target.value)}
              className="w-full p-2 bg-gray-700 rounded text-sm"
            >
              <option value="info">Info</option>
              <option value="link">Link</option>
              <option value="scene">Scene</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={saveHotspot}
                className="flex-1 py-2 bg-blue-600 rounded hover:bg-blue-500 transition text-sm"
              >
                Save
              </button>
              <button
                onClick={() => { setShowHotspotForm(false); setPendingHotspot(null); }}
                className="flex-1 py-2 bg-gray-700 rounded hover:bg-gray-600 transition text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
