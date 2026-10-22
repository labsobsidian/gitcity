"use client";

import { useState } from "react";
import { languageOf } from "@/lib/languages";
import { formatBytes, formatCount } from "@/lib/format";
import type { ExclusionReason, RepoSummary, RepoTree } from "@/lib/types";
import { Chevron, Warning } from "./icons";

interface Props {
  summary: RepoSummary | null;
  tree: RepoTree;
  demo: boolean;
  demoName: string;
}

const REASON_LABEL: Record<ExclusionReason, string> = {
  ignoredDirectory: "in dependency/build folders",
  lockfile: "lockfiles",
  binary: "binary assets",
  generated: "generated/minified",
  oversized: "over 5 MB",
  notAFile: "submodules & links",
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-void/40 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">{label}</div>
      <div className="truncate text-lg font-semibold leading-tight text-ink">{value}</div>
      {sub && <div className="truncate font-mono text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

export function StatsPanel({ summary, tree, demo, demoName }: Props) {
  // Collapsed by default on phones so the city stays visible; one tap expands it.
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 640px)").matches);
  const { stats } = tree;
  const buildingsForFiles = tree.files.filter((f) => !f.cluster).length;
  const topLanguage = stats.languages[0] ? languageOf(stats.languages[0].id).name : "—";
  const primary = summary?.primaryLanguage ?? topLanguage;
  const totalBytes = stats.languages.reduce((n, l) => n + l.bytes, 0) || 1;
  const legend = stats.languages.slice(0, 7);
  const otherBytes = stats.languages.slice(7).reduce((n, l) => n + l.bytes, 0);
  const excluded = (Object.entries(stats.excludedByReason) as [ExclusionReason, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <section className="panel pointer-events-auto w-full rounded-2xl sm:w-[21rem]" aria-label="Repository statistics">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 rounded-2xl px-4 pb-2 pt-3 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {demo && <span className="rounded bg-violet/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-violet">Demo</span>}
            <h2 className="truncate font-mono text-sm font-semibold text-ink">{summary?.fullName ?? demoName}</h2>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {demo ? "A fictional monorepo. Paste a repository to build yours." : summary?.description || "No description"}
          </p>
          {summary && (
            <p className="mt-1 font-mono text-[10px] text-dim">
              {summary.ref} · {summary.commitSha.slice(0, 7)} · ★ {formatCount(summary.stars)}
              {summary.archived ? " · archived" : ""}
            </p>
          )}
        </div>
        <Chevron className={`mt-1 shrink-0 text-dim transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Files visualized"
              value={formatCount(buildingsForFiles)}
              sub={stats.clusteredFiles ? `+${formatCount(stats.clusteredFiles)} in clusters` : `of ${formatCount(stats.includedFiles)} source files`}
            />
            <Stat label="Directories" value={formatCount(stats.directories)} sub={`${formatCount(tree.files.length)} buildings`} />
            <Stat label="Primary language" value={primary} sub={summary?.primaryLanguage ? "per GitHub" : "by bytes"} />
            {/* GitHub reports size 0 until it has computed it (e.g. brand-new repos); fall back to what we mapped. */}
            <Stat
              label="Repository size"
              value={summary && summary.sizeKb > 0 ? formatBytes(summary.sizeKb * 1024) : formatBytes(stats.includedBytes)}
              sub={summary && summary.sizeKb > 0 ? `${formatBytes(stats.includedBytes)} mapped` : "source mapped"}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Languages</span>
              <span className="font-mono text-[10px] text-muted">{stats.languages.length} represented</span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-void" aria-hidden="true">
              {legend.map((l) => (
                <span key={l.id} style={{ width: `${(l.bytes / totalBytes) * 100}%`, background: languageOf(l.id).color }} />
              ))}
              {otherBytes > 0 && <span style={{ width: `${(otherBytes / totalBytes) * 100}%` }} className="bg-dim" />}
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              {legend.map((l) => {
                const lang = languageOf(l.id);
                return (
                  <li key={l.id} className="flex min-w-0 items-center gap-1.5 text-xs">
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: lang.color, boxShadow: `0 0 8px ${lang.color}` }} />
                    <span className="truncate text-ink/90">{lang.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-dim">{((l.bytes / totalBytes) * 100).toFixed(l.bytes / totalBytes < 0.1 ? 1 : 0)}%</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {(tree.truncated || tree.simplified) && (
            <div className="space-y-1.5">
              {tree.truncated && (
                <p className="flex gap-2 rounded-lg border border-amber/30 bg-amber/10 px-2.5 py-2 text-xs text-amber">
                  <Warning className="mt-px shrink-0" width={14} height={14} />
                  <span>
                    GitHub truncated this repository&apos;s file list, so the city shows only part of it ({formatCount(stats.treeEntries)} entries
                    returned).
                  </span>
                </p>
              )}
              {tree.simplified && (
                <p className="flex gap-2 rounded-lg border border-cyan/25 bg-cyan/10 px-2.5 py-2 text-xs text-cyan">
                  <Warning className="mt-px shrink-0" width={14} height={14} />
                  <span>
                    Simplified for speed: the {formatCount(stats.clusteredFiles)} smallest files are merged into grey cluster blocks (budget{" "}
                    {formatCount(tree.budget)} buildings).
                  </span>
                </p>
              )}
            </div>
          )}

          {excluded.length > 0 && (
            <p className="text-[11px] leading-relaxed text-dim">
              Skipped {formatCount(stats.excludedFiles)} files:{" "}
              {excluded.map(([reason, n], i) => (
                <span key={reason}>
                  {i > 0 && ", "}
                  {formatCount(n)} {REASON_LABEL[reason]}
                </span>
              ))}
              .
            </p>
          )}
        </div>
      )}
    </section>
  );
}
