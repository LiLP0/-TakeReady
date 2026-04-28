import { useState } from 'react';

import type { ScriptFocusModeSettings, ScriptProject } from '../types/script';
import {
  compareDateStringsDescending,
  clearLastLibraryLoadError,
  clearLastProjectCleanupSummary,
  clearProjects,
  consumeLastProjectCleanupSummary,
  deleteProject as deleteStoredProject,
  getLastLibraryLoadError,
  getLastProjectCleanupSummary,
  type LibraryLoadError,
  type LibraryWriteResult,
  loadProject as loadStoredProject,
  loadProjects as loadStoredProjects,
  loadScriptFocusModeSettings as loadStoredScriptFocusModeSettings,
  type ProjectCleanupSummary,
  saveProject,
  saveScriptFocusModeSettings as saveStoredScriptFocusModeSettings,
} from '../utils/storage';

export type UseScriptStorageResult = {
  libraryLoadError: LibraryLoadError | null;
  isLibraryWriteBlocked: boolean;
  projectCleanupSummary: ProjectCleanupSummary | null;
  projects: ScriptProject[];
  project: ScriptProject | null;
  scriptFocusModeSettings: ScriptFocusModeSettings;
  clearProjectCleanupSummary: () => void;
  consumeProjectCleanupSummary: () => ProjectCleanupSummary | null;
  loadProjects: () => ScriptProject[];
  loadProject: (projectId: string) => ScriptProject | null;
  loadScriptFocusModeSettings: () => ScriptFocusModeSettings;
  saveScriptFocusModeSettings: (settings: ScriptFocusModeSettings) => void;
  save: (project: ScriptProject) => LibraryWriteResult;
  load: () => ScriptProject | null;
  deleteProject: (projectId: string) => LibraryWriteResult;
  clear: () => void;
};

function getLatestProject(projects: ScriptProject[]): ScriptProject | null {
  if (projects.length === 0) {
    return null;
  }

  return [...projects].sort((firstProject, secondProject) =>
    compareDateStringsDescending(
      firstProject.updatedAt,
      secondProject.updatedAt,
    ),
  )[0];
}

export function useScriptStorage(): UseScriptStorageResult {
  const [projects, setProjects] = useState<ScriptProject[]>(() =>
    loadStoredProjects(),
  );
  const [libraryLoadError, setLibraryLoadError] =
    useState<LibraryLoadError | null>(() => getLastLibraryLoadError());
  const [projectCleanupSummary, setProjectCleanupSummary] =
    useState<ProjectCleanupSummary | null>(() => getLastProjectCleanupSummary());
  const [scriptFocusModeSettings, setScriptFocusModeSettings] =
    useState<ScriptFocusModeSettings>(() => loadStoredScriptFocusModeSettings());
  const project = getLatestProject(projects);
  const isLibraryWriteBlocked = libraryLoadError?.code === 'malformed_library';

  function refreshProjects(): ScriptProject[] {
    const storedProjects = loadStoredProjects();
    setProjects(storedProjects);
    setLibraryLoadError(getLastLibraryLoadError());
    setProjectCleanupSummary(getLastProjectCleanupSummary());
    return storedProjects;
  }

  function clearProjectCleanupSummary(): void {
    clearLastProjectCleanupSummary();
    setProjectCleanupSummary(null);
  }

  function consumeProjectCleanupSummary(): ProjectCleanupSummary | null {
    const summary = consumeLastProjectCleanupSummary();
    setProjectCleanupSummary(null);
    return summary;
  }

  function loadProjects(): ScriptProject[] {
    return refreshProjects();
  }

  function loadProject(projectId: string): ScriptProject | null {
    const storedProject = loadStoredProject(projectId);
    refreshProjects();
    return storedProject;
  }

  function loadScriptFocusModeSettings(): ScriptFocusModeSettings {
    const storedSettings = loadStoredScriptFocusModeSettings();
    setScriptFocusModeSettings(storedSettings);
    return storedSettings;
  }

  function saveScriptFocusModeSettings(
    settings: ScriptFocusModeSettings,
  ): void {
    saveStoredScriptFocusModeSettings(settings);
    setScriptFocusModeSettings(loadStoredScriptFocusModeSettings());
  }

  function save(projectToSave: ScriptProject): LibraryWriteResult {
    const didSave = saveProject(projectToSave);
    refreshProjects();
    return didSave;
  }

  function load(): ScriptProject | null {
    return getLatestProject(refreshProjects());
  }

  function deleteProject(projectId: string): LibraryWriteResult {
    const didDelete = deleteStoredProject(projectId);
    refreshProjects();
    return didDelete;
  }

  function clear(): void {
    clearProjects();
    setProjects([]);
    clearLastLibraryLoadError();
    setLibraryLoadError(null);
    clearProjectCleanupSummary();
  }

  return {
    libraryLoadError,
    isLibraryWriteBlocked,
    projectCleanupSummary,
    projects,
    project,
    scriptFocusModeSettings,
    clearProjectCleanupSummary,
    consumeProjectCleanupSummary,
    loadProjects,
    loadProject,
    loadScriptFocusModeSettings,
    saveScriptFocusModeSettings,
    save,
    load,
    deleteProject,
    clear,
  };
}
