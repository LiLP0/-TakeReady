import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { useScriptStorage } from '../hooks/useScriptStorage';
import { ACCOUNT_ROUTE, appRoutes, SIGN_IN_ROUTE } from '../utils/routes';

export function AppLayout() {
  const location = useLocation();
  const { googleAppAuthState } = useScriptStorage();
  const authRoute =
    googleAppAuthState === 'signed_out' ? SIGN_IN_ROUTE : ACCOUNT_ROUTE;
  const authLabel = googleAppAuthState === 'signed_out' ? 'Sign In' : 'Account';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="container app-header-inner">
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
                {route.label}
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
      </header>

      <main className="app-main">
        <div className="container">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
