import { useState } from "react";

function CopyIcon({ copied }: { copied: boolean }) {
  const shown = "absolute inset-0 size-4 transition-[opacity,transform,filter] duration-200 ease-out";
  return (
    <span className="relative size-4">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`${shown} ${copied ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-none"}`}
        aria-hidden="true"
      >
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`${shown} ${copied ? "scale-100 opacity-100 blur-none" : "scale-[0.25] opacity-0 blur-[4px]"}`}
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

export function CopyBlock({ code, className = "mt-5" }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={`relative rounded-lg bg-surface-2 p-4 pr-14 shadow-[var(--shadow-border)] ${className}`}>
      <pre className="overflow-x-auto font-mono text-sm leading-relaxed break-all whitespace-pre-wrap text-fg sm:break-normal sm:whitespace-pre">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        aria-label="Copy"
        className="absolute top-2.5 right-2.5 inline-flex size-11 items-center justify-center rounded-sm text-muted transition-[color,background-color,transform] duration-150 ease-out hover:bg-surface hover:text-fg active:scale-[0.96]"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        <CopyIcon copied={copied} />
      </button>
    </div>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-fg">{children}</code>
  );
}
