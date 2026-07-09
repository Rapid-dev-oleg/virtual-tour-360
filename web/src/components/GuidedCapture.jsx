import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const GUIDE_POSITIONS = [
  { yaw: 0,   pitch: 0,   label: 'Center' },
  { yaw: 30,  pitch: 0,   label: 'Right 1' },
  { yaw: 60,  pitch: 0,   label: 'Right 2' },
  { yaw: 90,  pitch: 0,   label: 'Right 3' },
  { yaw: 120, pitch: 0,   label: 'Right 4' },
  { yaw: 150, pitch: 0,   label: 'Right 5' },
  { yaw: 180, pitch: 0,   label: 'Back' },
  { yaw: -150,pitch: 0,   label: 'Left 5' },
  { yaw: -120,pitch: 0,   label: 'Left 4' },
  { yaw: -90, pitch: 0,   label: 'Left 3' },
  { yaw: -60, pitch: 0,   label: 'Left 2' },
  { yaw: -30, pitch: 0,   label: 'Left 1' },
];

export default function GuidedCapture() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  // Phase: 'idle' | 'camera-ready' | 'capturing' | 'preview' | 'done'
  const [phase, setPhase] = useState('idle');
  const [mode, setMode] = useState(null); // 'timer' | 'gyro' | 'flow' | 'manual'
  const [photos, setPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [flash, setFlash] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);

  // Settings
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [zoom, setZoom] = useState(1);
  const [facingMode, setFacingMode] = useState('environment');
  const [showSettings, setShowSettings] = useState(false);

  // Debug
  const [debugInfo, setDebugInfo] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [videoReady, setVideoReady] = useState(false);

  const addDebug = (msg) => {
    const line = `${new Date().toLocaleTimeString()}: ${msg}`;
    setDebugInfo(prev => prev ? prev + '\n' + line : line);
    console.log('[GuidedCapture]', msg);
  };

  // ── Enumerate cameras ──
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices()
      .then(list => {
        const cams = list.filter(d => d.kind === 'videoinput');
        setDevices(cams);
        if (cams.length > 0) {
          // Prefer back camera
          const back = cams.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
          setSelectedDeviceId(back?.deviceId || cams[0].deviceId);
        }
        addDebug(`Found ${cams.length} camera(s)`);
      })
      .catch(err => addDebug(`enumerateDevices error: ${err.message}`));
  }, []);

  // ── Core camera start with multiple fallbacks ──
  const startCamera = useCallback(async (deviceId, requestedZoom, requestedFacing) => {
    addDebug('startCamera called');
    setErrorMsg('');
    setVideoReady(false);

    // Stop any existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    const videoEl = videoRef.current;
    if (!videoEl) {
      addDebug('ERROR: videoRef is null');
      setErrorMsg('Video element not found. Please reload.');
      return false;
    }

    try {
      // Build constraints
      const constraints = {
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: !deviceId ? { ideal: requestedFacing || 'environment' } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        }
      };

      // Apply zoom if supported
      if (requestedZoom && requestedZoom !== 1) {
        constraints.video.zoom = { ideal: requestedZoom };
      }

      addDebug(`Requesting getUserMedia with device: ${deviceId?.slice(0, 8) || 'default'}...`);

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const videoTrack = stream.getVideoTracks()[0];
      addDebug(`Got stream. Track: ${videoTrack?.label}, enabled: ${videoTrack?.enabled}, readyState: ${videoTrack?.readyState}`);

      // Check capabilities
      try {
        const caps = videoTrack.getCapabilities();
        addDebug(`Capabilities: ${JSON.stringify({
          width: caps.width,
          height: caps.height,
          zoom: caps.zoom,
          facingMode: caps.facingMode
        })}`);
      } catch (e) { /* ignore */ }

      // Set srcObject
      videoEl.srcObject = stream;
      addDebug('srcObject assigned');

      // Wait for video to be ready with timeout
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Video load timeout (5s)'));
        }, 5000);

        const onReady = () => {
          clearTimeout(timeout);
          addDebug(`Video ready: ${videoEl.videoWidth}x${videoEl.videoHeight}, readyState: ${videoEl.readyState}`);
          resolve();
        };

        if (videoEl.readyState >= 2) {
          onReady();
        } else {
          videoEl.addEventListener('loadeddata', onReady, { once: true });
        }
      });

      // Explicit play() - REQUIRED on mobile to bypass autoplay policy
      addDebug('Calling video.play()...');
      try {
        await videoEl.play();
        addDebug('video.play() succeeded');
      } catch (playErr) {
        addDebug(`video.play() failed: ${playErr.message}`);
        // Try muted play as fallback
        videoEl.muted = true;
        try {
          await videoEl.play();
          addDebug('video.play() succeeded with muted=true');
        } catch (playErr2) {
          throw new Error(`Cannot play video: ${playErr2.message}`);
        }
      }

      setVideoReady(true);
      setCameraStarted(true);
      addDebug('Camera ready ✓');
      return true;

    } catch (err) {
      addDebug(`Camera error: ${err.name}: ${err.message}`);

      // Fallback 1: Try without deviceId constraint
      if (deviceId) {
        addDebug('Retrying without specific deviceId...');
        return startCamera(null, requestedZoom, requestedFacing);
      }

      // Fallback 2: Try with basic constraints
      if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') {
        addDebug('Retrying with basic constraints...');
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          streamRef.current = stream;
          videoEl.srcObject = stream;
          await videoEl.play();
          setVideoReady(true);
          setCameraStarted(true);
          addDebug('Camera ready with basic constraints ✓');
          return true;
        } catch (err2) {
          addDebug(`Fallback failed: ${err2.message}`);
        }
      }

      setErrorMsg(`${err.name}: ${err.message}`);
      return false;
    }
  }, []);

  const stopCamera = useCallback(() => {
    addDebug('Stopping camera');
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.pause();
    }
    setCameraStarted(false);
    setVideoReady(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // ── Manual camera start (bypasses autoplay policy) ──
  const handleManualStart = async () => {
    addDebug('Manual start clicked');
    const ok = await startCamera(selectedDeviceId, zoom, facingMode);
    if (ok) {
      setPhase('camera-ready');
    }
  };

  // ── Select mode ──
  const selectMode = (selectedMode) => {
    addDebug(`Mode selected: ${selectedMode}`);
    setMode(selectedMode);
    setPhotos([]);
    setCurrentIndex(0);
    setPhase('camera-ready');
    // Don't auto-start camera - user will tap "Start Camera" button
  };

  // ── Take photo from video stream ──
  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      addDebug('Cannot capture: video not ready');
      return null;
    }

    canvas.width = video.videoWidth || 1920;
    canvas.height = video.videoHeight || 1080;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    addDebug(`Captured photo ${photos.length + 1}: ${canvas.width}x${canvas.height}`);
    return dataUrl;
  }, [photos.length]);

  // ── Timer mode capture ──
  const startTimerCapture = () => {
    if (currentIndex >= GUIDE_POSITIONS.length) return;
    setCountdown(3);

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          // Capture
          const photo = capturePhoto();
          if (photo) {
            setPhotos(p => [...p, { dataUrl: photo, position: GUIDE_POSITIONS[currentIndex] }]);
            setFlash(true);
            setTimeout(() => setFlash(false), 150);

            if (currentIndex + 1 >= GUIDE_POSITIONS.length) {
              setPhase('done');
            } else {
              setCurrentIndex(i => i + 1);
            }
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // ── Manual capture ──
  const captureManual = () => {
    if (currentIndex >= GUIDE_POSITIONS.length) return;
    const photo = capturePhoto();
    if (photo) {
      setPhotos(p => [...p, { dataUrl: photo, position: GUIDE_POSITIONS[currentIndex] }]);
      setFlash(true);
      setTimeout(() => setFlash(false), 150);

      if (currentIndex + 1 >= GUIDE_POSITIONS.length) {
        setPhase('done');
      } else {
        setCurrentIndex(i => i + 1);
      }
    }
  };

  // ── Proceed to stitching ──
  const proceedToStitch = () => {
    // Save photos to sessionStorage for stitching page
    const blobs = photos.map((p, i) => ({
      id: `capture-${Date.now()}-${i}`,
      name: `capture_${String(i + 1).padStart(2, '0')}.jpg`,
      dataUrl: p.dataUrl,
      yaw: p.position.yaw,
      pitch: p.position.pitch,
    }));
    sessionStorage.setItem('capturedPhotos', JSON.stringify(blobs));
    navigate('/stitch');
  };

  // ── Retake ──
  const retakeAll = () => {
    setPhotos([]);
    setCurrentIndex(0);
    setPhase('camera-ready');
  };

  // ── File upload fallback ──
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    Promise.all(
      files.map(
        (file, i) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) =>
              resolve({
                dataUrl: ev.target.result,
                position: GUIDE_POSITIONS[i % GUIDE_POSITIONS.length],
              });
            reader.readAsDataURL(file);
          })
      )
    ).then((loaded) => {
      setPhotos(loaded);
      setPhase('done');
      addDebug(`Loaded ${loaded.length} photos from files`);
    });
  };

  // ── Apply zoom ──
  const applyZoom = async (newZoom) => {
    setZoom(newZoom);
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      const caps = track.getCapabilities();
      if (caps.zoom) {
        await track.applyConstraints({
          advanced: [{ zoom: newZoom }],
        });
        addDebug(`Zoom applied: ${newZoom}`);
      }
    } catch (err) {
      addDebug(`Zoom error: ${err.message}`);
    }
  };

  // ── Switch camera ──
  const switchCamera = async (deviceId) => {
    setSelectedDeviceId(deviceId);
    if (phase === 'camera-ready' || phase === 'capturing') {
      await startCamera(deviceId, zoom, facingMode);
    }
  };

  // ── Toggle facing mode ──
  const toggleFacingMode = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    startCamera(null, zoom, next);
  };

  // ── Render ──
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col relative overflow-hidden">
      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Flash overlay */}
      {flash && <div className="absolute inset-0 bg-white z-50 pointer-events-none animate-pulse" />}

      {/* ── PHASE: IDLE (Mode Selection) ── */}
      {phase === 'idle' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6">
          <h1 className="text-2xl font-bold text-center">360° Guided Capture</h1>
          <p className="text-gray-400 text-center text-sm">
            Take 12 overlapping photos in a circle. We'll stitch them into a panorama.
          </p>

          <div className="grid grid-cols-1 gap-3 w-full max-w-sm">
            <button
              onClick={() => selectMode('timer')}
              className="p-4 bg-blue-600 hover:bg-blue-500 rounded-xl flex items-center gap-3 transition"
            >
              <span className="text-2xl">⏱️</span>
              <div className="text-left">
                <div className="font-semibold">Auto Timer</div>
                <div className="text-xs text-blue-200">3-2-1 countdown per shot</div>
              </div>
            </button>

            <button
              onClick={() => selectMode('manual')}
              className="p-4 bg-green-600 hover:bg-green-500 rounded-xl flex items-center gap-3 transition"
            >
              <span className="text-2xl">📷</span>
              <div className="text-left">
                <div className="font-semibold">Manual</div>
                <div className="text-xs text-green-200">Tap to capture each shot</div>
              </div>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-4 bg-gray-700 hover:bg-gray-600 rounded-xl flex items-center gap-3 transition"
            >
              <span className="text-2xl">📁</span>
              <div className="text-left">
                <div className="font-semibold">Upload Photos</div>
                <div className="text-xs text-gray-300">Use existing images</div>
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          <button
            onClick={() => navigate('/')}
            className="text-gray-500 hover:text-gray-300 text-sm"
          >
            ← Back to Home
          </button>
        </div>
      )}

      {/* ── PHASE: CAMERA-READY / CAPTURING ── */}
      {(phase === 'camera-ready' || phase === 'capturing') && (
        <div className="flex-1 flex flex-col relative">
          {/* Video preview area */}
          <div className="flex-1 relative bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              loop
              className={`w-full h-full object-cover ${videoReady ? 'opacity-100' : 'opacity-0'}`}
              style={{ display: 'block' }}
            />

            {/* Black screen / not started state */}
            {!videoReady && !errorMsg && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black">
                <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-gray-300">Starting camera...</p>
                <p className="text-gray-500 text-xs mt-2">Tap "Start Camera" if stuck</p>
              </div>
            )}

            {/* Error state */}
            {errorMsg && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black p-6">
                <p className="text-red-400 text-center mb-4">{errorMsg}</p>
                <button
                  onClick={handleManualStart}
                  className="px-6 py-3 bg-blue-600 rounded-lg hover:bg-blue-500 transition"
                >
                  Retry Camera
                </button>
              </div>
            )}

            {/* Overlay: Position guide */}
            {videoReady && (
              <>
                {/* Position indicator */}
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur px-3 py-2 rounded-lg">
                  <span className="text-sm font-mono">
                    {currentIndex + 1} / {GUIDE_POSITIONS.length}
                  </span>
                  <span className="text-xs text-gray-300 ml-2">
                    {GUIDE_POSITIONS[currentIndex]?.label}
                  </span>
                </div>

                {/* Mode badge */}
                <div className="absolute top-4 right-4 bg-black/60 backdrop-blur px-3 py-1 rounded-full text-xs capitalize">
                  {mode} mode
                </div>

                {/* Center crosshair */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-12 h-12 border-2 border-white/40 rounded-full" />
                  <div className="absolute w-1 h-4 bg-white/40" />
                  <div className="absolute w-4 h-1 bg-white/40" />
                </div>

                {/* Arrow pointing to next position */}
                {currentIndex < GUIDE_POSITIONS.length && (
                  <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex flex-col items-center">
                    <div className="text-white/70 text-sm bg-black/50 px-3 py-1 rounded-full">
                      Rotate → capture {GUIDE_POSITIONS[currentIndex]?.label}
                    </div>
                  </div>
                )}

                {/* Countdown overlay */}
                {countdown > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-20">
                    <div className="text-8xl font-bold text-white animate-bounce">
                      {countdown}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bottom controls */}
          <div className="bg-gray-900 border-t border-gray-800 p-4 space-y-3">
            {/* Start camera button (shown if not started) */}
            {!videoReady && !errorMsg && (
              <button
                onClick={handleManualStart}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-semibold transition"
              >
                Start Camera
              </button>
            )}

            {/* Capture controls */}
            {videoReady && phase === 'camera-ready' && (
              <div className="flex items-center justify-center gap-4">
                {mode === 'timer' && (
                  <button
                    onClick={startTimerCapture}
                    disabled={countdown > 0}
                    className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition disabled:opacity-50"
                  >
                    <div className="w-16 h-16 bg-red-500 rounded-full" />
                  </button>
                )}
                {mode === 'manual' && (
                  <button
                    onClick={captureManual}
                    className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition"
                  >
                    <div className="w-16 h-16 bg-white rounded-full" />
                  </button>
                )}
              </div>
            )}

            {/* Settings toggle */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-full py-2 text-sm text-gray-400 hover:text-white transition"
            >
              {showSettings ? 'Hide' : 'Show'} Settings ⚙️
            </button>

            {/* Settings panel */}
            {showSettings && (
              <div className="space-y-3 bg-gray-800 p-3 rounded-lg">
                {/* Camera selector */}
                {devices.length > 0 && (
                  <div>
                    <label className="text-xs text-gray-400">Camera</label>
                    <select
                      value={selectedDeviceId}
                      onChange={(e) => switchCamera(e.target.value)}
                      className="w-full mt-1 p-2 bg-gray-700 rounded text-sm"
                    >
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Facing mode toggle */}
                <button
                  onClick={toggleFacingMode}
                  className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
                >
                  Switch to {facingMode === 'environment' ? 'Front' : 'Back'} Camera
                </button>

                {/* Zoom slider */}
                <div>
                  <label className="text-xs text-gray-400">Zoom: {zoom.toFixed(1)}x</label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="0.1"
                    value={zoom}
                    onChange={(e) => applyZoom(parseFloat(e.target.value))}
                    className="w-full mt-1 accent-blue-500"
                  />
                </div>

                {/* Debug toggle */}
                <button
                  onClick={() => setDebugInfo(prev => prev ? '' : 'Debug enabled...')}
                  className="w-full py-1 text-xs text-gray-500 hover:text-gray-300"
                >
                  Toggle Debug Info
                </button>
              </div>
            )}

            {/* Debug info */}
            {debugInfo && (
              <pre className="text-xs text-green-400 bg-black/50 p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap">
                {debugInfo}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* ── PHASE: DONE ── */}
      {phase === 'done' && (
        <div className="flex-1 flex flex-col p-4 space-y-4">
          <h2 className="text-xl font-bold text-center">
            {photos.length} Photos Captured
          </h2>

          {/* Photo grid preview */}
          <div className="grid grid-cols-3 gap-2 overflow-auto flex-1">
            {photos.map((p, i) => (
              <div key={i} className="relative aspect-square bg-gray-800 rounded-lg overflow-hidden">
                <img
                  src={p.dataUrl}
                  alt={`Capture ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-1 left-1 bg-black/60 text-xs px-1.5 py-0.5 rounded">
                  {i + 1}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <button
              onClick={proceedToStitch}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-semibold transition"
            >
              Stitch Panorama →
            </button>
            <button
              onClick={retakeAll}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-xl transition"
            >
              Retake All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
