import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { ChunkBoundaryEditor } from '../components/ChunkBoundaryEditor';
import { PageShell } from '../components/PageShell';
import { usePageTitle } from '../hooks/usePageTitle';
import { useScriptStorage } from '../hooks/useScriptStorage';
import type { ScriptChunk, ScriptProject, ScriptSection } from '../types/script';
import { chunkScript } from '../utils/chunkScript';

const MAIN_SECTION_ID = 'main';
const MAIN_SECTION_TITLE = 'Main';
const DELIVERY_EMOJI_CUES = [
  { emoji: '😐', label: 'neutral' },
  { emoji: '😄', label: 'joyful' },
  { emoji: '😠', label: 'angry' },
  { emoji: '😕', label: 'confused' },
  { emoji: '😏', label: 'sarcastic' },
  { emoji: '😳', label: 'shocked' },
  { emoji: '😢', label: 'sad' },
  { emoji: '🤨', label: 'suspicious' },
  { emoji: '😶', label: 'deadpan' },
  { emoji: '🔥', label: 'intense' },
];

type SectionTemplate = Pick<ScriptSection, 'description' | 'id' | 'title'>;

function createProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `project-${Date.now()}`;
}

function createMainSectionTemplate(): SectionTemplate {
  return {
    description: '',
    id: MAIN_SECTION_ID,
    title: MAIN_SECTION_TITLE,
  };
}

function getSavedChunks(project: ScriptProject): ScriptChunk[] {
  return sortChunksByRange(
    project.sections.flatMap((section) =>
      section.chunks.map((chunk) => ({
        ...chunk,
        sectionId: chunk.sectionId ?? section.id,
      })),
    ),
  );
}

function sortChunksByRange(chunks: ScriptChunk[]): ScriptChunk[] {
  return [...chunks].sort(
    (leftChunk, rightChunk) =>
      leftChunk.startIndex - rightChunk.startIndex ||
      leftChunk.endIndex - rightChunk.endIndex,
  );
}

function createSectionTemplates(sections: ScriptSection[]): SectionTemplate[] {
  return sections.map((section) => ({
    description: section.description,
    id: section.id,
    title: section.title,
  }));
}

function getRechunkSectionTemplate(templates: SectionTemplate[]): SectionTemplate {
  if (templates.length === 1) {
    return templates[0];
  }

  return createMainSectionTemplate();
}

function buildSectionsFromOwnership(
  chunks: ScriptChunk[],
  templates: SectionTemplate[],
): ScriptSection[] {
  if (chunks.length === 0) {
    if (templates.length === 0) {
      return [];
    }

    return templates.map((template) => ({
      chunks: [],
      description: template.description,
      id: template.id,
      title: template.title,
    }));
  }

  const fallbackTemplate =
    templates.length === 1 ? templates[0] : createMainSectionTemplate();
  const orderedTemplates = templates.length > 0 ? templates : [fallbackTemplate];
  const sectionOrder = orderedTemplates.map((template) => template.id);
  const sectionMap = new Map(
    orderedTemplates.map((template) => [
      template.id,
      {
        chunks: [] as ScriptChunk[],
        description: template.description,
        id: template.id,
        title: template.title,
      },
    ]),
  );

  sortChunksByRange(chunks).forEach((chunk) => {
    const nextSectionId =
      chunk.sectionId && sectionMap.has(chunk.sectionId)
        ? chunk.sectionId
        : fallbackTemplate.id;
    const nextSection =
      sectionMap.get(nextSectionId) ??
      {
        chunks: [] as ScriptChunk[],
        description: fallbackTemplate.description,
        id: fallbackTemplate.id,
        title: fallbackTemplate.title,
      };

    if (!sectionMap.has(nextSectionId)) {
      sectionMap.set(nextSectionId, nextSection);
      sectionOrder.push(nextSectionId);
    }

    nextSection.chunks.push({
      ...chunk,
      sectionId: nextSectionId,
    });
  });

  return sectionOrder
    .map((sectionId) => sectionMap.get(sectionId))
    .filter((section): section is ScriptSection => Boolean(section))
    .map((section) => ({
      ...section,
      chunks: sortChunksByRange(section.chunks),
    }));
}

function createEditorSnapshot(
  title: string,
  rawScript: string,
  chunks: ScriptChunk[],
): string {
  return JSON.stringify({
    title,
    rawScript,
    chunks,
  });
}

function formatChunkCount(chunkCount: number): string {
  return `${chunkCount} performance chunk${chunkCount === 1 ? '' : 's'}`;
}

function getCloudSyncStatusLabel(cloudSyncState: ScriptProject['cloudSyncState']): string {
  if (cloudSyncState === 'synced') {
    return 'Cloud synced';
  }

  if (cloudSyncState === 'syncing') {
    return 'Cloud syncing';
  }

  if (cloudSyncState === 'sync_error') {
    return 'Cloud sync error';
  }

  return 'Local only';
}

function getRechunkConfirmationMessage(hasMultipleSections: boolean): string {
  if (hasMultipleSections) {
    return 'Chunk edits already exist. Click Confirm Re-chunk to replace them from the raw script. This will also collapse the project into a single Main section.';
  }

  return 'Chunk edits already exist. Click Confirm Re-chunk to replace them from the raw script.';
}

export function EditorPage() {
  usePageTitle('Create');
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId: routeProjectId } = useParams();
  const {
    googleAppAuthState,
    isLibraryWriteBlocked,
    load,
    loadProject,
    projects,
    save,
    syncProjectToGoogleDrive,
  } = useScriptStorage();
  const isNewProjectRoute = location.pathname === '/editor/new';
  const [title, setTitle] = useState('');
  const [rawScript, setRawScript] = useState('');
  const [generatedChunks, setGeneratedChunks] = useState<ScriptChunk[]>([]);
  const [sectionTemplates, setSectionTemplates] = useState<SectionTemplate[]>(
    [],
  );
  const [chunkSourceRawScript, setChunkSourceRawScript] = useState('');
  const [googleDriveFileId, setGoogleDriveFileId] = useState<
    ScriptProject['googleDriveFileId']
  >(undefined);
  const [cloudSyncState, setCloudSyncState] = useState<
    ScriptProject['cloudSyncState']
  >('local_only');
  const [isBoundaryEditorOpen, setIsBoundaryEditorOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [missingProjectId, setMissingProjectId] = useState<string | null>(null);
  const [sessionNotes, setSessionNotes] = useState<
    ScriptProject['sessionNotes']
  >([]);
  const [isConfirmingRechunk, setIsConfirmingRechunk] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() =>
    createEditorSnapshot('', '', []),
  );
  const currentSnapshot = createEditorSnapshot(title, rawScript, generatedChunks);
  const hasUnsavedChanges = currentSnapshot !== lastSavedSnapshot;
  const hasChunkedData = generatedChunks.length > 0;
  const isChunkDataOutOfSync =
    hasChunkedData && rawScript !== chunkSourceRawScript;
  const hasMultipleSectionTemplates = sectionTemplates.length > 1;
  const isGenericEditorRoute = !isNewProjectRoute && !routeProjectId;
  const hasMultipleSavedProjects = projects.length > 1;
  const editorContextLabel = projectId ? 'Editing saved script' : 'New script';

  function resetEditorState(
    nextStatusMessage: string | null = null,
    nextMissingProjectId: string | null = null,
  ): void {
    setTitle('');
    setRawScript('');
    setGeneratedChunks([]);
    setSectionTemplates([]);
    setChunkSourceRawScript('');
    setGoogleDriveFileId(undefined);
    setCloudSyncState('local_only');
    setIsBoundaryEditorOpen(false);
    setProjectId(null);
    setCreatedAt(null);
    setMissingProjectId(nextMissingProjectId);
    setSessionNotes([]);
    setIsConfirmingRechunk(false);
    setStatusMessage(nextStatusMessage);
    setLastSavedSnapshot(createEditorSnapshot('', '', []));
  }

  function loadProjectIntoEditor(project: ScriptProject): void {
    const savedChunks = getSavedChunks(project);

    setTitle(project.title);
    setRawScript(project.rawScript);
    setGeneratedChunks(savedChunks);
    setSectionTemplates(createSectionTemplates(project.sections));
    setChunkSourceRawScript(project.chunkSourceRawScript);
    setGoogleDriveFileId(project.googleDriveFileId);
    setCloudSyncState(project.cloudSyncState);
    setIsBoundaryEditorOpen(false);
    setProjectId(project.id);
    setCreatedAt(project.createdAt);
    setMissingProjectId(null);
    setSessionNotes(project.sessionNotes);
    setIsConfirmingRechunk(false);
    setStatusMessage(null);
    setLastSavedSnapshot(
      createEditorSnapshot(project.title, project.rawScript, savedChunks),
    );
  }

  useEffect(() => {
    if (isNewProjectRoute) {
      resetEditorState();
      return;
    }

    if (routeProjectId && routeProjectId === projectId) {
      return;
    }

    const projectToLoad = routeProjectId
      ? loadProject(routeProjectId)
      : load();

    if (!projectToLoad) {
      resetEditorState(
        null,
        routeProjectId ?? null,
      );
      return;
    }

    loadProjectIntoEditor(projectToLoad);
  }, [isNewProjectRoute, projectId, routeProjectId]);

  function handleTitleChange(nextTitle: string): void {
    setTitle(nextTitle);
    setIsConfirmingRechunk(false);
    setStatusMessage(null);
  }

  function handleRawScriptChange(nextRawScript: string): void {
    setRawScript(nextRawScript);
    setIsConfirmingRechunk(false);

    if (generatedChunks.length > 0) {
      setStatusMessage(null);
      return;
    }

    setStatusMessage(null);
  }

  function createChunksFromRawScript(): void {
    if (!rawScript.trim()) {
      setIsConfirmingRechunk(false);
      setStatusMessage('Paste or type a rough script first, then try chunking again.');
      return;
    }

    const nextSectionTemplate = getRechunkSectionTemplate(sectionTemplates);
    const chunks = chunkScript(rawScript, {
      sectionId: nextSectionTemplate.id,
    });

    if (chunks.length === 0) {
      setIsConfirmingRechunk(false);
      setStatusMessage('No readable chunks were created from that draft yet.');
      return;
    }

    setGeneratedChunks(chunks);
    setSectionTemplates([nextSectionTemplate]);
    setChunkSourceRawScript(rawScript);
    setIsConfirmingRechunk(false);
    setStatusMessage(
      `Created ${chunks.length} chunk${chunks.length === 1 ? '' : 's'} in the ${nextSectionTemplate.title} section.`,
    );
  }

  function handleChunkScript(): void {
    if (hasChunkedData && !isConfirmingRechunk) {
      setIsConfirmingRechunk(true);
      setStatusMessage(
        getRechunkConfirmationMessage(hasMultipleSectionTemplates),
      );
      return;
    }

    createChunksFromRawScript();
  }

  function handleSaveScript(): void {
    if (isLibraryWriteBlocked) {
      setStatusMessage(
        'Saved library data could not be read. Saving is temporarily blocked to avoid overwriting recoverable data. Use Scripts to recover or intentionally replace the library first.',
      );
      return;
    }

    const now = new Date().toISOString();
    const nextProjectId = projectId ?? createProjectId();
    const nextCreatedAt = createdAt ?? now;
    const nextSections = buildSectionsFromOwnership(
      generatedChunks,
      sectionTemplates,
    );
    const nextCloudSyncState =
      googleAppAuthState === 'signed_in_drive_connected'
        ? 'syncing'
        : 'local_only';

    const nextProject: ScriptProject = {
      id: nextProjectId,
      title,
      rawScript,
      chunkSourceRawScript: generatedChunks.length > 0
        ? chunkSourceRawScript
        : rawScript,
      googleDriveFileId,
      cloudSyncState: nextCloudSyncState,
      createdAt: nextCreatedAt,
      updatedAt: now,
      sections: nextSections,
      sessionNotes,
    };

    const didSave = save(nextProject);

    if (didSave === 'blocked') {
      setStatusMessage(
        'Saved library data could not be read. Saving is temporarily blocked to avoid overwriting recoverable data. Use Scripts to recover or intentionally replace the library first.',
      );
      return;
    }

    if (didSave !== 'success') {
      return;
    }

    setProjectId(nextProjectId);
    setCreatedAt(nextCreatedAt);
    setCloudSyncState(nextCloudSyncState);
    setSectionTemplates(createSectionTemplates(nextSections));
    setIsConfirmingRechunk(false);
    setLastSavedSnapshot(
      createEditorSnapshot(nextProject.title, nextProject.rawScript, generatedChunks),
    );
    setStatusMessage(
      nextCloudSyncState === 'syncing'
        ? 'Saved locally. Google Drive sync is running in the background.'
        : googleAppAuthState === 'signed_in'
          ? 'Saved locally. Reconnect cloud sync in Scripts when you want Drive updates again.'
          : generatedChunks.length > 0
            ? isChunkDataOutOfSync
              ? 'Saved locally. Your current chunk structure was preserved even though it is out of sync with the latest raw script. Confirm Re-chunk when you are ready to replace it.'
              : `Saved locally with ${formatChunkCount(generatedChunks.length)}. Open Performance when you are ready to record.`
            : 'Saved locally as a raw script draft. Chunk it before opening Performance.',
    );

    if (isNewProjectRoute) {
      navigate(`/editor/${nextProjectId}`, { replace: true });
    }

    if (nextCloudSyncState === 'syncing') {
      void syncProjectToGoogleDrive(nextProjectId).then((syncResult) => {
        if (syncResult.data) {
          setGoogleDriveFileId(syncResult.data.googleDriveFileId);
          setCloudSyncState(syncResult.data.cloudSyncState);
        }

        if (syncResult.status === 'success') {
          setStatusMessage('Saved locally and synced to Google Drive.');
          return;
        }

        setCloudSyncState('sync_error');
        setStatusMessage(
          'Saved locally, but Google Drive sync failed. Your local script is still safe.',
        );
      });
    }
  }

  function handleOpenPerformance(): void {
    const activeProjectId = projectId ?? routeProjectId;

    navigate(
      activeProjectId ? `/performance/${activeProjectId}` : '/performance',
    );
  }

  function handleBackToHome(): void {
    navigate('/');
  }

  function handleBackToScripts(): void {
    navigate('/scripts');
  }

  function handleOpenBoundaryEditor(): void {
    if (isChunkDataOutOfSync) {
      return;
    }

    setIsBoundaryEditorOpen(true);
  }

  function handleCloseBoundaryEditor(): void {
    setIsBoundaryEditorOpen(false);
  }

  function handleBoundaryEditorDone(nextChunks: ScriptChunk[]): void {
    setGeneratedChunks(nextChunks);
    setIsBoundaryEditorOpen(false);
    setIsConfirmingRechunk(false);
    setStatusMessage('Chunk boundaries updated. Review the preview or save when ready.');
  }

  function handleChunkEmojiCueChange(
    chunkId: string,
    nextEmojiCue: string,
  ): void {
    setGeneratedChunks((currentChunks) =>
      currentChunks.map((chunk) => {
        if (chunk.id !== chunkId) {
          return chunk;
        }

        return nextEmojiCue
          ? {
              ...chunk,
              emojiCue: nextEmojiCue,
            }
          : {
              ...chunk,
              emojiCue: undefined,
            };
      }),
    );
    setStatusMessage(null);
  }

  if (missingProjectId) {
    return (
      <PageShell
        title="Create"
      >
        <section className="panel missing-project">
          <p className="script-context-label">Missing script</p>
          <h2>Script not found</h2>
          <p className="page-note">
            This script may have been deleted or replaced. Head back to Scripts
            to choose another saved project.
          </p>
          <div className="action-row">
            <button
              className="text-link is-primary"
              onClick={handleBackToScripts}
              type="button"
            >
              Back to Scripts
            </button>
            <button
              className="text-link"
              onClick={handleBackToHome}
              type="button"
            >
              Back to Home
            </button>
          </div>
        </section>
      </PageShell>
    );
  }

  return (
    <>
      <PageShell
        title="Create"
      >
        <section className="panel editor-panel">
          {isGenericEditorRoute && hasMultipleSavedProjects ? (
            <div className="route-context-notice" aria-live="polite">
              <p className="route-context-note">
                You are viewing the most recently updated script in your
                library.
              </p>
              <button
                className="text-link"
                onClick={handleBackToScripts}
                type="button"
              >
                Choose a Different Script
              </button>
            </div>
          ) : null}

          <section
            className="editor-writing-surface"
            aria-label="Script writing workspace"
          >
            <div className="editor-compact-meta" aria-label="Editor metadata">
              <span>{editorContextLabel}</span>
              <span>
                {hasChunkedData
                  ? formatChunkCount(generatedChunks.length)
                  : 'Raw draft'}
              </span>
              <span>{getCloudSyncStatusLabel(cloudSyncState)}</span>
            </div>

            <div className="field-group editor-title-field">
              <input
                aria-label="Script title"
                className="field-input editor-title-input"
                id="script-title"
                onChange={(event) => handleTitleChange(event.target.value)}
                placeholder="Enter a working title"
                type="text"
                value={title}
              />
            </div>

            <div className="field-group editor-raw-script-field">
              <textarea
                aria-label="Raw script"
                className="field-textarea editor-raw-script-input"
                id="raw-script"
                onChange={(event) => handleRawScriptChange(event.target.value)}
                placeholder="Paste or write your rough script here."
                value={rawScript}
              />
            </div>
            <div className="action-row editor-action-row">
              <div className="editor-action-group is-main">
                <button
                  className={`text-link editor-action-secondary ${
                    isConfirmingRechunk ? 'is-warning' : ''
                  }`}
                  onClick={handleChunkScript}
                  type="button"
                >
                  {isConfirmingRechunk ? 'Confirm Re-chunk' : 'Chunk Script'}
                </button>
                <button
                  className="text-link is-primary editor-action-primary"
                  disabled={isLibraryWriteBlocked}
                  onClick={handleSaveScript}
                  title={
                    isLibraryWriteBlocked
                      ? 'Saving is temporarily blocked while unreadable saved library data is protected from overwrite.'
                      : undefined
                  }
                  type="button"
                >
                  Save Script
                </button>
              </div>

              {hasChunkedData ? (
                <div className="editor-action-group is-utility">
                  {generatedChunks.length > 0 ? (
                    <button
                      className="text-link editor-action-utility"
                      disabled={isChunkDataOutOfSync}
                      onClick={handleOpenBoundaryEditor}
                      title={
                        isChunkDataOutOfSync
                          ? 'Confirm Re-chunk before editing chunk boundaries again.'
                          : 'Adjust chunk boundaries against the current raw script.'
                      }
                      type="button"
                    >
                      Edit Chunk Boundaries
                    </button>
                  ) : null}
                  {hasChunkedData ? (
                    <button
                      className="text-link editor-action-utility"
                      disabled={hasUnsavedChanges}
                      onClick={handleOpenPerformance}
                      title={
                        hasUnsavedChanges
                          ? 'Save this chunked project before opening Performance.'
                          : 'Open the saved recording view.'
                      }
                      type="button"
                    >
                      Open Performance
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="editor-action-group is-tertiary">
                <button
                  className="text-link editor-action-tertiary"
                  onClick={handleBackToHome}
                  type="button"
                >
                  Back to Home
                </button>
              </div>
            </div>

            <p
              aria-live="polite"
              className={`editor-save-state ${
                hasUnsavedChanges || isChunkDataOutOfSync
                  ? 'has-unsaved'
                  : 'is-saved'
              }`}
            >
              {isChunkDataOutOfSync
                ? hasUnsavedChanges
                  ? `Raw script changed. Save to keep these ${formatChunkCount(generatedChunks.length)} while they remain out of sync, or confirm Re-chunk to replace them.`
                  : `Saved locally, but these ${formatChunkCount(generatedChunks.length)} are still out of sync with the raw script. Confirm Re-chunk when you are ready to replace them.`
                : hasUnsavedChanges
                  ? hasChunkedData
                    ? `Unsaved changes. Save these ${formatChunkCount(generatedChunks.length)} before opening Performance.`
                    : 'Unsaved changes.'
                  : hasChunkedData
                    ? `Saved locally with ${formatChunkCount(generatedChunks.length)} ready for Performance.`
                    : 'No unsaved changes.'}
            </p>

            {!hasChunkedData ? (
              <p className="page-note editor-preview-hint">
                Chunk preview appears here after you click Chunk Script.
              </p>
            ) : null}

            {isChunkDataOutOfSync ? (
              <p className="page-note editor-action-note">
                Boundary editing uses the current raw script. Confirm Re-chunk
                first to safely edit boundaries again.
              </p>
            ) : null}

            <div className="editor-feedback-stack">
              {isChunkDataOutOfSync ? (
                <p aria-live="polite" className="status-message is-error">
                  Raw script changed after chunking. Your current chunks,
                  boundary edits, and delivery cues are still preserved. Save
                  will keep this chunk structure until you confirm Re-chunk.
                </p>
              ) : null}

              {isLibraryWriteBlocked ? (
                <p aria-live="polite" className="status-message is-error">
                  Saved library data could not be read. Saving is temporarily
                  blocked to avoid overwriting recoverable data. Open Scripts
                  before replacing the library.
                </p>
              ) : null}

              {statusMessage ? (
                <p aria-live="polite" className="status-message">
                  {statusMessage}
                </p>
              ) : null}
            </div>
          </section>

          {hasChunkedData ? (
            <section className="editor-preview-surface" aria-label="Chunk preview">
              <div className="editor-section-header">
                <h2 className="editor-preview-title">Chunk preview</h2>
                <div className="editor-chunk-summary" aria-live="polite">
                  <span>{formatChunkCount(generatedChunks.length)}</span>
                  <span
                    className={`editor-chunk-save-state ${
                      hasUnsavedChanges || isChunkDataOutOfSync
                        ? 'has-unsaved'
                        : 'is-saved'
                    }`}
                  >
                    {isChunkDataOutOfSync
                      ? hasUnsavedChanges
                        ? 'Out of sync'
                        : 'Saved, out of sync'
                      : hasUnsavedChanges
                        ? 'Unsaved changes'
                        : 'Saved locally'}
                  </span>
                </div>
              </div>

              <ol className="chunk-preview-list">
                {generatedChunks.map((chunk, index) => (
                  <li className="chunk-preview-item" key={chunk.id}>
                    <span className="chunk-preview-number">
                      {index + 1}
                    </span>
                    <div className="chunk-preview-body">
                      <div className="chunk-preview-text-row">
                        <p className="chunk-preview-text">{chunk.text}</p>
                        <span
                          className={`chunk-preview-emoji ${
                            chunk.emojiCue ? 'has-cue' : ''
                          }`}
                          aria-label={
                            chunk.emojiCue
                              ? `Delivery cue ${chunk.emojiCue}`
                              : 'No delivery cue'
                          }
                        >
                          {chunk.emojiCue || 'No cue'}
                        </span>
                      </div>
                      <label
                        className="chunk-emoji-control"
                        htmlFor={`chunk-emoji-${chunk.id}`}
                      >
                        Delivery cue
                        <select
                          className="field-input chunk-emoji-select"
                          id={`chunk-emoji-${chunk.id}`}
                          onChange={(event) =>
                            handleChunkEmojiCueChange(
                              chunk.id,
                              event.target.value,
                            )
                          }
                          value={chunk.emojiCue ?? ''}
                        >
                          <option value="">None</option>
                          {DELIVERY_EMOJI_CUES.map((cue) => (
                            <option key={cue.emoji} value={cue.emoji}>
                              {cue.emoji} {cue.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </section>
      </PageShell>

      {isBoundaryEditorOpen && !isChunkDataOutOfSync ? (
        <ChunkBoundaryEditor
          chunks={generatedChunks}
          onCancel={handleCloseBoundaryEditor}
          onDone={handleBoundaryEditorDone}
          rawScript={rawScript}
        />
      ) : null}
    </>
  );
}
