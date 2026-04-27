import type { ReactNode } from 'react';

type PageShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function PageShell({ title, description, children }: PageShellProps) {
  return (
    <section className="page-shell">
      <header className="page-header">
        <p className="page-kicker">Script Chunking and Performance Reading</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </header>
      {children}
    </section>
  );
}
