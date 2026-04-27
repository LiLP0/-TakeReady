import type { ScriptChunk } from '../types/script';
import { getDefaultChunkMetadata } from './chunkDefaults';
import {
  containsFullWordInRange,
  findWordsInRange,
  isWhitespaceCharacter,
  snapIndexToNearestWordBoundary,
  type WordBoundaryRange,
} from './wordBoundaries';

type ChunkRange = {
  startIndex: number;
  endIndex: number;
};

type WordRange = WordBoundaryRange;

type InsertChunkResult = {
  chunk: ScriptChunk;
  chunks: ScriptChunk[];
};

const MAIN_SECTION_ID = 'main';
const MIN_NON_WHITESPACE_CHARACTER_COUNT = 4;
const INITIAL_CHUNK_WORD_COUNT = 12;
const INITIAL_CHUNK_CONTEXT_WORDS_BEFORE = 2;
const MAX_INITIAL_CHUNK_CHARACTER_COUNT = 96;

function clampIndex(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function hasFullWord(rawScript: string, range: ChunkRange): boolean {
  return containsFullWordInRange(
    rawScript,
    range.startIndex,
    range.endIndex,
  );
}

function getNonWhitespaceCharacterCount(text: string): number {
  return text.replace(/\s/g, '').length;
}

function isUsableChunkRange(rawScript: string, range: ChunkRange): boolean {
  const rangeText = rawScript.slice(range.startIndex, range.endIndex);

  return (
    hasFullWord(rawScript, range) ||
    getNonWhitespaceCharacterCount(rangeText) >= MIN_NON_WHITESPACE_CHARACTER_COUNT
  );
}

function applyTrimmedRange(
  rawScript: string,
  startIndex: number,
  endIndex: number,
): ChunkRange | null {
  let nextStartIndex = startIndex;
  let nextEndIndex = endIndex;

  while (
    nextStartIndex < nextEndIndex &&
    isWhitespaceCharacter(rawScript[nextStartIndex])
  ) {
    nextStartIndex += 1;
  }

  while (
    nextEndIndex > nextStartIndex &&
    isWhitespaceCharacter(rawScript[nextEndIndex - 1])
  ) {
    nextEndIndex -= 1;
  }

  if (nextStartIndex >= nextEndIndex) {
    return null;
  }

  return {
    startIndex: nextStartIndex,
    endIndex: nextEndIndex,
  };
}

function snapIndexToWordBoundaryWithinRange(
  rawScript: string,
  index: number,
  bounds: ChunkRange,
): number {
  return snapIndexToNearestWordBoundary(rawScript, index, bounds);
}

function getNearestWord(words: WordRange[], index: number): WordRange | null {
  let nearestWord: WordRange | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const word of words) {
    if (index >= word.startIndex && index <= word.endIndex) {
      return word;
    }

    const distance =
      index < word.startIndex ? word.startIndex - index : index - word.endIndex;

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestWord = word;
    }
  }

  return nearestWord;
}

function getSentenceLikeRangeAroundWord(
  rawScript: string,
  freeRange: ChunkRange,
  word: WordRange,
): ChunkRange {
  let startIndex = freeRange.startIndex;
  let endIndex = freeRange.endIndex;

  for (let index = word.startIndex - 1; index >= freeRange.startIndex; index -= 1) {
    if (/[.!?\n]/.test(rawScript[index])) {
      startIndex = index + 1;
      break;
    }
  }

  for (let index = word.endIndex; index < freeRange.endIndex; index += 1) {
    if (/[.!?\n]/.test(rawScript[index])) {
      endIndex = index + 1;
      break;
    }
  }

  return {
    endIndex,
    startIndex,
  };
}

function extendEndThroughTrailingPunctuation(
  rawScript: string,
  endIndex: number,
  maxEndIndex: number,
): number {
  let nextEndIndex = endIndex;

  while (
    nextEndIndex < maxEndIndex &&
    /[,;:.!?]/.test(rawScript[nextEndIndex])
  ) {
    nextEndIndex += 1;
  }

  return nextEndIndex;
}

function createChunkId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `chunk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function rangesOverlap(leftRange: ChunkRange, rightRange: ChunkRange): boolean {
  return (
    leftRange.startIndex < rightRange.endIndex &&
    rightRange.startIndex < leftRange.endIndex
  );
}

function getChunkDistanceFromRange(
  chunk: ScriptChunk,
  range: ChunkRange,
): number {
  if (chunk.endIndex <= range.startIndex) {
    return range.startIndex - chunk.endIndex;
  }

  if (chunk.startIndex >= range.endIndex) {
    return chunk.startIndex - range.endIndex;
  }

  return 0;
}

function getSectionIdForInsertedChunk(
  chunks: ScriptChunk[],
  range: ChunkRange,
): ScriptChunk['sectionId'] {
  let nearestChunk: ScriptChunk | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const chunk of sortChunksByRange(chunks)) {
    const distance = getChunkDistanceFromRange(chunk, range);

    if (distance < nearestDistance) {
      nearestChunk = chunk;
      nearestDistance = distance;
    }
  }

  return nearestChunk?.sectionId ?? MAIN_SECTION_ID;
}

function updateChunkFromRange(
  rawScript: string,
  chunk: ScriptChunk,
  range: ChunkRange,
): ScriptChunk {
  const text = getChunkTextFromRange(
    rawScript,
    range.startIndex,
    range.endIndex,
  );

  if (
    chunk.startIndex === range.startIndex &&
    chunk.endIndex === range.endIndex &&
    chunk.text === text
  ) {
    return chunk;
  }

  return {
    ...chunk,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    text,
  };
}

function trimChunkToEnd(
  rawScript: string,
  chunk: ScriptChunk,
  maxEndIndex: number,
): ScriptChunk | null {
  const nextRange = normalizeChunkRange(
    rawScript,
    chunk.startIndex,
    Math.min(chunk.endIndex, maxEndIndex),
  );

  if (!nextRange) {
    return null;
  }

  if (!isUsableChunkRange(rawScript, nextRange)) {
    return null;
  }

  return updateChunkFromRange(rawScript, chunk, nextRange);
}

function trimChunkToStart(
  rawScript: string,
  chunk: ScriptChunk,
  minStartIndex: number,
): ScriptChunk | null {
  const nextRange = normalizeChunkRange(
    rawScript,
    Math.max(chunk.startIndex, minStartIndex),
    chunk.endIndex,
  );

  if (!nextRange) {
    return null;
  }

  if (!isUsableChunkRange(rawScript, nextRange)) {
    return null;
  }

  return updateChunkFromRange(rawScript, chunk, nextRange);
}

function repairLeftNeighbors(
  rawScript: string,
  chunks: ScriptChunk[],
  protectedStartIndex: number,
): ScriptChunk[] {
  const repairedChunks: ScriptChunk[] = [];
  let nextBoundary = protectedStartIndex;

  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const repairedChunk = trimChunkToEnd(rawScript, chunks[index], nextBoundary);

    if (!repairedChunk) {
      continue;
    }

    repairedChunks.push(repairedChunk);
    nextBoundary = repairedChunk.startIndex;
  }

  return repairedChunks.reverse();
}

function repairRightNeighbors(
  rawScript: string,
  chunks: ScriptChunk[],
  protectedEndIndex: number,
): ScriptChunk[] {
  const repairedChunks: ScriptChunk[] = [];
  let nextBoundary = protectedEndIndex;

  for (const chunk of chunks) {
    const repairedChunk = trimChunkToStart(rawScript, chunk, nextBoundary);

    if (!repairedChunk) {
      continue;
    }

    repairedChunks.push(repairedChunk);
    nextBoundary = repairedChunk.endIndex;
  }

  return repairedChunks;
}

export function getChunkTextFromRange(
  rawScript: string,
  startIndex: number,
  endIndex: number,
): string {
  const normalizedRange = normalizeChunkRange(rawScript, startIndex, endIndex);

  if (!normalizedRange) {
    return '';
  }

  return rawScript
    .slice(normalizedRange.startIndex, normalizedRange.endIndex)
    .trim();
}

export function normalizeChunkRange(
  rawScript: string,
  startIndex: number,
  endIndex: number,
): ChunkRange | null {
  const maxIndex = rawScript.length;
  const nextStartIndex = clampIndex(startIndex, 0, maxIndex, 0);
  const nextEndIndex = clampIndex(endIndex, 0, maxIndex, maxIndex);

  if (nextStartIndex >= nextEndIndex) {
    return null;
  }

  return applyTrimmedRange(rawScript, nextStartIndex, nextEndIndex);
}

export function snapIndexToWordBoundary(
  rawScript: string,
  index: number,
): number {
  return snapIndexToWordBoundaryWithinRange(rawScript, index, {
    endIndex: rawScript.length,
    startIndex: 0,
  });
}

export function suggestChunkRangeFromFreeRegion(
  rawScript: string,
  freeStartIndex: number,
  freeEndIndex: number,
  clickIndex: number,
): ChunkRange | null {
  const freeRange = normalizeChunkRange(
    rawScript,
    freeStartIndex,
    freeEndIndex,
  );

  if (!freeRange) {
    return null;
  }

  const words = findWordsInRange(
    rawScript,
    freeRange.startIndex,
    freeRange.endIndex,
  );

  if (words.length === 0) {
    return null;
  }

  const clampedClickIndex = clampIndex(
    clickIndex,
    freeRange.startIndex,
    freeRange.endIndex,
    freeRange.startIndex,
  );
  const nearestWord = getNearestWord(words, clampedClickIndex);

  if (!nearestWord) {
    return null;
  }

  const sentenceLikeRange = getSentenceLikeRangeAroundWord(
    rawScript,
    freeRange,
    nearestWord,
  );
  const sentenceRange =
    normalizeChunkRange(
      rawScript,
      sentenceLikeRange.startIndex,
      sentenceLikeRange.endIndex,
    ) ?? freeRange;
  const sentenceWords = findWordsInRange(
    rawScript,
    sentenceRange.startIndex,
    sentenceRange.endIndex,
  );
  const nearestWordIndex = sentenceWords.findIndex(
    (word) =>
      word.startIndex === nearestWord.startIndex &&
      word.endIndex === nearestWord.endIndex,
  );

  if (nearestWordIndex < 0) {
    return null;
  }

  const targetWordCount = Math.min(
    INITIAL_CHUNK_WORD_COUNT,
    sentenceWords.length,
  );
  let startWordIndex = Math.max(
    0,
    nearestWordIndex - INITIAL_CHUNK_CONTEXT_WORDS_BEFORE,
  );
  let endWordIndex = Math.min(
    sentenceWords.length - 1,
    startWordIndex + targetWordCount - 1,
  );

  startWordIndex = Math.max(0, endWordIndex - targetWordCount + 1);

  let startIndex = sentenceWords[startWordIndex].startIndex;
  let endIndex = extendEndThroughTrailingPunctuation(
    rawScript,
    sentenceWords[endWordIndex].endIndex,
    sentenceRange.endIndex,
  );

  while (
    endIndex - startIndex > MAX_INITIAL_CHUNK_CHARACTER_COUNT &&
    endWordIndex > nearestWordIndex
  ) {
    endWordIndex -= 1;
    endIndex = extendEndThroughTrailingPunctuation(
      rawScript,
      sentenceWords[endWordIndex].endIndex,
      sentenceRange.endIndex,
    );
  }

  while (
    endIndex - startIndex > MAX_INITIAL_CHUNK_CHARACTER_COUNT &&
    startWordIndex < nearestWordIndex
  ) {
    startWordIndex += 1;
    startIndex = sentenceWords[startWordIndex].startIndex;
  }

  const snappedStartIndex = snapIndexToWordBoundaryWithinRange(
    rawScript,
    startIndex,
    freeRange,
  );
  const snappedEndIndex = snapIndexToWordBoundaryWithinRange(
    rawScript,
    endIndex,
    freeRange,
  );
  const suggestedRange = normalizeChunkRange(
    rawScript,
    snappedStartIndex,
    snappedEndIndex,
  );

  if (suggestedRange && isUsableChunkRange(rawScript, suggestedRange)) {
    return suggestedRange;
  }

  const fallbackRange = normalizeChunkRange(
    rawScript,
    nearestWord.startIndex,
    nearestWord.endIndex,
  );

  if (fallbackRange && isUsableChunkRange(rawScript, fallbackRange)) {
    return fallbackRange;
  }

  return null;
}

export function createChunkFromRange(
  rawScript: string,
  startIndex: number,
  endIndex: number,
  sectionId?: ScriptChunk['sectionId'],
): ScriptChunk | null {
  const nextRange = normalizeChunkRange(rawScript, startIndex, endIndex);

  if (!nextRange || !isUsableChunkRange(rawScript, nextRange)) {
    return null;
  }

  return {
    ...getDefaultChunkMetadata(),
    endIndex: nextRange.endIndex,
    id: createChunkId(),
    sectionId,
    startIndex: nextRange.startIndex,
    text: getChunkTextFromRange(
      rawScript,
      nextRange.startIndex,
      nextRange.endIndex,
    ),
  };
}

export function insertChunkFromRange(
  rawScript: string,
  chunks: ScriptChunk[],
  startIndex: number,
  endIndex: number,
): InsertChunkResult | null {
  const normalizedRange = normalizeChunkRange(rawScript, startIndex, endIndex);

  if (!normalizedRange || !isUsableChunkRange(rawScript, normalizedRange)) {
    return null;
  }

  const chunk = createChunkFromRange(
    rawScript,
    normalizedRange.startIndex,
    normalizedRange.endIndex,
    getSectionIdForInsertedChunk(chunks, normalizedRange),
  );

  if (!chunk) {
    return null;
  }

  const overlapsExistingChunk = chunks.some((existingChunk) =>
    rangesOverlap(existingChunk, chunk),
  );

  if (overlapsExistingChunk) {
    return null;
  }

  return {
    chunk,
    chunks: sortChunksByRange([...chunks, chunk]),
  };
}

export function sortChunksByRange(chunks: ScriptChunk[]): ScriptChunk[] {
  return [...chunks].sort(
    (leftChunk, rightChunk) =>
      leftChunk.startIndex - rightChunk.startIndex ||
      leftChunk.endIndex - rightChunk.endIndex,
  );
}

export function removeChunkById(
  chunks: ScriptChunk[],
  chunkId: string,
): ScriptChunk[] {
  return sortChunksByRange(chunks.filter((chunk) => chunk.id !== chunkId));
}

export function updateChunkBoundary(
  rawScript: string,
  chunks: ScriptChunk[],
  chunkId: string,
  nextStartIndex: number,
  nextEndIndex: number,
): ScriptChunk[] {
  const targetChunk = chunks.find((chunk) => chunk.id === chunkId);

  if (!targetChunk) {
    return sortChunksByRange(chunks);
  }

  const nextRange = normalizeChunkRange(rawScript, nextStartIndex, nextEndIndex);
  const remainingChunks = sortChunksByRange(
    chunks.filter((chunk) => chunk.id !== chunkId),
  );

  if (!nextRange) {
    return sortChunksByRange(chunks);
  }

  if (!isUsableChunkRange(rawScript, nextRange)) {
    return sortChunksByRange(chunks);
  }

  const updatedChunk = updateChunkFromRange(rawScript, targetChunk, nextRange);
  const leftNeighbors = remainingChunks.filter(
    (chunk) => chunk.startIndex < updatedChunk.startIndex,
  );
  const rightNeighbors = remainingChunks.filter(
    (chunk) => chunk.startIndex >= updatedChunk.startIndex,
  );

  return [
    ...repairLeftNeighbors(rawScript, leftNeighbors, updatedChunk.startIndex),
    updatedChunk,
    ...repairRightNeighbors(rawScript, rightNeighbors, updatedChunk.endIndex),
  ];
}
