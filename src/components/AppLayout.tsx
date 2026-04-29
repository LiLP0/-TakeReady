import { NavLink, Outlet } from 'react-router-dom';

import { appRoutes } from '../utils/routes';

export function AppLayout() {
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
