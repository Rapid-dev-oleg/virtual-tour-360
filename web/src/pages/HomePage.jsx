import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();
  const [showUpload, setShowUpload] = useState(false);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-900/20 to-gray-950" />
        <div className="relative px-6 pt-16 pb-12 text-center">
          <div className="text-5xl mb-4">🏠</div>
          <h1 className="text-3xl font-bold mb-2">360° Virtual Tour</h1>
          <p className="text-gray-400 text-sm max-w-xs mx-auto">
            Capture, stitch, and publish interactive 360° panoramas.
            Mobile-first with AI-powered editing.
          </p>
        </div>
      </div>

      {/* Main actions */}
      <div className="px-4 pb-8 max-w-sm mx-auto space-y-3">
        {/* Guided Capture */}
        <button
          onClick={() => navigate('/capture')}
          className="w-full p-4 bg-blue-600 hover:bg-blue-500 rounded-xl flex items-center gap-4 transition active:scale-[0.98]"
        >
          <span className="text-3xl">📸</span>
          <div className="text-left">
            <div className="font-semibold text-lg">Guided Capture</div>
            <div className="text-xs text-blue-200">Multi-shot panorama with auto-guidance</div>
          </div>
        </button>

        {/* Upload & Stitch */}
        <button
          onClick={() => navigate('/stitch')}
          className="w-full p-4 bg-purple-600 hover:bg-purple-500 rounded-xl flex items-center gap-4 transition active:scale-[0.98]"
        >
          <span className="text-3xl">🧩</span>
          <div className="text-left">
            <div className="font-semibold text-lg">Upload & Stitch</div>
            <div className="text-xs text-purple-200">Combine existing photos into panorama</div>
          </div>
        </button>

        {/* AI Editor */}
        <button
          onClick={() => navigate('/editor')}
          className="w-full p-4 bg-gray-800 hover:bg-gray-700 rounded-xl flex items-center gap-4 transition active:scale-[0.98]"
        >
          <span className="text-3xl">✨</span>
          <div className="text-left">
            <div className="font-semibold text-lg">AI Photo Editor</div>
            <div className="text-xs text-gray-400">Edit panoramas with Gemini AI</div>
          </div>
        </button>
      </div>

      {/* Features */}
      <div className="px-4 pb-12 max-w-sm mx-auto">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Features</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['📱', 'Mobile First'],
            ['🤖', 'AI Editing'],
            ['🌐', '360° Viewer'],
            ['📋', 'MLS Export'],
            ['🔥', 'Hotspot Editor'],
            ['⚡', 'Fast Preview'],
          ].map(([icon, label]) => (
            <div key={label} className="bg-gray-900 rounded-lg p-3 text-center">
              <div className="text-xl mb-1">{icon}</div>
              <div className="text-xs text-gray-400">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
