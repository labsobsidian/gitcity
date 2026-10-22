"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ClientError, fetchSummary, fetchTree } from "@/lib/client/api";
import { DEMO_NAME, demoFiles } from "@/lib/city/demo";
import { generateCity } from "@/lib/city/generate";
import { buildProfile, type CityProfile, type ProfileMeta } from "@/lib/city/profile";
import type { CityModel } from "@/lib/city/types";
import { normalizeTree } from "@/lib/github/normalize";
import { formatRepoRef, parseRepoInput } from "@/lib/github/parse-url";
import type { ApiErrorCode, RepoSummary, RepoTree } from "@/lib/types";
import type { CameraApi } from "./scene/CameraRig";
import { createHoverStore } from "./scene/hoverStore";
import { createFlyStore, isTypingTarget, type Picker } from "./scene/input";
import { cityLabels, createLabelRegistry } from "./scene/labels";
import { ControlsDock } from "./ui/ControlsDock";
import { ControlsHelp, FlyHud } from "./ui/FlightUi";
import { HoverTooltip } from "./ui/HoverTooltip";
import { Inspector } from "./ui/Inspector";
import { LabelLayer } from "./ui/LabelLayer";
import { StatsPanel } from "./ui/StatsPanel";
import { ErrorCard, Hero, LoadingCard, type LoadingStage } from "./ui/StatusOverlays";
import { TopBar } from "./ui/TopBar";

const CityScene = dynamic(() => import("./scene/CityScene").then((m) => m.CityScene), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center font-mono text-xs text-dim">Booting renderer…</div>,
});

/** What was fetched. The profile and city are derived from it (plus the remix number). */
interface CityData {
  key: string;
  tree: RepoTree;
  summary: RepoSummary | null;
  meta: ProfileMeta;
  demo: boolean;
}

function buildCity(data: CityData, remix: number): { profile: CityProfile; city: CityModel } {
  const profile = buildProfile({ files: data.tree.files, languages: data.tree.stats.languages, meta: data.meta, remix });
  return { profile, city: generateCity({ name: data.meta.fullName, files: data.tree.files, profile }) };
}

function metaFrom(summary: RepoSummary): ProfileMeta {
  return {
    fullName: summary.fullName,
    description: summary.description,
    // Tolerate summaries cached before these fields existed.
    createdAt: summary.createdAt ?? null,
    pushedAt: summary.pushedAt ?? null,
    stars: summary.stars ?? 0,
    forks: summary.forks ?? 0,
    archived: summary.archived ?? false,
    topics: Array.isArray(summary.topics) ? summary.topics : [],
    avatarUrl: summary.avatarUrl ?? null,
  };
}

function remixFromUrl(): number {
  const raw = Number.parseInt(new URLSearchParams(window.location.search).get("remix") ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 9999) : 0;
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; target: string; stage: LoadingStage; received: number; detail: string | null }
  | { kind: "error"; code: ApiErrorCode; message: string; resetAt?: Date; input: string };

function buildDemo(): CityData {
  const files = demoFiles();
  const { files: normalized, stats, simplified } = normalizeTree(
    files.map((f) => ({ path: f.path, type: "blob", size: f.size })),
    6000,
  );
  const tree: RepoTree = { fullName: DEMO_NAME, commitSha: "0".repeat(40), truncated: false, simplified, budget: 6000, files: normalized, stats };
  const now = Date.now();
  const meta: ProfileMeta = {
    fullName: DEMO_NAME,
    description: "A fictional polyglot monorepo",
    createdAt: new Date(now - 3 * 365 * 86_400_000).toISOString(),
    pushedAt: new Date(now - 86_400_000).toISOString(),
    stars: 4200,
    forks: 310,
    archived: false,
    topics: ["monorepo", "demo", "gitcity"],
    avatarUrl: null,
  };
  return { key: "demo", tree, summary: null, meta, demo: true };
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(reducedMotionQuery);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

export function CityExperience() {
  const [data, setData] = useState<CityData>(buildDemo);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [heroOpen, setHeroOpen] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [inputValue, setInputValue] = useState("");
  const [flying, setFlying] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [remix, setRemix] = useState(0);
  const reducedMotion = useReducedMotion();
  const hoverStore = useMemo(createHoverStore, []);
  const labelRegistry = useMemo(createLabelRegistry, []);
  const flyStore = useMemo(createFlyStore, []);
  const picker = useRef<Picker | null>(null);
  const cameraRef = useRef<CameraApi | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (input: string, options: { updateUrl?: boolean; remix?: number } = {}) => {
    const parsed = parseRepoInput(input);
    if (!parsed.ok) {
      setInputValue(input);
      setPhase({ kind: "error", code: "INVALID_URL", message: parsed.reason, input });
      return;
    }
    const target = formatRepoRef(parsed.value);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setHeroOpen(false);
    setInputValue(target);
    setPhase({ kind: "loading", target, stage: "resolve", received: 0, detail: null });

    try {
      const summary = await fetchSummary(parsed.value, controller.signal);
      const detail = `${summary.ref} @ ${summary.commitSha.slice(0, 7)}`;
      setPhase({ kind: "loading", target: summary.fullName, stage: "tree", received: 0, detail });
      let lastReport = 0;
      const tree = await fetchTree(summary, controller.signal, (received) => {
        const now = performance.now();
        if (now - lastReport < 80) return;
        lastReport = now;
        setPhase((p) => (p.kind === "loading" ? { ...p, received } : p));
      });
      setPhase((p) => (p.kind === "loading" ? { ...p, stage: "build" } : p));
      // Let the loading card paint before the (synchronous) layout pass.
      await nextFrame();
      if (controller.signal.aborted) return;
      setSelected(null);
      setFlying(false);
      setRemix(options.remix ?? 0);
      setData({ key: `${summary.fullName}@${summary.commitSha}#${tree.budget}`, tree, summary, meta: metaFrom(summary), demo: false });
      setPhase({ kind: "idle" });
      if (options.updateUrl !== false) {
        const url = new URL(window.location.href);
        url.searchParams.set("repo", formatRepoRef({ owner: summary.owner, repo: summary.repo, ref: parsed.value.ref }));
        url.searchParams.delete("remix");
        window.history.replaceState(null, "", url);
      }
    } catch (error) {
      if (controller.signal.aborted || (error as { name?: string })?.name === "AbortError") return;
      const e = error instanceof ClientError ? error : new ClientError("UPSTREAM", "Something went wrong while building the city.");
      setPhase({ kind: "error", code: e.code, message: e.message, resetAt: e.resetAt, input });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  // Deep links: /?repo=owner/name
  useEffect(() => {
    const repo = new URLSearchParams(window.location.search).get("repo");
    if (repo) void load(repo, { updateUrl: false, remix: remixFromUrl() });
    return () => abortRef.current?.abort();
  }, [load]);

  const cancel = () => {
    abortRef.current?.abort();
    setPhase({ kind: "idle" });
  };

  const helpOpenRef = useRef(helpOpen);
  helpOpenRef.current = helpOpen;
  const applyRemixRef = useRef<(n: number) => void>(() => {});

  // Toggle shortcuts (ignored while typing). Camera movement keys are handled
  // continuously inside the camera rig.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      switch (e.key) {
        case "Escape":
          // Browsers release pointer lock on Esc themselves; here it closes help or deselects.
          if (helpOpenRef.current) setHelpOpen(false);
          else setSelected(null);
          break;
        case "h":
        case "H":
        case "r":
        case "R":
          cameraRef.current?.reset();
          break;
        case "l":
        case "L":
          setShowLabels((v) => !v);
          break;
        case "o":
        case "O":
          setAutoRotate((v) => !v);
          break;
        case "f":
        case "F":
          setHeroOpen(false);
          setFlying((v) => !v);
          break;
        case "?":
          setHelpOpen((v) => !v);
          break;
        case "m":
        case "M":
          applyRemixRef.current(remixRef.current + 1);
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const onSelect = useCallback((index: number | null) => setSelected(index), []);
  const built = useMemo(() => buildCity(data, remix), [data, remix]);
  const { city, profile } = built;
  const cityKey = `${data.key}~${remix}`;

  const applyRemix = useCallback((next: number) => {
    setRemix(next);
    setSelected(null);
    setFlying(false);
    const url = new URL(window.location.href);
    if (next > 0) url.searchParams.set("remix", String(next));
    else url.searchParams.delete("remix");
    window.history.replaceState(null, "", url);
  }, []);
  const remixRef = useRef(remix);
  remixRef.current = remix;
  applyRemixRef.current = applyRemix;
  const onFocusBuilding = useCallback(
    (index: number) => {
      const b = city.buildings[index];
      if (!b) return;
      setSelected(index);
      cameraRef.current?.focus(b);
    },
    [city],
  );
  const building = selected !== null ? city.buildings[selected] : undefined;
  const loading = phase.kind === "loading";
  const labels = useMemo(
    () => (heroOpen ? [] : cityLabels(city, selected, showLabels)),
    [city, selected, showLabels, heroOpen],
  );

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-void">
      <div className="absolute inset-0">
        <CityScene
          city={city}
          profile={profile}
          cityKey={cityKey}
          selected={selected}
          labelRegistry={labelRegistry}
          autoRotate={autoRotate}
          scanning={loading}
          reducedMotion={reducedMotion}
          hoverStore={hoverStore}
          cameraRef={cameraRef}
          flying={flying}
          flyStore={flyStore}
          picker={picker}
          onSelect={onSelect}
          onFocus={onFocusBuilding}
        />
      </div>

      <LabelLayer labels={labels} registry={labelRegistry} />

      {/* Overlay UI. The container ignores pointer events so the city stays draggable between panels. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-4">
        <TopBar
          initialValue={inputValue}
          busy={loading}
          repoUrl={data.summary?.htmlUrl ?? null}
          repoName={data.summary?.fullName ?? null}
          onSubmit={(v) => void load(v)}
        />

        <div className="relative flex min-h-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
          {!heroOpen && (
            <div className="max-h-full min-h-0 overflow-y-auto sm:max-h-[calc(100dvh-6rem)]">
              <StatsPanel
                summary={data.summary}
                tree={data.tree}
                demo={data.demo}
                demoName={DEMO_NAME}
                profile={profile}
                city={city}
                onRemix={() => applyRemix(remix + 1)}
                onOriginal={() => applyRemix(0)}
                onLandmark={(index) => onFocusBuilding(index)}
                onLandmarkDistrict={(x, z) => cameraRef.current?.lookAt(x, z)}
              />
            </div>
          )}

          <div className="flex-1" />

          {building && (
            <div className="absolute inset-x-0 bottom-16 z-10 sm:static sm:inset-auto">
              <Inspector
                building={building}
                district={city.districts[building.districtIndex]}
                summary={data.summary}
                onClose={() => setSelected(null)}
                onFocus={() => cameraRef.current?.focus(building)}
              />
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col items-center justify-end gap-3 sm:inset-x-4 sm:bottom-4 sm:items-start">
          {helpOpen && (
            <div className="flex w-full justify-center pb-16 sm:justify-start sm:pb-0">
              <ControlsHelp onClose={() => setHelpOpen(false)} />
            </div>
          )}
          {flying && phase.kind !== "loading" && (
            <div className="flex w-full justify-center pb-16 sm:justify-start sm:pb-0 sm:pr-[34rem]">
              <FlyHud store={flyStore} city={city} onLand={() => setFlying(false)} />
            </div>
          )}
          {heroOpen && phase.kind === "idle" && (
            <div className="flex w-full justify-center pb-16 sm:justify-start sm:pb-0">
              <Hero onExample={(repo) => void load(repo)} onDismiss={() => setHeroOpen(false)} />
            </div>
          )}
          {phase.kind === "loading" && (
            <div className="flex w-full justify-center pb-16 sm:pb-0">
              <LoadingCard target={phase.target} stage={phase.stage} received={phase.received} detail={phase.detail} onCancel={cancel} />
            </div>
          )}
          {phase.kind === "error" && (
            <div className="flex w-full justify-center pb-16 sm:pb-0">
              <ErrorCard
                code={phase.code}
                message={phase.message}
                resetAt={phase.resetAt}
                onRetry={() => void load(phase.input)}
                onDismiss={() => setPhase({ kind: "idle" })}
              />
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 sm:bottom-4 sm:left-auto sm:right-4 sm:translate-x-0">
          <ControlsDock
            showLabels={showLabels}
            autoRotate={autoRotate}
            flying={flying}
            helpOpen={helpOpen}
            onZoom={(d) => cameraRef.current?.zoom(d)}
            onRotate={(d) => cameraRef.current?.rotate(d)}
            onReset={() => cameraRef.current?.reset()}
            onToggleLabels={() => setShowLabels((v) => !v)}
            onToggleAutoRotate={() => setAutoRotate((v) => !v)}
            onToggleFly={() => {
              setHeroOpen(false);
              setFlying((v) => !v);
            }}
            onToggleHelp={() => setHelpOpen((v) => !v)}
          />
        </div>
      </div>

      <HoverTooltip store={hoverStore} city={city} />
    </main>
  );
}
