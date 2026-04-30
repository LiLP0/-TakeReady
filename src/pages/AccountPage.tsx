import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { PageShell } from '../components/PageShell';
import { usePageTitle } from '../hooks/usePageTitle';
import { useScriptStorage } from '../hooks/useScriptStorage';
import type { GoogleAppAuthState } from '../types/auth';
import { ACCOUNT_ROUTE, SIGN_IN_ROUTE } from '../utils/routes';

type AccountStatus = {
  message: string;
  type: 'error' | 'success';
};

function getGoogleAccountStatusLabel(
  googleAppAuthState: GoogleAppAuthState,
): string {
  if (googleAppAuthState === 'signed_in_drive_connected') {
    return 'Signed in + Drive connected';
  }

  if (googleAppAuthState === 'signed_in') {
    return 'Signed in';
  }

  return 'Signed out';
}

function getGoogleAccountInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return initials || '?';
}

function getInitialAccountStatus(locationState: unknown): AccountStatus | null {
  if (
    typeof locationState === 'object' &&
    locationState &&
    'accountStatus' in locationState &&
    typeof locationState.accountStatus === 'object' &&
    locationState.accountStatus &&
    'message' in locationState.accountStatus &&
    'type' in locationState.accountStatus &&
    typeof locationState.accountStatus.message === 'string' &&
    (locationState.accountStatus.type === 'error' ||
      locationState.accountStatus.type === 'success')
  ) {
    return {
      message: locationState.accountStatus.message,
      type: locationState.accountStatus.type,
    };
  }

  return null;
}

export function AccountPage() {
  usePageTitle('Account');
  const navigate = useNavigate();
  const location = useLocation();
  const {
    connectGoogleDrive,
    disconnectGoogleDrive,
    googleAppAuthState,
    googleDriveConnectionState,
    googleDriveFiles,
    googleSignedInUser,
    isGoogleCloudSyncEnabled,
    isLibraryWriteBlocked,
    isLoadingGoogleDriveFiles,
    refreshGoogleDriveFiles,
    signOutGoogleAccount,
  } = useScriptStorage();
  const [status, setStatus] = useState<AccountStatus | null>(() =>
    getInitialAccountStatus(location.state),
  );
  const isGoogleDriveConnected = googleDriveConnectionState === 'connected';
  const isGoogleDriveConnecting = googleDriveConnectionState === 'connecting';

  useEffect(() => {
    if (!location.state) {
      return;
    }

    navigate(location.pathname, { replace: true });
  }, [location.pathname, location.state, navigate]);

  async function handleConnectGoogleDrive(): Promise<void> {
    const result = await connectGoogleDrive();

    setStatus({
      message: result.message,
      type: result.status === 'success' ? 'success' : 'error',
    });
  }

  async function handleDisconnectGoogleDrive(): Promise<void> {
    const result = await disconnectGoogleDrive();

    setStatus({
      message: result.message,
      type: result.status === 'success' ? 'success' : 'error',
    });
  }

  async function handleRefreshGoogleDriveFiles(): Promise<void> {
    const result = await refreshGoogleDriveFiles();

    setStatus({
      message: result.message,
      type: result.status === 'success' ? 'success' : 'error',
    });
  }

  async function handleSignOutGoogleAccount(): Promise<void> {
    const result = await signOutGoogleAccount();

    setStatus({
      message: result.message,
      type: result.status === 'success' ? 'success' : 'error',
    });
  }

  return (
    <PageShell
      description="Review your Google account details, reconnect cloud sync, and manage how LexiCue works with Google Drive on this device."
      title="Account"
    >
      {status ? (
        <p
          aria-live="polite"
          className={`status-message ${
            status.type === 'error' ? 'is-error' : 'is-success'
          }`}
        >
          {status.message}
        </p>
      ) : null}

      {googleSignedInUser ? (
        <>
          <section className="scripts-account-panel" aria-label="Google account">
            <div className="scripts-account-header">
              <div className="scripts-account-copy">
                <h2>Google account</h2>
                <p className="page-note">
                  LexiCue uses this Google account for your signed-in session on
                  this device. Local scripts remain available even when cloud
                  sync is off.
                </p>
              </div>
              <span
                className={`script-status-badge scripts-account-badge ${
                  googleAppAuthState === 'signed_out' ? 'is-raw' : 'is-chunked'
                }`}
              >
                {getGoogleAccountStatusLabel(googleAppAuthState)}
              </span>
            </div>

            <div className="scripts-account-body">
              {googleSignedInUser.avatarUrl ? (
                <img
                  alt={`Avatar for ${googleSignedInUser.displayName}`}
                  className="scripts-account-avatar"
                  referrerPolicy="no-referrer"
                  src={googleSignedInUser.avatarUrl}
                />
              ) : (
                <div className="scripts-account-avatar is-fallback" aria-hidden="true">
                  {getGoogleAccountInitials(googleSignedInUser.displayName)}
                </div>
              )}
              <div className="scripts-account-details">
                <p className="scripts-account-name">
                  {googleSignedInUser.displayName}
                </p>
                <p className="page-note">{googleSignedInUser.email}</p>
              </div>
              <div className="scripts-account-actions">
                <button
                  className="text-link"
                  onClick={handleSignOutGoogleAccount}
                  type="button"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </section>

          <section className="scripts-cloud-panel" aria-label="Cloud sync tools">
            <div className="scripts-cloud-header">
              <div className="scripts-cloud-copy">
                <h2>Cloud sync</h2>
                <p className="page-note">
                  Google Drive powers your LexiCue cloud project library when
                  cloud sync is connected for this browser session.
                </p>
              </div>
              <div className="scripts-cloud-connection">
                <span
                  className={`script-status-badge scripts-cloud-badge ${
                    isGoogleDriveConnected
                      ? 'is-chunked'
                      : isGoogleDriveConnecting
                        ? 'is-pending'
                        : 'is-raw'
                  }`}
                >
                  {isGoogleDriveConnected
                    ? 'Cloud sync on'
                    : isGoogleDriveConnecting
                      ? 'Restoring cloud sync'
                      : 'Cloud sync off'}
                </span>
                {isGoogleDriveConnected ? (
                  <>
                    <button
                      className="text-link"
                      disabled={isLoadingGoogleDriveFiles}
                      onClick={handleRefreshGoogleDriveFiles}
                      type="button"
                    >
                      {isLoadingGoogleDriveFiles
                        ? 'Refreshing Cloud Sync...'
                        : 'Refresh Cloud Sync'}
                    </button>
                    <button
                      className="text-link"
                      onClick={handleDisconnectGoogleDrive}
                      type="button"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    className="text-link"
                    disabled={googleDriveConnectionState === 'connecting'}
                    onClick={handleConnectGoogleDrive}
                    type="button"
                  >
                    {googleDriveConnectionState === 'connecting'
                      ? 'Restoring Cloud Sync...'
                      : 'Reconnect Cloud Sync'}
                  </button>
                )}
              </div>
            </div>

            <div className="scripts-cloud-grid">
              <div className="scripts-cloud-stat">
                <span className="scripts-cloud-stat-label">Google Drive files</span>
                <strong className="scripts-cloud-stat-value">
                  {googleDriveFiles.length}
                </strong>
              </div>
              <div className="scripts-cloud-stat">
                <span className="scripts-cloud-stat-label">Sync mode</span>
                <strong className="scripts-cloud-stat-value">
                  {isGoogleCloudSyncEnabled
                    ? 'Automatic this session'
                    : isGoogleDriveConnecting
                      ? 'Restoring in background'
                      : 'Local fallback'}
                </strong>
              </div>
            </div>

            {isGoogleDriveConnecting ? (
              <p className="page-note scripts-cloud-note">
                LexiCue is quietly checking whether Google Drive can reconnect
                for this browser session.
              </p>
            ) : isGoogleDriveConnected ? (
              <p className="page-note scripts-cloud-note">
                Cloud sync is active. New saves from Editor sync in the
                background, and refreshing cloud sync pulls Drive-backed
                LexiCue projects into your local library.
              </p>
            ) : (
              <p className="page-note scripts-cloud-note">
                Cloud sync is currently off. Reconnect it when you want
                Drive-backed projects and background syncing again.
              </p>
            )}

            {isLibraryWriteBlocked ? (
              <p className="page-note scripts-cloud-note">
                Local library protection is active right now, so merging cloud
                projects into local storage is temporarily blocked.
              </p>
            ) : null}
          </section>
        </>
      ) : (
        <section className="panel account-empty">
          <h2>You are signed out</h2>
          <p className="page-note">
            Sign in with Google to restore your LexiCue account on this device
            and reconnect cloud sync when Google Drive access is available.
          </p>
          <div className="link-row">
            <button
              className="text-link is-primary"
              onClick={() =>
                navigate(SIGN_IN_ROUTE, {
                  state: {
                    from: ACCOUNT_ROUTE,
                  },
                })
              }
              type="button"
            >
              Go to Sign In
            </button>
          </div>
        </section>
      )}
    </PageShell>
  );
}
