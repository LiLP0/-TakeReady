export type WordBoundaryRange = {
  endIndex: number;
  startIndex: number;
  text: string;
};

type BoundaryBounds = {
  endIndex: number;
  startIndex: number;
};

const WORD_CORE_CHARACTER_PATTERN = /^[\p{L}\p{N}\p{M}_]$/u;
const WORD_JOINER_CHARACTERS = new Set(["'", '’', '-', '‐', '‑']);

function clampIndex(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function isWhitespaceCharacter(character: string | undefined): boolean {
  return typeof character === 'string' && /\s/.test(character);
}

export function isWordCoreCharacter(character: string | undefined): boolean {
  return (
    typeof character === 'string' && WORD_CORE_CHARACTER_PATTERN.test(character)
  );
}

export function isWordJoinerCharacter(character: string | undefined): boolean {
  return typeof character === 'string' && WORD_JOINER_CHARACTERS.has(character);
}

export function isWordCharacterAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) {
    return false;
  }

  const character = text[index];

  if (isWordCoreCharacter(character)) {
    return true;
  }

  if (!isWordJoinerCharacter(character)) {
    return false;
  }

  return (
    isWordCoreCharacter(text[index - 1]) &&
    isWordCoreCharacter(text[index + 1])
  );
}

export function isSafeWordBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) {
    return true;
  }

  const previousCharacter = text[index - 1];
  const nextCharacter = text[index];

  return (
    isWhitespaceCharacter(previousCharacter) ||
    isWhitespaceCharacter(nextCharacter) ||
    isWordCharacterAt(text, index - 1) !== isWordCharacterAt(text, index)
  );
}

export function findWordsInRange(
  text: string,
  startIndex: number,
  endIndex: number,
): WordBoundaryRange[] {
  const rangeStartIndex = clampIndex(startIndex, 0, text.length);
  const rangeEndIndex = clampIndex(endIndex, 0, text.length);
  const words: WordBoundaryRange[] = [];
  let cursor = rangeStartIndex;

  while (cursor < rangeEndIndex) {
    if (!isWordCharacterAt(text, cursor)) {
      cursor += 1;
      continue;
    }

    const wordStartIndex = cursor;

    while (cursor < rangeEndIndex && isWordCharacterAt(text, cursor)) {
      cursor += 1;
    }

    words.push({
      endIndex: cursor,
      startIndex: wordStartIndex,
      text: text.slice(wordStartIndex, cursor),
    });
  }

  return words;
}

export function containsFullWordInRange(
  text: string,
  startIndex: number,
  endIndex: number,
): boolean {
  return findWordsInRange(text, startIndex, endIndex).some(
    (word) =>
      isSafeWordBoundary(text, word.startIndex) &&
      isSafeWordBoundary(text, word.endIndex),
  );
}

export function normalizeWordToken(token: string): string {
  return findWordsInRange(token, 0, token.length)
    .map((word) => word.text)
    .join('')
    .toLowerCase();
}

export function snapIndexToNearestWordBoundary(
  text: string,
  index: number,
  bounds: BoundaryBounds = { endIndex: text.length, startIndex: 0 },
): number {
  const boundsStartIndex = clampIndex(bounds.startIndex, 0, text.length);
  const boundsEndIndex = clampIndex(bounds.endIndex, 0, text.length);
  const clampedIndex = clampIndex(index, boundsStartIndex, boundsEndIndex);

  if (isSafeWordBoundary(text, clampedIndex)) {
    return clampedIndex;
  }

  const maxDistance = Math.max(
    clampedIndex - boundsStartIndex,
    boundsEndIndex - clampedIndex,
  );

  for (let distance = 1; distance <= maxDistance; distance += 1) {
    const leftIndex = clampedIndex - distance;
    const rightIndex = clampedIndex + distance;

    if (leftIndex >= boundsStartIndex && isSafeWordBoundary(text, leftIndex)) {
      return leftIndex;
    }

    if (rightIndex <= boundsEndIndex && isSafeWordBoundary(text, rightIndex)) {
      return rightIndex;
    }
  }

  return clampedIndex;
}
