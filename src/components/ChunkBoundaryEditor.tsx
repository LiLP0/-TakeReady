import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

import type { ScriptChunk } from '../types/script';
import {
  insertChunkFromRange,
  normalizeChunkRange,
  removeChunkById,
  snapIndexToWordBoundary,
  sortChunksByRange,
  suggestChunkRangeFromFreeRegion,
  updateChunkBoundary,
} from '../utils/chunkBoundaries';

type ChunkBoundaryEditorProps = {
  rawScript: string;
  chunks: ScriptChunk[];
  onCancel: () => void;
  onDone: (chunks: ScriptChunk[]) => void;
};

type DragHandle = 'start' | 'end';

type HandlePosition = {
  left: number;
  top: number;
};

type ScriptSegment =
  | {
      endIndex: number;
      key: string;
      startIndex: number;
      text: string;
      type: 'text';
    }
  | {
      chunk: ScriptChunk;
      endIndex: number;
      key: string;
      startIndex: number;
      text: string;
      type: 'chunk';
    };

type FreeScriptSegment = Extract<ScriptSegment, { type: 'text' }>;

type CaretPoint = {
  node: Node | null;
  offset: number;
};

function clampIndex(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildScriptSegments(
  rawScript: string,
  chunks: ScriptChunk[],
): ScriptSegment[] {
  const sortedChunks = sortChunksByRange(chunks);
  const segments: ScriptSegment[] = [];
  let cursor = 0;

  sortedChunks.forEach((chunk) => {
    if (cursor < chunk.startIndex) {
      segments.push({
        endIndex: chunk.startIndex,
        key: `text-${cursor}-${chunk.startIndex}`,
        startIndex: cursor,
        text: rawScript.slice(cursor, chunk.startIndex),
        type: 'text',
      });
    }

    segments.push({
      chunk,
      endIndex: chunk.endIndex,
      key: chunk.id,
      startIndex: chunk.startIndex,
      text: rawScript.slice(chunk.startIndex, chunk.endIndex),
      type: 'chunk',
    });

    cursor = chunk.endIndex;
  });

  if (cursor < rawScript.length) {
    segments.push({
      endIndex: rawScript.length,
      key: `text-${cursor}-${rawScript.length}`,
      startIndex: cursor,
      text: rawScript.slice(cursor),
      type: 'text',
    });
  }

  return segments;
}

function getCaretPointFromMouse(
  clientX: number,
  clientY: number,
): CaretPoint | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const caretPosition = doc.caretPositionFromPoint?.(clientX, clientY);

  if (caretPosition) {
    return {
      node: caretPosition.offsetNode,
      offset: caretPosition.offset,
    };
  }

  const caretRange = doc.caretRangeFromPoint?.(clientX, clientY);

  if (caretRange) {
    return {
      node: caretRange.startContainer,
      offset: caretRange.startOffset,
    };
  }

  return null;
}

function getSegmentElement(
  rootElement: HTMLElement | null,
  node: Node | null,
): HTMLElement | null {
  let currentNode = node;

  while (currentNode && currentNode !== rootElement) {
    if (
      currentNode instanceof HTMLElement &&
      currentNode.dataset.segmentStartIndex &&
      currentNode.dataset.segmentEndIndex
    ) {
      return currentNode;
    }

    currentNode = currentNode.parentNode;
  }

  return null;
}

function getApproximateIndexFromSegment(
  segmentElement: HTMLElement,
  clientX: number,
): number {
  const startIndex = Number(segmentElement.dataset.segmentStartIndex);
  const endIndex = Number(segmentElement.dataset.segmentEndIndex);
  const segmentLength = Math.max(0, endIndex - startIndex);
  const rect = segmentElement.getBoundingClientRect();

  if (segmentLength === 0 || rect.width <= 0) {
    return startIndex;
  }

  const horizontalRatio = clampIndex(
    (clientX - rect.left) / rect.width,
    0,
    1,
  );

  return startIndex + Math.round(segmentLength * horizontalRatio);
}

function getIndexFromCaretPoint(
  rootElement: HTMLElement | null,
  caretPoint: CaretPoint,
  clientX: number,
): number | null {
  const segmentElement = getSegmentElement(rootElement, caretPoint.node);

  if (!segmentElement) {
    return null;
  }

  const startIndex = Number(segmentElement.dataset.segmentStartIndex);
  const endIndex = Number(segmentElement.dataset.segmentEndIndex);
  const segmentLength = Math.max(0, endIndex - startIndex);

  if (caretPoint.node instanceof Text) {
    return startIndex + clampIndex(caretPoint.offset, 0, segmentLength);
  }

  return getApproximateIndexFromSegment(segmentElement, clientX);
}

function getRawIndexFromPoint(
  rawScript: string,
  rootElement: HTMLElement | null,
  clientX: number,
  clientY: number,
): number | null {
  if (!rootElement) {
    return null;
  }

  const caretPoint = getCaretPointFromMouse(clientX, clientY);

  if (caretPoint) {
    const caretIndex = getIndexFromCaretPoint(
      rootElement,
      caretPoint,
      clientX,
    );

    if (caretIndex !== null) {
      return caretIndex;
    }
  }

  const fallbackElement = document.elementFromPoint(clientX, clientY);
  const fallbackSegment = getSegmentElement(rootElement, fallbackElement);

  if (fallbackSegment) {
    return getApproximateIndexFromSegment(fallbackSegment, clientX);
  }

  const rootRect = rootElement.getBoundingClientRect();

  if (clientY <= rootRect.top || clientX <= rootRect.left) {
    return 0;
  }

  if (clientY >= rootRect.bottom || clientX >= rootRect.right) {
    return rawScript.length;
  }

  return null;
}

function getBoundaryHandlePosition(
  rootElement: HTMLElement | null,
  selectedElement: HTMLSpanElement | null,
  handle: DragHandle,
): HandlePosition | null {
  if (!rootElement || !selectedElement) {
    return null;
  }

  const textNode = selectedElement.firstChild;
  const rootRect = rootElement.getBoundingClientRect();

  if (!(textNode instanceof Text) || textNode.length === 0) {
    const fallbackRect = selectedElement.getBoundingClientRect();

    return {
      left:
        (handle === 'start' ? fallbackRect.left : fallbackRect.right) -
        rootRect.left,
      top: fallbackRect.top - rootRect.top + fallbackRect.height / 2,
    };
  }

  const range = document.createRange();

  if (handle === 'start') {
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(1, textNode.length));
  } else {
    range.setStart(textNode, Math.max(0, textNode.length - 1));
    range.setEnd(textNode, textNode.length);
  }

  const rectList = range.getClientRects();
  const boundaryRect =
    rectList[handle === 'start' ? 0 : rectList.length - 1] ??
    range.getBoundingClientRect();

  return {
    left:
      (handle === 'start' ? boundaryRect.left : boundaryRect.right) -
      rootRect.left,
    top: boundaryRect.top - rootRect.top + boundaryRect.height / 2,
  };
}

function getChunkDistance(
  sourceChunk: ScriptChunk,
  candidateChunk: ScriptChunk,
): number {
  if (candidateChunk.endIndex <= sourceChunk.startIndex) {
    return sourceChunk.startIndex - candidateChunk.endIndex;
  }

  if (candidateChunk.startIndex >= sourceChunk.endIndex) {
    return candidateChunk.startIndex - sourceChunk.endIndex;
  }

  return 0;
}

function getNearestChunkId(
  sourceChunk: ScriptChunk,
  chunks: ScriptChunk[],
): string | null {
  const sortedChunks = sortChunksByRange(chunks);
  let nearestChunk: ScriptChunk | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const chunk of sortedChunks) {
    const distance = getChunkDistance(sourceChunk, chunk);

    if (distance < nearestDistance) {
      nearestChunk = chunk;
      nearestDistance = distance;
    }
  }

  return nearestChunk?.id ?? null;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  );
}

function isDeleteShortcut(event: globalThis.KeyboardEvent): boolean {
  return event.key === 'Delete' || event.key === 'Backspace';
}

function isDoneShortcut(event: globalThis.KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey);
}

export function ChunkBoundaryEditor({
  rawScript,
  chunks,
  onCancel,
  onDone,
}: ChunkBoundaryEditorProps) {
  const [draftChunks, setDraftChunks] = useState<ScriptChunk[]>(() =>
    sortChunksByRange(chunks),
  );
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(
    chunks[0]?.id ?? null,
  );
  const [dragHandle, setDragHandle] = useState<DragHandle | null>(null);
  const [handlePositions, setHandlePositions] = useState<{
    end: HandlePosition | null;
    start: HandlePosition | null;
  }>({
    end: null,
    start: null,
  });
  const scriptViewRef = useRef<HTMLDivElement | null>(null);
  const selectedChunkElementRef = useRef<HTMLSpanElement | null>(null);
  const draftChunksRef = useRef<ScriptChunk[]>(sortChunksByRange(chunks));
  const onCancelRef = useRef(onCancel);
  const onDoneRef = useRef(onDone);
  const selectedChunkIdRef = useRef<string | null>(chunks[0]?.id ?? null);

  useEffect(() => {
    const sortedChunks = sortChunksByRange(chunks);

    setDraftChunks(sortedChunks);
    draftChunksRef.current = sortedChunks;
    setSelectedChunkId((currentChunkId) => {
      if (
        currentChunkId &&
        sortedChunks.some((chunk) => chunk.id === currentChunkId)
      ) {
        selectedChunkIdRef.current = currentChunkId;
        return currentChunkId;
      }

      const nextChunkId = sortedChunks[0]?.id ?? null;
      selectedChunkIdRef.current = nextChunkId;
      return nextChunkId;
    });
  }, [chunks]);

  useEffect(() => {
    onCancelRef.current = onCancel;
    onDoneRef.current = onDone;
  }, [onCancel, onDone]);

  const selectedChunk =
    draftChunks.find((chunk) => chunk.id === selectedChunkId) ?? null;

  function handleChunkClick(chunkId: string): void {
    setSelectedChunkId(chunkId);
    selectedChunkIdRef.current = chunkId;
  }

  function handleChunkKeyDown(
    event: KeyboardEvent<HTMLSpanElement>,
    chunkId: string,
  ): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    handleChunkClick(chunkId);
  }

  function handleFreeSegmentDoubleClick(
    event: ReactMouseEvent<HTMLSpanElement>,
    segment: FreeScriptSegment,
  ): void {
    event.preventDefault();
    event.stopPropagation();

    const rawIndex =
      getRawIndexFromPoint(
        rawScript,
        scriptViewRef.current,
        event.clientX,
        event.clientY,
      ) ?? getApproximateIndexFromSegment(event.currentTarget, event.clientX);
    const suggestedRange = suggestChunkRangeFromFreeRegion(
      rawScript,
      segment.startIndex,
      segment.endIndex,
      rawIndex,
    );

    if (!suggestedRange) {
      return;
    }

    const insertedChunk = insertChunkFromRange(
      rawScript,
      draftChunksRef.current,
      suggestedRange.startIndex,
      suggestedRange.endIndex,
    );

    if (!insertedChunk) {
      return;
    }

    draftChunksRef.current = insertedChunk.chunks;
    setDraftChunks(insertedChunk.chunks);
    selectedChunkIdRef.current = insertedChunk.chunk.id;
    setSelectedChunkId(insertedChunk.chunk.id);
  }

  function handleBoundaryChange(
    startDelta: number,
    endDelta: number,
  ): void {
    if (!selectedChunk) {
      return;
    }

    const nextStartIndex = selectedChunk.startIndex + startDelta;
    const nextEndIndex = selectedChunk.endIndex + endDelta;
    const nextRange = normalizeChunkRange(
      rawScript,
      nextStartIndex,
      nextEndIndex,
    );

    if (!nextRange) {
      return;
    }

    const nextChunks = updateChunkBoundary(
      rawScript,
      draftChunksRef.current,
      selectedChunk.id,
      nextRange.startIndex,
      nextRange.endIndex,
    );

    draftChunksRef.current = nextChunks;
    setDraftChunks(nextChunks);
    selectedChunkIdRef.current = selectedChunk.id;
    setSelectedChunkId(selectedChunk.id);
  }

  function deleteChunk(chunk: ScriptChunk): void {
    const nextChunks = removeChunkById(draftChunksRef.current, chunk.id);
    const nextSelectedChunkId = getNearestChunkId(chunk, nextChunks);

    draftChunksRef.current = nextChunks;
    setDraftChunks(nextChunks);
    selectedChunkIdRef.current = nextSelectedChunkId;
    setSelectedChunkId(nextSelectedChunkId);
  }

  function handleDeleteSelectedChunk(): void {
    if (!selectedChunk) {
      return;
    }

    deleteChunk(selectedChunk);
  }

  function applyBoundaryIndex(
    chunkId: string,
    nextStartIndex: number,
    nextEndIndex: number,
  ): void {
    const nextRange = normalizeChunkRange(
      rawScript,
      nextStartIndex,
      nextEndIndex,
    );

    if (!nextRange) {
      return;
    }

    const nextChunks = updateChunkBoundary(
      rawScript,
      draftChunksRef.current,
      chunkId,
      nextRange.startIndex,
      nextRange.endIndex,
    );

    draftChunksRef.current = nextChunks;
    setDraftChunks(nextChunks);
    selectedChunkIdRef.current = chunkId;
    setSelectedChunkId(chunkId);
  }

  function handleCancel(): void {
    onCancelRef.current();
  }

  function handleBackdropClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    handleCancel();
  }

  function handleHandleMouseDown(
    event: ReactMouseEvent<HTMLButtonElement>,
    handle: DragHandle,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    setDragHandle(handle);
  }

  function handleDone(): void {
    onDoneRef.current(sortChunksByRange(draftChunksRef.current));
  }

  useEffect(() => {
    draftChunksRef.current = draftChunks;
  }, [draftChunks]);

  useEffect(() => {
    selectedChunkIdRef.current = selectedChunkId;
  }, [selectedChunkId]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (isTextEntryTarget(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
        return;
      }

      if (isDoneShortcut(event)) {
        event.preventDefault();
        handleDone();
        return;
      }

      if (!isDeleteShortcut(event)) {
        return;
      }

      const currentSelectedChunkId = selectedChunkIdRef.current;

      if (!currentSelectedChunkId) {
        return;
      }

      const currentChunk = draftChunksRef.current.find(
        (chunk) => chunk.id === currentSelectedChunkId,
      );

      if (!currentChunk) {
        return;
      }

      event.preventDefault();
      deleteChunk(currentChunk);
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    function updateHandlePositions(): void {
      setHandlePositions({
        end: getBoundaryHandlePosition(
          scriptViewRef.current,
          selectedChunkElementRef.current,
          'end',
        ),
        start: getBoundaryHandlePosition(
          scriptViewRef.current,
          selectedChunkElementRef.current,
          'start',
        ),
      });
    }

    updateHandlePositions();
    window.addEventListener('resize', updateHandlePositions);

    return () => {
      window.removeEventListener('resize', updateHandlePositions);
    };
  }, [draftChunks, selectedChunkId]);

  useEffect(() => {
    if (!dragHandle) {
      return;
    }

    function handleMouseMove(event: MouseEvent): void {
      event.preventDefault();

      const currentChunkId = selectedChunkIdRef.current;

      if (!currentChunkId) {
        return;
      }

      const currentChunk = draftChunksRef.current.find(
        (chunk) => chunk.id === currentChunkId,
      );

      if (!currentChunk) {
        return;
      }

      const nextRawIndex = getRawIndexFromPoint(
        rawScript,
        scriptViewRef.current,
        event.clientX,
        event.clientY,
      );

      if (nextRawIndex === null) {
        return;
      }

      const snappedRawIndex = snapIndexToWordBoundary(rawScript, nextRawIndex);

      if (dragHandle === 'start') {
        applyBoundaryIndex(
          currentChunk.id,
          snappedRawIndex,
          currentChunk.endIndex,
        );
        return;
      }

      applyBoundaryIndex(
        currentChunk.id,
        currentChunk.startIndex,
        snappedRawIndex,
      );
    }

    function handleMouseUp(): void {
      setDragHandle(null);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragHandle, rawScript]);

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div
        aria-labelledby="chunk-boundary-editor-title"
        aria-modal="true"
        className="modal-panel"
        role="dialog"
      >
        <div className="modal-header">
          <h2 className="modal-title" id="chunk-boundary-editor-title">
            Edit Chunk Boundaries
          </h2>
          <p className="page-note">
            Click a highlighted chunk to edit it, or double-click free text to
            create a new chunk.
          </p>
        </div>

        <div className="chunk-boundary-layout">
          <section className="modal-section">
            <h3 className="modal-section-title">Full raw script</h3>
            <p className="page-note chunk-script-hint">
              Double-click free text to create a chunk.
            </p>
            <div
              className={
                dragHandle ? 'chunk-script-view is-dragging' : 'chunk-script-view'
              }
              ref={scriptViewRef}
            >
              {buildScriptSegments(rawScript, draftChunks).map((segment) => {
                if (segment.type === 'text') {
                  return (
                    <span
                      className="chunk-script-plain-fragment"
                      data-segment-end-index={segment.endIndex}
                      data-segment-start-index={segment.startIndex}
                      key={segment.key}
                      onDoubleClick={(event) =>
                        handleFreeSegmentDoubleClick(event, segment)
                      }
                      title="Double-click free text to create a chunk"
                    >
                      {segment.text}
                    </span>
                  );
                }

                const isSelected = segment.chunk.id === selectedChunkId;

                return (
                  <span
                    aria-pressed={isSelected}
                    className={
                      isSelected
                        ? 'chunk-script-fragment is-selected'
                        : 'chunk-script-fragment'
                    }
                    data-segment-end-index={segment.endIndex}
                    data-segment-start-index={segment.startIndex}
                    key={segment.key}
                    onClick={() => handleChunkClick(segment.chunk.id)}
                    onKeyDown={(event) =>
                      handleChunkKeyDown(event, segment.chunk.id)
                    }
                    ref={(node) => {
                      if (isSelected) {
                        selectedChunkElementRef.current = node;
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {segment.text}
                  </span>
                );
              })}

              {selectedChunk && handlePositions.start ? (
                <span
                  aria-hidden="true"
                  className="chunk-boundary-guide is-start"
                  style={{
                    left: `${handlePositions.start.left}px`,
                  }}
                />
              ) : null}

              {selectedChunk && handlePositions.end ? (
                <span
                  aria-hidden="true"
                  className="chunk-boundary-guide is-end"
                  style={{
                    left: `${handlePositions.end.left}px`,
                  }}
                />
              ) : null}

              {selectedChunk && handlePositions.start ? (
                <button
                  aria-label="Drag start boundary"
                  className={
                    dragHandle === 'start'
                      ? 'chunk-boundary-handle is-active is-start'
                      : 'chunk-boundary-handle is-start'
                  }
                  onMouseDown={(event) => handleHandleMouseDown(event, 'start')}
                  style={{
                    left: `${handlePositions.start.left}px`,
                    top: `${handlePositions.start.top}px`,
                  }}
                  type="button"
                />
              ) : null}

              {selectedChunk && handlePositions.end ? (
                <button
                  aria-label="Drag end boundary"
                  className={
                    dragHandle === 'end'
                      ? 'chunk-boundary-handle is-active is-end'
                      : 'chunk-boundary-handle is-end'
                  }
                  onMouseDown={(event) => handleHandleMouseDown(event, 'end')}
                  style={{
                    left: `${handlePositions.end.left}px`,
                    top: `${handlePositions.end.top}px`,
                  }}
                  type="button"
                />
              ) : null}
            </div>
          </section>

          <aside className="modal-section chunk-boundary-sidebar">
            <h3 className="modal-section-title">Selected chunk</h3>
            {selectedChunk ? (
              <div className="chunk-boundary-details">
                <p className="page-note">
                  Start: {selectedChunk.startIndex}
                </p>
                <p className="page-note">End: {selectedChunk.endIndex}</p>
                <p className="page-note">
                  Drag either boundary bubble in the script view to resize this
                  chunk live.
                </p>
                <p className="status-message chunk-boundary-preview">
                  {selectedChunk.text}
                </p>

                <div className="chunk-boundary-controls">
                  <button
                    className="text-link"
                    onClick={() => handleBoundaryChange(-1, 0)}
                    type="button"
                  >
                    Move start left
                  </button>
                  <button
                    className="text-link"
                    onClick={() => handleBoundaryChange(1, 0)}
                    type="button"
                  >
                    Move start right
                  </button>
                  <button
                    className="text-link"
                    onClick={() => handleBoundaryChange(0, -1)}
                    type="button"
                  >
                    Move end left
                  </button>
                  <button
                    className="text-link"
                    onClick={() => handleBoundaryChange(0, 1)}
                    type="button"
                  >
                    Move end right
                  </button>
                  <button
                    className="text-link"
                    onClick={handleDeleteSelectedChunk}
                    type="button"
                  >
                    Delete Selected Chunk
                  </button>
                </div>
              </div>
            ) : (
              <p className="page-note">
                Select a chunk from the script to edit its boundaries.
              </p>
            )}
          </aside>
        </div>

        <div className="action-row modal-actions">
          <button className="text-link is-primary" onClick={handleDone} type="button">
            Done
          </button>
          <button className="text-link" onClick={handleCancel} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
