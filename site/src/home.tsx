import { useEffect, type ReactNode } from "react";
import { CopyBlock } from "./copy-block";
import { ArrowRight, Shell, githubUrl } from "./shell";

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

const agentsSnippet = `## wcp

This checkout may have many coding agents on one local dev working tree.
The issue files are the protocol. There is no daemon.

- in-progress/ means an agent is editing that issue on this machine
- Do not commit while any issue is in in-progress/
- When in-progress/ is empty and you have no further task, commit and push origin/dev
- Commit .wcp/issues/ and .wcp/tracker.md. Nothing else under .wcp/`;

const chain = [
  ["open", "open/", "Backlog. Nobody is editing it. Does not block a commit."],
  ["in-progress", "in-progress/", "An agent is editing this issue on this machine. This is the only lock."],
  ["done", "done/YYYY/MM/DD/", "Writing matches acceptance. The code is in the tree and has not been pushed."],
  ["deployed-dev", "deployed-dev/YYYY/MM/DD/", "That commit is on origin/dev. The sha is in dev."],
  ["deployed-main", "deployed-main/YYYY/MM/DD/", "That commit is on origin/main. The sha is in main."],
] as const;

const doors = [
  ["blocked", "blocked/", "Still wanted. Do not pick it up. reason is required."],
  ["canceled", "canceled/YYYY/MM/DD/", "Will not be done. reason is required."],
] as const;

const steps = [
  ["01", "look", "If a done issue’s commit is already on origin/dev or origin/main, move it and write the sha."],
  ["02", "take", "One open issue whose files do not overlap in-progress. Write your name. Read it back."],
  ["03", "files", "Add each path as you write it. Other agents read in-progress and work around those paths."],
  ["04", "done", "When the writing matches acceptance, move the issue to done/."],
  ["05", "quiet", "If in-progress still has anything, stop. Do not commit. Do not push. Leave the tree dirty."],
  ["06", "push", "If in-progress is empty and you have no further task, commit, push origin/dev, move those issues to deployed-dev/."],
] as const;

const comparisons = [
  {
    title: "They cannot see the other write",
    worktree:
      "A worktree’s uncommitted files are invisible to the next agent. The overlap shows up at merge, after both have finished and neither is still in the file.",
    wcp: "One tree. If a path already has changes, the agent reads the issue that lists it, and the other paths in files, and keeps that acceptance. The edit builds on those bytes. It does not revert them.",
  },
  {
    title: "The lock is a second checkout",
    worktree:
      "Each agent gets a directory, an index, and usually its own install. git worktree list names folders. It does not name the issue or the paths.",
    wcp: "in-progress/ is the only lock. An open issue whose files overlap a live one is not taken. Everything else proceeds in the checkout you already have open.",
  },
  {
    title: "You become the integrator",
    worktree:
      "Five agents means five branches to rebase, five copies of the repo, and a dev server that is not the tree you will push.",
    wcp: "The tree stays dirty while anyone is in in-progress/. The last agent, with nothing left to do, commits once and pushes origin/dev.",
  },
] as const;

function Card({
  id,
  who,
  title,
  path,
}: {
  id: string;
  who: string;
  title: string;
  path?: string;
}) {
  return (
    <li className="rounded-md bg-surface px-3 py-2.5 shadow-[var(--shadow-border)]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-fg">{id}</span>
        <span className="truncate font-mono text-[11px] text-subtle">{who}</span>
      </div>
      <div className="mt-1 text-sm text-fg">{title}</div>
      {path ? <div className="mt-1 font-mono text-[11px] break-all text-muted">{path}</div> : null}
    </li>
  );
}

function Column({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg bg-surface-2 px-3 py-3 sm:px-4">
      <h3 className="font-mono text-xs text-accent">{name}</h3>
      <ul className="mt-3 space-y-2">{children}</ul>
    </section>
  );
}

function StatusRow({ name, folder, text }: { name: string; folder: string; text: string }) {
  return (
    <li className="grid gap-1 py-4 sm:grid-cols-[10rem_16rem_1fr] sm:items-baseline sm:gap-6">
      <div className="text-fg">{name}</div>
      <div className="font-mono text-sm text-accent">{folder}</div>
      <p className="text-muted">{text}</p>
    </li>
  );
}

export function Home() {
  useEffect(() => {
    document.title = "Water Cooler Protocol";
  }, []);

  return (
    <Shell>
      <main>
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-10 sm:pt-24 sm:pb-14">
          <p className="stagger-in font-mono text-xs tracking-wider text-accent uppercase" style={{ animationDelay: "40ms" }}>
            Issue files · local dev
          </p>
          <h1
            className="stagger-in mt-5 max-w-4xl font-display text-5xl leading-[1.05] font-extrabold tracking-[-0.04em] text-fg sm:text-6xl md:text-7xl"
            style={{ animationDelay: "80ms" }}
          >
            The issue folder is the protocol.
          </h1>
          <p className="stagger-in mt-6 max-w-2xl text-lg leading-relaxed text-muted" style={{ animationDelay: "140ms" }}>
            Many coding agents share one local <span className="font-mono text-fg">dev</span> checkout. There is no daemon
            and no <span className="font-mono text-fg">wcp</span> binary. The files under{" "}
            <span className="font-mono text-fg">.wcp/issues/</span> are the whole protocol.
          </p>
          <div className="stagger-in mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "200ms" }}>
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-fg px-5 text-sm font-medium text-bg transition-transform duration-150 ease-out hover:opacity-90 active:scale-[0.96]"
              href="/spec"
            >
              Read the spec
              <ArrowRight />
            </a>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-5 text-sm font-medium text-fg shadow-[var(--shadow-border)] transition-[box-shadow,transform] duration-150 ease-out hover:shadow-[var(--shadow-border-hover)] active:scale-[0.96]"
            >
              GitHub
            </a>
          </div>
        </section>

        <section id="queue" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-20">
          <h2 className="font-display text-2xl font-bold tracking-[-0.03em] text-fg sm:text-3xl">The queue</h2>
          <p className="mt-2 max-w-xl text-muted">
            An agent moves an issue from <span className="font-mono text-fg">open/</span> to{" "}
            <span className="font-mono text-fg">in-progress/</span>, lists the files it touches, and moves it to{" "}
            <span className="font-mono text-fg">done/</span> when the writing is finished. A quiet run pushes{" "}
            <span className="font-mono text-fg">origin/dev</span> and moves those issues to{" "}
            <span className="font-mono text-fg">deployed-dev/</span>. A later run moves them to{" "}
            <span className="font-mono text-fg">deployed-main/</span> only after that commit is on{" "}
            <span className="font-mono text-fg">origin/main</span>.
          </p>
          <div className="mt-6">
            <div className="rounded-xl bg-surface p-2 shadow-[var(--shadow-border)] sm:p-3">
              <div className="rounded-lg bg-surface-2 px-4 py-3 sm:px-5 sm:py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
                    <span className="text-fg">.wcp/issues</span>
                    <span aria-hidden="true" className="text-subtle">/</span>
                    <span>dev</span>
                    <span aria-hidden="true" className="text-subtle">·</span>
                    <span>no daemon</span>
                  </div>
                  <span className="font-mono text-xs text-subtle tabular-nums">in-progress 2</span>
                </div>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <Column name="open">
                  <Card id="0125" who="—" title="Read current session" />
                </Column>
                <Column name="in-progress">
                  <Card id="0123" who="auth-1" title="Rotate refresh token" path="src/auth/session.ts" />
                  <Card id="0124" who="ui-2" title="Dashboard empty state" path="src/routes/dashboard.tsx" />
                </Column>
                <Column name="done">
                  <li className="py-4 font-mono text-xs text-subtle">empty</li>
                </Column>
                <Column name="deployed-dev">
                  <li className="py-4 font-mono text-xs text-subtle">empty</li>
                </Column>
                <Column name="deployed-main">
                  <li className="py-4 font-mono text-xs text-subtle">empty</li>
                </Column>
              </div>
              <p className="mt-3 px-1 font-mono text-[11px] tracking-wider text-subtle uppercase">Side doors</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <section className="rounded-lg bg-surface-2 px-3 py-3 sm:px-4">
                  <h3 className="font-mono text-xs text-accent">blocked</h3>
                  <p className="mt-2 text-sm text-muted">Still wanted. Do not pick it up.</p>
                  <p className="mt-2 font-mono text-xs text-subtle">empty</p>
                </section>
                <section className="rounded-lg bg-surface-2 px-3 py-3 sm:px-4">
                  <h3 className="font-mono text-xs text-accent">canceled</h3>
                  <p className="mt-2 text-sm text-muted">Will not be done.</p>
                  <p className="mt-2 font-mono text-xs text-subtle">empty</p>
                </section>
              </div>
              <p className="mt-3 px-1 text-sm text-subtle">
                <span className="font-mono text-muted">in-review</span> is retired. A file left there means the writing is
                finished. The next agent moves it to <span className="font-mono">done/</span>.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-4 py-3 font-mono text-xs sm:px-5">
                <span className="text-subtle">$</span>
                <span className="text-fg">read .wcp/issues/in-progress/</span>
              </div>
            </div>
          </div>
        </section>

        <section id="worktrees" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <p className="font-mono text-xs tracking-wider text-subtle uppercase">Solo, several agents</p>
            <h2 className="mt-3 max-w-3xl font-display text-2xl font-bold tracking-[-0.03em] sm:text-3xl">
              Worktrees isolate the wrong thing.
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">
              A worktree gives each agent its own checkout so they cannot step on each other. That helps until you are
              the person who has to put the pieces back. You are one developer. The agents are writing the same product,
              on the same machine, toward the same <span className="font-mono text-fg">dev</span> branch. The isolation is
              a merge you will do tonight.
            </p>
            <ul className="mt-10 divide-y divide-border border-y border-border">
              {comparisons.map((row) => (
                <li key={row.title} className="grid gap-6 py-8 lg:grid-cols-[16rem_1fr_1fr] lg:gap-10">
                  <h3 className="font-medium text-fg">{row.title}</h3>
                  <div>
                    <p className="font-mono text-xs tracking-wider text-subtle uppercase">Worktree</p>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{row.worktree}</p>
                  </div>
                  <div>
                    <p className="font-mono text-xs tracking-wider text-accent uppercase">wcp</p>
                    <p className="mt-2 text-sm leading-relaxed text-fg">{row.wcp}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-8 max-w-2xl text-sm leading-relaxed text-muted">
              Use a worktree for a branch you might delete. Use this when the work is supposed to land together. There
              is still no daemon. The folder is the lock, and agents have to read it.
            </p>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <p className="font-mono text-xs tracking-wider text-subtle uppercase">Seven live statuses</p>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] sm:text-3xl">The folder is the status.</h2>
            <p className="mt-3 max-w-2xl text-muted">
              The main chain is five folders. Two side doors sit beside it. <span className="font-mono text-fg">in-review</span>{" "}
              is retired.
            </p>
            <h3 className="mt-10 font-mono text-xs tracking-wider text-subtle uppercase">Main chain</h3>
            <ul className="mt-3 divide-y divide-border">
              {chain.map(([name, folder, text]) => (
                <StatusRow key={name} name={name} folder={folder} text={text} />
              ))}
            </ul>
            <h3 className="mt-10 font-mono text-xs tracking-wider text-subtle uppercase">Side doors</h3>
            <ul className="mt-3 divide-y divide-border">
              {doors.map(([name, folder, text]) => (
                <StatusRow key={name} name={name} folder={folder} text={text} />
              ))}
            </ul>
            <p className="mt-8 max-w-2xl text-sm leading-relaxed text-muted">
              <span className="font-mono text-fg">open/</span>, <span className="font-mono text-fg">in-progress/</span>, and{" "}
              <span className="font-mono text-fg">blocked/</span> stay flat. <span className="font-mono text-fg">done/</span>,{" "}
              <span className="font-mono text-fg">deployed-dev/</span>, <span className="font-mono text-fg">deployed-main/</span>,
              and <span className="font-mono text-fg">canceled/</span> are filed by the issue’s created day. The filename never
              changes when the status moves.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
              A file left in <span className="font-mono text-fg">in-review/</span> means the writing is finished. The next
              agent moves it to <span className="font-mono text-fg">done/</span>.
            </p>
          </div>
        </section>

        <section id="run" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <p className="font-mono text-xs tracking-wider text-subtle uppercase">One issue at a time</p>
            <h2 className="mt-3 max-w-2xl font-display text-2xl font-bold tracking-[-0.03em] sm:text-3xl">The run</h2>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-xl bg-border shadow-[var(--shadow-border)] sm:grid-cols-2 lg:grid-cols-3">
              {steps.map(([n, name, text]) => (
                <li key={n} className="bg-surface px-5 py-6">
                  <div className="font-mono text-xs text-subtle">{n}</div>
                  <div className="mt-3 font-mono text-sm text-accent">{name}</div>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
                </li>
              ))}
            </ol>
            <p className="mt-8 max-w-2xl text-sm leading-relaxed text-muted">
              A later run moves an issue to <span className="font-mono text-fg">deployed-main/</span> only after that commit
              is on <span className="font-mono text-fg">origin/main</span>. A crashed agent leaves an issue in{" "}
              <span className="font-mono text-fg">in-progress/</span>. The next agent moves it back to{" "}
              <span className="font-mono text-fg">open/</span> when the work has stopped, and clears{" "}
              <span className="font-mono text-fg">assignee</span>.
            </p>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Issue file</h2>
              <p className="mt-3 text-muted">
                The filename is <span className="font-mono text-fg">YYYYMMDDThhmmZ-&lt;id&gt;-&lt;slug&gt;.md</span>. The
                body under the frontmatter is the spec. <span className="font-mono text-fg">dev</span> and{" "}
                <span className="font-mono text-fg">main</span> stay empty until those commits exist.
              </p>
              <CopyBlock code={issueFile} />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Tracker</h2>
              <p className="mt-3 text-muted">
                wcp issues are always managed here. <span className="font-mono text-fg">.wcp/tracker.md</span> may name{" "}
                <span className="font-mono text-fg">notion</span>, <span className="font-mono text-fg">linear</span>,{" "}
                <span className="font-mono text-fg">jira</span>, another tool, or{" "}
                <span className="font-mono text-fg">none</span>. A missing file means this folder is the only queue.
              </p>
              <CopyBlock code={trackerFile} />
            </div>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <p className="font-mono text-xs tracking-wider text-subtle uppercase">What this is not</p>
            <ul className="mt-6 grid gap-px overflow-hidden rounded-xl bg-border shadow-[var(--shadow-border)] sm:grid-cols-2">
              <li className="bg-surface px-5 py-6">
                <h3 className="font-medium text-fg">Not a daemon</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  There is no wcp binary, no socket, and no lease command. The issue files are the protocol. Agents edit
                  them.
                </p>
              </li>
              <li className="bg-surface px-5 py-6">
                <h3 className="font-medium text-fg">Not a second queue</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Notion, Linear, or Jira can mirror the same updates. The file is written first. A failed mirror does not
                  undo it.
                </p>
              </li>
              <li className="bg-surface px-5 py-6">
                <h3 className="font-medium text-fg">Not a rewind</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Do not reset, checkout, or stash. Another agent’s uncommitted work stays. Your edit builds on it.
                </p>
              </li>
              <li className="bg-surface px-5 py-6">
                <h3 className="font-medium text-fg">Not a chat system</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  The folder is who is editing what. Occupancy is the issue’s path, not a thread.
                </p>
              </li>
            </ul>
          </div>
        </section>

        <section id="skill" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <p className="font-mono text-xs tracking-wider text-subtle uppercase">Paste into the app</p>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] sm:text-3xl">AGENTS.md</h2>
            <p className="mt-3 max-w-2xl text-muted">
              Load the skill <span className="font-mono text-fg">water-cooler-protocol</span>. The spec and the skill stay
              in agreement.
            </p>
            <CopyBlock code={agentsSnippet} className="mt-6" />
            <a className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm text-fg" href="/spec">
              Full protocol
              <ArrowRight />
            </a>
          </div>
        </section>
      </main>
    </Shell>
  );
}
