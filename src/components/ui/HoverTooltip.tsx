"use client";

import { useSyncExternalStore } from "react";
import { languageOf } from "@/lib/languages";
import { formatBytes } from "@/lib/format";
import type { CityModel } from "@/lib/city/types";
import type { HoverStore } from "../scene/hoverStore";

/** Follows the pointer while hovering a building (mouse only; touch uses the inspector). */
export function HoverTooltip({ store, city }: { store: HoverStore; city: CityModel }) {
  const hover = useSyncExternalStore(store.subscribe, store.get, () => null);
  const building = hover ? city.buildings[hover.index] : undefined;
  if (!hover || !building) return null;
  const lang = languageOf(building.language);
  const flipX = typeof window !== "undefined" && hover.x > window.innerWidth - 300;
  return (
    <div
      className="panel pointer-events-none fixed z-30 hidden max-w-xs rounded-lg px-2.5 py-1.5 [@media(hover:hover)]:block"
      style={{
        left: hover.x + (flipX ? -14 : 14),
        top: hover.y + 14,
        transform: flipX ? "translateX(-100%)" : undefined,
      }}
      role="tooltip"
    >
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: building.cluster ? "#4b6275" : lang.color }} />
        <span className="truncate font-mono text-xs font-semibold text-ink">{building.name}</span>
        <span className="ml-1 shrink-0 font-mono text-[10px] text-muted">{formatBytes(building.size)}</span>
      </div>
      <div className="truncate font-mono text-[10px] text-dim">{building.cluster ? building.dir || "/" : building.path}</div>
    </div>
  );
}
