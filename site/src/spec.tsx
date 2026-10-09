import { useEffect } from "react";
import { Code } from "./copy-block";
import { Shell } from "./shell";

const folders = `.wcp/issues/
  open/                          backlog. nobody is editing it. does not block a commit
  in-progress/                   an agent is editing this on this machine. the only lock
  done/YYYY/MM/DD/               writing matches acceptance. in the tree. not pushed
  deployed-dev/YYYY/MM/DD/       that commit is on origin/dev. the sha is in dev
  deployed-main/YYYY/MM/DD/      that commit is on origin/main. the sha is in main
  blocked/                       still wanted. do not pick it up. reason is required
  canceled/YYYY/MM/DD/           will not be done. reason is required`;

const issueFile = `---
id: 0123
title: Rotate refresh token on session mint
status: open
assignee:
files: []
acceptance:
reason:
dev:
main:
created: 2026-10-01T12:02:00Z
session: 2026-10-01T12:00:00Z
---`;

const trackerFile = `---
tracker: none
url:
---`;

const toc = [
  ["#folders", "Folders"],
  ["#run", "The run"],
  ["#issue", "Issue file"],
  ["#tracker", "External tracker"],
] as const;

export function Spec() {
  useEffect(() => {
    document.title = "Spec · Water Cooler Protocol";
  }, []);

  return (
    <Shell spec>
      <main className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <div className="max-w-2xl">
          <p className="font-mono text-xs tracking-wider text-accent uppercase">PROTOCOL.md</p>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] text-fg sm:text-5xl md:text-6xl">
            Specification
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Many coding agents share one local <span className="font-mono text-fg">dev</span> checkout. The issue files
            under <span className="font-mono text-fg">.wcp/issues/</span> are the whole protocol. There is no daemon, no
            database, and no lease command.
          </p>
          <p className="mt-4 text-sm text-subtle">
            Source of truth:{" "}
            <a
              href="https://github.com/davidsolheim/water-cooler-protocol/blob/main/PROTOCOL.md"
              target="_blank"
              rel="noreferrer"
              className="text-fg underline decoration-border underline-offset-4 hover:decoration-muted"
            >
              PROTOCOL.md on GitHub
            </a>
            .
          </p>
        </div>

        <div className="mt-14 grid min-w-0 gap-12 lg:grid-cols-[14rem_minmax(0,42rem)] lg:gap-16">
          <nav className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <p className="font-mono text-[11px] tracking-wider text-subtle uppercase">Contents</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 lg:grid-cols-1">
              {toc.map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="inline-flex min-h-10 items-center text-sm text-muted transition-colors hover:text-fg">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <article className="min-w-0 space-y-16 text-[1.05rem] leading-relaxed">
            <section id="folders" className="scroll-mt-24">
              <h2 className="font-display text-2xl font-bold tracking-[-0.03em] text-fg">Folders</h2>
              <div className="mt-5">
                <pre className="max-w-full overflow-x-auto rounded-lg bg-surface-2 p-5 font-mono text-sm leading-relaxed text-fg shadow-[var(--shadow-border)]">
                  {folders}
                </pre>
                <p className="mt-5 text-muted">
                  Seven live statuses. The folder is the status. <Code>open/</Code>, <Code>in-progress/</Code>, and{" "}
                  <Code>blocked/</Code> stay flat. <Code>done/</Code>, <Code>deployed-dev/</Code>,{" "}
                  <Code>deployed-main/</Code>, and <Code>canceled/</Code> are filed under <Code>YYYY/MM/DD</Code> from{" "}
                  <Code>created</Code>. Walk every <Code>*.md</Code> under a status directory, including a day tree and
                  any older flat file.
                </p>
                <p className="mt-4 text-muted">
                  The filename is <Code>YYYYMMDDThhmmZ-&lt;id&gt;-&lt;slug&gt;.md</Code>. It never changes when the status
                  moves. Set <Code>status</Code> to the folder name, then move the file.
                </p>
                <p className="mt-4 text-muted">
                  <Code>in-review</Code> is retired. A file left in <Code>in-review/</Code> means the writing is finished.
                  The next agent moves it to <Code>done/</Code>.
                </p>
              </div>
            </section>

            <section id="run" className="scroll-mt-24">
              <h2 className="font-display text-2xl font-bold tracking-[-0.03em] text-fg">The run</h2>
              <div className="mt-5">
                <ol className="list-decimal space-y-3 pl-5 text-muted">
                  <li>
                    At the start, look in <Code>done/</Code>. If that issue’s commit is already on <Code>origin/dev</Code>,
                    move it to <Code>deployed-dev/</Code> and write the sha in <Code>dev</Code>. If it is already on{" "}
                    <Code>origin/main</Code>, move it to <Code>deployed-main/</Code> and write the sha in <Code>main</Code>.
                    Then read <Code>in-progress/</Code>.
                  </li>
                  <li>
                    Take one issue from <Code>open/</Code> whose <Code>files</Code> do not overlap an issue already in{" "}
                    <Code>in-progress/</Code>. Move it to <Code>in-progress/</Code>. Write your name in <Code>assignee</Code>.
                    Read it back. If <Code>assignee</Code> is not you, stop.
                  </li>
                  <li>
                    Add each path to <Code>files</Code> as you write it. Another agent reads <Code>in-progress/</Code> and
                    works around those paths.
                  </li>
                  <li>
                    When the writing matches <Code>acceptance</Code>, move the issue to <Code>done/</Code>.
                  </li>
                  <li>
                    If <Code>in-progress/</Code> still has anything, or you still have another task, stop. Do not commit.
                    Do not push. Leave the tree dirty.
                  </li>
                  <li>
                    If <Code>in-progress/</Code> is empty and you have no further task, commit the tree, push <Code>dev</Code>{" "}
                    to <Code>origin/dev</Code>, write that sha into <Code>dev</Code> on each <Code>done/</Code> issue from
                    that commit, and move those issues to <Code>deployed-dev/</Code>.
                  </li>
                  <li>
                    A later run’s start check moves an issue to <Code>deployed-main/</Code> only after its commit is on{" "}
                    <Code>origin/main</Code>, and writes that sha into <Code>main</Code>.
                  </li>
                </ol>
                <p className="mt-5 text-muted">
                  <Code>open/</Code> does not block the push. Only <Code>in-progress/</Code> means someone is still editing.
                </p>
                <p className="mt-4 text-muted">
                  Do not commit while any issue is in <Code>in-progress/</Code>. Do not reset, checkout, or stash. Another
                  agent’s uncommitted work stays.
                </p>
                <p className="mt-4 text-muted">
                  If you edit a file that already has uncommitted changes, find every issue in <Code>in-progress/</Code> or{" "}
                  <Code>done/</Code> whose <Code>files</Code> list includes that path. Read that issue and the other paths
                  in its <Code>files</Code>. Keep the behavior its <Code>acceptance</Code> describes. Your edit builds on
                  those changes. Do not revert them, and do not leave that acceptance broken.
                </p>
                <p className="mt-4 text-muted">
                  A crashed agent leaves an issue in <Code>in-progress/</Code>. The next agent moves it back to{" "}
                  <Code>open/</Code> when the work has stopped, and clears <Code>assignee</Code>.
                </p>
              </div>
            </section>

            <section id="issue" className="scroll-mt-24">
              <h2 className="font-display text-2xl font-bold tracking-[-0.03em] text-fg">Issue file</h2>
              <div className="mt-5">
                <pre className="max-w-full overflow-x-auto rounded-lg bg-surface-2 p-5 font-mono text-sm leading-relaxed text-fg shadow-[var(--shadow-border)]">
                  {issueFile}
                </pre>
                <p className="mt-5 text-muted">
                  The body under the frontmatter is the spec. <Code>dev</Code> and <Code>main</Code> stay empty until those
                  commits exist. <Code>reason</Code> is required to block or cancel.
                </p>
                <p className="mt-4 text-muted">
                  Search <Code>blocked/</Code> and <Code>canceled/</Code> before filing the same work again. Read{" "}
                  <Code>reason</Code>. Unblocking moves the file to <Code>open/</Code> and leaves <Code>reason</Code>.
                  Reviving a canceled issue does the same, and only when the user says to.
                </p>
                <p className="mt-4 text-muted">
                  Commit <Code>.wcp/issues/</Code> and <Code>.wcp/tracker.md</Code>. Do not commit any other path under{" "}
                  <Code>.wcp/</Code>.
                </p>
              </div>
            </section>

            <section id="tracker" className="scroll-mt-24">
              <h2 className="font-display text-2xl font-bold tracking-[-0.03em] text-fg">External tracker</h2>
              <div className="mt-5">
                <p className="text-muted">
                  wcp issues are always created and managed in <Code>.wcp/issues/</Code>. An external tracker is optional.
                </p>
                <p className="mt-4 text-muted">
                  The choice lives in <Code>.wcp/tracker.md</Code>:
                </p>
                <pre className="mt-4 max-w-full overflow-x-auto rounded-lg bg-surface-2 p-5 font-mono text-sm text-fg shadow-[var(--shadow-border)]">
                  {trackerFile}
                </pre>
                <p className="mt-5 text-muted">
                  <Code>tracker</Code> is <Code>none</Code>, or a tool the user named: <Code>notion</Code>, <Code>linear</Code>,{" "}
                  <Code>jira</Code>, or another. <Code>url</Code> is that board or project. <Code>none</Code> leaves{" "}
                  <Code>url</Code> empty.
                </p>
                <p className="mt-4 text-muted">
                  Ask the user once when this file is missing. <Code>none</Code> is a complete answer. Record it and do not
                  ask again. If you cannot ask, leave the file missing and keep going. A missing file means wcp only.
                </p>
                <p className="mt-4 text-muted">
                  When <Code>tracker</Code> is not <Code>none</Code>, every create, status move, <Code>files</Code> change,
                  and <Code>dev</Code> or <Code>main</Code> sha is written to that tool as well. The file is written first.
                  A failed external write does not undo the file. Do not create a second queue.
                </p>
                <p className="mt-8">
                  <a className="text-sm text-fg underline decoration-border underline-offset-4 hover:decoration-muted" href="/">
                    Back to the protocol
                  </a>
                </p>
              </div>
            </section>
          </article>
        </div>
      </main>
    </Shell>
  );
}
