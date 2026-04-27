import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/AppLayout';
import { EditorPage } from './pages/EditorPage';
import { HomePage } from './pages/HomePage';
import { PerformancePage } from './pages/PerformancePage';
import { ScriptsPage } from './pages/ScriptsPage';

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="/scripts" element={<ScriptsPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/editor/new" element={<EditorPage />} />
        <Route path="/editor/:projectId" element={<EditorPage />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/performance/:projectId" element={<PerformancePage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Route>
    </Routes>
  );
}

export default App;
