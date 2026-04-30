import type { GoogleSignedInUser } from '../types/auth';

const GOOGLE_IDENTITY_SCRIPT_ID = 'lexicue-google-identity-services';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DEFAULT_GOOGLE_CLIENT_ID =
  '638160893106-ikovp4ndr4gicf6v44h94ab1pa1j1jeb.apps.googleusercontent.com';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type GoogleTokenError = {
  type?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (overrideConfig?: {
    prompt?: '' | 'consent';
  }) => void;
};

type GoogleIdCredentialResponse = {
  credential?: string;
};

type GoogleIdConfiguration = {
  callback: (response: GoogleIdCredentialResponse) => void;
  client_id: string;
  context?: 'signin' | 'signup' | 'use';
  ux_mode?: 'popup' | 'redirect';
};

type GoogleIdButtonConfiguration = {
  logo_alignment?: 'left' | 'center';
  shape?: 'circle' | 'pill' | 'rectangular' | 'square';
  size?: 'large' | 'medium' | 'small';
  text?: 'continue_with' | 'signin' | 'signin_with' | 'signup_with';
  theme?: 'filled_black' | 'filled_blue' | 'outline';
  width?: number | string;
};

type GoogleOauth2Api = {
  initTokenClient: (config: {
    callback: (response: GoogleTokenResponse) => void;
    client_id: string;
    error_callback?: (error: GoogleTokenError) => void;
    scope: string;
  }) => GoogleTokenClient;
  revoke: (
    accessToken: string,
    callback?: (response: {
      error?: string;
      error_description?: string;
      successful?: boolean;
    }) => void,
  ) => void;
};

type GoogleIdApi = {
  disableAutoSelect: () => void;
  initialize: (config: GoogleIdConfiguration) => void;
  renderButton: (
    parent: HTMLElement,
    options: GoogleIdButtonConfiguration,
  ) => void;
};

type GoogleWindow = Window & {
  google?: {
    accounts?: {
      id?: GoogleIdApi;
      oauth2?: GoogleOauth2Api;
    };
  };
};

export type GoogleDriveToken = {
  accessToken: string;
  expiresAt: number;
  scope: string;
};

let googleIdentityScriptPromise: Promise<void> | null = null;

function getGoogleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || DEFAULT_GOOGLE_CLIENT_ID;
}

function getGoogleOauth2Api(): GoogleOauth2Api {
  const googleWindow = window as GoogleWindow;
  const oauth2Api = googleWindow.google?.accounts?.oauth2;

  if (!oauth2Api) {
    throw new Error('Google Identity Services is not available right now.');
  }

  return oauth2Api;
}

function getGoogleIdApi(): GoogleIdApi {
  const googleWindow = window as GoogleWindow;
  const idApi = googleWindow.google?.accounts?.id;

  if (!idApi) {
    throw new Error('Google Identity Services is not available right now.');
  }

  return idApi;
}

function decodeBase64UrlText(value: string): string {
  const normalizedValue = value.replace(/-/g, '+').replace(/_/g, '/');
  const paddedValue =
    normalizedValue + '='.repeat((4 - (normalizedValue.length % 4)) % 4);
  const binaryValue = window.atob(paddedValue);
  const bytes = Uint8Array.from(binaryValue, (character) =>
    character.charCodeAt(0),
  );

  return new TextDecoder().decode(bytes);
}

function parseGoogleSignedInUser(
  credentialResponse: GoogleIdCredentialResponse,
): GoogleSignedInUser {
  if (!credentialResponse.credential) {
    throw new Error('Google account sign-in did not return a usable credential.');
  }

  const tokenParts = credentialResponse.credential.split('.');

  if (tokenParts.length < 2) {
    throw new Error('Google account sign-in returned an invalid credential.');
  }

  const payload = JSON.parse(
    decodeBase64UrlText(tokenParts[1]),
  ) as Partial<{
    email: string;
    name: string;
    picture: string;
    sub: string;
  }>;

  if (!payload.sub || !payload.email || !payload.name) {
    throw new Error('Google account sign-in returned incomplete profile data.');
  }

  return {
    avatarUrl: payload.picture,
    displayName: payload.name,
    email: payload.email,
    googleUserId: payload.sub,
  };
}

export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new Error('Google account features are only available in the browser.'),
    );
  }

  if ((window as GoogleWindow).google?.accounts) {
    return Promise.resolve();
  }

  if (googleIdentityScriptPromise) {
    return googleIdentityScriptPromise;
  }

  googleIdentityScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(
      GOOGLE_IDENTITY_SCRIPT_ID,
    ) as HTMLScriptElement | null;

    if (existingScript) {
      if ((window as GoogleWindow).google?.accounts) {
        resolve();
        return;
      }

      existingScript.addEventListener('load', () => resolve(), {
        once: true,
      });
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Google Identity Services failed to load.')),
        {
          once: true,
        },
      );
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_IDENTITY_SCRIPT_ID;
    script.src = GOOGLE_IDENTITY_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Google Identity Services failed to load.'));
    document.head.append(script);
  });

  return googleIdentityScriptPromise;
}

export async function requestGoogleDriveAccessToken(
  prompt: '' | 'consent' = 'consent',
): Promise<GoogleDriveToken> {
  await loadGoogleIdentityScript();

  return new Promise((resolve, reject) => {
    const oauth2Api = getGoogleOauth2Api();
    const tokenClient = oauth2Api.initTokenClient({
      callback: (response) => {
        if (response.error) {
          reject(
            new Error(
              response.error_description ??
                'Google Drive authorization did not succeed.',
            ),
          );
          return;
        }

        if (!response.access_token) {
          reject(new Error('Google Drive did not return an access token.'));
          return;
        }

        resolve({
          accessToken: response.access_token,
          expiresAt:
            Date.now() + Math.max((response.expires_in ?? 3600) - 60, 60) * 1000,
          scope: response.scope ?? GOOGLE_DRIVE_SCOPE,
        });
      },
      client_id: getGoogleClientId(),
      error_callback: (error) => {
        if (error.type === 'popup_closed') {
          reject(new Error('Google Drive sign-in was closed before it finished.'));
          return;
        }

        if (error.type === 'popup_failed_to_open') {
          reject(new Error('Google Drive sign-in popup could not be opened.'));
          return;
        }

        reject(new Error('Google Drive sign-in could not be started.'));
      },
      scope: GOOGLE_DRIVE_SCOPE,
    });

    tokenClient.requestAccessToken({ prompt });
  });
}

export async function tryRestoreGoogleDriveAccessToken(): Promise<GoogleDriveToken | null> {
  try {
    return await requestGoogleDriveAccessToken('');
  } catch {
    return null;
  }
}

export async function revokeGoogleDriveAccessToken(
  accessToken: string,
): Promise<void> {
  await loadGoogleIdentityScript();

  return new Promise((resolve) => {
    getGoogleOauth2Api().revoke(accessToken, () => resolve());
  });
}

export async function renderGoogleSignInButton(
  container: HTMLElement,
  callbacks: {
    onError?: (message: string) => void;
    onSignIn: (user: GoogleSignedInUser) => void;
  },
): Promise<void> {
  await loadGoogleIdentityScript();

  const idApi = getGoogleIdApi();

  idApi.initialize({
    callback: (response) => {
      try {
        callbacks.onSignIn(parseGoogleSignedInUser(response));
      } catch (error) {
        callbacks.onError?.(
          error instanceof Error
            ? error.message
            : 'Google account sign-in could not be completed.',
        );
      }
    },
    client_id: getGoogleClientId(),
    context: 'signin',
    ux_mode: 'popup',
  });

  container.innerHTML = '';
  idApi.renderButton(container, {
    logo_alignment: 'left',
    shape: 'pill',
    size: 'large',
    text: 'signin_with',
    theme: 'outline',
    width: 260,
  });
}

export async function clearGoogleAccountSession(): Promise<void> {
  await loadGoogleIdentityScript();
  getGoogleIdApi().disableAutoSelect();
}
