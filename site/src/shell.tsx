import { useEffect, type ReactNode } from "react";

const GITHUB = "https://github.com/davidsolheim/water-cooler-protocol";

function Mark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="size-7">
      <circle cx="16" cy="16" r="13.5" stroke="currentColor" strokeWidth="0.75" className="text-accent/40" />
      <circle cx="16" cy="16" r="9.5" stroke="currentColor" strokeWidth="1" className="text-accent/70" />
      <circle cx="16" cy="16" r="5.5" stroke="currentColor" strokeWidth="1.35" className="text-fg" />
      <circle cx="16" cy="16" r="1.75" fill="currentColor" className="text-fg" />
    </svg>
  );
}

export function ArrowRight() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

const navClass =
  "min-h-11 items-center px-2.5 text-sm text-muted transition-colors duration-150 hover:text-fg";

export function Shell({
  children,
  spec,
}: {
  children: ReactNode;
  spec?: boolean;
}) {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    document.getElementById(id)?.scrollIntoView();
  }, []);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <a
            className="flex min-h-11 items-center gap-2.5 text-fg no-underline"
            href="/"
            aria-current={spec ? undefined : "page"}
          >
            <Mark />
            <span className="font-display text-[1.05rem] font-semibold tracking-[-0.03em] whitespace-nowrap">
              Water Cooler Protocol
            </span>
          </a>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a href="/#queue" className={`hidden sm:inline-flex ${navClass}`}>
              Queue
            </a>
            <a href="/#worktrees" className={`hidden sm:inline-flex ${navClass}`}>
              Worktrees
            </a>
            <a href="/#run" className={`hidden sm:inline-flex ${navClass}`}>
              Run
            </a>
            <a
              className={`inline-flex ${navClass}`}
              href="/spec"
              aria-current={spec ? "page" : undefined}
            >
              Spec
            </a>
            <a href={GITHUB} target="_blank" rel="noreferrer" className={`inline-flex ${navClass}`}>
              GitHub
            </a>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">MIT © 2026 David Solheim</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <a
              className="text-muted transition-colors hover:text-fg"
              href="/spec"
              aria-current={spec ? "page" : undefined}
            >
              Spec
            </a>
            <a href={GITHUB} target="_blank" rel="noreferrer" className="text-muted transition-colors hover:text-fg">
              GitHub
            </a>
            <a href="/#queue" className="text-muted transition-colors hover:text-fg">
              Queue
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export const githubUrl = GITHUB;
