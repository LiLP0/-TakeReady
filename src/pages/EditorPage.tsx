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
    return [];
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
    .filter((section) => section.chunks.length > 0)
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

export function EditorPage() {
  usePageTitle('Editor');
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId: routeProjectId } = useParams();
  const { load, loadProject, save } = useScriptStorage();
  const isNewProjectRoute = location.pathname === '/editor/new';
  const [title, setTitle] = useState('');
  const [rawScript, setRawScript] = useState('');
  const [generatedChunks, setGeneratedChunks] = useState<ScriptChunk[]>([]);
  const [sectionTemplates, setSectionTemplates] = useState<SectionTemplate[]>(
    [],
  );
  const [chunkSourceRawScript, setChunkSourceRawScript] = useState('');
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
  const isGenericEditorRoute = !isNewProjectRoute && !routeProjectId;
  const editorTitle = title.trim() || 'Untitled script';
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
    setChunkSourceRawScript(project.rawScript);
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
        'Chunk edits already exist. Click Confirm Re-chunk to replace them from the raw script.',
      );
      return;
    }

    createChunksFromRawScript();
  }

  function handleSaveScript(): void {
    const now = new Date().toISOString();
    const nextProjectId = projectId ?? createProjectId();
    const nextCreatedAt = createdAt ?? now;
    const nextSections = buildSectionsFromOwnership(
      generatedChunks,
      sectionTemplates,
    );

    const nextProject: ScriptProject = {
      id: nextProjectId,
      title,
      rawScript,
      createdAt: nextCreatedAt,
      updatedAt: now,
      sections: nextSections,
      sessionNotes,
    };

    save(nextProject);
    setProjectId(nextProjectId);
    setCreatedAt(nextCreatedAt);
    setSectionTemplates(createSectionTemplates(nextSections));
    setIsConfirmingRechunk(false);
    setLastSavedSnapshot(
      createEditorSnapshot(nextProject.title, nextProject.rawScript, generatedChunks),
    );
    setStatusMessage(
      generatedChunks.length > 0
        ? isChunkDataOutOfSync
          ? 'Saved locally. Your current chunk structure was preserved even though it is out of sync with the latest raw script. Confirm Re-chunk when you are ready to replace it.'
          : `Saved locally with ${formatChunkCount(generatedChunks.length)}. Open Performance when you are ready to record.`
        : 'Saved locally as a raw script draft. Chunk it before opening Performance.',
    );

    if (isNewProjectRoute) {
      navigate(`/editor/${nextProjectId}`, { replace: true });
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
        description="That saved script could not be found in your local BitFeeder library."
        title="Editor"
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
        description={
          isGenericEditorRoute
            ? 'You are editing the most recently updated script in your library. Open Scripts to choose a different saved project.'
            : 'Write or paste a raw script, chunk it into recording beats, adjust boundaries, and save the current project locally.'
        }
        title="Editor"
      >
        <section className="panel editor-panel">
          <div className="script-identity editor-script-identity">
            <p className="script-context-label">{editorContextLabel}</p>
            <h2 className="script-identity-title">{editorTitle}</h2>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="script-title">
              Script title
            </label>
            <input
              className="field-input"
              id="script-title"
              onChange={(event) => handleTitleChange(event.target.value)}
              placeholder="Enter a working title"
              type="text"
              value={title}
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="raw-script">
              Raw script
            </label>
            <textarea
              className="field-textarea"
              id="raw-script"
              onChange={(event) => handleRawScriptChange(event.target.value)}
              placeholder="Paste or write your rough script here."
              value={rawScript}
            />
          </div>

          <div className="field-group">
            <h2>Chunk preview</h2>
            {generatedChunks.length > 0 ? (
              <>
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
              </>
            ) : (
              <p className="page-note">
                {rawScript.trim()
                  ? 'Your chunk preview will appear here after you click Chunk Script. Then you can fine-tune chunk boundaries before saving.'
                  : 'Paste or write a rough script above, then turn it into short recording beats.'}
              </p>
            )}
          </div>

          {isChunkDataOutOfSync ? (
            <p aria-live="polite" className="status-message is-error">
              Raw script changed after chunking. Your current chunks, boundary
              edits, and delivery cues are still preserved. Save will keep this
              chunk structure until you confirm Re-chunk.
            </p>
          ) : null}

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

          <div className="action-row">
            <button
              className={`text-link ${isConfirmingRechunk ? 'is-warning' : ''}`}
              onClick={handleChunkScript}
              type="button"
            >
              {isConfirmingRechunk ? 'Confirm Re-chunk' : 'Chunk Script'}
            </button>
            {generatedChunks.length > 0 ? (
              <button
                className="text-link"
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
            <button
              className="text-link is-primary"
              onClick={handleSaveScript}
              type="button"
            >
              Save Script
            </button>
            {hasChunkedData ? (
              <button
                className="text-link"
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
            <button
              className="text-link"
              onClick={handleBackToHome}
              type="button"
            >
              Back to Home
            </button>
          </div>

          {isChunkDataOutOfSync ? (
            <p className="page-note editor-action-note">
              Boundary editing uses the current raw script. Confirm Re-chunk
              first to safely edit boundaries again.
            </p>
          ) : null}

          {statusMessage ? (
            <p aria-live="polite" className="status-message">
              {statusMessage}
            </p>
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
