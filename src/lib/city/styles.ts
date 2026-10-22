/**
 * Architecture styles ("biomes"). A style decides how buildings are massed,
 * what sits on their roofs, how windows glow and what the city is painted
 * with. Language colors still mark each building's edges, so the legend
 * stays true whatever the style.
 */

export type StyleId = "neon" | "foundry" | "greenhouse" | "megablock" | "modular" | "corporate" | "artdeco" | "archive";

export type RoofKind = "flat" | "spire" | "antenna" | "crown" | "helipad" | "dome" | "smokestack" | "tanks" | "solar" | "garden" | "pyramid";

/** Window patterns understood by the building shader. */
export const WINDOW = { grid: 0, bands: 1, strips: 2, sparse: 3, dense: 4, lattice: 5 } as const;
export type WindowPattern = (typeof WINDOW)[keyof typeof WINDOW];

export interface StyleDef {
  id: StyleId;
  name: string;
  tagline: string;
  // --- massing (generator)
  heightScale: number;
  /** Footprint as a fraction of the plot's smaller side: [min, max]. */
  fill: [number, number];
  tierChance: number;
  /** Roof weights for tall (>17), mid and low buildings. */
  roofs: { tall: [RoofKind, number][]; mid: [RoofKind, number][]; low: [RoofKind, number][] };
  windows: [WindowPattern, number][];
  // --- look (renderer)
  /** Base color of the building shell. */
  body: string;
  /** Window light color, mixed with the language color by `windowMix` (0 = pure language color). */
  windowLight: string;
  windowMix: number;
  /** Randomize window hues per window (neon signage chaos). */
  windowHueJitter: number;
  /** District outlines: [top-level, nested]. */
  accents: [string, string];
  plate: string;
  ground: string;
  grid: [string, string];
  /** Weather this style tends to have, as weights. */
  weather: [Weather, number][];
}

export type Weather = "clear" | "rain" | "snow" | "haze";

export const STYLES: Record<StyleId, StyleDef> = {
  neon: {
    id: "neon",
    name: "Neon Sprawl",
    tagline: "Glass towers wrapped in light",
    heightScale: 1,
    fill: [0.5, 0.82],
    tierChance: 0.55,
    roofs: {
      tall: [["spire", 0.3], ["antenna", 0.35], ["crown", 0.2], ["helipad", 0.15]],
      mid: [["antenna", 0.25], ["crown", 0.25], ["dome", 0.15], ["flat", 0.35]],
      low: [["flat", 0.7], ["crown", 0.3]],
    },
    windows: [[WINDOW.grid, 0.3], [WINDOW.bands, 0.25], [WINDOW.strips, 0.25], [WINDOW.sparse, 0.2]],
    body: "#0a1620",
    windowLight: "#ffffff",
    windowMix: 0.18,
    windowHueJitter: 0,
    accents: ["#31E6B0", "#31BDE6"],
    plate: "#0a1218",
    ground: "#05090c",
    grid: ["#154c47", "#24a07f"],
    weather: [["rain", 0.45], ["clear", 0.4], ["haze", 0.15]],
  },
  foundry: {
    id: "foundry",
    name: "Foundry District",
    tagline: "Forged, riveted, running hot",
    heightScale: 0.85,
    fill: [0.62, 0.88],
    tierChance: 0.35,
    roofs: {
      tall: [["smokestack", 0.45], ["antenna", 0.2], ["tanks", 0.2], ["flat", 0.15]],
      mid: [["smokestack", 0.35], ["tanks", 0.3], ["flat", 0.35]],
      low: [["flat", 0.5], ["tanks", 0.3], ["smokestack", 0.2]],
    },
    windows: [[WINDOW.sparse, 0.45], [WINDOW.bands, 0.35], [WINDOW.strips, 0.2]],
    body: "#1a120d",
    windowLight: "#ff9a3c",
    windowMix: 0.7,
    windowHueJitter: 0,
    accents: ["#ff8a3d", "#ffc15e"],
    plate: "#120d0a",
    ground: "#080605",
    grid: ["#4a2a14", "#a8561f"],
    weather: [["haze", 0.6], ["clear", 0.25], ["rain", 0.15]],
  },
  greenhouse: {
    id: "greenhouse",
    name: "Greenhouse Commons",
    tagline: "Glass domes, rooftop gardens, humid air",
    heightScale: 0.9,
    fill: [0.55, 0.85],
    tierChance: 0.4,
    roofs: {
      tall: [["dome", 0.4], ["garden", 0.35], ["spire", 0.25]],
      mid: [["garden", 0.45], ["dome", 0.35], ["flat", 0.2]],
      low: [["garden", 0.55], ["dome", 0.2], ["flat", 0.25]],
    },
    windows: [[WINDOW.lattice, 0.6], [WINDOW.grid, 0.25], [WINDOW.strips, 0.15]],
    body: "#0b1a17",
    windowLight: "#b8ffd9",
    windowMix: 0.45,
    windowHueJitter: 0,
    accents: ["#43e97b", "#a3f7bf"],
    plate: "#0a1512",
    ground: "#040a08",
    grid: ["#14432f", "#2fae6a"],
    weather: [["rain", 0.5], ["haze", 0.3], ["clear", 0.2]],
  },
  megablock: {
    id: "megablock",
    name: "Walled Megablock",
    tagline: "Dense, stacked, never sleeps",
    heightScale: 1.15,
    fill: [0.78, 0.92],
    tierChance: 0.25,
    roofs: {
      tall: [["antenna", 0.45], ["tanks", 0.35], ["crown", 0.2]],
      mid: [["tanks", 0.4], ["antenna", 0.35], ["flat", 0.25]],
      low: [["tanks", 0.4], ["flat", 0.6]],
    },
    windows: [[WINDOW.dense, 0.7], [WINDOW.grid, 0.3]],
    body: "#14161a",
    windowLight: "#ffe2b0",
    windowMix: 0.4,
    windowHueJitter: 0.55,
    accents: ["#8aa2ff", "#ff5fa2"],
    plate: "#0d0e11",
    ground: "#060607",
    grid: ["#2a2f4a", "#5965b8"],
    weather: [["rain", 0.65], ["haze", 0.25], ["clear", 0.1]],
  },
  modular: {
    id: "modular",
    name: "Modular Grid",
    tagline: "Clean blocks, solar roofs, quiet efficiency",
    heightScale: 0.9,
    fill: [0.6, 0.86],
    tierChance: 0.3,
    roofs: {
      tall: [["solar", 0.4], ["helipad", 0.3], ["antenna", 0.3]],
      mid: [["solar", 0.55], ["flat", 0.45]],
      low: [["solar", 0.5], ["flat", 0.5]],
    },
    windows: [[WINDOW.grid, 0.65], [WINDOW.bands, 0.35]],
    body: "#0b1820",
    windowLight: "#bff4ff",
    windowMix: 0.55,
    windowHueJitter: 0,
    accents: ["#31d7f0", "#7ee0ff"],
    plate: "#091318",
    ground: "#04080b",
    grid: ["#12424f", "#2ba6c4"],
    weather: [["clear", 0.55], ["snow", 0.3], ["haze", 0.15]],
  },
  corporate: {
    id: "corporate",
    name: "Corporate Heights",
    tagline: "Curtain walls and helipads",
    heightScale: 1.2,
    fill: [0.55, 0.8],
    tierChance: 0.6,
    roofs: {
      tall: [["helipad", 0.35], ["crown", 0.35], ["spire", 0.3]],
      mid: [["crown", 0.4], ["helipad", 0.2], ["flat", 0.4]],
      low: [["flat", 0.8], ["crown", 0.2]],
    },
    windows: [[WINDOW.bands, 0.6], [WINDOW.grid, 0.4]],
    body: "#0b1426",
    windowLight: "#dbe8ff",
    windowMix: 0.6,
    windowHueJitter: 0,
    accents: ["#5b8cff", "#a8c0ff"],
    plate: "#0a0f1a",
    ground: "#05070c",
    grid: ["#1c2c58", "#4467c9"],
    weather: [["clear", 0.6], ["rain", 0.25], ["haze", 0.15]],
  },
  artdeco: {
    id: "artdeco",
    name: "Art Deco Boulevard",
    tagline: "Stepped towers, gold trim, old glamour",
    heightScale: 1.05,
    fill: [0.55, 0.8],
    tierChance: 0.75,
    roofs: {
      tall: [["spire", 0.55], ["crown", 0.45]],
      mid: [["crown", 0.5], ["pyramid", 0.3], ["flat", 0.2]],
      low: [["pyramid", 0.4], ["flat", 0.6]],
    },
    windows: [[WINDOW.strips, 0.6], [WINDOW.grid, 0.4]],
    body: "#16100f",
    windowLight: "#ffd88a",
    windowMix: 0.6,
    windowHueJitter: 0,
    accents: ["#f5c46b", "#ff6f91"],
    plate: "#110c0b",
    ground: "#070505",
    grid: ["#4a3418", "#b3843a"],
    weather: [["clear", 0.5], ["haze", 0.3], ["rain", 0.2]],
  },
  archive: {
    id: "archive",
    name: "Archive Quarter",
    tagline: "Libraries, reading rooms and lamplight",
    heightScale: 0.75,
    fill: [0.65, 0.88],
    tierChance: 0.45,
    roofs: {
      tall: [["pyramid", 0.5], ["spire", 0.3], ["dome", 0.2]],
      mid: [["pyramid", 0.55], ["dome", 0.2], ["flat", 0.25]],
      low: [["pyramid", 0.6], ["flat", 0.4]],
    },
    windows: [[WINDOW.strips, 0.55], [WINDOW.sparse, 0.45]],
    body: "#14120f",
    windowLight: "#ffcf8a",
    windowMix: 0.75,
    windowHueJitter: 0,
    accents: ["#9fc3d9", "#e8d3a8"],
    plate: "#0f0e0c",
    ground: "#070706",
    grid: ["#2f3a40", "#6f8a99"],
    weather: [["snow", 0.45], ["clear", 0.35], ["haze", 0.2]],
  },
};

/** Which style each language pulls toward. Unlisted languages don't vote. */
export const LANGUAGE_STYLE: Record<string, StyleId> = {
  typescript: "neon",
  javascript: "neon",
  css: "neon",
  html: "neon",
  vue: "neon",
  svelte: "neon",
  rust: "foundry",
  zig: "foundry",
  python: "greenhouse",
  c: "megablock",
  cpp: "megablock",
  go: "modular",
  dart: "modular",
  swift: "modular",
  java: "corporate",
  csharp: "corporate",
  kotlin: "corporate",
  scala: "corporate",
  ruby: "artdeco",
  php: "artdeco",
  elixir: "artdeco",
  haskell: "artdeco",
  lua: "artdeco",
  shell: "modular",
  markdown: "archive",
};
