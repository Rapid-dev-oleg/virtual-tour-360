import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PanoramaViewer from '../components/PanoramaViewer';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function StitchingPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [files, setFiles] = useState([]);
  const [taskId, setTaskId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | uploading | stitching | done | error
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const [previewMode, setPreviewMode] = useState('draft'); // draft | full
  const [hotspots, setHotspots] = useState([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportMeta, setExportMeta] = useState({
    title: '',
    description: '',
    address: '',
  });

  // Load captured photos from sessionStorage (from GuidedCapture)
  useEffect(() => {
    const stored = sessionStorage.getItem('capturedPhotos');
    if (stored) {
      try {
        const photos = JSON.parse(stored);
        // Convert dataURLs to File objects
        const filePromises = photos.map(async (p, i) => {
          const res = await fetch(p.dataUrl);
          const blob = await res.blob();
          return new File([blob], p.name || `capture_${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' });
        });
        Promise.all(filePromises).then(fileObjects => {
          setFiles(fileObjects);
        }).catch(err => {
          console.error('Error converting captured photos:', err);
        });
      } catch (e) {
        console.error('Error parsing captured photos:', e);
      }
    }
  }, []);

  const addLog = useCallback((msg) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
  }, []);

  // File selection
  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files);
    if (selected.length > 0) {
      setFiles(prev => [...prev, ...selected]);
      setStatus('idle');
      setError('');
    }
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearFiles = () => {
    setFiles([]);
    setResult(null);
    setStatus('idle');
    setTaskId(null);
  };

  // Upload and stitch
  const startStitch = async (quality = 'draft') => {
    if (files.length < 2) {
      setError('Please select at least 2 images');
      return;
    }

    setStatus('uploading');
    setProgress(0);
    setError('');
    setPreviewMode(quality);
    addLog(`Starting ${quality} stitch with ${files.length} images...`);

    try {
      // Upload files
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));
      formData.append('quality', quality);
      formData.append('projection', 'equirectangular');

      setProgress(20);
      addLog('Uploading images...');

      const uploadRes = await fetch(`${API_BASE}/api/stitch/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(err.detail || `Upload failed: ${uploadRes.status}`);
      }

      const { task_id } = await uploadRes.json();
      setTaskId(task_id);
      setProgress(40);
      addLog(`Task created: ${task_id}`);

      // Poll status
      setStatus('stitching');
      await pollStatus(task_id);

    } catch (err) {
      setError(err.message);
      setStatus('error');
      addLog(`Error: ${err.message}`);
    }
  };

  // Poll task status
  const pollStatus = async (tid) => {
    const maxAttempts = 120; // 2 minutes max
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`${API_BASE}/api/stitch/status/${tid}`);
        if (!res.ok) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }

        const data = await res.json();
        addLog(`Status: ${data.status}`);

        if (data.status === 'completed') {
          setProgress(100);
          setResult(data);
          setStatus('done');
          addLog('Stitching complete!');
          return;
        } else if (data.status === 'failed') {
          throw new Error(data.error || 'Stitching failed');
        } else if (data.status === 'processing') {
          setProgress(40 + Math.min(55, i * 2));
        }

        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        if (i === maxAttempts - 1) {
          throw err;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    throw new Error('Stitching timed out');
  };

  // Hotspot management
  const handleAddHotspot = (hotspot) => {
    setHotspots(prev => [...prev, { ...hotspot, id: `hs-${Date.now()}` }]);
    addLog(`Added hotspot: ${hotspot.text}`);
  };

  const removeHotspot = (id) => {
    setHotspots(prev => prev.filter(h => h.id !== id));
  };

  // MLS Export
  const exportMLS = async () => {
    if (!result?.output_url) return;

    try {
      const exportData = {
        panorama_url: result.output_url,
        hotspots,
        metadata: exportMeta,
      };

      const res = await fetch(`${API_BASE}/api/export/mls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportData),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Export failed' }));
        throw new Error(err.detail || 'Export failed');
      }

      const data = await res.json();

      // Trigger download
      if (data.download_url) {
        const a = document.createElement('a');
        a.href = `${API_BASE}${data.download_url}`;
        a.download = `360-tour-${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      addLog('MLS export downloaded');
      setShowExportModal(false);
    } catch (err) {
      setError(`Export error: ${err.message}`);
    }
  };

  // Download single panorama
  const downloadPanorama = () => {
    if (result?.output_url) {
      const a = document.createElement('a');
      a.href = result.output_url;
      a.download = `panorama-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white">
            ←
          </button>
          <h1 className="text-lg font-bold">Panorama Stitching</h1>
        </div>
        {result && (
          <button
            onClick={() => setShowExportModal(true)}
            className="px-3 py-1.5 bg-green-600 rounded-lg text-sm hover:bg-green-500 transition"
          >
            Export MLS 📦
          </button>
        )}
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-4">
        {/* File upload area */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-700 rounded-xl p-6 text-center hover:border-gray-500 transition cursor-pointer"
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <div className="text-3xl mb-2">📁</div>
          <p className="text-gray-300">Tap to add photos</p>
          <p className="text-gray-500 text-xs mt-1">or drag & drop</p>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">{files.length} image(s)</span>
              <button onClick={clearFiles} className="text-xs text-red-400 hover:text-red-300">
                Clear all
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 max-h-40 overflow-auto">
              {files.map((f, i) => (
                <div key={i} className="relative group">
                  <div className="aspect-square bg-gray-800 rounded-lg flex items-center justify-center text-xs text-gray-400 overflow-hidden">
                    {f.type?.startsWith('image/') ? (
                      <img
                        src={URL.createObjectURL(f)}
                        alt={f.name}
                        className="w-full h-full object-cover"
                        onLoad={(e) => URL.revokeObjectURL(e.target.src)}
                      />
                    ) : (
                      <span>📄</span>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  >
                    ×
                  </button>
                  <div className="text-[10px] text-gray-500 truncate mt-0.5">{f.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stitch buttons */}
        {files.length >= 2 && status !== 'stitching' && status !== 'uploading' && (
          <div className="flex gap-3">
            <button
              onClick={() => startStitch('draft')}
              disabled={status === 'uploading'}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-semibold transition disabled:opacity-50"
            >
              Quick Preview ⚡
            </button>
            <button
              onClick={() => startStitch('full')}
              disabled={status === 'uploading'}
              className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl font-semibold transition disabled:opacity-50"
            >
              Full Quality ✨
            </button>
          </div>
        )}

        {/* Progress */}
        {(status === 'uploading' || status === 'stitching') && (
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="flex justify-between text-sm mb-2">
              <span>{status === 'uploading' ? 'Uploading...' : 'Stitching...'}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            {/* Logs */}
            <div className="mt-3 max-h-24 overflow-auto text-xs text-gray-400 space-y-0.5">
              {logs.slice(-5).map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Result - 360 Viewer */}
        {status === 'done' && result?.output_url && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">
                {previewMode === 'full' ? 'Full Quality' : 'Quick Preview'} Panorama
              </h2>
              <div className="flex gap-2">
                {!result?.is_full_quality && previewMode === 'draft' && (
                  <button
                    onClick={() => startStitch('full')}
                    className="px-3 py-1.5 bg-purple-600 rounded-lg text-sm hover:bg-purple-500 transition"
                  >
                    Render Full Quality
                  </button>
                )}
                <button
                  onClick={downloadPanorama}
                  className="px-3 py-1.5 bg-gray-700 rounded-lg text-sm hover:bg-gray-600 transition"
                >
                  Download 💾
                </button>
              </div>
            </div>

            {/* 360 Viewer */}
            <div className="rounded-xl overflow-hidden border border-gray-800" style={{ height: '50vh', minHeight: '300px' }}>
              <PanoramaViewer
                imageUrl={result.output_url}
                hotspots={hotspots}
                onAddHotspot={handleAddHotspot}
                editable={true}
              />
            </div>

            {/* Hotspot list */}
            {hotspots.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-3">
                <h3 className="text-sm font-medium mb-2">Hotspots ({hotspots.length})</h3>
                <div className="space-y-1 max-h-32 overflow-auto">
                  {hotspots.map(h => (
                    <div key={h.id} className="flex justify-between items-center text-sm bg-gray-800 px-2 py-1 rounded">
                      <span className="truncate">{h.text}</span>
                      <button
                        onClick={() => removeHotspot(h.id)}
                        className="text-red-400 hover:text-red-300 ml-2"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Image info */}
            {result.width && (
              <div className="text-xs text-gray-500">
                Resolution: {result.width}×{result.height} | Projection: {result.projection || 'equirectangular'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MLS Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl p-5 w-full max-w-md space-y-4">
            <h3 className="text-lg font-bold">Export MLS Package</h3>
            <p className="text-sm text-gray-400">
              Creates a ZIP with the panorama, manifest, and hotspot data.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400">Property Title</label>
                <input
                  type="text"
                  value={exportMeta.title}
                  onChange={(e) => setExportMeta(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g., 123 Main St"
                  className="w-full mt-1 p-2 bg-gray-800 rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Description</label>
                <textarea
                  value={exportMeta.description}
                  onChange={(e) => setExportMeta(p => ({ ...p, description: e.target.value }))}
                  placeholder="Property description..."
                  rows={2}
                  className="w-full mt-1 p-2 bg-gray-800 rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Address</label>
                <input
                  type="text"
                  value={exportMeta.address}
                  onChange={(e) => setExportMeta(p => ({ ...p, address: e.target.value }))}
                  placeholder="Full address"
                  className="w-full mt-1 p-2 bg-gray-800 rounded text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={exportMLS}
                className="flex-1 py-2 bg-green-600 rounded-lg hover:bg-green-500 transition font-medium"
              >
                Download ZIP
              </button>
              <button
                onClick={() => setShowExportModal(false)}
                className="flex-1 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
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
