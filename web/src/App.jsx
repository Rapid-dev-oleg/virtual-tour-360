import React from 'react';
import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import StitchingPage from './pages/StitchingPage';
import GuidedCapture from './components/GuidedCapture';
import EditorPage from './pages/EditorPage';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/capture" element={<GuidedCapture />} />
        <Route path="/stitch" element={<StitchingPage />} />
        <Route path="/editor" element={<EditorPage />} />
      </Routes>
    </div>
  );
}
