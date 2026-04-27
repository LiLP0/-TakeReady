import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageShell } from '../components/PageShell';
import { usePageTitle } from '../hooks/usePageTitle';
import { useScriptStorage } from '../hooks/useScriptStorage';

export function HomePage() {
  usePageTitle('Home');
  const navigate = useNavigate();
  const { projects } = useScriptStorage();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  function handleCreateNewScript(): void {
    setStatusMessage(null);
    navigate('/editor/new');
  }

  function handleOpenScriptsLibrary(): void {
    if (projects.length > 0) {
      setStatusMessage(null);
      navigate('/scripts');
      return;
    }

    setStatusMessage(
      'No saved BitFeeder scripts yet. Create one in the Editor, then manage it from Scripts.',
    );
  }

  function handleImportProjectJson(): void {
    setStatusMessage(
      'Import is available from Scripts when you are ready to bring in a saved BitFeeder project.',
    );
  }

  return (
    <PageShell
      description="BitFeeder helps YouTube creators turn rough scripts into performance-friendly chunks for easier recording."
      title="BitFeeder"
    >
      <div className="panel-grid">
        <section className="panel panel-half">
          <h2>Start a project</h2>
          <p className="page-note">
            Start a new script here, then use Scripts to reopen the exact
            project you want to edit or record later.
          </p>
          <div className="link-row">
            <button
              className="text-link"
              onClick={handleCreateNewScript}
              type="button"
            >
              Create New Script
            </button>
            <button
              className="text-link"
              onClick={handleOpenScriptsLibrary}
              type="button"
            >
              Open Scripts Library
            </button>
            <button
              className="text-link"
              onClick={handleImportProjectJson}
              type="button"
            >
              Import Project JSON
            </button>
          </div>
          {statusMessage ? (
            <p aria-live="polite" className="page-note">
              {statusMessage}
            </p>
          ) : null}
        </section>

        <section className="panel panel-half">
          <h2>Built for creator flow</h2>
          <ul className="page-list">
            <li>Desktop-first editing for structuring rough scripts</li>
            <li>Script library for choosing the exact project you want</li>
            <li>Minimal interface that keeps spoken text central</li>
            <li>Dark-friendly foundation for longer writing sessions</li>
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
