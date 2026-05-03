import type {
  ScriptFocusModeSettings,
  ScriptFocusUnderlineStyle,
} from '../types/script';

const DEFAULT_EMPHASIS_COLOR = '#86cf97';
const DEFAULT_FUNCTION_WORDS = new Set([
  'the',
  'and',
  'or',
  'to',
  'of',
  'in',
  'a',
  'an',
  'is',
  'it',
]);

const WORD_OR_NUMBER_OR_OTHER_REGEX =
  /(\p{L}+(?:['’-]\p{L}+)*)|(\p{N}+(?:[:.,/-]\p{N}+)*)|([^\p{L}\p{N}]+)/gu;
const LETTER_CHARACTER_REGEX = /\p{L}/u;
const NUMBER_CHARACTER_REGEX = /\p{N}/u;
const WORD_CONNECTOR_CHARACTER_REGEX = /['’-]/u;
const NUMBER_SEPARATOR_CHARACTER_REGEX = /[:.,/-]/u;
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
const CSS_COLOR_REGEX = /^[a-zA-Z]+$/;
const PREVIEW_TEXT =
  "You're still reading the original script. Word Anchors are optional visual guides for 10:30 timestamps, punchlines, and long phrases.";

export type ScriptFocusRenderableSegment = {
  emphasized: boolean;
  text: string;
};

export type ScriptFocusEmphasisInlineStyle = {
  color?: string;
  fontWeight?: string;
  textDecorationColor?: string;
  textDecorationLine?: string;
  textDecorationStyle?: ScriptFocusUnderlineStyle;
  textDecorationThickness?: string;
};

export const DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS: ScriptFocusModeSettings = {
  enabled: false,
  lettersEmphasized: 2,
  minimumWordLength: 4,
  frequency: 2,
  emphasisStyle: 'color',
  emphasisColor: DEFAULT_EMPHASIS_COLOR,
  underlineStyle: 'solid',
  underlineThickness: 1,
  ignoreShortFunctionWords: true,
  applyToNumbers: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return clampNumber(Math.round(value), minimum, maximum);
}

function normalizeColor(value: unknown): string {
  if (
    typeof value === 'string' &&
    (HEX_COLOR_REGEX.test(value) || CSS_COLOR_REGEX.test(value))
  ) {
    return value;
  }

  return DEFAULT_EMPHASIS_COLOR;
}

function normalizeEmphasisStyle(
  value: unknown,
): ScriptFocusModeSettings['emphasisStyle'] {
  return value === 'color' || value === 'underline' || value === 'color+underline'
    ? value
    : DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.emphasisStyle;
}

function normalizeUnderlineStyle(
  value: unknown,
): ScriptFocusModeSettings['underlineStyle'] {
  return value === 'solid' ||
    value === 'dotted' ||
    value === 'dashed' ||
    value === 'wavy'
    ? value
    : DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.underlineStyle;
}

function isTokenCharacter(
  character: string,
  tokenType: 'number' | 'word',
): boolean {
  return tokenType === 'word'
    ? LETTER_CHARACTER_REGEX.test(character)
    : NUMBER_CHARACTER_REGEX.test(character);
}

function countTokenLength(token: string, tokenType: 'number' | 'word'): number {
  return Array.from(token).reduce(
    (length, character) =>
      length + (isTokenCharacter(character, tokenType) ? 1 : 0),
    0,
  );
}

function isAllWordsEligibilityMode(
  settings: ScriptFocusModeSettings,
): boolean {
  return settings.minimumWordLength <= 1;
}

function migrateLettersEmphasizedFromLegacyPercentage(
  value: unknown,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.lettersEmphasized;
  }

  const normalizedPercentage = clampNumber(Math.round(value), 10, 70);

  if (normalizedPercentage <= 20) {
    return 1;
  }

  if (normalizedPercentage <= 40) {
    return 2;
  }

  if (normalizedPercentage <= 55) {
    return 3;
  }

  return 4;
}

function getAnchorLength(
  tokenLength: number,
  lettersEmphasized: number,
): number {
  if (tokenLength <= 1) {
    return 1;
  }

  return clampNumber(lettersEmphasized, 1, Math.max(1, tokenLength - 1));
}

function splitTokenAtAnchor(
  token: string,
  tokenType: 'number' | 'word',
  anchorLength: number,
): {
  anchor: string;
  remainder: string;
} {
  let consumedCharacters = 0;
  let anchor = '';
  let remainder = '';

  for (const character of Array.from(token)) {
    if (consumedCharacters < anchorLength) {
      anchor += character;

      if (isTokenCharacter(character, tokenType)) {
        consumedCharacters += 1;
      }

      continue;
    }

    remainder += character;
  }

  return {
    anchor,
    remainder,
  };
}

function moveTrailingBoundaryCharacters(
  anchor: string,
  remainder: string,
  boundaryRegex: RegExp,
): {
  anchor: string;
  remainder: string;
} {
  let nextAnchor = anchor;
  let nextRemainder = remainder;

  while (nextAnchor) {
    const anchorCharacters = Array.from(nextAnchor);
    const trailingCharacter = anchorCharacters[anchorCharacters.length - 1];

    if (!boundaryRegex.test(trailingCharacter)) {
      break;
    }

    nextAnchor = anchorCharacters.slice(0, -1).join('');
    nextRemainder = `${trailingCharacter}${nextRemainder}`;
  }

  return {
    anchor: nextAnchor,
    remainder: nextRemainder,
  };
}

function moveSeparatedSuffixToRemainder(
  anchor: string,
  remainder: string,
  boundaryRegex: RegExp,
): {
  anchor: string;
  remainder: string;
} {
  if (!anchor || !remainder) {
    return {
      anchor,
      remainder,
    };
  }

  const anchorCharacters = Array.from(anchor);
  let lastBoundaryIndex = -1;

  for (let index = anchorCharacters.length - 1; index >= 1; index -= 1) {
    if (boundaryRegex.test(anchorCharacters[index])) {
      lastBoundaryIndex = index;
      break;
    }
  }

  if (lastBoundaryIndex <= 0 || lastBoundaryIndex >= anchorCharacters.length) {
    return {
      anchor,
      remainder,
    };
  }

  return {
    anchor: anchorCharacters.slice(0, lastBoundaryIndex).join(''),
    remainder: `${anchorCharacters.slice(lastBoundaryIndex).join('')}${remainder}`,
  };
}

function normalizeAnchorSplit(
  anchor: string,
  remainder: string,
  tokenType: 'number' | 'word',
): {
  anchor: string;
  remainder: string;
} {
  const boundaryRegex =
    tokenType === 'word'
      ? WORD_CONNECTOR_CHARACTER_REGEX
      : NUMBER_SEPARATOR_CHARACTER_REGEX;

  const withoutTrailingBoundary = moveTrailingBoundaryCharacters(
    anchor,
    remainder,
    boundaryRegex,
  );

  return moveSeparatedSuffixToRemainder(
    withoutTrailingBoundary.anchor,
    withoutTrailingBoundary.remainder,
    boundaryRegex,
  );
}

function isIgnoredFunctionWord(
  token: string,
  settings: ScriptFocusModeSettings,
): boolean {
  if (isAllWordsEligibilityMode(settings)) {
    return false;
  }

  if (!settings.ignoreShortFunctionWords) {
    return false;
  }

  const normalizedWord = Array.from(token)
    .filter((character) => LETTER_CHARACTER_REGEX.test(character))
    .join('')
    .toLowerCase();

  return DEFAULT_FUNCTION_WORDS.has(normalizedWord);
}

export function normalizeScriptFocusModeSettings(
  value: Partial<ScriptFocusModeSettings> | unknown,
): ScriptFocusModeSettings {
  const settings = isRecord(value) ? value : {};
  const legacyWordAnchorsEnabled = normalizeBoolean(
    settings.wordAnchorsEnabled,
    false,
  );

  return {
    enabled:
      normalizeBoolean(
        settings.enabled,
        DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.enabled,
      ) || legacyWordAnchorsEnabled,
    lettersEmphasized:
      typeof settings.lettersEmphasized === 'number' &&
      Number.isFinite(settings.lettersEmphasized)
        ? normalizeNumber(
            settings.lettersEmphasized,
            DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.lettersEmphasized,
            1,
            8,
          )
        : migrateLettersEmphasizedFromLegacyPercentage(
            settings.emphasizedPortion,
          ),
    minimumWordLength: normalizeNumber(
      settings.minimumWordLength,
      DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.minimumWordLength,
      1,
      24,
    ),
    frequency: normalizeNumber(
      settings.frequency,
      DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.frequency,
      1,
      24,
    ),
    emphasisStyle: normalizeEmphasisStyle(settings.emphasisStyle),
    emphasisColor: normalizeColor(settings.emphasisColor),
    underlineStyle: normalizeUnderlineStyle(settings.underlineStyle),
    underlineThickness: normalizeNumber(
      settings.underlineThickness,
      DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.underlineThickness,
      1,
      6,
    ),
    ignoreShortFunctionWords: normalizeBoolean(
      settings.ignoreShortFunctionWords,
      DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.ignoreShortFunctionWords,
    ),
    applyToNumbers: normalizeBoolean(
      settings.applyToNumbers,
      DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.applyToNumbers,
    ),
  };
}

export function isScriptFocusModeActive(
  settings: ScriptFocusModeSettings,
): boolean {
  return settings.enabled;
}

export function getScriptFocusRenderableSegments(
  text: string,
  settings: ScriptFocusModeSettings,
): ScriptFocusRenderableSegment[] {
  if (!text) {
    return [];
  }

  if (!isScriptFocusModeActive(settings)) {
    return [
      {
        emphasized: false,
        text,
      },
    ];
  }

  const segments: ScriptFocusRenderableSegment[] = [];
  let eligibleTokenIndex = 0;

  for (const match of text.matchAll(WORD_OR_NUMBER_OR_OTHER_REGEX)) {
    const wordToken = match[1];
    const numberToken = match[2];
    const otherToken = match[3];

    if (otherToken) {
      segments.push({
        emphasized: false,
        text: otherToken,
      });
      continue;
    }

    const token = wordToken ?? numberToken ?? '';
    const tokenType = wordToken ? 'word' : 'number';
    const tokenLength = countTokenLength(token, tokenType);
    const minimumEligibleLength =
      tokenType === 'word' && isAllWordsEligibilityMode(settings)
        ? 1
        : settings.minimumWordLength;
    const canEmphasize =
      tokenLength >= minimumEligibleLength &&
      (tokenType === 'word' || settings.applyToNumbers) &&
      (tokenType !== 'word' || !isIgnoredFunctionWord(token, settings));

    if (!canEmphasize) {
      segments.push({
        emphasized: false,
        text: token,
      });
      continue;
    }

    const shouldEmphasize =
      eligibleTokenIndex % settings.frequency === 0;
    eligibleTokenIndex += 1;

    if (!shouldEmphasize) {
      segments.push({
        emphasized: false,
        text: token,
      });
      continue;
    }

    const splitToken = splitTokenAtAnchor(
      token,
      tokenType,
      getAnchorLength(tokenLength, settings.lettersEmphasized),
    );
    const { anchor, remainder } = normalizeAnchorSplit(
      splitToken.anchor,
      splitToken.remainder,
      tokenType,
    );

    segments.push({
      emphasized: true,
      text: anchor,
    });

    if (remainder) {
      segments.push({
        emphasized: false,
        text: remainder,
      });
    }
  }

  return segments;
}

export function getScriptFocusEmphasisStyle(
  settings: ScriptFocusModeSettings,
): ScriptFocusEmphasisInlineStyle {
  const sharedUnderlineStyle = {
    textDecorationColor: settings.emphasisColor,
    textDecorationLine: 'underline',
    textDecorationStyle: settings.underlineStyle,
    textDecorationThickness: `${settings.underlineThickness}px`,
  } as const;

  if (settings.emphasisStyle === 'color') {
    return {
      color: settings.emphasisColor,
      fontWeight: 'inherit',
    };
  }

  if (settings.emphasisStyle === 'underline') {
    return {
      fontWeight: 'inherit',
      ...sharedUnderlineStyle,
    };
  }

  return {
    color: settings.emphasisColor,
    fontWeight: 'inherit',
    ...sharedUnderlineStyle,
  };
}

export function getScriptFocusPreviewText(rawScript: string): string {
  const previewSource = rawScript.trim();

  if (!previewSource) {
    return PREVIEW_TEXT;
  }

  return previewSource.slice(0, 220);
}
