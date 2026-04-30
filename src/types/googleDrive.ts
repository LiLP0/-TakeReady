import type { ScriptProject } from './script';

export type GoogleDriveConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected';

export type GoogleDriveProjectFile = {
  id: string;
  modifiedTime: string;
  name: string;
  projectId?: string;
};

export type GoogleDriveActionResult<T = undefined> = {
  data?: T;
  message: string;
  status: 'blocked' | 'error' | 'success';
};

export type LexiCueDriveProjectEnvelope = {
  lexiCue: {
    app: 'LexiCue';
    kind: 'project';
    projectId: ScriptProject['id'];
    savedAt: string;
    version: 1;
  };
  project: ScriptProject;
};
