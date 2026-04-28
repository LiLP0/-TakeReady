import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PageShell } from '../components/PageShell';
import { usePageTitle } from '../hooks/usePageTitle';
import { useScriptStorage } from '../hooks/useScriptStorage';
import type {
  ScriptChunk,
  ScriptFocusModeSettings,
  ScriptProject,
} from '../types/script';
import {
  DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS,
  getScriptFocusEmphasisStyle,
  getScriptFocusPreviewText,
  getScriptFocusRenderableSegments,
  normalizeScriptFocusModeSettings,
} from '../utils/scriptFocusMode';

type PlaybackChunk = {
  chunk: ScriptChunk;
  sectionTitle: string | null;
};

const MAX_CHUNK_FONT_SIZE = 80;
const MIN_CHUNK_FONT_SIZE = 26;
const FONT_SIZE_STEP = 2;
const TIMER_INTERVAL_MS = 1000;
const SCRIPT_FOCUS_FUNCTION_WORD_HINT = 'the, and, or, to, of, in, a, an, is, it';

function getPlaybackChunks(project: ScriptProject | null): PlaybackChunk[] {
  if (!project) {
    return [];
  }

  return project.sections.flatMap((section) =>
    section.chunks.map((chunk) => ({
      chunk,
      sectionTitle: section.title.trim() || null,
    })),
  );
}

function getInnerSize(element: HTMLElement): {
  height: number;
  width: number;
} {
  const styles = window.getComputedStyle(element);
  const horizontalPadding =
    Number.parseFloat(styles.paddingLeft) +
    Number.parseFloat(styles.paddingRight);
  const verticalPadding =
    Number.parseFloat(styles.paddingTop) +
    Number.parseFloat(styles.paddingBottom);

  return {
    height: element.clientHeight - verticalPadding,
    width: element.clientWidth - horizontalPadding,
  };
}

function doesTextFit(container: HTMLElement, textElement: HTMLElement): boolean {
  const { height, width } = getInnerSize(container);

  return (
    textElement.scrollHeight <= height + 1 &&
    textElement.scrollWidth <= width + 1
  );
}

function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.closest(
      'a[href], button, input, textarea, select, [contenteditable], [role="button"], [role="link"]',
    ) !== null
  );
}

function getClampedChunkIndex(
  nextValue: string,
  currentIndex: number,
  totalChunks: number,
): number {
  if (totalChunks === 0) {
    return 0;
  }

  const parsedValue = Number.parseInt(nextValue, 10);

  if (!Number.isFinite(parsedValue)) {
    return currentIndex;
  }

  return Math.min(Math.max(parsedValue - 1, 0), totalChunks - 1);
}

function formatElapsedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const paddedSeconds = String(seconds).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }

  return `${paddedMinutes}:${paddedSeconds}`;
}

function getEmphasizedPortionMode(value: number): string {
  return [20, 30, 40, 50].includes(value) ? String(value) : 'custom';
}

function getMinimumWordLengthMode(value: number): string {
  switch (value) {
    case 1:
      return 'all';
    case 4:
      return 'gt3';
    case 5:
      return 'gt4';
    case 6:
      return 'gt5';
    default:
      return 'custom';
  }
}

function getFrequencyMode(value: number): string {
  return [1, 2, 3, 4].includes(value) ? String(value) : 'custom';
}

function getFocusModeButtonLabel(isScriptFocusPanelOpen: boolean): string {
  return isScriptFocusPanelOpen
    ? 'Hide Focus Settings'
    : 'Script Focus Settings';
}

export function PerformancePage() {
  usePageTitle('Performance');
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams();
  const {
    loadProjects,
    project: latestProject,
    projects,
    scriptFocusModeSettings,
    saveScriptFocusModeSettings,
  } = useScriptStorage();
  const routedProject = routeProjectId
    ? projects.find((project) => project.id === routeProjectId) ?? null
    : null;
  const project = routeProjectId ? routedProject : latestProject;
  const isGenericPerformanceRoute = !routeProjectId;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [chunkFontSize, setChunkFontSize] = useState(MAX_CHUNK_FONT_SIZE);
  const [isFullscreenSupported, setIsFullscreenSupported] = useState(false);
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);
  const [isMirrorMode, setIsMirrorMode] = useState(false);
  const [jumpValue, setJumpValue] = useState('1');
  const [isScriptFocusPanelOpen, setIsScriptFocusPanelOpen] = useState(false);
  const [timerStartedAt, setTimerStartedAt] = useState(() => Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const performanceReaderRef = useRef<HTMLElement | null>(null);
  const chunkContainerRef = useRef<HTMLElement | null>(null);
  const chunkTextRef = useRef<HTMLParagraphElement | null>(null);
  const playbackChunks = getPlaybackChunks(project);
  const totalChunks = playbackChunks.length;
  const currentPlaybackChunk = playbackChunks[currentIndex] ?? null;
  const previousPlaybackChunk = playbackChunks[currentIndex - 1] ?? null;
  const nextPlaybackChunk = playbackChunks[currentIndex + 1] ?? null;
  const isLastChunk = totalChunks > 0 && currentIndex === totalChunks - 1;
  const isScriptFocusEnabled = scriptFocusModeSettings.enabled;
  const scriptFocusLayoutKey = isScriptFocusEnabled
    ? JSON.stringify({
        applyToNumbers: scriptFocusModeSettings.applyToNumbers,
        emphasisStyle: scriptFocusModeSettings.emphasisStyle,
        emphasizedPortion: scriptFocusModeSettings.emphasizedPortion,
        frequency: scriptFocusModeSettings.frequency,
        ignoreShortFunctionWords:
          scriptFocusModeSettings.ignoreShortFunctionWords,
        minimumWordLength: scriptFocusModeSettings.minimumWordLength,
        underlineStyle: scriptFocusModeSettings.underlineStyle,
        underlineThickness: scriptFocusModeSettings.underlineThickness,
      })
    : 'script-focus-disabled';
  const progressPercent =
    totalChunks > 0 ? ((currentIndex + 1) / totalChunks) * 100 : 0;
  const scriptFocusEmphasisStyle =
    getScriptFocusEmphasisStyle(scriptFocusModeSettings);
  const scriptFocusPreviewText = getScriptFocusPreviewText(
    currentPlaybackChunk?.chunk.text ?? project?.rawScript ?? '',
  );

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    function updateElapsedSeconds(): void {
      setElapsedSeconds(Math.floor((Date.now() - timerStartedAt) / 1000));
    }

    updateElapsedSeconds();
    const intervalId = window.setInterval(
      updateElapsedSeconds,
      TIMER_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [timerStartedAt]);

  useEffect(() => {
    setIsFullscreenSupported(document.fullscreenEnabled);

    function handleFullscreenChange(): void {
      setIsFullscreenActive(
        document.fullscreenElement === performanceReaderRef.current,
      );
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    setCurrentIndex(0);
  }, [project?.id]);

  useEffect(() => {
    setJumpValue(totalChunks > 0 ? String(currentIndex + 1) : '');
  }, [currentIndex, totalChunks]);

  useEffect(() => {
    if (totalChunks === 0) {
      setCurrentIndex(0);
      return;
    }

    setCurrentIndex((previousIndex) =>
      Math.min(previousIndex, totalChunks - 1),
    );
  }, [totalChunks]);

  useEffect(() => {
    if (totalChunks === 0) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (isInteractiveShortcutTarget(event.target)) {
        return;
      }

      if (
        event.key === 'ArrowRight' ||
        event.key === ' ' ||
        event.key === 'Enter'
      ) {
        event.preventDefault();
        setCurrentIndex((previousIndex) =>
          Math.min(previousIndex + 1, totalChunks - 1),
        );
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentIndex((previousIndex) => Math.max(previousIndex - 1, 0));
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [totalChunks]);

  useLayoutEffect(() => {
    const container = chunkContainerRef.current;
    const textElement = chunkTextRef.current;

    if (!container || !textElement || !currentPlaybackChunk) {
      return;
    }

    const measuredContainer = container;
    const measuredTextElement = textElement;

    function fitChunkText(): void {
      let nextFontSize = MAX_CHUNK_FONT_SIZE;

      measuredTextElement.style.fontSize = `${nextFontSize}px`;

      while (
        nextFontSize > MIN_CHUNK_FONT_SIZE &&
        !doesTextFit(measuredContainer, measuredTextElement)
      ) {
        nextFontSize -= FONT_SIZE_STEP;
        measuredTextElement.style.fontSize = `${nextFontSize}px`;
      }

      setChunkFontSize(nextFontSize);
    }

    fitChunkText();
    window.addEventListener('resize', fitChunkText);

    return () => {
      window.removeEventListener('resize', fitChunkText);
    };
  }, [
    currentPlaybackChunk?.chunk.id,
    currentPlaybackChunk?.chunk.text,
    isFullscreenActive,
    scriptFocusLayoutKey,
  ]);

  function handlePrevious(): void {
    setCurrentIndex((previousIndex) => Math.max(previousIndex - 1, 0));
  }

  function handleNext(): void {
    setCurrentIndex((previousIndex) =>
      Math.min(previousIndex + 1, totalChunks - 1),
    );
  }

  function handleRestart(): void {
    setCurrentIndex(0);
    setTimerStartedAt(Date.now());
    setElapsedSeconds(0);
  }

  function handleJumpSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const nextIndex = getClampedChunkIndex(
      jumpValue,
      currentIndex,
      totalChunks,
    );

    setCurrentIndex(nextIndex);
    setJumpValue(String(nextIndex + 1));
  }

  function handleJumpBlur(): void {
    const nextIndex = getClampedChunkIndex(
      jumpValue,
      currentIndex,
      totalChunks,
    );

    setCurrentIndex(nextIndex);
    setJumpValue(String(nextIndex + 1));
  }

  function handleToggleFullscreen(): void {
    const performanceReader = performanceReaderRef.current;

    if (!isFullscreenSupported || !performanceReader) {
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }

    void performanceReader.requestFullscreen().catch(() => undefined);
  }

  function handleToggleScriptFocusPanel(): void {
    setIsScriptFocusPanelOpen((currentValue) => !currentValue);
  }

  function handleToggleMirrorMode(): void {
    setIsMirrorMode((currentMirrorMode) => !currentMirrorMode);
  }

  function updateScriptFocusSettings(
    partialSettings: Partial<ScriptFocusModeSettings>,
  ): void {
    saveScriptFocusModeSettings(
      normalizeScriptFocusModeSettings({
        ...scriptFocusModeSettings,
        ...partialSettings,
      }),
    );
  }

  function handleScriptFocusEnabledChange(nextChecked: boolean): void {
    updateScriptFocusSettings({
      enabled: nextChecked,
    });
  }

  function handleEmphasizedPortionPresetChange(nextValue: string): void {
    if (nextValue === 'custom') {
      return;
    }

    updateScriptFocusSettings({
      emphasizedPortion: Number.parseInt(nextValue, 10),
    });
  }

  function handleMinimumWordLengthModeChange(nextValue: string): void {
    if (nextValue === 'custom') {
      return;
    }

    const nextMinimumWordLength =
      nextValue === 'all'
        ? 1
        : nextValue === 'gt3'
          ? 4
          : nextValue === 'gt4'
            ? 5
            : 6;

    updateScriptFocusSettings({
      minimumWordLength: nextMinimumWordLength,
    });
  }

  function handleFrequencyModeChange(nextValue: string): void {
    if (nextValue === 'custom') {
      return;
    }

    updateScriptFocusSettings({
      frequency: Number.parseInt(nextValue, 10),
    });
  }

  function renderScriptFocusText(text: string, keyPrefix: string) {
    return getScriptFocusRenderableSegments(text, scriptFocusModeSettings).map(
      (segment, index) => (
        <span
          className={`script-focus-segment ${
            segment.emphasized ? 'is-emphasized' : ''
          }`}
          key={`${keyPrefix}-${index}`}
          style={segment.emphasized ? scriptFocusEmphasisStyle : undefined}
        >
          {segment.text}
        </span>
      ),
    );
  }

  function handleBackToHome(): void {
    navigate('/');
  }

  function handleBackToScripts(): void {
    navigate('/scripts');
  }

  function handleOpenEditor(): void {
    if (!project) {
      return;
    }

    navigate(`/editor/${project.id}`);
  }

  if (!project) {
    if (routeProjectId) {
      return (
        <PageShell
          description="That saved script could not be found in your local TakeReady library."
          title="Performance"
        >
          <section className="panel missing-project">
            <p className="script-context-label">Missing script</p>
            <h2>Script not found</h2>
            <p className="page-note">
              This performance route points to a script that is no longer
              saved. Head back to Scripts to choose another project.
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
      <PageShell
        description="Load a saved TakeReady project here when you are ready to record chunk by chunk."
        title="Performance"
      >
        <section className="panel performance-empty">
          <h2>No saved script yet</h2>
          <p className="page-note">
            Save a chunked project from the Editor, then come back here to read
            it during recording.
          </p>
          <div className="action-row">
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

  if (!currentPlaybackChunk) {
    return (
      <PageShell
        description="This saved project is ready, but it does not have chunked script beats yet."
        title="Performance"
      >
        <section className="panel performance-empty">
          <h2>No chunks to read yet</h2>
          <p className="page-note">
            Open the project in the Editor, run Chunk Script, save it, then
            return here for the recording view.
          </p>
          <div className="action-row">
            <button
              className="text-link is-primary"
              onClick={handleOpenEditor}
              type="button"
            >
              Open in Editor
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
    <PageShell
      description={
        isGenericPerformanceRoute
          ? 'You are reading the most recently updated chunked script in your library. Open Scripts to choose a different project.'
          : 'Read your saved script one performance-friendly chunk at a time.'
      }
      title="Performance"
    >
      <section className="panel performance-reader" ref={performanceReaderRef}>
        <div className="performance-meta">
          <div className="performance-meta-copy">
            <p className="performance-label">Recording script</p>
            <h2 className="performance-project-title">
              {project.title.trim() || 'Untitled script'}
            </h2>
            {currentPlaybackChunk.sectionTitle ? (
              <p className="performance-section-title">
                <span>Section</span>
                {currentPlaybackChunk.sectionTitle}
              </p>
            ) : null}
          </div>
          <div className="performance-meta-actions">
            <p
              className="performance-position"
              aria-label={`Chunk ${currentIndex + 1} of ${totalChunks}`}
            >
              <span>Chunk</span>
              <strong>{currentIndex + 1}</strong>
              <span>of {totalChunks}</span>
            </p>
            <button
              className="text-link performance-meta-button"
              onClick={handleOpenEditor}
              type="button"
            >
              Open in Editor
            </button>
            <button
              className={`text-link performance-meta-button ${
                isScriptFocusPanelOpen ? 'is-active' : ''
              }`}
              onClick={handleToggleScriptFocusPanel}
              type="button"
            >
              {getFocusModeButtonLabel(isScriptFocusPanelOpen)}
            </button>
            <button
              className="text-link performance-meta-button"
              disabled={!isFullscreenSupported}
              onClick={handleToggleFullscreen}
              title={
                isFullscreenSupported
                  ? 'Toggle browser fullscreen for recording.'
                  : 'Fullscreen is not supported in this browser.'
              }
              type="button"
            >
              {isFullscreenActive ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          </div>
        </div>

        <div
          className="performance-progress"
          role="progressbar"
          aria-label="Script progress"
          aria-valuemin={1}
          aria-valuemax={totalChunks}
          aria-valuenow={currentIndex + 1}
        >
          <span style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="performance-session-controls">
          <p className="performance-session-timer">
            <span>Session</span>
            <strong>{formatElapsedTime(elapsedSeconds)}</strong>
          </p>
          <form className="performance-jump-control" onSubmit={handleJumpSubmit}>
            <label className="performance-jump-label" htmlFor="chunk-jump">
              Jump
            </label>
            <input
              className="field-input performance-jump-input"
              id="chunk-jump"
              inputMode="numeric"
              max={totalChunks}
              min={1}
              onBlur={handleJumpBlur}
              onChange={(event) => setJumpValue(event.target.value)}
              type="number"
              value={jumpValue}
            />
            <button className="text-link performance-meta-button" type="submit">
              Go
            </button>
          </form>
          <button
            className="text-link performance-meta-button"
            disabled={currentIndex === 0 && elapsedSeconds === 0}
            onClick={handleRestart}
            type="button"
          >
            Restart
          </button>
          <button
            className="text-link performance-meta-button"
            onClick={handleToggleMirrorMode}
            type="button"
          >
            {isMirrorMode ? 'Mirror Off' : 'Mirror Mode'}
          </button>
        </div>

        {isScriptFocusPanelOpen ? (
          <section
            className="script-focus-panel"
            aria-label="Script Focus Mode settings"
          >
            <div className="script-focus-panel-header">
              <div>
                <h2>Script Focus Mode</h2>
                <p className="page-note">
                  Word Anchors are optional visual guides that can make long
                  scripts easier to scan. They do not change your original
                  script.
                </p>
                <p className="page-note">
                  Designed to support focus, scanning, and readability
                  preferences.
                </p>
              </div>
              <button
                className="text-link"
                onClick={() =>
                  saveScriptFocusModeSettings(
                    DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS,
                  )
                }
                type="button"
              >
                Reset to default
              </button>
            </div>

            <div className="script-focus-controls">
              <label className="script-focus-toggle">
                <input
                  checked={isScriptFocusEnabled}
                  onChange={(event) =>
                    handleScriptFocusEnabledChange(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>Script Focus Mode</span>
              </label>

              <label className="script-focus-toggle">
                <input
                  checked={scriptFocusModeSettings.ignoreShortFunctionWords}
                  onChange={(event) =>
                    updateScriptFocusSettings({
                      ignoreShortFunctionWords: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <span>Ignore short function words</span>
              </label>

              <label className="script-focus-toggle">
                <input
                  checked={scriptFocusModeSettings.applyToNumbers}
                  onChange={(event) =>
                    updateScriptFocusSettings({
                      applyToNumbers: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <span>Apply to numbers</span>
              </label>
            </div>

            <div className="script-focus-grid">
              <div className="field-group">
                <label
                  className="field-label"
                  htmlFor="performance-script-focus-portion-preset"
                >
                  Emphasized portion preset
                </label>
                <select
                  className="field-input"
                  id="performance-script-focus-portion-preset"
                  onChange={(event) =>
                    handleEmphasizedPortionPresetChange(event.target.value)
                  }
                  value={getEmphasizedPortionMode(
                    scriptFocusModeSettings.emphasizedPortion,
                  )}
                >
                  <option value="20">20%</option>
                  <option value="30">30%</option>
                  <option value="40">40%</option>
                  <option value="50">50%</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div className="field-group">
                <label
                  className="field-label"
                  htmlFor="performance-script-focus-portion"
                >
                  Custom emphasized portion: {scriptFocusModeSettings.emphasizedPortion}%
                </label>
                <input
                  id="performance-script-focus-portion"
                  max={70}
                  min={10}
                  onChange={(event) =>
                    updateScriptFocusSettings({
                      emphasizedPortion: Number.parseInt(
                        event.target.value,
                        10,
                      ),
                    })
                  }
                  step={1}
                  type="range"
                  value={scriptFocusModeSettings.emphasizedPortion}
                />
              </div>

              <div className="field-group">
                <label
                  className="field-label"
                  htmlFor="performance-script-focus-eligibility"
                >
                  Word eligibility
                </label>
                <select
                  className="field-input"
                  id="performance-script-focus-eligibility"
                  onChange={(event) =>
                    handleMinimumWordLengthModeChange(event.target.value)
                  }
                  value={getMinimumWordLengthMode(
                    scriptFocusModeSettings.minimumWordLength,
                  )}
                >
                  <option value="all">All words</option>
                  <option value="gt3">Words longer than 3 letters</option>
                  <option value="gt4">Words longer than 4 letters</option>
                  <option value="gt5">Words longer than 5 letters</option>
                  <option value="custom">Custom minimum word length</option>
                </select>
              </div>

              <div className="field-group">
                <label
                  className="field-label"
                  htmlFor="performance-script-focus-minimum-length"
                >
                  Custom minimum word length
                </label>
                <input
                  className="field-input"
                  id="performance-script-focus-minimum-length"
                  max={24}
                  min={1}
                  onChange={(event) =>
                    updateScriptFocusSettings({
                      minimumWordLength: Number.parseInt(
                        event.target.value || '1',
                        10,
                      ),
                    })
                  }
                  type="number"
                  value={scriptFocusModeSettings.minimumWordLength}
                />
              </div>

              <div className="field-group">
                <label
                  className="field-label"
                  htmlFor="performance-script-focus-frequency-mode"
                >
                  Frequency
                </label>
                <select
                  className="field-input"
                  id="performance-script-focus-frequency-mode"
                  onChange={(event) =>
                    handleFrequencyModeChange(event.target.value)
                  }
                  value={getFrequencyMode(scriptFocusModeSettings.frequency)}
                >
                  <option value="1">Every word</option>
                  <option value="2">Every 2nd word</option>
                  <option value="3">Every 3rd word</option>
                  <option value="4">Every 4th word</option>
                  <option value="custom">Custom frequency</option>
                </select>
              </div>

              <div className="field-group">
                <label
                  className="field-label"
                  htmlFor="performance-script-focus-frequency"
                >
                  Custom frequency
                </label>
                <input
                  className="field-input"
                  id="performance-script-focus-frequency"
                  max={24}
                  min={1}
                  onChange={(event) =>
                    updateScriptFocusSettings({
                      frequency: Number.parseInt(
                        event.target.value || '1',
                        10,
                      ),
                    })
                  }
                  type="number"
                  value={scriptFocusModeSettings.frequency}
                />
              </div>

              <div className="field-group">
                <label
                  className="field-label"
                  htmlFor="performance-script-focus-style"
                >
                  Emphasis style
                </label>
                <select
                  className="field-input"
                  id="performance-script-focus-style"
                  onChange={(event) =>
                    updateScriptFocusSettings({
                      emphasisStyle:
                        event.target.value as ScriptFocusModeSettings['emphasisStyle'],
                    })
                  }
                  value={scriptFocusModeSettings.emphasisStyle}
                >
                  <option value="color">Color</option>
                  <option value="underline">Underline</option>
                  <option value="color+underline">Color + underline</option>
                </select>
              </div>

              <div className="field-group">
                <label
                  className="field-label"
                  htmlFor="performance-script-focus-color"
                >
                  Emphasis color
                </label>
                <input
                  className="script-focus-color-input"
                  id="performance-script-focus-color"
                  onChange={(event) =>
                    updateScriptFocusSettings({
                      emphasisColor: event.target.value,
                    })
                  }
                  type="color"
                  value={scriptFocusModeSettings.emphasisColor}
                />
              </div>

              <div className="field-group">
                <label
                  className="field-label"
                  htmlFor="performance-script-focus-underline-style"
                >
                  Underline style
                </label>
                <select
                  className="field-input"
                  id="performance-script-focus-underline-style"
                  onChange={(event) =>
                    updateScriptFocusSettings({
                      underlineStyle:
                        event.target.value as ScriptFocusModeSettings['underlineStyle'],
                    })
                  }
                  value={scriptFocusModeSettings.underlineStyle}
                >
                  <option value="solid">Solid</option>
                  <option value="dotted">Dotted</option>
                  <option value="dashed">Dashed</option>
                  <option value="wavy">Wavy</option>
                </select>
              </div>

              <div className="field-group">
                <label
                  className="field-label"
                  htmlFor="performance-script-focus-underline-thickness"
                >
                  Underline thickness: {scriptFocusModeSettings.underlineThickness}px
                </label>
                <input
                  id="performance-script-focus-underline-thickness"
                  max={6}
                  min={1}
                  onChange={(event) =>
                    updateScriptFocusSettings({
                      underlineThickness: Number.parseInt(
                        event.target.value,
                        10,
                      ),
                    })
                  }
                  step={1}
                  type="range"
                  value={scriptFocusModeSettings.underlineThickness}
                />
              </div>
            </div>

            <p className="script-focus-function-word-hint">
              Default function words: {SCRIPT_FOCUS_FUNCTION_WORD_HINT}
            </p>

            <div className="script-focus-preview">
              <p className="script-focus-preview-label">Current chunk preview</p>
              <p className="script-focus-render script-focus-preview-text">
                {renderScriptFocusText(
                  scriptFocusPreviewText,
                  'performance-script-focus-preview',
                )}
              </p>
            </div>
          </section>
        ) : null}

        <div className="performance-reading-stack">
          {previousPlaybackChunk ? (
            <aside
              className="performance-chunk-preview is-previous"
              aria-label="Previous chunk preview"
            >
              <span>Previous</span>
              <p className="script-focus-render">
                {renderScriptFocusText(
                  previousPlaybackChunk.chunk.text,
                  `previous-${previousPlaybackChunk.chunk.id}`,
                )}
              </p>
            </aside>
          ) : null}

          <div className="performance-chunk-shell">
            <button
              aria-label="Go to previous chunk"
              className="performance-nav-zone is-previous"
              disabled={currentIndex === 0}
              onClick={handlePrevious}
              type="button"
            >
              <span aria-hidden="true">◀</span>
            </button>

            <article
              className={`performance-chunk ${
                currentPlaybackChunk.chunk.emojiCue ? 'has-emoji-cue' : ''
              }`}
              aria-live="polite"
              ref={chunkContainerRef}
            >
              {currentPlaybackChunk.chunk.emojiCue ? (
                <span
                  className="performance-emoji-cue"
                  aria-label="Delivery emoji cue"
                >
                  {currentPlaybackChunk.chunk.emojiCue}
                </span>
              ) : null}
              <p
                className={`performance-chunk-text ${
                  isMirrorMode ? 'is-mirrored' : ''
                } script-focus-render`}
                ref={chunkTextRef}
                style={{ fontSize: `${chunkFontSize}px` }}
              >
                {renderScriptFocusText(
                  currentPlaybackChunk.chunk.text,
                  currentPlaybackChunk.chunk.id,
                )}
              </p>
            </article>

            <button
              aria-label="Go to next chunk"
              className="performance-nav-zone is-next"
              disabled={currentIndex === totalChunks - 1}
              onClick={handleNext}
              type="button"
            >
              <span aria-hidden="true">▶</span>
            </button>
          </div>

          {nextPlaybackChunk ? (
            <aside
              className="performance-chunk-preview is-next"
              aria-label="Next chunk preview"
            >
              <span>Next</span>
              <p className="script-focus-render">
                {renderScriptFocusText(
                  nextPlaybackChunk.chunk.text,
                  `next-${nextPlaybackChunk.chunk.id}`,
                )}
              </p>
            </aside>
          ) : null}
        </div>

        {isLastChunk ? (
          <p className="performance-end-note" aria-live="polite">
            End of script. You are on the final chunk.
          </p>
        ) : null}

        <div className="action-row performance-actions">
          <button
            className="text-link"
            disabled={currentIndex === 0}
            onClick={handlePrevious}
            type="button"
          >
            Previous
          </button>
          <button
            className="text-link is-primary"
            disabled={currentIndex === totalChunks - 1}
            onClick={handleNext}
            type="button"
          >
            Next
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
