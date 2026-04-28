import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageShell } from '../components/PageShell';
import { usePageTitle } from '../hooks/usePageTitle';
import { useScriptStorage } from '../hooks/useScriptStorage';
import type { ScriptProject } from '../types/script';
import {
  compareDateStringsDescending,
  type LibraryLoadError,
  parseImportedProjects,
  type ProjectCleanupSummary,
  saveImportedProjects,
} from '../utils/storage';

type SortMode = 'updated' | 'title';
type LibraryStatus = {
  message: string;
  type: 'error' | 'success';
};

function createProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `project-${Date.now()}`;
}

function getChunkCount(project: ScriptProject): number {
  return project.sections.reduce(
    (totalChunks, section) => totalChunks + section.chunks.length,
    0,
  );
}

function formatUpdatedAt(updatedAt: string): string {
  const updatedDate = new Date(updatedAt);

  if (Number.isNaN(updatedDate.getTime())) {
    return updatedAt;
  }

  return updatedDate.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function sortProjects(
  projects: ScriptProject[],
  sortMode: SortMode,
): ScriptProject[] {
  return [...projects].sort((firstProject, secondProject) => {
    if (sortMode === 'title') {
      return (firstProject.title.trim() || 'Untitled script').localeCompare(
        secondProject.title.trim() || 'Untitled script',
        undefined,
        { sensitivity: 'base' },
      );
    }

    return compareDateStringsDescending(
      firstProject.updatedAt,
      secondProject.updatedAt,
    );
  });
}

function filterProjectsByTitle(
  projects: ScriptProject[],
  searchTerm: string,
): ScriptProject[] {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  if (!normalizedSearchTerm) {
    return projects;
  }

  return projects.filter((project) =>
    (project.title.trim() || 'Untitled script')
      .toLowerCase()
      .includes(normalizedSearchTerm),
  );
}

function createCopyTitle(project: ScriptProject, projects: ScriptProject[]): string {
  const baseTitle = project.title.trim() || 'Untitled script';
  const firstCopyTitle = `${baseTitle} Copy`;
  const existingTitles = new Set(
    projects.map((storedProject) => storedProject.title.trim().toLowerCase()),
  );

  if (!existingTitles.has(firstCopyTitle.toLowerCase())) {
    return firstCopyTitle;
  }

  let copyNumber = 2;
  let nextTitle = `${firstCopyTitle} ${copyNumber}`;

  while (existingTitles.has(nextTitle.toLowerCase())) {
    copyNumber += 1;
    nextTitle = `${firstCopyTitle} ${copyNumber}`;
  }

  return nextTitle;
}

function duplicateProject(
  project: ScriptProject,
  projects: ScriptProject[],
): ScriptProject {
  const now = new Date().toISOString();

  return {
    ...project,
    id: createProjectId(),
    title: createCopyTitle(project, projects),
    createdAt: now,
    updatedAt: now,
    sections: project.sections.map((section) => ({
      ...section,
      chunks: section.chunks.map((chunk) => ({ ...chunk })),
    })),
    sessionNotes: project.sessionNotes.map((sessionNote) => ({
      ...sessionNote,
    })),
  };
}

function getScriptTitle(project: ScriptProject): string {
  return project.title.trim() || 'Untitled script';
}

function getSafeFilenamePart(title: string): string {
  const filenamePart = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');

  return filenamePart || 'untitled-script';
}

function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatCleanupCount(
  count: number,
  singularLabel: string,
  pluralLabel: string,
): string {
  return `${count} ${count === 1 ? singularLabel : pluralLabel}`;
}

function formatCleanupDetails(summary: ProjectCleanupSummary): string {
  const cleanupParts: string[] = [];

  if (summary.skippedProjectCount > 0) {
    cleanupParts.push(
      `${formatCleanupCount(summary.skippedProjectCount, 'invalid project was', 'invalid projects were')} skipped`,
    );
  }

  if (summary.filteredChunkCount > 0) {
    cleanupParts.push(
      `${formatCleanupCount(summary.filteredChunkCount, 'invalid chunk was', 'invalid chunks were')} removed`,
    );
  }

  return cleanupParts.join(' and ');
}

function formatLoadCleanupMessage(summary: ProjectCleanupSummary): string {
  return `TakeReady cleaned up your saved library while loading it. ${formatCleanupDetails(summary)}.`;
}

function formatImportSuccessMessage(
  importedProjectCount: number,
  fileName: string,
  cleanupSummary: ProjectCleanupSummary | null,
): string {
  const importedProjectsLabel = `Imported ${importedProjectCount} script${
    importedProjectCount === 1 ? '' : 's'
  } from ${fileName}. Matching ids were replaced and the list is refreshed.`;

  if (!cleanupSummary) {
    return importedProjectsLabel;
  }

  return `${importedProjectsLabel} TakeReady cleaned the import so the usable data stayed intact: ${formatCleanupDetails(cleanupSummary)}.`;
}

function formatLibraryLoadErrorMessage(
  libraryLoadError: LibraryLoadError,
): string {
  if (libraryLoadError.code === 'malformed_library') {
    return 'TakeReady found saved library data but could not read it. Write actions are temporarily blocked to avoid overwriting recoverable data. Export any readable scripts first, then recover or intentionally replace the saved library before importing a backup.';
  }

  return 'TakeReady could not read your saved library.';
}

function getWriteBlockedStatusMessage(): string {
  return 'Write actions are temporarily blocked while TakeReady protects unreadable saved library data. Export any readable scripts first, then recover or intentionally replace the saved library before importing a backup.';
}

export function ScriptsPage() {
  usePageTitle('Scripts');
  const navigate = useNavigate();
  const {
    clearProjectCleanupSummary,
    consumeProjectCleanupSummary,
    deleteProject,
    isLibraryWriteBlocked,
    libraryLoadError,
    loadProjects,
    projectCleanupSummary,
    projects,
    save,
  } = useScriptStorage();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('updated');
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(
    null,
  );
  const [renameTitle, setRenameTitle] = useState('');
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<
    string | null
  >(null);
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(
    null,
  );
  const [isImporting, setIsImporting] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(
    null,
  );
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sortedProjects = sortProjects(projects, sortMode);
  const filteredProjects = filterProjectsByTitle(sortedProjects, searchTerm);

  function clearCleanupNotice(): void {
    clearProjectCleanupSummary();
    setCleanupMessage(null);
  }

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (!projectCleanupSummary) {
      return;
    }

    if (projectCleanupSummary.source === 'load') {
      setCleanupMessage(formatLoadCleanupMessage(projectCleanupSummary));
    }

    clearProjectCleanupSummary();
  }, [projectCleanupSummary]);

  function handleOpenEditor(projectId: string): void {
    clearCleanupNotice();
    setPendingDeleteProjectId(null);
    setRenamingProjectId(null);
    navigate(`/editor/${projectId}`);
  }

  function handleOpenPerformance(projectId: string): void {
    clearCleanupNotice();
    setPendingDeleteProjectId(null);
    setRenamingProjectId(null);
    navigate(`/performance/${projectId}`);
  }

  function handleDelete(projectId: string): void {
    clearCleanupNotice();

    if (isLibraryWriteBlocked) {
      setLibraryStatus({
        message: getWriteBlockedStatusMessage(),
        type: 'error',
      });
      return;
    }

    if (pendingDeleteProjectId !== projectId) {
      setPendingDeleteProjectId(projectId);
      setLibraryStatus(null);
      return;
    }

    const didDelete = deleteProject(projectId);

    if (didDelete === 'blocked') {
      setLibraryStatus({
        message: getWriteBlockedStatusMessage(),
        type: 'error',
      });
      return;
    }

    if (didDelete !== 'success') {
      return;
    }

    setPendingDeleteProjectId(null);
    setRenamingProjectId(null);
    setLibraryStatus(null);
  }

  function handleSearchChange(nextSearchTerm: string): void {
    clearCleanupNotice();
    setSearchTerm(nextSearchTerm);
    setPendingDeleteProjectId(null);
  }

  function handleSortChange(nextSortMode: SortMode): void {
    clearCleanupNotice();
    setSortMode(nextSortMode);
    setPendingDeleteProjectId(null);
  }

  function handleDuplicate(project: ScriptProject): void {
    clearCleanupNotice();

    if (isLibraryWriteBlocked) {
      setLibraryStatus({
        message: getWriteBlockedStatusMessage(),
        type: 'error',
      });
      return;
    }

    const didSave = save(duplicateProject(project, projects));

    if (didSave === 'blocked') {
      setLibraryStatus({
        message: getWriteBlockedStatusMessage(),
        type: 'error',
      });
      return;
    }

    if (didSave !== 'success') {
      return;
    }

    setPendingDeleteProjectId(null);
    setRenamingProjectId(null);
    setLibraryStatus(null);
  }

  function handleStartRename(project: ScriptProject): void {
    clearCleanupNotice();

    if (isLibraryWriteBlocked) {
      setLibraryStatus({
        message: getWriteBlockedStatusMessage(),
        type: 'error',
      });
      return;
    }

    setRenamingProjectId(project.id);
    setRenameTitle(project.title);
    setPendingDeleteProjectId(null);
    setLibraryStatus(null);
  }

  function handleCancelRename(): void {
    clearCleanupNotice();
    setRenamingProjectId(null);
    setRenameTitle('');
  }

  function handleSaveRename(project: ScriptProject): void {
    clearCleanupNotice();

    if (isLibraryWriteBlocked) {
      setLibraryStatus({
        message: getWriteBlockedStatusMessage(),
        type: 'error',
      });
      return;
    }

    const now = new Date().toISOString();
    const nextTitle = renameTitle.trim() || 'Untitled script';

    const didSave = save({
      ...project,
      title: nextTitle,
      updatedAt: now,
    });

    if (didSave === 'blocked') {
      setLibraryStatus({
        message: getWriteBlockedStatusMessage(),
        type: 'error',
      });
      return;
    }

    if (didSave !== 'success') {
      return;
    }

    setRenamingProjectId(null);
    setRenameTitle('');
    setPendingDeleteProjectId(null);
    setLibraryStatus(null);
  }

  function handleExportProject(project: ScriptProject): void {
    clearCleanupNotice();
    const scriptTitle = getScriptTitle(project);
    const filename = `${getSafeFilenamePart(scriptTitle)}.json`;

    try {
      downloadJsonFile(filename, project);
      setPendingDeleteProjectId(null);
      setRenamingProjectId(null);
      setLibraryStatus({
        message: `Exported "${scriptTitle}" as ${filename}. Keep it somewhere safe as a backup.`,
        type: 'success',
      });
    } catch {
      setLibraryStatus({
        message: `Export failed for "${scriptTitle}". Try again or export the full library instead.`,
        type: 'error',
      });
    }
  }

  function handleExportAll(): void {
    clearCleanupNotice();

    if (projects.length === 0) {
      setLibraryStatus({
        message: 'Export failed because there are no saved scripts yet.',
        type: 'error',
      });
      return;
    }

    try {
      downloadJsonFile('bitfeeder-script-library.json', projects);
      setPendingDeleteProjectId(null);
      setRenamingProjectId(null);
      setLibraryStatus({
        message: `Exported all ${projects.length} saved script${projects.length === 1 ? '' : 's'} as bitfeeder-script-library.json.`,
        type: 'success',
      });
    } catch {
      setLibraryStatus({
        message: 'Export All failed. Your scripts are still saved locally.',
        type: 'error',
      });
    }
  }

  async function handleImportFile(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    clearCleanupNotice();

    if (isLibraryWriteBlocked) {
      setLibraryStatus({
        message: getWriteBlockedStatusMessage(),
        type: 'error',
      });
      input.value = '';
      return;
    }

    setIsImporting(true);
    setLibraryStatus(null);

    try {
      const parsedJson: unknown = JSON.parse(await file.text());
      const importedProjects = parseImportedProjects(parsedJson);
      const importCleanupSummary = consumeProjectCleanupSummary();

      if (!importedProjects || importedProjects.length === 0) {
        throw new Error('Invalid BitFeeder import');
      }

      const didSaveImportedProjects = saveImportedProjects(importedProjects);

      if (didSaveImportedProjects === 'blocked') {
        setLibraryStatus({
          message: getWriteBlockedStatusMessage(),
          type: 'error',
        });
        return;
      }

      if (didSaveImportedProjects !== 'success') {
        throw new Error('BitFeeder import could not be saved');
      }

      loadProjects();
      setPendingDeleteProjectId(null);
      setRenamingProjectId(null);
      setLibraryStatus({
        message: formatImportSuccessMessage(
          importedProjects.length,
          file.name,
          importCleanupSummary,
        ),
        type: 'success',
      });
    } catch {
      setLibraryStatus({
        message:
          `Import failed for ${file.name}. Choose a TakeReady script export or full library JSON file.`,
        type: 'error',
      });
    } finally {
      input.value = '';
      setIsImporting(false);
    }
  }

  function handleBackHome(): void {
    navigate('/');
  }

  function handleCreateNewScript(): void {
    clearCleanupNotice();
    setPendingDeleteProjectId(null);
    setRenamingProjectId(null);
    setLibraryStatus(null);
    navigate('/editor/new');
  }

  function handleOpenImportPicker(): void {
    if (isImporting || isLibraryWriteBlocked) {
      return;
    }

    importInputRef.current?.click();
  }

  return (
    <PageShell
      description="Review your saved TakeReady scripts and open the one you want to edit or record."
      title="Scripts"
    >
      <section className="panel scripts-toolbar" aria-label="Script library tools">
        <div className="scripts-library-actions">
          <button
            className="text-link is-primary"
            onClick={handleCreateNewScript}
            type="button"
          >
            Create New Script
          </button>
          <button
            className="text-link"
            disabled={projects.length === 0}
            onClick={handleExportAll}
            type="button"
          >
            Export All
          </button>
          <button
            className="text-link scripts-import-button"
            disabled={isImporting || isLibraryWriteBlocked}
            onClick={handleOpenImportPicker}
            title={
              isLibraryWriteBlocked
                ? 'Import is temporarily blocked while unreadable saved library data is protected from overwrite.'
                : undefined
            }
            type="button"
          >
            {isImporting ? 'Importing...' : 'Import'}
          </button>
          <input
            accept="application/json,.json"
            className="visually-hidden"
            disabled={isImporting || isLibraryWriteBlocked}
            id="script-import"
            onChange={handleImportFile}
            ref={importInputRef}
            tabIndex={-1}
            type="file"
          />
        </div>

        {sortedProjects.length > 0 ? (
          <div className="scripts-toolbar-controls">
            <div className="field-group">
              <label className="field-label" htmlFor="script-search">
                Search saved scripts
              </label>
              <input
                className="field-input scripts-search-input"
                id="script-search"
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder="Filter by title"
                type="search"
                value={searchTerm}
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="script-sort">
                Sort scripts
              </label>
              <select
                className="field-input"
                id="script-sort"
                onChange={(event) =>
                  handleSortChange(event.target.value as SortMode)
                }
                value={sortMode}
              >
                <option value="updated">Recently updated</option>
                <option value="title">Title A-Z</option>
              </select>
            </div>
          </div>
        ) : null}

        {libraryStatus ? (
          <p
            aria-live="polite"
            className={`status-message ${
              libraryStatus.type === 'error' ? 'is-error' : 'is-success'
            }`}
          >
            {libraryStatus.message}
          </p>
        ) : null}

        {cleanupMessage ? (
          <p aria-live="polite" className="status-message is-success">
            {cleanupMessage}
          </p>
        ) : null}

        {libraryLoadError ? (
          <p aria-live="polite" className="status-message is-error">
            {formatLibraryLoadErrorMessage(libraryLoadError)}
          </p>
        ) : null}
      </section>

      {libraryLoadError && sortedProjects.length === 0 ? (
        <section className="panel scripts-empty">
          <h2>Saved library needs recovery</h2>
          <p className="page-note">
            TakeReady found saved library data but could not read it. Import a
            saved TakeReady JSON backup from above, or create and save a new
            script to rebuild the local library.
          </p>
          <div className="action-row">
            <button
              className="text-link"
              onClick={handleBackHome}
              type="button"
            >
              Back to Home
            </button>
          </div>
        </section>
      ) : sortedProjects.length === 0 ? (
        <section className="panel scripts-empty">
          <h2>No saved scripts yet</h2>
          <p className="page-note">
            Create and save a script from the Editor, then it will appear here.
          </p>
          <div className="action-row">
            <button
              className="text-link"
              onClick={handleBackHome}
              type="button"
            >
              Back to Home
            </button>
          </div>
        </section>
      ) : (
        <>
          {filteredProjects.length === 0 ? (
            <section className="panel scripts-no-matches">
              <h2>No matching scripts</h2>
              <p className="page-note">
                Try a different title or clear the search to see every saved
                script.
              </p>
            </section>
          ) : (
            <section className="scripts-list" aria-label="Saved scripts">
              {filteredProjects.map((project) => {
                const chunkCount = getChunkCount(project);
                const isChunked = chunkCount > 0;
                const isConfirmingDelete = pendingDeleteProjectId === project.id;
                const isRenaming = renamingProjectId === project.id;

                return (
                  <article className="panel script-card" key={project.id}>
                    <div className="script-card-copy">
                      {isRenaming ? (
                        <input
                          aria-label={`Rename script ${project.title.trim() || 'Untitled script'}`}
                          autoFocus
                          className="field-input script-rename-input"
                          onChange={(event) =>
                            setRenameTitle(event.target.value)
                          }
                          type="text"
                          value={renameTitle}
                        />
                      ) : (
                        <h2 className="script-card-title">
                          {project.title.trim() || 'Untitled script'}
                        </h2>
                      )}
                      <p className="page-note">
                        Updated {formatUpdatedAt(project.updatedAt)}
                      </p>
                      <div className="script-card-meta-row">
                        <span
                          className={`script-status-badge ${
                            isChunked ? 'is-chunked' : 'is-raw'
                          }`}
                        >
                          {isChunked ? 'Chunked' : 'Raw draft'}
                        </span>
                        <p className="script-card-meta">
                          {chunkCount} chunk{chunkCount === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>

                    <div className="script-card-actions">
                      <div
                        className="script-card-action-group"
                        aria-label="Open script"
                      >
                        <span className="script-action-label">Open</span>
                        <button
                          className="text-link"
                          onClick={() => handleOpenEditor(project.id)}
                          type="button"
                        >
                          Open in Editor
                        </button>
                        <button
                          className="text-link"
                          disabled={chunkCount === 0}
                          onClick={() => handleOpenPerformance(project.id)}
                          title={
                            chunkCount === 0
                              ? 'Chunk this script before opening Performance.'
                              : 'Open the recording view for this script.'
                          }
                          type="button"
                        >
                          Open Performance
                        </button>
                      </div>

                      <div
                        className="script-card-action-group"
                        aria-label="Manage script"
                      >
                        <span className="script-action-label">Manage</span>
                        {isRenaming ? (
                          <>
                            <button
                              className="text-link is-primary"
                              disabled={isLibraryWriteBlocked}
                              onClick={() => handleSaveRename(project)}
                              title={
                                isLibraryWriteBlocked
                                  ? 'Rename is temporarily blocked while unreadable saved library data is protected from overwrite.'
                                  : undefined
                              }
                              type="button"
                            >
                              Save Rename
                            </button>
                            <button
                              className="text-link"
                              onClick={handleCancelRename}
                              type="button"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="text-link"
                            disabled={isLibraryWriteBlocked}
                            onClick={() => handleStartRename(project)}
                            title={
                              isLibraryWriteBlocked
                                ? 'Rename is temporarily blocked while unreadable saved library data is protected from overwrite.'
                                : undefined
                            }
                            type="button"
                          >
                            Rename
                          </button>
                        )}
                        <button
                          className="text-link"
                          onClick={() => handleExportProject(project)}
                          type="button"
                        >
                          Export
                        </button>
                        <button
                          className="text-link"
                          disabled={isLibraryWriteBlocked}
                          onClick={() => handleDuplicate(project)}
                          title={
                            isLibraryWriteBlocked
                              ? 'Duplicate is temporarily blocked while unreadable saved library data is protected from overwrite.'
                              : undefined
                          }
                          type="button"
                        >
                          Duplicate
                        </button>
                        <button
                          className={`text-link ${
                            isConfirmingDelete ? 'is-danger' : ''
                          }`}
                          disabled={isLibraryWriteBlocked}
                          onClick={() => handleDelete(project.id)}
                          title={
                            isLibraryWriteBlocked
                              ? 'Delete is temporarily blocked while unreadable saved library data is protected from overwrite.'
                              : undefined
                          }
                          type="button"
                        >
                          {isConfirmingDelete ? 'Confirm Delete' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}
