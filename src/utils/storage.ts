import type {
  ChunkType,
  ScriptChunk,
  ScriptFocusModeSettings,
  ScriptProject,
  ScriptSection,
  SessionNote,
  ToneTag,
} from '../types/script';
import {
  DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS,
  normalizeScriptFocusModeSettings,
} from './scriptFocusMode';

const BITFEEDER_PROJECTS_STORAGE_KEY = 'bitfeeder.projects';
const BITFEEDER_SCRIPT_FOCUS_SETTINGS_STORAGE_KEY =
  'bitfeeder.scriptFocusMode';
const LEGACY_BITFEEDER_PROJECT_STORAGE_KEY = 'bitfeeder.project';
const MAIN_SECTION_ID = 'main';
const MAIN_SECTION_TITLE = 'Main';
const RAW_DRAFT_SECTION_ID = 'raw-draft';
const RAW_DRAFT_SECTION_TITLE = 'Raw Draft';

const CHUNK_TYPES: ChunkType[] = [
  'HOOK',
  'SETUP',
  'POINT',
  'JOKE',
  'PUNCHLINE',
  'TRANSITION',
  'RANT',
  'OUTRO',
  'B_ROLL_NOTE',
];

const TONE_TAGS: ToneTag[] = [
  'neutral',
  'curious',
  'dry',
  'sarcastic',
  'deadpan',
  'confused',
  'fake_serious',
  'escalating',
];

export type ProjectCleanupSummary = {
  filteredChunkCount: number;
  skippedProjectCount: number;
  source: 'import' | 'load';
};

export type LibraryLoadError = {
  code: 'malformed_library';
};

export type LibraryWriteResult = 'blocked' | 'failed' | 'success';

type RawScriptSectionRecord = {
  chunks: unknown[];
  description: string;
  id: string;
  title: string;
};

type MigratedProjectResult = {
  filteredChunkCount: number;
  project: ScriptProject;
};

let lastProjectCleanupSummary: ProjectCleanupSummary | null = null;
let lastLibraryLoadError: LibraryLoadError | null = null;

function createProjectCleanupSummary(
  source: ProjectCleanupSummary['source'],
  skippedProjectCount: number,
  filteredChunkCount: number,
): ProjectCleanupSummary | null {
  if (skippedProjectCount === 0 && filteredChunkCount === 0) {
    return null;
  }

  return {
    filteredChunkCount,
    skippedProjectCount,
    source,
  };
}

function setLastProjectCleanupSummary(
  summary: ProjectCleanupSummary | null,
): void {
  lastProjectCleanupSummary = summary;
}

function createMalformedLibraryLoadError(): LibraryLoadError {
  return {
    code: 'malformed_library',
  };
}

function setLastLibraryLoadError(error: LibraryLoadError | null): void {
  lastLibraryLoadError = error;
}

export function clearLastProjectCleanupSummary(): void {
  setLastProjectCleanupSummary(null);
}

export function clearLastLibraryLoadError(): void {
  setLastLibraryLoadError(null);
}

export function consumeLastProjectCleanupSummary(): ProjectCleanupSummary | null {
  const summary = lastProjectCleanupSummary;
  setLastProjectCleanupSummary(null);
  return summary;
}

export function getLastProjectCleanupSummary(): ProjectCleanupSummary | null {
  return lastProjectCleanupSummary;
}

export function getLastLibraryLoadError(): LibraryLoadError | null {
  return lastLibraryLoadError;
}

function getParsedDateTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

export function compareDateStringsDescending(
  firstValue: string,
  secondValue: string,
): number {
  const firstTimestamp = getParsedDateTimestamp(firstValue);
  const secondTimestamp = getParsedDateTimestamp(secondValue);

  if (firstTimestamp !== null && secondTimestamp !== null) {
    if (firstTimestamp !== secondTimestamp) {
      return secondTimestamp - firstTimestamp;
    }

    return secondValue.localeCompare(firstValue);
  }

  if (firstTimestamp !== null) {
    return -1;
  }

  if (secondTimestamp !== null) {
    return 1;
  }

  return secondValue.localeCompare(firstValue);
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return typeof value === 'undefined' || isString(value);
}

function isChunkType(value: unknown): value is ChunkType {
  return isString(value) && CHUNK_TYPES.includes(value as ChunkType);
}

function isToneTag(value: unknown): value is ToneTag {
  return isString(value) && TONE_TAGS.includes(value as ToneTag);
}

function getScriptSections(value: unknown): RawScriptSectionRecord[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const sections: RawScriptSectionRecord[] = [];

  for (const section of value) {
    if (
      !isRecord(section) ||
      !isString(section.id) ||
      !isString(section.title) ||
      !isString(section.description) ||
      !Array.isArray(section.chunks)
    ) {
      return null;
    }

    sections.push({
      chunks: section.chunks,
      description: section.description,
      id: section.id,
      title: section.title,
    });
  }

  return sections;
}

function getSessionNotes(value: unknown): SessionNote[] | null {
  if (!Array.isArray(value) || !value.every(isSessionNote)) {
    return null;
  }

  return value;
}

function isScriptChunk(value: unknown): value is ScriptChunk {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.id) &&
    isString(value.text) &&
    isNumber(value.startIndex) &&
    isNumber(value.endIndex) &&
    value.startIndex >= 0 &&
    value.endIndex >= value.startIndex &&
    isOptionalString(value.sectionId) &&
    isChunkType(value.type) &&
    isToneTag(value.tone) &&
    isString(value.deliveryNote) &&
    isString(value.editNote) &&
    isString(value.brollNote) &&
    isOptionalString(value.emojiCue) &&
    isBoolean(value.pauseAfter) &&
    isBoolean(value.goodTake)
  );
}

function isSessionNote(value: unknown): value is SessionNote {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.id) &&
    isString(value.text) &&
    isString(value.createdAt) &&
    isOptionalString(value.sectionId) &&
    isOptionalString(value.chunkId)
  );
}

function isLegacyRawScriptSection(section: RawScriptSectionRecord): boolean {
  return (
    section.id === MAIN_SECTION_ID ||
    section.title === MAIN_SECTION_TITLE ||
    section.id === RAW_DRAFT_SECTION_ID ||
    (section.title === RAW_DRAFT_SECTION_TITLE && section.chunks.length === 0)
  );
}

function deriveLegacyRawScript(sections: RawScriptSectionRecord[]): string {
  const mainSection = sections.find(
    (section) => section.id === MAIN_SECTION_ID || section.title === MAIN_SECTION_TITLE,
  );

  if (mainSection?.description) {
    return mainSection.description;
  }

  const rawDraftSection = sections.find(
    (section) =>
      section.id === RAW_DRAFT_SECTION_ID ||
      (section.title === RAW_DRAFT_SECTION_TITLE && section.chunks.length === 0),
  );

  return rawDraftSection?.description ?? '';
}

function clearLegacyRawScriptDescriptions(
  sections: ScriptSection[],
  rawScript: string,
): ScriptSection[] {
  if (!rawScript) {
    return sections;
  }

  return sections.map((section) => {
    if (
      isLegacyRawScriptSection(section) &&
      section.description === rawScript
    ) {
      return {
        ...section,
        description: '',
      };
    }

    return section;
  });
}

function normalizeChunkTextForComparison(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isChunkRangeWithinRawScript(
  chunk: ScriptChunk,
  rawScript: string,
): boolean {
  return (
    chunk.startIndex >= 0 &&
    chunk.endIndex <= rawScript.length &&
    chunk.startIndex < chunk.endIndex
  );
}

function isChunkTextConsistentWithRawScript(
  chunk: ScriptChunk,
  rawScript: string,
): boolean {
  const rawSliceText = rawScript.slice(chunk.startIndex, chunk.endIndex).trim();

  if (!rawSliceText) {
    return false;
  }

  return (
    normalizeChunkTextForComparison(chunk.text) ===
    normalizeChunkTextForComparison(rawSliceText)
  );
}

function sanitizeSectionChunks(
  section: RawScriptSectionRecord,
  chunkSourceRawScript: string,
): {
  filteredChunkCount: number;
  section: ScriptSection;
} {
  const chunks: ScriptChunk[] = [];
  let filteredChunkCount = 0;

  for (const chunkValue of section.chunks) {
    if (!isScriptChunk(chunkValue)) {
      filteredChunkCount += 1;
      continue;
    }

    if (!isChunkRangeWithinRawScript(chunkValue, chunkSourceRawScript)) {
      filteredChunkCount += 1;
      continue;
    }

    if (!isChunkTextConsistentWithRawScript(chunkValue, chunkSourceRawScript)) {
      filteredChunkCount += 1;
      continue;
    }

    chunks.push({
      ...chunkValue,
      sectionId: section.id,
    });
  }

  return {
    filteredChunkCount,
    section: {
      chunks,
      description: section.description,
      id: section.id,
      title: section.title,
    },
  };
}

function migrateScriptProject(value: unknown): MigratedProjectResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const sections = getScriptSections(value.sections);
  const sessionNotes = getSessionNotes(value.sessionNotes);

  if (
    !isString(value.id) ||
    !isString(value.title) ||
    !isString(value.createdAt) ||
    !isString(value.updatedAt) ||
    !sections ||
    !sessionNotes
  ) {
    return null;
  }

  if ('rawScript' in value && !isString(value.rawScript)) {
    return null;
  }

  const rawScript = isString(value.rawScript)
    ? value.rawScript
    : deriveLegacyRawScript(sections);
  const chunkSourceRawScript = isString(value.chunkSourceRawScript)
    ? value.chunkSourceRawScript
    : rawScript;
  const sanitizedSections = sections.map((section) =>
    sanitizeSectionChunks(section, chunkSourceRawScript),
  );
  const filteredChunkCount = sanitizedSections.reduce(
    (totalFilteredChunkCount, result) =>
      totalFilteredChunkCount + result.filteredChunkCount,
    0,
  );

  return {
    filteredChunkCount,
    project: {
      id: value.id,
      title: value.title,
      rawScript,
      chunkSourceRawScript,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      sections: clearLegacyRawScriptDescriptions(
        sanitizedSections.map((result) => result.section),
        rawScript,
      ),
      sessionNotes,
    },
  };
}

function migrateScriptProjects(value: unknown): {
  filteredChunkCount: number;
  projects: ScriptProject[];
  skippedProjectCount: number;
} | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const projects: ScriptProject[] = [];
  let filteredChunkCount = 0;
  let skippedProjectCount = 0;

  for (const projectValue of value) {
    const migratedProject = migrateScriptProject(projectValue);

    if (!migratedProject) {
      skippedProjectCount += 1;
      continue;
    }

    filteredChunkCount += migratedProject.filteredChunkCount;
    projects.push(migratedProject.project);
  }

  return {
    filteredChunkCount,
    projects,
    skippedProjectCount,
  };
}

function upsertProject(
  projects: ScriptProject[],
  projectToSave: ScriptProject,
): ScriptProject[] {
  const existingIndex = projects.findIndex(
    (project) => project.id === projectToSave.id,
  );

  if (existingIndex === -1) {
    return [...projects, projectToSave];
  }

  return projects.map((project, index) =>
    index === existingIndex ? projectToSave : project,
  );
}

function readProjectCollection(storage: Storage): {
  filteredChunkCount: number;
  libraryLoadError: LibraryLoadError | null;
  projects: ScriptProject[];
  skippedProjectCount: number;
  shouldPersist: boolean;
} {
  const rawProjects = storage.getItem(BITFEEDER_PROJECTS_STORAGE_KEY);

  if (rawProjects === null) {
    return {
      filteredChunkCount: 0,
      libraryLoadError: null,
      projects: [],
      skippedProjectCount: 0,
      shouldPersist: false,
    };
  }

  try {
    const parsedProjects: unknown = JSON.parse(rawProjects);
    const migratedProjects = migrateScriptProjects(parsedProjects);

    if (!migratedProjects) {
      return {
        filteredChunkCount: 0,
        libraryLoadError: createMalformedLibraryLoadError(),
        projects: [],
        skippedProjectCount: 0,
        shouldPersist: false,
      };
    }

    return {
      filteredChunkCount: migratedProjects.filteredChunkCount,
      libraryLoadError: null,
      projects: migratedProjects.projects,
      skippedProjectCount: migratedProjects.skippedProjectCount,
      shouldPersist:
        migratedProjects.skippedProjectCount > 0 ||
        migratedProjects.filteredChunkCount > 0,
    };
  } catch {
    return {
      filteredChunkCount: 0,
      libraryLoadError: createMalformedLibraryLoadError(),
      projects: [],
      skippedProjectCount: 0,
      shouldPersist: false,
    };
  }
}

function isTopLevelLibraryWriteBlocked(storage: Storage): boolean {
  return (
    readProjectCollection(storage).libraryLoadError?.code ===
    'malformed_library'
  );
}

function readLegacyProject(storage: Storage): MigratedProjectResult | null {
  const rawProject = storage.getItem(LEGACY_BITFEEDER_PROJECT_STORAGE_KEY);

  if (rawProject === null) {
    return null;
  }

  try {
    const parsedProject: unknown = JSON.parse(rawProject);
    return migrateScriptProject(parsedProject);
  } catch {
    return null;
  }
}

function writeProjects(storage: Storage, projects: ScriptProject[]): void {
  storage.setItem(BITFEEDER_PROJECTS_STORAGE_KEY, JSON.stringify(projects));
}

function persistProjects(storage: Storage, projects: ScriptProject[]): void {
  try {
    writeProjects(storage, projects);
  } catch {
    // Ignore migration write failures and keep readable projects available.
  }
}

export function saveProject(project: ScriptProject): LibraryWriteResult {
  const storage = getStorage();

  if (!storage) {
    return 'failed';
  }

  try {
    if (isTopLevelLibraryWriteBlocked(storage)) {
      setLastLibraryLoadError(createMalformedLibraryLoadError());
      return 'blocked';
    }

    const projects = loadProjects();
    writeProjects(storage, upsertProject(projects, project));
    storage.removeItem(LEGACY_BITFEEDER_PROJECT_STORAGE_KEY);
    return 'success';
  } catch {
    // Ignore storage write failures and keep the app stable.
    return 'failed';
  }
}

export function parseImportedProjects(value: unknown): ScriptProject[] | null {
  if (Array.isArray(value)) {
    const migratedProjects = migrateScriptProjects(value);

    if (!migratedProjects) {
      setLastProjectCleanupSummary(null);
      return null;
    }

    setLastProjectCleanupSummary(
      createProjectCleanupSummary(
        'import',
        migratedProjects.skippedProjectCount,
        migratedProjects.filteredChunkCount,
      ),
    );
    return migratedProjects.projects;
  }

  const migratedProject = migrateScriptProject(value);

  if (!migratedProject) {
    setLastProjectCleanupSummary(null);
    return null;
  }

  setLastProjectCleanupSummary(
    createProjectCleanupSummary('import', 0, migratedProject.filteredChunkCount),
  );
  return [migratedProject.project];
}

export function saveImportedProjects(
  projectsToImport: ScriptProject[],
): LibraryWriteResult {
  const storage = getStorage();

  if (!storage || projectsToImport.length === 0) {
    return 'failed';
  }

  try {
    if (isTopLevelLibraryWriteBlocked(storage)) {
      setLastLibraryLoadError(createMalformedLibraryLoadError());
      return 'blocked';
    }

    const projects = projectsToImport.reduce(
      (nextProjects, project) => upsertProject(nextProjects, project),
      loadProjects(),
    );

    writeProjects(storage, projects);
    storage.removeItem(LEGACY_BITFEEDER_PROJECT_STORAGE_KEY);
    return 'success';
  } catch {
    // Ignore import write failures and keep the app stable.
    return 'failed';
  }
}

export function loadScriptFocusModeSettings(): ScriptFocusModeSettings {
  const storage = getStorage();

  if (!storage) {
    return DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS;
  }

  try {
    const rawSettings = storage.getItem(BITFEEDER_SCRIPT_FOCUS_SETTINGS_STORAGE_KEY);

    if (!rawSettings) {
      return DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS;
    }

    const parsedSettings: unknown = JSON.parse(rawSettings);
    return normalizeScriptFocusModeSettings(parsedSettings);
  } catch {
    return DEFAULT_SCRIPT_FOCUS_MODE_SETTINGS;
  }
}

export function saveScriptFocusModeSettings(
  settings: ScriptFocusModeSettings,
): void {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      BITFEEDER_SCRIPT_FOCUS_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeScriptFocusModeSettings(settings)),
    );
  } catch {
    // Ignore settings write failures and keep the app stable.
  }
}

export function loadProject(projectId: string): ScriptProject | null {
  return loadProjects().find((project) => project.id === projectId) ?? null;
}

export function loadProjects(): ScriptProject[] {
  const storage = getStorage();

  if (!storage) {
    setLastProjectCleanupSummary(null);
    setLastLibraryLoadError(null);
    return [];
  }

  try {
    const collection = readProjectCollection(storage);
    const isTopLevelLibraryUnreadable =
      collection.libraryLoadError?.code === 'malformed_library';
    const hasLegacyProject =
      storage.getItem(LEGACY_BITFEEDER_PROJECT_STORAGE_KEY) !== null;
    const legacyProject = readLegacyProject(storage);
    let projects = collection.projects;
    let filteredChunkCount = collection.filteredChunkCount;
    const skippedProjectCount = collection.skippedProjectCount;

    if (legacyProject) {
      projects = upsertProject(projects, legacyProject.project);
      filteredChunkCount += legacyProject.filteredChunkCount;
    }

    if (!isTopLevelLibraryUnreadable) {
      if (hasLegacyProject) {
        storage.removeItem(LEGACY_BITFEEDER_PROJECT_STORAGE_KEY);
      }

      if (collection.shouldPersist || hasLegacyProject) {
        persistProjects(storage, projects);
      }
    }

    setLastLibraryLoadError(collection.libraryLoadError);
    setLastProjectCleanupSummary(
      createProjectCleanupSummary(
        'load',
        skippedProjectCount,
        filteredChunkCount,
      ),
    );
    return projects;
  } catch {
    setLastProjectCleanupSummary(null);
    setLastLibraryLoadError(null);
    return [];
  }
}

export function deleteProject(projectId: string): LibraryWriteResult {
  const storage = getStorage();

  if (!storage) {
    return 'failed';
  }

  try {
    if (isTopLevelLibraryWriteBlocked(storage)) {
      setLastLibraryLoadError(createMalformedLibraryLoadError());
      return 'blocked';
    }

    const projects = loadProjects().filter(
      (project) => project.id !== projectId,
    );
    writeProjects(storage, projects);
    return 'success';
  } catch {
    // Ignore storage delete failures and keep the app stable.
    return 'failed';
  }
}

export function clearProjects(): void {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  try {
    storage.removeItem(BITFEEDER_PROJECTS_STORAGE_KEY);
    storage.removeItem(LEGACY_BITFEEDER_PROJECT_STORAGE_KEY);
  } catch {
    // Ignore storage clear failures and keep the app stable.
  }
}
