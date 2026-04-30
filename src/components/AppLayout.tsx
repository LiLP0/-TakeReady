import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { useScriptStorage } from '../hooks/useScriptStorage';
import { ACCOUNT_ROUTE, appRoutes, SIGN_IN_ROUTE } from '../utils/routes';

function getNavigationLabel(path: string, defaultLabel: string): string {
  if (path === '/editor') {
    return 'Create';
  }

  if (path === '/scripts') {
    return 'Library';
  }

  if (path === '/performance') {
    return 'Cue Cards';
  }

  return defaultLabel;
}

export function AppLayout() {
  const location = useLocation();
  const { googleAppAuthState } = useScriptStorage();
  const authRoute =
    googleAppAuthState === 'signed_out' ? SIGN_IN_ROUTE : ACCOUNT_ROUTE;
  const authLabel = googleAppAuthState === 'signed_out' ? 'Sign In' : 'Account';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="container">
          <div className="app-header-panel">
            <div className="app-header-inner">
              <div className="brand">
                <p className="brand-title">LexiCue</p>
                <p className="brand-subtitle">
                  Turn long scripts into recording-ready cards.
                </p>
              </div>

              <nav aria-label="Primary" className="app-nav">
                {appRoutes.map((route) => (
                  <NavLink
                    key={route.path}
                    className={({ isActive }) =>
                      isActive ? 'nav-link is-active' : 'nav-link'
                    }
                    end={route.path === '/'}
                    to={route.path}
                  >
                    {getNavigationLabel(route.path, route.label)}
                  </NavLink>
                ))}
                <NavLink
                  className={({ isActive }) =>
                    isActive ? 'nav-link is-active' : 'nav-link'
                  }
                  end
                  state={
                    googleAppAuthState === 'signed_out'
                      ? {
                          from: location.pathname,
                        }
                      : undefined
                  }
                  to={authRoute}
                >
                  {authLabel}
                </NavLink>
              </nav>
            </div>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="container app-main-container">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
