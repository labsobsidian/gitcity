/**
 * CityProfile → concrete scene colors and atmosphere. Keeps every
 * renderer-facing color decision in one place.
 */
import * as THREE from "three";
import type { CityProfile, TimeOfDay } from "@/lib/city/profile";
import { STYLES, type StyleDef, type Weather } from "@/lib/city/styles";

export interface SceneTheme {
  style: StyleDef;
  accents: [string, string];
  plate: string;
  ground: string;
  grid: [string, string];
  sky: { zenith: string; horizon: string; glow: string; glowDir: [number, number, number]; stars: number; aurora: boolean; moon: boolean };
  fog: { color: string; near: number; far: number };
  weather: Weather;
  activity: number;
  ruined: boolean;
  searchlights: number;
  suburbs: number;
  seed: number;
}

const SKIES: Record<TimeOfDay, SceneTheme["sky"]> = {
  dawn: { zenith: "#0b1733", horizon: "#3b2742", glow: "#ff7a52", glowDir: [0.8, 0.05, -0.6], stars: 0.15, aurora: false, moon: false },
  dusk: { zenith: "#080d24", horizon: "#2a1440", glow: "#c2458e", glowDir: [-0.7, 0.04, 0.7], stars: 0.4, aurora: false, moon: false },
  night: { zenith: "#04070f", horizon: "#0c1a26", glow: "#1b6f7d", glowDir: [0.3, 0.02, 0.95], stars: 0.75, aurora: false, moon: true },
  midnight: { zenith: "#020309", horizon: "#070c14", glow: "#123e57", glowDir: [-0.4, 0.02, -0.9], stars: 1, aurora: false, moon: true },
};

function shiftHue(hex: string, degrees: number): string {
  if (!degrees) return hex;
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((hsl.h + degrees / 360 + 1) % 1, hsl.s, hsl.l);
  return `#${c.getHexString()}`;
}

function mixHex(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

export function themeFor(profile: CityProfile | undefined): SceneTheme {
  const style = STYLES[profile?.style ?? "neon"];
  const time = profile?.timeOfDay ?? "night";
  const base = SKIES[time];
  const hue = profile?.hueShift ?? 0;
  const accents: [string, string] = [shiftHue(style.accents[0], hue), shiftHue(style.accents[1], hue)];
  const weather = profile?.weather ?? "clear";
  const ruined = profile?.ruined ?? false;

  // A touch of the style's accent in the horizon ties sky and city together.
  const horizon = mixHex(base.horizon, accents[0], 0.08);
  const sky = { ...base, horizon, aurora: profile?.aurora ?? false };
  const fogColor = mixHex(horizon, "#000000", weather === "haze" ? 0.15 : 0.35);
  // Fog distances are multiples of the city radius (resolved in the scene).
  const fog =
    weather === "haze" || ruined
      ? { color: weather === "haze" ? mixHex(fogColor, style.windowLight, 0.06) : fogColor, near: 0.6, far: 3.2 }
      : weather === "rain"
        ? { color: fogColor, near: 1.0, far: 4.4 }
        : weather === "snow"
          ? { color: mixHex(fogColor, "#9fb3c8", 0.12), near: 1.0, far: 4.6 }
          : { color: fogColor, near: 1.4, far: 5.5 };

  return {
    style,
    accents,
    plate: style.plate,
    ground: style.ground,
    grid: [shiftHue(style.grid[0], hue), shiftHue(style.grid[1], hue)],
    sky,
    fog,
    weather,
    activity: profile?.activity ?? 0.9,
    ruined,
    searchlights: profile?.searchlights ?? 0,
    suburbs: profile?.suburbs ?? 0,
    seed: profile?.seed ?? 1,
  };
}
