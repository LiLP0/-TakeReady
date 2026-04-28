import type {
  ScriptFocusModeSettings,
  ScriptFocusUnderlineStyle,
} from '../types/script';

const DEFAULT_EMPHASIS_COLOR = '#60a5fa';
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
  emphasizedPortion: 35,
  minimumWordLength: 1,
  frequency: 1,
  emphasisStyle: 'color+underline',
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

function getAnchorLength(
  tokenLength: number,
  emphasizedPortion: number,
): number {
  return Math.max(
    1,
    Math.min(tokenLength, Math.round((tokenLength * emphasizedPortion) / 100)),
  );
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

function isIgnoredFunctionWord(
  token: string,
  settings: ScriptFocusModeSettings,
): boolean {
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
    emphasizedPortion: normalizeNumber(
      settings.emphasizedPortion,
      DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS.emphasizedPortion,
      10,
      70,
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
    const canEmphasize =
      tokenLength >= settings.minimumWordLength &&
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

    const { anchor, remainder } = splitTokenAtAnchor(
      token,
      tokenType,
      getAnchorLength(tokenLength, settings.emphasizedPortion),
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
