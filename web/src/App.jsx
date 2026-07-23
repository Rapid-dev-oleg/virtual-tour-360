import { Routes, Route } from 'react-router-dom';
import BalanceBadge from './components/BalanceBadge.jsx';
import HomePage from './pages/HomePage.jsx';
import CreatePage from './pages/CreatePage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import RoomEditorPage from './pages/RoomEditorPage.jsx';
import CapturePage from './pages/CapturePage.jsx';
import PanoramaPage from './pages/PanoramaPage.jsx';
import CornerPanoramaPage from './pages/CornerPanoramaPage.jsx';
import RealStitchPage from './pages/RealStitchPage.jsx';
import PanoramasPage from './pages/PanoramasPage.jsx';
import ViewerPage from './pages/ViewerPage.jsx';

export default function App() {
  return (
    <>
    <BalanceBadge />
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/create" element={<CreatePage />} />
      <Route path="/tour/:id/edit" element={<EditorPage />} />
      <Route path="/tour/:id/room" element={<RoomEditorPage />} />
      <Route path="/tour/:id/capture" element={<CapturePage />} />
      <Route path="/panorama" element={<PanoramaPage />} />
      <Route path="/panorama/corners" element={<CornerPanoramaPage />} />
      <Route path="/panorama/stitch" element={<RealStitchPage />} />
      <Route path="/panoramas" element={<PanoramasPage />} />
      <Route path="/t/:id" element={<ViewerPage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
    </>
  );
}
