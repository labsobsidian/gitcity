"use client";

import { LANDMARK_INFO, type CityProfile } from "@/lib/city/profile";
import { STYLES } from "@/lib/city/styles";
import type { CityModel } from "@/lib/city/types";
import { basename } from "@/lib/languages";

const FORM_NAME = { grid: "City grid", plaza: "Plaza city", islands: "Archipelago", river: "River city" } as const;
const SKY_NAME = { dawn: "Dawn", dusk: "Dusk", night: "Night", midnight: "Midnight" } as const;
const WEATHER_NAME = { clear: "Clear skies", rain: "Rain", snow: "Snow", haze: "Haze" } as const;

interface Props {
  profile: CityProfile;
  city: CityModel;
  onRemix(): void;
  onOriginal(): void;
  onLandmark(buildingIndex: number): void;
  onLandmarkDistrict(x: number, z: number): void;
}

/** Why this city looks the way it does, its landmarks, and the remix control. */
export function CityDna({ profile, city, onRemix, onOriginal, onLandmark, onLandmarkDistrict }: Props) {
  const style = STYLES[profile.style];
  const chips = [FORM_NAME[city.form], SKY_NAME[profile.timeOfDay], profile.ruined ? "Ruins" : WEATHER_NAME[profile.weather]];
  if (profile.aurora) chips.push("Aurora");
  const reasons = [profile.styleReason, profile.formReason, profile.skyReason, profile.activityReason];

  return (
    <div className="rounded-xl border border-line bg-void/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">City DNA</div>
          <div className="truncate text-base font-semibold" style={{ color: style.accents[0] }}>
            {style.name}
          </div>
          <div className="truncate text-[11px] text-muted">{style.tagline}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={onRemix}
            className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:border-emerald/50 hover:bg-emerald/10"
            title="Remix: re-roll the shape, sky and weather (M)"
          >
            ↻ Remix
          </button>
          {profile.remix > 0 && (
            <button type="button" onClick={onOriginal} className="font-mono text-[10px] text-dim hover:text-ink">
              variant {profile.remix} · original
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {chips.map((c) => (
          <span key={c} className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted">
            {c}
          </span>
        ))}
      </div>

      <ul className="mt-2 space-y-0.5 text-[11px] leading-snug text-dim">
        {reasons.map((r) => (
          <li key={r}>› {r}</li>
        ))}
      </ul>

      {city.landmarks.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Landmarks</div>
          <ul className="grid grid-cols-1 gap-1">
            {city.landmarks.map((l) => {
              const info = LANDMARK_INFO[l.kind];
              const label = l.building !== undefined ? basename(l.path) : `${l.path}/`;
              return (
                <li key={`${l.kind}:${l.path}`}>
                  <button
                    type="button"
                    onClick={() => (l.building !== undefined ? onLandmark(l.building) : onLandmarkDistrict(l.x, l.z))}
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-white/5"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: info.color, boxShadow: `0 0 8px ${info.color}` }} />
                    <span className="shrink-0 text-xs text-ink">{info.name}</span>
                    <span className="ml-auto truncate font-mono text-[10px] text-dim">{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
