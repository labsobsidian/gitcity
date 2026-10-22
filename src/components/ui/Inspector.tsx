"use client";

import { languageOf } from "@/lib/languages";
import { formatBytes, formatCount, githubBlobUrl, githubTreeUrl } from "@/lib/format";
import type { Building, District } from "@/lib/city/types";
import type { RepoSummary } from "@/lib/types";
import { Close, External, Target } from "./icons";

interface Props {
  building: Building;
  district: District | undefined;
  summary: RepoSummary | null;
  onClose(): void;
  onFocus(): void;
}

const FLOOR_HEIGHT = 0.62;

export function Inspector({ building, district, summary, onClose, onFocus }: Props) {
  const lang = languageOf(building.language);
  const isCluster = Boolean(building.cluster);
  const href = summary
    ? isCluster
      ? githubTreeUrl(summary.htmlUrl, summary.commitSha, building.dir)
      : githubBlobUrl(summary.htmlUrl, summary.commitSha, building.path)
    : null;
  const districtLabel = district ? (district.depth === 0 ? "City center (root)" : district.path) : "—";

  return (
    <aside
      className="panel rise-in pointer-events-auto w-full rounded-2xl p-4 sm:w-[22rem]"
      aria-label="Building inspector"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
          style={{ borderColor: `${lang.color}66`, background: `${lang.color}1a`, boxShadow: `0 0 18px -4px ${lang.color}` }}
          aria-hidden="true"
        >
          <span className="h-4 w-3 rounded-[2px]" style={{ background: isCluster ? "#4b6275" : lang.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">{isCluster ? "Cluster block" : "Building"}</p>
          <h2 className="break-all font-mono text-base font-semibold leading-snug text-ink">{building.name}</h2>
        </div>
        <button type="button" onClick={onClose} className="icon-btn -mr-1 -mt-1 h-8 w-8 shrink-0" aria-label="Close inspector">
          <Close width={16} height={16} />
        </button>
      </div>

      <p className="mt-2 break-all rounded-lg bg-void/60 px-2.5 py-1.5 font-mono text-[11px] text-muted">
        {isCluster ? `${building.dir || "/"} — ${formatCount(building.cluster!.count)} files merged` : building.path}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl border border-line bg-void/40 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-[0.14em] text-dim">{isCluster ? "Combined size" : "File size"}</dt>
          <dd className="font-semibold text-ink">{formatBytes(building.size)}</dd>
          <dd className="font-mono text-[10px] text-dim">{formatCount(building.size)} bytes</dd>
        </div>
        <div className="rounded-xl border border-line bg-void/40 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-[0.14em] text-dim">Language</dt>
          <dd className="flex items-center gap-1.5 font-semibold text-ink">
            <span className="h-2 w-2 rounded-sm" style={{ background: isCluster ? "#4b6275" : lang.color }} />
            {isCluster ? "Mixed" : lang.name}
          </dd>
          <dd className="font-mono text-[10px] text-dim">{isCluster ? "small files" : `${Math.max(1, Math.round(building.height / FLOOR_HEIGHT))} floors`}</dd>
        </div>
        <div className="col-span-2 rounded-xl border border-line bg-void/40 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-[0.14em] text-dim">District</dt>
          <dd className="break-all font-mono text-xs text-ink">{districtLabel}</dd>
          {district && district.depth > 0 && (
            <dd className="font-mono text-[10px] text-dim">
              {formatCount(district.buildingCount)} buildings · {formatBytes(district.bytes)}
            </dd>
          )}
        </div>
      </dl>

      <div className="mt-3 flex gap-2">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold"
          >
            {isCluster ? "Browse on GitHub" : "Open on GitHub"}
            <External width={15} height={15} />
          </a>
        ) : (
          <span className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-line text-xs text-dim">
            Demo building — no GitHub file
          </span>
        )}
        <button
          type="button"
          onClick={onFocus}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm text-ink hover:border-cyan/50 hover:bg-cyan/10"
        >
          <Target width={15} height={15} />
          Fly to
        </button>
      </div>
    </aside>
  );
}
