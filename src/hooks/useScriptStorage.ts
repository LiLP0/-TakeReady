import { useState } from 'react';

import type { ScriptFocusModeSettings, ScriptProject } from '../types/script';
import {
  clearProjects,
  deleteProject as deleteStoredProject,
  getLastProjectCleanupSummary,
  loadProject as loadStoredProject,
  loadProjects as loadStoredProjects,
  loadScriptFocusModeSettings as loadStoredScriptFocusModeSettings,
  type ProjectCleanupSummary,
  saveProject,
  saveScriptFocusModeSettings as saveStoredScriptFocusModeSettings,
} from '../utils/storage';

export type UseScriptStorageResult = {
  projects: ScriptProject[];
  project: ScriptProject | null;
  projectCleanupSummary: ProjectCleanupSummary | null;
  scriptFocusModeSettings: ScriptFocusModeSettings;
  loadProjects: () => ScriptProject[];
  loadProject: (projectId: string) => ScriptProject | null;
  loadScriptFocusModeSettings: () => ScriptFocusModeSettings;
  saveScriptFocusModeSettings: (settings: ScriptFocusModeSettings) => void;
  save: (project: ScriptProject) => void;
  load: () => ScriptProject | null;
  deleteProject: (projectId: string) => void;
  clear: () => void;
};

function getLatestProject(projects: ScriptProject[]): ScriptProject | null {
  if (projects.length === 0) {
    return null;
  }

  return [...projects].sort((firstProject, secondProject) =>
    secondProject.updatedAt.localeCompare(firstProject.updatedAt),
  )[0];
}

export function useScriptStorage(): UseScriptStorageResult {
  const [projects, setProjects] = useState<ScriptProject[]>(() =>
    loadStoredProjects(),
  );
  const [projectCleanupSummary, setProjectCleanupSummary] =
    useState<ProjectCleanupSummary | null>(() => getLastProjectCleanupSummary());
  const [scriptFocusModeSettings, setScriptFocusModeSettings] =
    useState<ScriptFocusModeSettings>(() => loadStoredScriptFocusModeSettings());
  const project = getLatestProject(projects);

  function refreshProjects(): ScriptProject[] {
    const storedProjects = loadStoredProjects();
    setProjects(storedProjects);
    setProjectCleanupSummary(getLastProjectCleanupSummary());
    return storedProjects;
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

  function save(projectToSave: ScriptProject): void {
    saveProject(projectToSave);
    refreshProjects();
  }

  function load(): ScriptProject | null {
    return getLatestProject(refreshProjects());
  }

  function deleteProject(projectId: string): void {
    deleteStoredProject(projectId);
    refreshProjects();
  }

  function clear(): void {
    clearProjects();
    setProjects([]);
    setProjectCleanupSummary(null);
  }

  return {
    projects,
    project,
    projectCleanupSummary,
    scriptFocusModeSettings,
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
