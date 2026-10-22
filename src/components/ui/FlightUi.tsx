"use client";

import { useSyncExternalStore } from "react";
import { languageOf } from "@/lib/languages";
import { formatBytes } from "@/lib/format";
import type { CityModel } from "@/lib/city/types";
import type { FlyState, Store } from "../scene/input";
import { Close } from "./icons";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.6rem] items-center justify-center rounded-md border border-line bg-void/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
      {children}
    </kbd>
  );
}

function Row({ keys, label }: { keys: React.ReactNode[]; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="flex shrink-0 items-center gap-1">{keys}</span>
    </li>
  );
}

/** Crosshair, target readout and flight instruments while in fly mode. */
export function FlyHud({ store, city, onLand }: { store: Store<FlyState>; city: CityModel; onLand(): void }) {
  const s = useSyncExternalStore(store.subscribe, store.get, store.get);
  const aim = s.aim >= 0 ? city.buildings[s.aim] : undefined;
  const aimColor = aim ? (aim.cluster ? "#7a8ca3" : languageOf(aim.language).color) : undefined;

  return (
    <>
      <div className="pointer-events-none fixed left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
        <div
          className="relative h-8 w-8 rounded-full border transition-colors"
          style={{ borderColor: aimColor ?? "rgb(230 241 245 / 0.45)", boxShadow: aimColor ? `0 0 14px ${aimColor}` : undefined }}
        >
          <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: aimColor ?? "#e6f1f5" }} />
        </div>
        {aim && (
          <div className="panel absolute left-1/2 top-11 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1 text-center">
            <div className="font-mono text-xs font-semibold text-ink">{aim.name}</div>
            <div className="font-mono text-[10px] text-dim">
              {formatBytes(aim.size)} · {s.locked ? "click to inspect" : "aim"}
            </div>
          </div>
        )}
      </div>

      <section className="panel pointer-events-auto rise-in flex w-full max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-2.5" aria-label="Flight controls">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald shadow-[0_0_10px_#31e6b0]" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald">Fly mode</span>
        </div>
        {s.locked ? (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <li className="flex items-center gap-1"><Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd> fly</li>
            <li className="flex items-center gap-1"><Kbd>Space</Kbd>/<Kbd>C</Kbd> up/down</li>
            <li className="flex items-center gap-1"><Kbd>Shift</Kbd> boost</li>
            <li className="flex items-center gap-1"><Kbd>Esc</Kbd> free mouse</li>
          </ul>
        ) : (
          <p className="text-xs text-ink">
            <span className="text-emerald">Click the city</span> to steer with your mouse — or drag to look around.
          </p>
        )}
        <div className="ml-auto flex items-center gap-3 font-mono text-[11px] text-muted">
          <span title="Speed (scroll to change)">
            SPD <span className="text-ink">{s.speed}</span> m/s <span className="text-cyan">×{s.speedFactor.toFixed(1)}</span>
          </span>
          <span>
            ALT <span className="text-ink">{s.altitude}</span> m
          </span>
          <button type="button" onClick={onLand} className="rounded-lg border border-line px-2.5 py-1 font-display text-xs text-ink hover:border-emerald/50 hover:bg-emerald/10">
            Land <Kbd>F</Kbd>
          </button>
        </div>
      </section>
    </>
  );
}

/** Cheat sheet for mouse and keyboard controls in both modes. */
export function ControlsHelp({ onClose }: { onClose(): void }) {
  return (
    <section className="panel rise-in pointer-events-auto w-full max-w-xl rounded-2xl p-4" aria-label="Controls">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Controls</h2>
        <button type="button" onClick={onClose} className="icon-btn h-8 w-8" aria-label="Close controls help">
          <Close width={16} height={16} />
        </button>
      </div>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald">Explore</h3>
          <ul className="divide-y divide-line">
            <Row label="Orbit · pan · zoom" keys={[<Kbd key="a">Drag</Kbd>, <Kbd key="b">Right-drag</Kbd>, <Kbd key="c">Scroll</Kbd>]} />
            <Row label="Move across the city" keys={[<Kbd key="w">W</Kbd>, <Kbd key="a">A</Kbd>, <Kbd key="s">S</Kbd>, <Kbd key="d">D</Kbd>]} />
            <Row label="Turn" keys={[<Kbd key="q">Q</Kbd>, <Kbd key="e">E</Kbd>]} />
            <Row label="Tilt top-down / to horizon" keys={[<Kbd key="t">T</Kbd>, <Kbd key="g">G</Kbd>]} />
            <Row label="Zoom in / out" keys={[<Kbd key="z">Z</Kbd>, <Kbd key="x">X</Kbd>]} />
            <Row label="Fly to a building" keys={[<Kbd key="dbl">Double-click</Kbd>]} />
            <Row label="Faster" keys={[<Kbd key="s">Shift</Kbd>]} />
            <Row label="Reset view" keys={[<Kbd key="h">H</Kbd>]} />
          </ul>
        </div>
        <div>
          <h3 className="mb-1 mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan sm:mt-0">Fly mode</h3>
          <ul className="divide-y divide-line">
            <Row label="Take off / land" keys={[<Kbd key="f">F</Kbd>]} />
            <Row label="Steer with the mouse" keys={[<Kbd key="c">Click</Kbd>]} />
            <Row label="Fly" keys={[<Kbd key="w">W</Kbd>, <Kbd key="a">A</Kbd>, <Kbd key="s">S</Kbd>, <Kbd key="d">D</Kbd>]} />
            <Row label="Up / down" keys={[<Kbd key="sp">Space</Kbd>, <Kbd key="c2">C</Kbd>]} />
            <Row label="Boost · cruise speed" keys={[<Kbd key="sh">Shift</Kbd>, <Kbd key="sc">Scroll</Kbd>]} />
            <Row label="Inspect building in sights" keys={[<Kbd key="cl">Click</Kbd>]} />
            <Row label="Free the mouse" keys={[<Kbd key="esc">Esc</Kbd>]} />
          </ul>
          <h3 className="mb-1 mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">Anywhere</h3>
          <ul className="divide-y divide-line">
            <Row label="Labels · auto-orbit · this help" keys={[<Kbd key="l">L</Kbd>, <Kbd key="o">O</Kbd>, <Kbd key="q">?</Kbd>]} />
          </ul>
        </div>
      </div>
    </section>
  );
}
