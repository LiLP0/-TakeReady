import type { ScriptProject } from '../types/script';
import type {
  GoogleDriveProjectFile,
  LexiCueDriveProjectEnvelope,
} from '../types/googleDrive';

const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API_BASE_URL =
  'https://www.googleapis.com/upload/drive/v3/files';
const LEXICUE_DRIVE_FILE_TYPE = 'project';
const LEXICUE_DRIVE_FILE_FIELDS =
  'id,name,modifiedTime,appProperties';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getDriveErrorMessage(
  fallbackMessage: string,
  responseBody: unknown,
): string {
  if (
    isRecord(responseBody) &&
    isRecord(responseBody.error) &&
    typeof responseBody.error.message === 'string'
  ) {
    return responseBody.error.message;
  }

  return fallbackMessage;
}

async function parseDriveResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const responseText = await response.text();
  const responseBody = responseText ? (JSON.parse(responseText) as unknown) : null;

  if (!response.ok) {
    throw new Error(getDriveErrorMessage(fallbackMessage, responseBody));
  }

  return responseBody as T;
}

function createDriveAuthHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

function getSafeFilenamePart(title: string): string {
  const filenamePart = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');

  return filenamePart || 'untitled-script';
}

function toGoogleDriveProjectFile(value: unknown): GoogleDriveProjectFile | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.modifiedTime !== 'string'
  ) {
    return null;
  }

  const appProperties = isRecord(value.appProperties)
    ? value.appProperties
    : null;

  return {
    id: value.id,
    modifiedTime: value.modifiedTime,
    name: value.name,
    projectId:
      appProperties && typeof appProperties.lexicueProjectId === 'string'
        ? appProperties.lexicueProjectId
        : undefined,
  };
}

function createLexiCueAppProperties(projectId: ScriptProject['id']): Record<string, string> {
  return {
    lexicueApp: 'LexiCue',
    lexicueProjectId: projectId,
    lexicueType: LEXICUE_DRIVE_FILE_TYPE,
  };
}

function createMultipartBody(
  metadata: Record<string, unknown>,
  data: unknown,
): { body: string; contentType: string } {
  const boundary = `lexicue-drive-${crypto.randomUUID()}`;
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    `${JSON.stringify(data, null, 2)}\r\n` +
    `--${boundary}--`;

  return {
    body,
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

export function createLexiCueDriveFileName(title: string): string {
  return `lexicue-project-${getSafeFilenamePart(title)}.json`;
}

export function createLexiCueDriveProjectEnvelope(
  project: ScriptProject,
): LexiCueDriveProjectEnvelope {
  return {
    lexiCue: {
      app: 'LexiCue',
      kind: 'project',
      projectId: project.id,
      savedAt: new Date().toISOString(),
      version: 1,
    },
    project: {
      ...project,
      cloudSyncState: 'synced',
    },
  };
}

export function unwrapLexiCueDriveProjectEnvelope(value: unknown): unknown {
  if (
    isRecord(value) &&
    isRecord(value.lexiCue) &&
    value.lexiCue.app === 'LexiCue' &&
    'project' in value
  ) {
    return value.project;
  }

  return value;
}

export async function listLexiCueDriveProjectFiles(
  accessToken: string,
): Promise<GoogleDriveProjectFile[]> {
  const files: GoogleDriveProjectFile[] = [];
  let nextPageToken: string | null = null;

  do {
    const searchParams = new URLSearchParams({
      fields: `files(${LEXICUE_DRIVE_FILE_FIELDS}),nextPageToken`,
      orderBy: 'modifiedTime desc',
      pageSize: '100',
      q:
        "trashed = false and mimeType = 'application/json' and appProperties has { key='lexicueType' and value='project' }",
      spaces: 'drive',
      supportsAllDrives: 'true',
    });

    if (nextPageToken) {
      searchParams.set('pageToken', nextPageToken);
    }

    const response = await fetch(`${DRIVE_API_BASE_URL}?${searchParams.toString()}`, {
      headers: createDriveAuthHeaders(accessToken),
    });
    const body = await parseDriveResponse<{
      files?: unknown[];
      nextPageToken?: string;
    }>(response, 'Google Drive files could not be listed.');

    files.push(
      ...(body.files ?? [])
        .map((file) => toGoogleDriveProjectFile(file))
        .filter((file): file is GoogleDriveProjectFile => Boolean(file)),
    );
    nextPageToken = body.nextPageToken ?? null;
  } while (nextPageToken);

  return files;
}

async function uploadLexiCueDriveProjectFile(
  accessToken: string,
  method: 'PATCH' | 'POST',
  project: ScriptProject,
  fileId?: string,
): Promise<GoogleDriveProjectFile> {
  const metadata = {
    appProperties: createLexiCueAppProperties(project.id),
    mimeType: 'application/json',
    name: createLexiCueDriveFileName(project.title),
  };
  const { body, contentType } = createMultipartBody(
    metadata,
    createLexiCueDriveProjectEnvelope(project),
  );
  const endpoint =
    method === 'PATCH' && fileId
      ? `${DRIVE_UPLOAD_API_BASE_URL}/${fileId}?uploadType=multipart&fields=${encodeURIComponent(
          LEXICUE_DRIVE_FILE_FIELDS,
        )}&supportsAllDrives=true`
      : `${DRIVE_UPLOAD_API_BASE_URL}?uploadType=multipart&fields=${encodeURIComponent(
          LEXICUE_DRIVE_FILE_FIELDS,
        )}&supportsAllDrives=true`;
  const response = await fetch(endpoint, {
    body,
    headers: {
      ...createDriveAuthHeaders(accessToken),
      'Content-Type': contentType,
    },
    method,
  });
  const driveFile = toGoogleDriveProjectFile(
    await parseDriveResponse<unknown>(
      response,
      'Google Drive project file could not be saved.',
    ),
  );

  if (!driveFile) {
    throw new Error('Google Drive did not return usable file metadata.');
  }

  return driveFile;
}

export async function saveLexiCueProjectFile(
  accessToken: string,
  project: ScriptProject,
  existingFileId?: string | null,
): Promise<GoogleDriveProjectFile> {
  if (existingFileId) {
    try {
      return await uploadLexiCueDriveProjectFile(
        accessToken,
        'PATCH',
        project,
        existingFileId,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('File not found') ||
          error.message.includes('not found'))
      ) {
        return uploadLexiCueDriveProjectFile(accessToken, 'POST', project);
      }

      throw error;
    }
  }

  return uploadLexiCueDriveProjectFile(accessToken, 'POST', project);
}

export async function downloadLexiCueDriveProjectFile(
  accessToken: string,
  fileId: string,
): Promise<unknown> {
  const response = await fetch(
    `${DRIVE_API_BASE_URL}/${fileId}?alt=media&supportsAllDrives=true`,
    {
      headers: createDriveAuthHeaders(accessToken),
    },
  );

  return parseDriveResponse<unknown>(
    response,
    'Google Drive project file could not be loaded.',
  );
}
