import type { ScriptChunk } from '../types/script';
import { getDefaultChunkMetadata } from './chunkDefaults';
import {
  findWordsInRange,
  isWhitespaceCharacter,
  isWordCharacterAt,
  normalizeWordToken,
  type WordBoundaryRange,
} from './wordBoundaries';

type IndexedSpan = {
  startIndex: number;
  endIndex: number;
};

type WordSpan = WordBoundaryRange;

type ChunkScriptOptions = {
  sectionId?: ScriptChunk['sectionId'];
};

const SENTENCE_PATTERN = /[^.!?]+[.!?]+|[^.!?]+$/g;
const SOFT_BREAK_CHAR_COUNT = 80;
const HARD_BREAK_CHAR_COUNT = 120;
const HARD_BREAK_WORD_COUNT = 18;
const MIN_READABLE_WORD_COUNT = 4;
const CONJUNCTION_BREAK_WORDS = new Set([
  'and',
  'but',
  'or',
  'so',
  'because',
  'then',
  'while',
  'although',
  'though',
]);

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function trimWhitespaceRange(
  text: string,
  startIndex: number,
  endIndex: number,
): IndexedSpan | null {
  let nextStartIndex = startIndex;
  let nextEndIndex = endIndex;

  while (
    nextStartIndex < nextEndIndex &&
    isWhitespaceCharacter(text[nextStartIndex])
  ) {
    nextStartIndex += 1;
  }

  while (
    nextEndIndex > nextStartIndex &&
    isWhitespaceCharacter(text[nextEndIndex - 1])
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

function getSpanText(text: string, span: IndexedSpan): string {
  return text.slice(span.startIndex, span.endIndex);
}

function getNormalizedSpanText(text: string, span: IndexedSpan): string {
  return normalizeWhitespace(getSpanText(text, span));
}

function getDisplaySpanText(text: string, span: IndexedSpan): string {
  return getSpanText(text, span).trim();
}

function splitIntoSentences(text: string): IndexedSpan[] {
  return Array.from(text.matchAll(SENTENCE_PATTERN))
    .map((match) =>
      trimWhitespaceRange(
        text,
        match.index ?? 0,
        (match.index ?? 0) + match[0].length,
      ),
    )
    .filter((span): span is IndexedSpan => span !== null);
}

function splitIntoWords(text: string, span: IndexedSpan): WordSpan[] {
  return findWordsInRange(text, span.startIndex, span.endIndex);
}

function normalizeToken(token: string): string {
  return normalizeWordToken(token);
}

function endsWithSoftPause(text: string): boolean {
  return /[,;:]$/.test(text.trim());
}

function createChunkId(index: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `chunk-${Date.now()}-${index}`;
}

function shouldSplitChunk(
  text: string,
  currentWords: WordSpan[],
  remainingWords: WordSpan[],
  maxEndIndex: number,
): boolean {
  if (currentWords.length === 0 || remainingWords.length === 0) {
    return false;
  }

  const currentSpan = createSpanFromWords(text, currentWords, maxEndIndex);
  const currentText = getNormalizedSpanText(text, currentSpan);
  const nextWord = normalizeToken(remainingWords[0].text);
  const currentWordCount = currentWords.length;
  const remainingWordCount = remainingWords.length;
  const reachedSoftPause =
    currentText.length >= SOFT_BREAK_CHAR_COUNT &&
    (endsWithSoftPause(currentText) || CONJUNCTION_BREAK_WORDS.has(nextWord));
  const reachedHardLimit =
    currentText.length >= HARD_BREAK_CHAR_COUNT ||
    currentWordCount >= HARD_BREAK_WORD_COUNT;

  if (
    reachedSoftPause &&
    currentWordCount >= MIN_READABLE_WORD_COUNT &&
    remainingWordCount >= MIN_READABLE_WORD_COUNT
  ) {
    return true;
  }

  return reachedHardLimit && currentWordCount >= MIN_READABLE_WORD_COUNT;
}

function createChunkSpan(
  text: string,
  startIndex: number,
  endIndex: number,
): IndexedSpan | null {
  return trimWhitespaceRange(text, startIndex, endIndex);
}

function includeTrailingPunctuation(
  text: string,
  endIndex: number,
  maxEndIndex: number,
): number {
  let nextEndIndex = endIndex;

  while (
    nextEndIndex < maxEndIndex &&
    !isWhitespaceCharacter(text[nextEndIndex]) &&
    !isWordCharacterAt(text, nextEndIndex)
  ) {
    nextEndIndex += 1;
  }

  return nextEndIndex;
}

function createSpanFromWords(
  text: string,
  words: WordSpan[],
  maxEndIndex: number,
): IndexedSpan {
  return {
    startIndex: words[0].startIndex,
    endIndex: includeTrailingPunctuation(
      text,
      words[words.length - 1].endIndex,
      maxEndIndex,
    ),
  };
}

function splitLongSentence(text: string, sentence: IndexedSpan): IndexedSpan[] {
  const words = splitIntoWords(text, sentence);

  if (words.length === 0) {
    return [];
  }

  const chunks: IndexedSpan[] = [];
  let currentWords: WordSpan[] = [];

  words.forEach((word, index) => {
    currentWords.push(word);

    const remainingWords = words.slice(index + 1);

    if (shouldSplitChunk(text, currentWords, remainingWords, sentence.endIndex)) {
      const currentSpan = createSpanFromWords(
        text,
        currentWords,
        sentence.endIndex,
      );
      const nextChunk = createChunkSpan(
        text,
        currentSpan.startIndex,
        currentSpan.endIndex,
      );

      if (nextChunk) {
        chunks.push(nextChunk);
      }

      currentWords = [];
    }
  });

  if (currentWords.length > 0) {
    const currentSpan = createSpanFromWords(text, currentWords, sentence.endIndex);
    const nextChunk = createChunkSpan(
      text,
      currentSpan.startIndex,
      currentSpan.endIndex,
    );

    if (nextChunk) {
      chunks.push(nextChunk);
    }
  }

  return chunks;
}

function createChunk(
  text: string,
  span: IndexedSpan,
  index: number,
  options?: ChunkScriptOptions,
): ScriptChunk {
  return {
    id: createChunkId(index),
    text: getDisplaySpanText(text, span),
    startIndex: span.startIndex,
    endIndex: span.endIndex,
    sectionId: options?.sectionId,
    ...getDefaultChunkMetadata(),
  };
}

export function chunkScript(
  rawScriptText: string,
  options?: ChunkScriptOptions,
): ScriptChunk[] {
  if (!normalizeWhitespace(rawScriptText)) {
    return [];
  }

  return splitIntoSentences(rawScriptText)
    .flatMap((sentence) => splitLongSentence(rawScriptText, sentence))
    .map((span, index) => createChunk(rawScriptText, span, index, options));
}
