import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { PageShell } from '../components/PageShell';
import { usePageTitle } from '../hooks/usePageTitle';
import { useScriptStorage } from '../hooks/useScriptStorage';
import { renderGoogleSignInButton } from '../utils/googleIdentity';
import { ACCOUNT_ROUTE } from '../utils/routes';

type SignInStatus = {
  message: string;
  type: 'error' | 'success';
};

function getRedirectPath(locationState: unknown): string {
  if (
    typeof locationState === 'object' &&
    locationState &&
    'from' in locationState &&
    typeof locationState.from === 'string'
  ) {
    if (locationState.from === '/signin') {
      return ACCOUNT_ROUTE;
    }

    return locationState.from;
  }

  return ACCOUNT_ROUTE;
}

export function SignInPage() {
  usePageTitle('Sign In');
  const navigate = useNavigate();
  const location = useLocation();
  const {
    completeGoogleSignIn,
    connectGoogleDrive,
    googleSignedInUser,
  } = useScriptStorage();
  const [status, setStatus] = useState<SignInStatus | null>(null);
  const [isFinishingSignIn, setIsFinishingSignIn] = useState(false);
  const googleSignInButtonRef = useRef<HTMLDivElement | null>(null);
  const redirectPath = getRedirectPath(location.state);
  const shouldRedirectToAccount = Boolean(googleSignedInUser) && !isFinishingSignIn;

  useEffect(() => {
    const buttonContainer = googleSignInButtonRef.current;

    if (!buttonContainer || shouldRedirectToAccount) {
      if (buttonContainer) {
        buttonContainer.innerHTML = '';
      }

      return;
    }

    let isCancelled = false;

    void renderGoogleSignInButton(buttonContainer, {
      onError: (message) => {
        if (isCancelled) {
          return;
        }

        setStatus({
          message,
          type: 'error',
        });
      },
      onSignIn: async (user) => {
        if (isCancelled) {
          return;
        }

        setIsFinishingSignIn(true);
        setStatus({
          message: `Signed in as ${user.displayName}. Connecting cloud sync...`,
          type: 'success',
        });
        completeGoogleSignIn(user);

        const cloudSyncResult = await connectGoogleDrive();

        navigate(redirectPath, {
          replace: true,
          state: {
            accountStatus: {
              message: cloudSyncResult.message,
              type: cloudSyncResult.status === 'success' ? 'success' : 'error',
            },
          },
        });
      },
    }).catch((error) => {
      if (isCancelled) {
        return;
      }

      setStatus({
        message:
          error instanceof Error
            ? error.message
            : 'Google account sign-in could not be started.',
        type: 'error',
      });
    });

    return () => {
      isCancelled = true;
      buttonContainer.innerHTML = '';
    };
  }, [shouldRedirectToAccount]);

  if (shouldRedirectToAccount) {
    return <Navigate replace to={ACCOUNT_ROUTE} />;
  }

  return (
    <PageShell
      description="Sign in with Google to use LexiCue on this device and reconnect cloud sync when Google Drive is available."
      title="Sign In"
    >
      <section className="panel sign-in-panel">
        <div className="sign-in-copy">
          <h2>Sign in to LexiCue</h2>
          <p className="page-note">
            Use your Google account to open LexiCue here. Local scripts stay on
            this device, and cloud sync reconnects when Google Drive is
            available.
          </p>
        </div>

        <div className="scripts-google-sign-in-button" ref={googleSignInButtonRef} />

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
      </section>
    </PageShell>
  );
}
