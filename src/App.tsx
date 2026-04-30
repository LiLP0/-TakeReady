import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/AppLayout';
import { AccountPage } from './pages/AccountPage';
import { EditorPage } from './pages/EditorPage';
import { HomePage } from './pages/HomePage';
import { PerformancePage } from './pages/PerformancePage';
import { SignInPage } from './pages/SignInPage';
import { ScriptsPage } from './pages/ScriptsPage';

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/account" element={<AccountPage />} />
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
