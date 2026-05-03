import type { ReactNode } from 'react';

type PageShellProps = {
  title: string;
  description?: string;
  children: ReactNode;
  variant?: 'compact' | 'hero';
};

export function PageShell({
  title,
  description,
  children,
  variant = 'compact',
}: PageShellProps) {
  return (
    <section className={`page-shell is-${variant}`}>
      <header className="page-header">
        <div className="page-header-surface">
          {variant === 'hero' ? (
            <p className="page-kicker">Script Chunking and Performance Reading</p>
          ) : null}
          <div className="page-header-copy">
            <h1 className="page-title">{title}</h1>
            {description ? (
              <p className="page-description">{description}</p>
            ) : null}
          </div>
        </div>
      </header>
      <div className="page-content">{children}</div>
    </section>
  );
}
