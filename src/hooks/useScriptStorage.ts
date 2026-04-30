import { useEffect, useState } from 'react';

import type {
  GoogleAppAuthState,
  GoogleAuthActionResult,
  GoogleSignedInUser,
} from '../types/auth';
import type {
  GoogleDriveActionResult,
  GoogleDriveConnectionState,
  GoogleDriveProjectFile,
} from '../types/googleDrive';
import type {
  ScriptFocusModeSettings,
  ScriptProject,
} from '../types/script';
import {
  downloadLexiCueDriveProjectFile,
  listLexiCueDriveProjectFiles,
  saveLexiCueProjectFile,
  unwrapLexiCueDriveProjectEnvelope,
} from '../utils/googleDrive';
import {
  clearGoogleAccountSession,
  requestGoogleDriveAccessToken,
  revokeGoogleDriveAccessToken,
  tryRestoreGoogleDriveAccessToken,
} from '../utils/googleIdentity';
import {
  clearGoogleSignedInUser as clearStoredGoogleSignedInUser,
  clearLastLibraryLoadError,
  clearLastProjectCleanupSummary,
  clearProjects,
  compareDateStringsDescending,
  consumeLastProjectCleanupSummary,
  deleteProject as deleteStoredProject,
  getLastLibraryLoadError,
  getLastProjectCleanupSummary,
  type LibraryLoadError,
  type LibraryWriteResult,
  loadGoogleSignedInUser as loadStoredGoogleSignedInUser,
  loadProject as loadStoredProject,
  loadProjects as loadStoredProjects,
  loadScriptFocusModeSettings as loadStoredScriptFocusModeSettings,
  parseImportedProjects,
  type ProjectCleanupSummary,
  saveGoogleSignedInUser as saveStoredGoogleSignedInUser,
  saveImportedProjects,
  saveProject as saveStoredProject,
  saveScriptFocusModeSettings as saveStoredScriptFocusModeSettings,
} from '../utils/storage';

export type UseScriptStorageResult = {
  googleAppAuthState: GoogleAppAuthState;
  googleDriveConnectionState: GoogleDriveConnectionState;
  googleDriveFiles: GoogleDriveProjectFile[];
  googleSignedInUser: GoogleSignedInUser | null;
  isGoogleCloudSyncEnabled: boolean;
  isLoadingGoogleDriveFiles: boolean;
  isLoadingProjectFromGoogleDrive: boolean;
  isSavingProjectToGoogleDrive: boolean;
  libraryLoadError: LibraryLoadError | null;
  isLibraryWriteBlocked: boolean;
  projectCleanupSummary: ProjectCleanupSummary | null;
  projects: ScriptProject[];
  project: ScriptProject | null;
  scriptFocusModeSettings: ScriptFocusModeSettings;
  connectGoogleDrive: () => Promise<
    GoogleDriveActionResult<GoogleDriveProjectFile[]>
  >;
  completeGoogleSignIn: (
    user: GoogleSignedInUser,
  ) => GoogleAuthActionResult<GoogleSignedInUser>;
  disconnectGoogleDrive: () => Promise<GoogleDriveActionResult>;
  clearProjectCleanupSummary: () => void;
  consumeProjectCleanupSummary: () => ProjectCleanupSummary | null;
  loadProjectFromGoogleDrive: (
    fileId: string,
  ) => Promise<GoogleDriveActionResult<ScriptProject>>;
  loadProjects: () => ScriptProject[];
  loadProject: (projectId: string) => ScriptProject | null;
  loadScriptFocusModeSettings: () => ScriptFocusModeSettings;
  refreshGoogleDriveFiles: () => Promise<
    GoogleDriveActionResult<GoogleDriveProjectFile[]>
  >;
  saveScriptFocusModeSettings: (settings: ScriptFocusModeSettings) => void;
  saveProjectToGoogleDrive: (
    projectId: string,
  ) => Promise<GoogleDriveActionResult<ScriptProject>>;
  save: (project: ScriptProject) => LibraryWriteResult;
  signOutGoogleAccount: () => Promise<GoogleAuthActionResult>;
  syncProjectToGoogleDrive: (
    projectId: string,
  ) => Promise<GoogleDriveActionResult<ScriptProject>>;
  load: () => ScriptProject | null;
  deleteProject: (projectId: string) => LibraryWriteResult;
  clear: () => void;
};

type DriveMergeSummary = {
  importedCloudCount: number;
  keptLocalCount: number;
  syncedLocalCount: number;
  syncErrorCount: number;
};

let sharedGoogleDriveConnectionState: GoogleDriveConnectionState =
  'disconnected';
let sharedGoogleDriveFiles: GoogleDriveProjectFile[] = [];
let sharedGoogleDriveAccessToken: string | null = null;
let sharedGoogleDriveTokenExpiresAt: number | null = null;
let sharedGoogleSignedInUser: GoogleSignedInUser | null | undefined;
let hasAttemptedGoogleDriveRestoreThisSession = false;
const sharedGoogleStateListeners = new Set<() => void>();

function notifySharedGoogleStateListeners(): void {
  sharedGoogleStateListeners.forEach((listener) => listener());
}

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

function sortGoogleDriveFiles(
  files: GoogleDriveProjectFile[],
): GoogleDriveProjectFile[] {
  return [...files].sort((firstFile, secondFile) => {
    const dateComparison = compareDateStringsDescending(
      firstFile.modifiedTime,
      secondFile.modifiedTime,
    );

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return firstFile.name.localeCompare(secondFile.name, undefined, {
      sensitivity: 'base',
    });
  });
}

function upsertGoogleDriveFile(
  files: GoogleDriveProjectFile[],
  nextFile: GoogleDriveProjectFile,
): GoogleDriveProjectFile[] {
  const existingFileIndex = files.findIndex((file) => file.id === nextFile.id);

  if (existingFileIndex === -1) {
    return sortGoogleDriveFiles([...files, nextFile]);
  }

  return sortGoogleDriveFiles(
    files.map((file, index) => (index === existingFileIndex ? nextFile : file)),
  );
}

function getInitialGoogleSignedInUser(): GoogleSignedInUser | null {
  if (typeof sharedGoogleSignedInUser === 'undefined') {
    sharedGoogleSignedInUser = loadStoredGoogleSignedInUser();
  }

  return sharedGoogleSignedInUser ?? null;
}

function createSyncedProject(
  project: ScriptProject,
  googleDriveFileId: string,
): ScriptProject {
  return {
    ...project,
    googleDriveFileId,
    cloudSyncState: 'synced',
  };
}

function formatCount(
  count: number,
  singularLabel: string,
  pluralLabel: string,
): string {
  return `${count} ${count === 1 ? singularLabel : pluralLabel}`;
}

function formatDriveMergeMessage(
  driveFileCount: number,
  summary: DriveMergeSummary,
  isLibraryWriteBlocked: boolean,
): string {
  if (driveFileCount === 0) {
    return 'Connected to Google Drive. No LexiCue project files found yet.';
  }

  if (isLibraryWriteBlocked) {
    return `Connected to Google Drive. Found ${formatCount(
      driveFileCount,
      'cloud project file',
      'cloud project files',
    )}, but local library protection prevented them from merging.`;
  }

  const detailParts: string[] = [];

  if (summary.importedCloudCount > 0) {
    detailParts.push(
      `${formatCount(summary.importedCloudCount, 'cloud project was', 'cloud projects were')} added or updated locally`,
    );
  }

  if (summary.syncedLocalCount > 0) {
    detailParts.push(
      `${formatCount(summary.syncedLocalCount, 'local project was', 'local projects were')} synced back to Google Drive`,
    );
  }

  if (summary.syncErrorCount > 0) {
    detailParts.push(
      `${formatCount(summary.syncErrorCount, 'local project hit', 'local projects hit')} a cloud sync issue`,
    );
  }

  if (detailParts.length === 0) {
    return `Connected to Google Drive. Found ${formatCount(
      driveFileCount,
      'LexiCue cloud project',
      'LexiCue cloud projects',
    )} and kept the current local library up to date.`;
  }

  return `Connected to Google Drive. ${detailParts.join(', ')}.`;
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
  const [googleDriveConnectionState, setGoogleDriveConnectionState] =
    useState<GoogleDriveConnectionState>(() => sharedGoogleDriveConnectionState);
  const [googleSignedInUser, setGoogleSignedInUser] =
    useState<GoogleSignedInUser | null>(() => getInitialGoogleSignedInUser());
  const [googleDriveFiles, setGoogleDriveFiles] = useState<
    GoogleDriveProjectFile[]
  >(() => sharedGoogleDriveFiles);
  const [, setGoogleDriveAccessToken] = useState<string | null>(
    () => sharedGoogleDriveAccessToken,
  );
  const [, setGoogleDriveTokenExpiresAt] = useState<number | null>(
    () => sharedGoogleDriveTokenExpiresAt,
  );
  const [isLoadingGoogleDriveFiles, setIsLoadingGoogleDriveFiles] =
    useState(false);
  const [isSavingProjectToGoogleDrive, setIsSavingProjectToGoogleDrive] =
    useState(false);
  const [isLoadingProjectFromGoogleDrive, setIsLoadingProjectFromGoogleDrive] =
    useState(false);
  const project = getLatestProject(projects);
  const isLibraryWriteBlocked = libraryLoadError?.code === 'malformed_library';
  const googleAppAuthState: GoogleAppAuthState = googleSignedInUser
    ? googleDriveConnectionState === 'connected'
      ? 'signed_in_drive_connected'
      : 'signed_in'
    : 'signed_out';
  const isGoogleCloudSyncEnabled =
    googleAppAuthState === 'signed_in_drive_connected';

  function setSharedGoogleSignedInUser(
    nextGoogleSignedInUser: GoogleSignedInUser | null,
  ): void {
    sharedGoogleSignedInUser = nextGoogleSignedInUser;
    setGoogleSignedInUser(nextGoogleSignedInUser);
    notifySharedGoogleStateListeners();
  }

  function setSharedGoogleDriveConnectionState(
    nextConnectionState: GoogleDriveConnectionState,
  ): void {
    sharedGoogleDriveConnectionState = nextConnectionState;
    setGoogleDriveConnectionState(nextConnectionState);
    notifySharedGoogleStateListeners();
  }

  function setSharedGoogleDriveFiles(
    nextFiles: GoogleDriveProjectFile[],
  ): void {
    const sortedFiles = sortGoogleDriveFiles(nextFiles);
    sharedGoogleDriveFiles = sortedFiles;
    setGoogleDriveFiles(sortedFiles);
    notifySharedGoogleStateListeners();
  }

  function updateSharedGoogleDriveFiles(
    getNextFiles: (
      currentFiles: GoogleDriveProjectFile[],
    ) => GoogleDriveProjectFile[],
  ): void {
    setSharedGoogleDriveFiles(getNextFiles(sharedGoogleDriveFiles));
  }

  function setSharedGoogleDriveAccessToken(
    nextAccessToken: string | null,
  ): void {
    sharedGoogleDriveAccessToken = nextAccessToken;
    setGoogleDriveAccessToken(nextAccessToken);
    notifySharedGoogleStateListeners();
  }

  function setSharedGoogleDriveTokenExpiresAt(
    nextTokenExpiresAt: number | null,
  ): void {
    sharedGoogleDriveTokenExpiresAt = nextTokenExpiresAt;
    setGoogleDriveTokenExpiresAt(nextTokenExpiresAt);
    notifySharedGoogleStateListeners();
  }

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

  function clearGoogleDriveSession(): void {
    setSharedGoogleDriveConnectionState('disconnected');
    setSharedGoogleDriveFiles([]);
    setSharedGoogleDriveAccessToken(null);
    setSharedGoogleDriveTokenExpiresAt(null);
  }

  function completeGoogleSignIn(
    user: GoogleSignedInUser,
  ): GoogleAuthActionResult<GoogleSignedInUser> {
    saveStoredGoogleSignedInUser(user);
    setSharedGoogleSignedInUser(user);

    return {
      data: user,
      message: `Signed in as ${user.displayName}.`,
      status: 'success',
    };
  }

  async function requestPreferredGoogleDriveAccessToken(): Promise<{
    accessToken: string;
    expiresAt: number;
    scope: string;
  }> {
    const shouldTrySilentPrompt =
      Boolean(googleSignedInUser) || Boolean(sharedGoogleSignedInUser);
    const preferredPrompt: '' | 'consent' = shouldTrySilentPrompt
      ? ''
      : 'consent';

    try {
      return await requestGoogleDriveAccessToken(preferredPrompt);
    } catch (error) {
      if (preferredPrompt === 'consent') {
        throw error;
      }

      return requestGoogleDriveAccessToken('consent');
    }
  }

  async function connectGoogleDriveInternal(
    shouldAllowConsentFallback: boolean,
  ): Promise<GoogleDriveActionResult<GoogleDriveProjectFile[]>> {
    hasAttemptedGoogleDriveRestoreThisSession = true;
    setSharedGoogleDriveConnectionState('connecting');
    setIsLoadingGoogleDriveFiles(true);

    try {
      const token = shouldAllowConsentFallback
        ? await requestPreferredGoogleDriveAccessToken()
        : await tryRestoreGoogleDriveAccessToken();

      if (!token) {
        throw new Error('Cloud sync could not be restored for this session.');
      }

      const driveFiles = sortGoogleDriveFiles(
        await listLexiCueDriveProjectFiles(token.accessToken),
      );
      const mergeSummary = await mergeGoogleDriveProjectsIntoLocalLibrary(
        token.accessToken,
        driveFiles,
      );

      setSharedGoogleDriveAccessToken(token.accessToken);
      setSharedGoogleDriveTokenExpiresAt(token.expiresAt);
      setSharedGoogleDriveFiles(driveFiles);
      setSharedGoogleDriveConnectionState('connected');

      return {
        data: driveFiles,
        message: formatDriveMergeMessage(
          driveFiles.length,
          mergeSummary,
          isLibraryWriteBlocked,
        ),
        status: 'success',
      };
    } catch (error) {
      clearGoogleDriveSession();
      return {
        message:
          error instanceof Error
            ? error.message
            : 'Google Drive could not be connected right now.',
        status: 'error',
      };
    } finally {
      setIsLoadingGoogleDriveFiles(false);
    }
  }

  async function getFreshGoogleDriveAccessToken(): Promise<string> {
    if (!sharedGoogleDriveAccessToken) {
      throw new Error('Connect Google Drive first.');
    }

    if (
      sharedGoogleDriveTokenExpiresAt &&
      Date.now() < sharedGoogleDriveTokenExpiresAt - 15_000
    ) {
      return sharedGoogleDriveAccessToken;
    }

    const nextToken = await requestGoogleDriveAccessToken('');

    setSharedGoogleDriveAccessToken(nextToken.accessToken);
    setSharedGoogleDriveTokenExpiresAt(nextToken.expiresAt);
    setSharedGoogleDriveConnectionState('connected');
    return nextToken.accessToken;
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
    const didSave = saveStoredProject(projectToSave);
    refreshProjects();
    return didSave;
  }

  async function syncProjectToGoogleDrive(
    projectId: string,
  ): Promise<GoogleDriveActionResult<ScriptProject>> {
    const projectToSync =
      loadStoredProject(projectId) ??
      projects.find((storedProject) => storedProject.id === projectId) ??
      null;

    if (!projectToSync) {
      return {
        message: 'Choose a saved script before syncing it to Google Drive.',
        status: 'error',
      };
    }

    if (!sharedGoogleDriveAccessToken) {
      return {
        message: 'Enable cloud sync before syncing this project to Google Drive.',
        status: 'error',
      };
    }

    const syncingProject =
      projectToSync.cloudSyncState === 'syncing'
        ? projectToSync
        : {
            ...projectToSync,
            cloudSyncState: 'syncing' as const,
          };

    if (syncingProject !== projectToSync) {
      const didMarkSyncing = saveStoredProject(syncingProject);

      if (didMarkSyncing === 'success') {
        refreshProjects();
      }
    }

    setIsSavingProjectToGoogleDrive(true);

    try {
      const accessToken = await getFreshGoogleDriveAccessToken();
      const matchedDriveFileId =
        syncingProject.googleDriveFileId ??
        sharedGoogleDriveFiles.find((file) => file.projectId === syncingProject.id)
          ?.id ??
        null;
      const driveFile = await saveLexiCueProjectFile(
        accessToken,
        syncingProject,
        matchedDriveFileId,
      );

      updateSharedGoogleDriveFiles((currentFiles) =>
        upsertGoogleDriveFile(currentFiles, driveFile),
      );

      const syncedProject = createSyncedProject(syncingProject, driveFile.id);
      const didPersistSyncedProject = saveStoredProject(syncedProject);

      if (didPersistSyncedProject === 'success') {
        refreshProjects();
      }

      return {
        data: syncedProject,
        message: `Synced "${syncedProject.title.trim() || 'Untitled script'}" to Google Drive.`,
        status: 'success',
      };
    } catch (error) {
      const latestProject = loadStoredProject(projectId) ?? projectToSync;
      const syncErrorProject: ScriptProject = {
        ...latestProject,
        cloudSyncState: 'sync_error',
      };

      if (!isLibraryWriteBlocked) {
        const didPersistErrorProject = saveStoredProject(syncErrorProject);

        if (didPersistErrorProject === 'success') {
          refreshProjects();
        }
      }

      return {
        data: syncErrorProject,
        message:
          error instanceof Error
            ? error.message
            : 'Google Drive sync failed, but your local save is still safe.',
        status: 'error',
      };
    } finally {
      setIsSavingProjectToGoogleDrive(false);
    }
  }

  async function mergeGoogleDriveProjectsIntoLocalLibrary(
    accessToken: string,
    driveFiles: GoogleDriveProjectFile[],
  ): Promise<DriveMergeSummary> {
    if (isLibraryWriteBlocked || driveFiles.length === 0) {
      clearLastProjectCleanupSummary();
      setProjectCleanupSummary(null);

      return {
        importedCloudCount: 0,
        keptLocalCount: 0,
        syncedLocalCount: 0,
        syncErrorCount: 0,
      };
    }

    const currentProjects = refreshProjects();
    const currentProjectsById = new Map(
      currentProjects.map((storedProject) => [storedProject.id, storedProject]),
    );
    const projectsToPersist = new Map<string, ScriptProject>();
    const projectIdsToSync = new Set<string>();
    let importedCloudCount = 0;
    let keptLocalCount = 0;

    for (const driveFile of driveFiles) {
      try {
        const downloadedValue = await downloadLexiCueDriveProjectFile(
          accessToken,
          driveFile.id,
        );
        const importedProjects = parseImportedProjects(
          unwrapLexiCueDriveProjectEnvelope(downloadedValue),
        );

        if (!importedProjects || importedProjects.length === 0) {
          continue;
        }

        for (const importedProject of importedProjects) {
          const cloudProject = createSyncedProject(
            {
              ...importedProject,
              googleDriveFileId:
                importedProject.googleDriveFileId ?? driveFile.id,
            },
            driveFile.id,
          );
          const currentProject =
            projectsToPersist.get(cloudProject.id) ??
            currentProjectsById.get(cloudProject.id) ??
            null;

          if (!currentProject) {
            projectsToPersist.set(cloudProject.id, cloudProject);
            currentProjectsById.set(cloudProject.id, cloudProject);
            importedCloudCount += 1;
            continue;
          }

          const recencyComparison = compareDateStringsDescending(
            currentProject.updatedAt,
            cloudProject.updatedAt,
          );

          if (recencyComparison > 0) {
            projectsToPersist.set(cloudProject.id, cloudProject);
            currentProjectsById.set(cloudProject.id, cloudProject);
            projectIdsToSync.delete(cloudProject.id);
            importedCloudCount += 1;
            continue;
          }

          if (recencyComparison < 0) {
            const nextLocalProject: ScriptProject = {
              ...currentProject,
              googleDriveFileId: driveFile.id,
              cloudSyncState: 'syncing',
            };

            projectsToPersist.set(nextLocalProject.id, nextLocalProject);
            currentProjectsById.set(nextLocalProject.id, nextLocalProject);
            projectIdsToSync.add(nextLocalProject.id);
            keptLocalCount += 1;
            continue;
          }

          if (
            currentProject.googleDriveFileId !== driveFile.id ||
            currentProject.cloudSyncState !== 'synced'
          ) {
            const nextLocalProject = createSyncedProject(
              currentProject,
              driveFile.id,
            );

            projectsToPersist.set(nextLocalProject.id, nextLocalProject);
            currentProjectsById.set(nextLocalProject.id, nextLocalProject);
          }
        }
      } catch {
        // Skip unreadable Drive files and keep local data safe.
      }
    }

    if (projectsToPersist.size > 0) {
      const didPersistProjects = saveImportedProjects(
        Array.from(projectsToPersist.values()),
      );

      if (didPersistProjects === 'success') {
        refreshProjects();
      }
    }

    clearLastProjectCleanupSummary();
    setProjectCleanupSummary(null);

    let syncedLocalCount = 0;
    let syncErrorCount = 0;

    for (const projectId of projectIdsToSync) {
      const syncResult = await syncProjectToGoogleDrive(projectId);

      if (syncResult.status === 'success') {
        syncedLocalCount += 1;
      } else {
        syncErrorCount += 1;
      }
    }

    return {
      importedCloudCount,
      keptLocalCount,
      syncedLocalCount,
      syncErrorCount,
    };
  }

  async function connectGoogleDrive(): Promise<
    GoogleDriveActionResult<GoogleDriveProjectFile[]>
  > {
    return connectGoogleDriveInternal(true);
  }

  async function disconnectGoogleDrive(): Promise<GoogleDriveActionResult> {
    hasAttemptedGoogleDriveRestoreThisSession = true;
    const accessToken = sharedGoogleDriveAccessToken;

    clearGoogleDriveSession();

    if (!accessToken) {
      return {
        message: 'Cloud sync is disconnected.',
        status: 'success',
      };
    }

    try {
      await revokeGoogleDriveAccessToken(accessToken);
    } catch {
      // Keep the app usable even if revoke fails remotely.
    }

    return {
      message: 'Cloud sync is disconnected.',
      status: 'success',
    };
  }

  async function signOutGoogleAccount(): Promise<GoogleAuthActionResult> {
    hasAttemptedGoogleDriveRestoreThisSession = true;

    try {
      await clearGoogleAccountSession();
    } catch {
      // Keep the app usable even if GIS could not be reached again.
    }

    clearGoogleDriveSession();
    clearStoredGoogleSignedInUser();
    setSharedGoogleSignedInUser(null);

    return {
      message: 'Signed out of your Google account in this browser session.',
      status: 'success',
    };
  }

  async function refreshGoogleDriveFiles(): Promise<
    GoogleDriveActionResult<GoogleDriveProjectFile[]>
  > {
    if (!sharedGoogleDriveAccessToken) {
      return {
        message: 'Enable cloud sync first.',
        status: 'error',
      };
    }

    setIsLoadingGoogleDriveFiles(true);

    try {
      const accessToken = await getFreshGoogleDriveAccessToken();
      const driveFiles = sortGoogleDriveFiles(
        await listLexiCueDriveProjectFiles(accessToken),
      );
      const mergeSummary = await mergeGoogleDriveProjectsIntoLocalLibrary(
        accessToken,
        driveFiles,
      );

      setSharedGoogleDriveFiles(driveFiles);

      return {
        data: driveFiles,
        message: formatDriveMergeMessage(
          driveFiles.length,
          mergeSummary,
          isLibraryWriteBlocked,
        ),
        status: 'success',
      };
    } catch (error) {
      return {
        message:
          error instanceof Error
            ? error.message
            : 'Cloud sync could not be refreshed right now.',
        status: 'error',
      };
    } finally {
      setIsLoadingGoogleDriveFiles(false);
    }
  }

  async function saveProjectToGoogleDrive(
    projectId: string,
  ): Promise<GoogleDriveActionResult<ScriptProject>> {
    return syncProjectToGoogleDrive(projectId);
  }

  async function loadProjectFromGoogleDrive(
    fileId: string,
  ): Promise<GoogleDriveActionResult<ScriptProject>> {
    if (isLibraryWriteBlocked) {
      return {
        message:
          'Loading from Google Drive is temporarily blocked while unreadable local library data is protected.',
        status: 'blocked',
      };
    }

    if (!sharedGoogleDriveAccessToken) {
      return {
        message: 'Enable cloud sync before loading a script from Google Drive.',
        status: 'error',
      };
    }

    setIsLoadingProjectFromGoogleDrive(true);

    try {
      const accessToken = await getFreshGoogleDriveAccessToken();
      const driveFile =
        sharedGoogleDriveFiles.find((file) => file.id === fileId) ?? null;
      const downloadedValue = await downloadLexiCueDriveProjectFile(
        accessToken,
        fileId,
      );
      const importedProjects = parseImportedProjects(
        unwrapLexiCueDriveProjectEnvelope(downloadedValue),
      );

      if (!importedProjects || importedProjects.length === 0) {
        return {
          message: 'That Google Drive file did not contain a usable LexiCue project.',
          status: 'error',
        };
      }

      const projectsToSave = importedProjects.map((importedProject) =>
        createSyncedProject(
          {
            ...importedProject,
            googleDriveFileId:
              importedProject.googleDriveFileId ?? driveFile?.id ?? fileId,
          },
          driveFile?.id ?? fileId,
        ),
      );
      const didSaveImportedProjects = saveImportedProjects(projectsToSave);

      if (didSaveImportedProjects === 'blocked') {
        return {
          message:
            'Loading from Google Drive is temporarily blocked while unreadable local library data is protected.',
          status: 'blocked',
        };
      }

      if (didSaveImportedProjects !== 'success') {
        return {
          message: 'That Google Drive project could not be saved into the local library.',
          status: 'error',
        };
      }

      refreshProjects();
      clearLastProjectCleanupSummary();
      setProjectCleanupSummary(null);

      if (projectsToSave.length === 1) {
        return {
          data: projectsToSave[0],
          message: `Loaded "${projectsToSave[0].title.trim() || driveFile?.name || 'Untitled script'}" from Google Drive into the local library.`,
          status: 'success',
        };
      }

      return {
        data: projectsToSave[0],
        message: `Loaded ${projectsToSave.length} scripts from Google Drive into the local library.`,
        status: 'success',
      };
    } catch (error) {
      return {
        message:
          error instanceof Error
            ? error.message
            : 'Google Drive project data could not be loaded.',
        status: 'error',
      };
    } finally {
      setIsLoadingProjectFromGoogleDrive(false);
    }
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
    hasAttemptedGoogleDriveRestoreThisSession = true;
    clearProjects();
    setProjects([]);
    clearLastLibraryLoadError();
    setLibraryLoadError(null);
    clearProjectCleanupSummary();
    clearGoogleDriveSession();
    clearStoredGoogleSignedInUser();
    setSharedGoogleSignedInUser(null);
  }

  useEffect(() => {
    function handleSharedGoogleStateChange(): void {
      setGoogleSignedInUser(sharedGoogleSignedInUser ?? null);
      setGoogleDriveConnectionState(sharedGoogleDriveConnectionState);
      setGoogleDriveFiles(sharedGoogleDriveFiles);
      setGoogleDriveAccessToken(sharedGoogleDriveAccessToken);
      setGoogleDriveTokenExpiresAt(sharedGoogleDriveTokenExpiresAt);
    }

    sharedGoogleStateListeners.add(handleSharedGoogleStateChange);

    return () => {
      sharedGoogleStateListeners.delete(handleSharedGoogleStateChange);
    };
  }, []);

  useEffect(() => {
    if (
      !googleSignedInUser ||
      hasAttemptedGoogleDriveRestoreThisSession ||
      sharedGoogleDriveConnectionState !== 'disconnected' ||
      sharedGoogleDriveAccessToken
    ) {
      return;
    }

    void connectGoogleDriveInternal(false);
  }, [googleSignedInUser]);

  return {
    googleAppAuthState,
    googleDriveConnectionState,
    googleDriveFiles,
    googleSignedInUser,
    isGoogleCloudSyncEnabled,
    isLoadingGoogleDriveFiles,
    isLoadingProjectFromGoogleDrive,
    isSavingProjectToGoogleDrive,
    libraryLoadError,
    isLibraryWriteBlocked,
    projectCleanupSummary,
    projects,
    project,
    scriptFocusModeSettings,
    connectGoogleDrive,
    completeGoogleSignIn,
    disconnectGoogleDrive,
    clearProjectCleanupSummary,
    consumeProjectCleanupSummary,
    loadProjectFromGoogleDrive,
    loadProjects,
    loadProject,
    loadScriptFocusModeSettings,
    refreshGoogleDriveFiles,
    saveScriptFocusModeSettings,
    saveProjectToGoogleDrive,
    save,
    signOutGoogleAccount,
    syncProjectToGoogleDrive,
    load,
    deleteProject,
    clear,
  };
}
