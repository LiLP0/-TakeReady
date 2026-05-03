import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageShell } from '../components/PageShell';
import { usePageTitle } from '../hooks/usePageTitle';
import { useScriptStorage } from '../hooks/useScriptStorage';

export function HomePage() {
  usePageTitle('Home');
  const navigate = useNavigate();
  const { libraryLoadError, projects } = useScriptStorage();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  function handleCreateNewScript(): void {
    setStatusMessage(null);
    navigate('/editor/new');
  }

  function handleOpenScriptsLibrary(): void {
    if (projects.length > 0 || libraryLoadError) {
      setStatusMessage(null);
      navigate('/scripts');
      return;
    }

    setStatusMessage(
      'No saved LexiCue scripts yet. Create one in the Editor, then manage it from Scripts.',
    );
  }

  function handleGoToImportInScripts(): void {
    setStatusMessage(null);
    navigate('/scripts');
  }

  return (
    <PageShell
      description="LexiCue helps creators break long scripts into focused recording cards with delivery notes, pause cues, B-roll ideas, progress tracking, and dyslexia-friendly reading controls."
      title="LexiCue Studio"
      variant="hero"
    >
      <div className="panel-grid">
        <section className="panel panel-half">
          <h2>Start a project</h2>
          <p className="page-note">
            Start a new script here, then use Scripts to reopen the exact
            project you want to edit or record later. Import and export also
            live in Scripts.
          </p>
          <div className="home-action-cluster">
            <button
              className="text-link is-primary home-primary-action"
              onClick={handleCreateNewScript}
              type="button"
            >
              Create New Script
            </button>
            <div className="home-secondary-actions">
              <button
                className="text-link home-secondary-action"
                onClick={handleOpenScriptsLibrary}
                type="button"
              >
                Open Scripts Library
              </button>
              <button
                className="text-link home-secondary-action"
                onClick={handleGoToImportInScripts}
                type="button"
              >
                Go to Import in Scripts
              </button>
            </div>
          </div>
          {statusMessage ? (
            <p aria-live="polite" className="page-note home-action-status">
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
