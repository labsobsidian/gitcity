"use client";

import { formatBytes } from "@/lib/format";
import type { ApiErrorCode } from "@/lib/types";
import { Check, Close, Spark, Warning } from "./icons";

export type LoadingStage = "resolve" | "tree" | "build";

export const EXAMPLES = ["vercel/next.js", "facebook/react", "pmndrs/react-three-fiber", "denoland/deno", "torvalds/linux"];

export function Hero({ onExample, onDismiss }: { onExample(repo: string): void; onDismiss(): void }) {
  return (
    <section className="panel rise-in pointer-events-auto w-full max-w-xl rounded-3xl p-5 sm:p-7" aria-labelledby="hero-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-emerald">GitCity v0.1</p>
          <h1 id="hero-title" className="mt-1 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Every codebase has a <span className="text-emerald glow-text">skyline</span>.
          </h1>
        </div>
        <button type="button" onClick={onDismiss} className="icon-btn -mr-2 -mt-2 shrink-0" aria-label="Explore the demo city">
          <Close />
        </button>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Paste any public GitHub repository above and watch it rise as a living city. Directories become districts, files become
        buildings — taller for bigger files, lit by their language.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ["Directory", "District"],
          ["File", "Building"],
          ["Size", "Height"],
          ["Language", "Color"],
        ].map(([from, to]) => (
          <div key={from} className="rounded-xl border border-line bg-void/50 px-2.5 py-2">
            <div className="text-dim">{from}</div>
            <div className="font-semibold text-ink">→ {to}</div>
          </div>
        ))}
      </div>
      <div className="mt-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Try one</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((repo) => (
            <button
              key={repo}
              type="button"
              onClick={() => onExample(repo)}
              className="rounded-full border border-line bg-void/50 px-3 py-1.5 font-mono text-xs text-ink transition hover:border-emerald/50 hover:bg-emerald/10 hover:text-emerald"
            >
              {repo}
            </button>
          ))}
        </div>
      </div>
      <button type="button" onClick={onDismiss} className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
        <Spark width={14} height={14} /> Or explore the demo city — drag to orbit, WASD to move, F to fly, ? for all controls.
      </button>
    </section>
  );
}

const STAGES: { id: LoadingStage; label: string }[] = [
  { id: "resolve", label: "Resolving repository" },
  { id: "tree", label: "Downloading file tree" },
  { id: "build", label: "Laying out districts & raising buildings" },
];

export function LoadingCard({ target, stage, received, detail, onCancel }: { target: string; stage: LoadingStage; received: number; detail: string | null; onCancel(): void }) {
  const current = STAGES.findIndex((s) => s.id === stage);
  return (
    <section className="panel rise-in pointer-events-auto w-full max-w-sm rounded-2xl p-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-emerald">Generating city</p>
          <p className="truncate font-mono text-sm text-ink">{target}</p>
        </div>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-ink">
          Cancel
        </button>
      </div>
      <div className="scan-bar relative mt-3 h-0.5 overflow-hidden rounded-full bg-line" aria-hidden="true" />
      <ol className="mt-3 space-y-1.5">
        {STAGES.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.id} className={`flex items-center gap-2 text-xs ${done ? "text-muted" : active ? "text-ink" : "text-dim"}`}>
              <span
                className={`grid h-4 w-4 place-items-center rounded-full border ${
                  done ? "border-emerald/60 bg-emerald/15 text-emerald" : active ? "border-cyan/70 text-cyan" : "border-line"
                }`}
              >
                {done ? <Check width={10} height={10} /> : active ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" /> : null}
              </span>
              <span>{s.label}</span>
              {active && s.id === "tree" && received > 0 && <span className="ml-auto font-mono text-[10px] text-cyan">{formatBytes(received)}</span>}
              {done && s.id === "resolve" && detail && <span className="ml-auto truncate font-mono text-[10px] text-dim">{detail}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const ERROR_TITLE: Record<ApiErrorCode, string> = {
  INVALID_URL: "That's not a GitHub repository link",
  NOT_FOUND: "Repository not found",
  PRIVATE: "This repository is private",
  REF_NOT_FOUND: "Branch or tag not found",
  EMPTY: "Nothing to build here",
  RATE_LIMITED: "GitHub rate limit reached",
  THROTTLED: "Slow down a little",
  FORBIDDEN: "GitHub won't serve this repository",
  TOO_LARGE: "This repository is too large",
  UPSTREAM: "GitHub had a problem",
  BAD_RESPONSE: "Unexpected response",
  NETWORK: "Connection problem",
  TIMEOUT: "GitHub took too long",
};

export function ErrorCard({
  code,
  message,
  resetAt,
  onRetry,
  onDismiss,
}: {
  code: ApiErrorCode;
  message: string;
  resetAt?: Date;
  onRetry?: () => void;
  onDismiss(): void;
}) {
  const retryable = !["INVALID_URL", "NOT_FOUND", "PRIVATE", "REF_NOT_FOUND", "EMPTY", "TOO_LARGE", "FORBIDDEN"].includes(code);
  return (
    <section className="panel rise-in pointer-events-auto w-full max-w-md rounded-2xl border-danger/30 p-4" role="alert">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-danger/15 text-danger">
          <Warning />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-ink">{ERROR_TITLE[code] ?? "Something went wrong"}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{message}</p>
          {resetAt && (
            <p className="mt-1 font-mono text-xs text-amber">
              Try again after {resetAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
            </p>
          )}
          {code === "INVALID_URL" && (
            <p className="mt-1 font-mono text-xs text-dim">Example: https://github.com/vercel/next.js or vercel/next.js</p>
          )}
          <div className="mt-3 flex gap-2">
            {retryable && onRetry && (
              <button type="button" onClick={onRetry} className="btn-primary h-9 rounded-lg px-3 text-sm font-semibold">
                Try again
              </button>
            )}
            <button type="button" onClick={onDismiss} className="h-9 rounded-lg border border-line px-3 text-sm text-ink hover:bg-white/5">
              Back to the city
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
