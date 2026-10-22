"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ClientError, fetchSummary, fetchTree } from "@/lib/client/api";
import { DEMO_NAME, demoFiles } from "@/lib/city/demo";
import { generateCity } from "@/lib/city/generate";
import type { CityModel } from "@/lib/city/types";
import { normalizeTree } from "@/lib/github/normalize";
import { formatRepoRef, parseRepoInput } from "@/lib/github/parse-url";
import type { ApiErrorCode, RepoSummary, RepoTree } from "@/lib/types";
import type { CameraApi } from "./scene/CameraRig";
import { createHoverStore } from "./scene/hoverStore";
import { cityLabels, createLabelRegistry } from "./scene/labels";
import { ControlsDock } from "./ui/ControlsDock";
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

interface CityData {
  key: string;
  city: CityModel;
  tree: RepoTree;
  summary: RepoSummary | null;
  demo: boolean;
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
  return { key: "demo", city: generateCity({ name: DEMO_NAME, files: normalized }), tree, summary: null, demo: true };
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
  const reducedMotion = useReducedMotion();
  const hoverStore = useMemo(createHoverStore, []);
  const labelRegistry = useMemo(createLabelRegistry, []);
  const cameraRef = useRef<CameraApi | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (input: string, options: { updateUrl?: boolean } = {}) => {
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
      const city = generateCity({ name: summary.fullName, files: tree.files });
      setSelected(null);
      setData({ key: `${summary.fullName}@${summary.commitSha}#${tree.budget}`, city, tree, summary, demo: false });
      setPhase({ kind: "idle" });
      if (options.updateUrl !== false) {
        const url = new URL(window.location.href);
        url.searchParams.set("repo", formatRepoRef({ owner: summary.owner, repo: summary.repo, ref: parsed.value.ref }));
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
    if (repo) void load(repo, { updateUrl: false });
    return () => abortRef.current?.abort();
  }, [load]);

  const cancel = () => {
    abortRef.current?.abort();
    setPhase({ kind: "idle" });
  };

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const cam = cameraRef.current;
      switch (e.key) {
        case "Escape":
          setSelected(null);
          break;
        case "r":
        case "R":
          cam?.reset();
          break;
        case "l":
        case "L":
          setShowLabels((v) => !v);
          break;
        case "o":
        case "O":
          setAutoRotate((v) => !v);
          break;
        case "+":
        case "=":
          cam?.zoom(1);
          break;
        case "-":
        case "_":
          cam?.zoom(-1);
          break;
        case "q":
        case "Q":
          cam?.rotate(-1);
          break;
        case "e":
        case "E":
          cam?.rotate(1);
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSelect = useCallback((index: number | null) => setSelected(index), []);
  const building = selected !== null ? data.city.buildings[selected] : undefined;
  const loading = phase.kind === "loading";
  const labels = useMemo(
    () => (heroOpen ? [] : cityLabels(data.city, selected, showLabels)),
    [data.city, selected, showLabels, heroOpen],
  );

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-void">
      <div className="absolute inset-0">
        <CityScene
          city={data.city}
          cityKey={data.key}
          selected={selected}
          labelRegistry={labelRegistry}
          autoRotate={autoRotate}
          scanning={loading}
          reducedMotion={reducedMotion}
          hoverStore={hoverStore}
          cameraRef={cameraRef}
          onSelect={onSelect}
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
              <StatsPanel summary={data.summary} tree={data.tree} demo={data.demo} demoName={DEMO_NAME} />
            </div>
          )}

          <div className="flex-1" />

          {building && (
            <div className="absolute inset-x-0 bottom-16 z-10 sm:static sm:inset-auto">
              <Inspector
                building={building}
                district={data.city.districts[building.districtIndex]}
                summary={data.summary}
                onClose={() => setSelected(null)}
                onFocus={() => cameraRef.current?.focus(building)}
              />
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex items-end justify-center sm:inset-x-4 sm:bottom-4">
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
            onZoom={(d) => cameraRef.current?.zoom(d)}
            onRotate={(d) => cameraRef.current?.rotate(d)}
            onReset={() => cameraRef.current?.reset()}
            onToggleLabels={() => setShowLabels((v) => !v)}
            onToggleAutoRotate={() => setAutoRotate((v) => !v)}
          />
        </div>
      </div>

      <HoverTooltip store={hoverStore} city={data.city} />
    </main>
  );
}
