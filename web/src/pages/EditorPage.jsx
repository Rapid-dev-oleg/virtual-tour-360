import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const PRESETS = [
  { id: 'remove_people', label: 'Remove People', icon: '👥', prompt: 'Remove all people from this image seamlessly. Fill in the background naturally.' },
  { id: 'remove_objects', label: 'Remove Objects', icon: '🪑', prompt: 'Remove all furniture and movable objects. Keep the room structure intact.' },
  { id: 'virtual_stage', label: 'Virtual Staging', icon: '🛋️', prompt: 'Add modern minimalist furniture to this empty room. Make it look professionally staged.' },
  { id: 'brighten', label: 'Brighten', icon: '☀️', prompt: 'Make this image brighter and more inviting. Increase natural lighting.' },
  { id: 'twilight', label: 'Twilight', icon: '🌅', prompt: 'Convert this to a beautiful twilight/dusk scene with warm interior lighting.' },
  { id: 'custom', label: 'Custom', icon: '✏️', prompt: '' },
];

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function EditorPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [image, setImage] = useState(null); // dataURL
  const [file, setFile] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  const handleFileSelect = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setImage(ev.target.result);
    reader.readAsDataURL(f);
    setResult(null);
    setError('');
  };

  const handlePreset = (preset) => {
    setSelectedPreset(preset);
    if (preset.id !== 'custom') {
      setCustomPrompt(preset.prompt);
    } else {
      setCustomPrompt('');
    }
  };

  const processImage = async () => {
    if (!file || !customPrompt) {
      setError('Select an image and enter a prompt');
      return;
    }

    setStatus('processing');
    setError('');

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('prompt', customPrompt);
      if (selectedPreset) {
        formData.append('preset', selectedPreset.id);
      }

      const res = await fetch(`${API_BASE}/api/ai/edit`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Processing failed' }));
        throw new Error(err.detail || `Error: ${res.status}`);
      }

      const data = await res.json();
      setResult(data.image_url || data.result_url);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 p-4 flex items-center gap-3">
        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white">←</button>
        <h1 className="text-lg font-bold">AI Photo Editor</h1>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {/* Upload */}
        {!image && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center hover:border-gray-500 transition cursor-pointer"
          >
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            <div className="text-3xl mb-2">🖼️</div>
            <p className="text-gray-300">Tap to select an image</p>
          </div>
        )}

        {/* Image preview */}
        {image && (
          <div className="relative">
            <img src={image} alt="Source" className="w-full rounded-xl" />
            <button
              onClick={() => { setImage(null); setFile(null); setResult(null); }}
              className="absolute top-2 right-2 px-3 py-1 bg-red-600 rounded-lg text-sm hover:bg-red-500 transition"
            >
              Change
            </button>
          </div>
        )}

        {/* Presets */}
        {image && !result && (
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Select edit type:</label>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handlePreset(p)}
                  className={`p-3 rounded-xl text-center transition ${
                    selectedPreset?.id === p.id
                      ? 'bg-blue-600 ring-2 ring-blue-400'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  <div className="text-xl mb-1">{p.icon}</div>
                  <div className="text-xs">{p.label}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom prompt */}
        {selectedPreset && (
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Prompt:</label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={3}
              className="w-full p-3 bg-gray-800 rounded-xl text-sm resize-none"
              placeholder="Describe what you want to change..."
            />
          </div>
        )}

        {/* Process button */}
        {selectedPreset && (
          <button
            onClick={processImage}
            disabled={status === 'processing' || !customPrompt}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-semibold transition disabled:opacity-50"
          >
            {status === 'processing' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processing with AI...
              </span>
            ) : (
              '✨ Apply AI Edit'
            )}
          </button>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            <h3 className="font-semibold">Result:</h3>
            <img src={result.startsWith('http') ? result : `${API_BASE}${result}`} alt="Edited" className="w-full rounded-xl" />
            <div className="flex gap-2">
              <a
                href={result.startsWith('http') ? result : `${API_BASE}${result}`}
                download
                className="flex-1 py-2 bg-green-600 rounded-lg text-center hover:bg-green-500 transition"
              >
                Download 💾
              </a>
              <button
                onClick={() => { setResult(null); setSelectedPreset(null); }}
                className="flex-1 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
              >
                Edit Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
