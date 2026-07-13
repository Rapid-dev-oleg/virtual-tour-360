import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import CreatePage from './pages/CreatePage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import ViewerPage from './pages/ViewerPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/create" element={<CreatePage />} />
      <Route path="/tour/:id/edit" element={<EditorPage />} />
      <Route path="/t/:id" element={<ViewerPage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
