"use client";

import { useEffect, useState, type FormEvent } from "react";
import { GitHubMark, Logo } from "./icons";

interface Props {
  initialValue: string;
  busy: boolean;
  repoUrl: string | null;
  repoName: string | null;
  onSubmit(value: string): void;
}

export function TopBar({ initialValue, busy, repoUrl, repoName, onSubmit }: Props) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => setValue(initialValue), [initialValue]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(value);
  };

  return (
    <header className="pointer-events-auto panel flex items-center gap-2 rounded-2xl px-2.5 py-2 sm:gap-3 sm:px-3">
      <a href="/" className="flex shrink-0 items-center gap-2 rounded-lg pr-1" aria-label="GitCity home">
        <Logo />
        <span className="hidden text-lg font-semibold tracking-tight sm:inline">
          Git<span className="text-emerald glow-text">City</span>
        </span>
        <span className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-dim lg:inline">v0.1</span>
      </a>

      <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2" role="search">
        <label htmlFor="repo-input" className="sr-only">
          GitHub repository URL
        </label>
        <div className="relative min-w-0 flex-1">
          <input
            id="repo-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://github.com/owner/repository"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            inputMode="url"
            maxLength={400}
            className="h-10 w-full rounded-xl border border-line bg-void/70 px-3 font-mono text-sm text-ink placeholder:text-dim focus:border-emerald/50 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="btn-primary h-10 shrink-0 rounded-xl px-3 text-sm font-semibold sm:px-4"
        >
          <span className="sm:hidden">{busy ? "…" : "Go"}</span>
          <span className="hidden sm:inline">{busy ? "Generating…" : "Generate City"}</span>
        </button>
      </form>

      {repoUrl && (
        <a
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="icon-btn shrink-0"
          title={`Open ${repoName ?? "repository"} on GitHub`}
          aria-label={`Open ${repoName ?? "repository"} on GitHub`}
        >
          <GitHubMark />
        </a>
      )}
    </header>
  );
}
