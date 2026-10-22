/**
 * City geometry descriptors produced by the generator and consumed by the
 * renderer. Units are abstract "meters"; y is up, the ground is y = 0.
 */
import type { LanguageId } from "../languages";
import type { SourceFile } from "../types";
import type { CityForm, CityProfile, LandmarkKind } from "./profile";
import type { RoofKind, StyleId, WindowPattern } from "./styles";

/** Axis-aligned rectangle on the ground plane: min corner (x, z), extent (w along x, d along z). */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export type RoofStyle = RoofKind;

/** One stacked block of a building. `y` is the block's base height above the plot. */
export interface Tier {
  y: number;
  height: number;
  width: number;
  depth: number;
}

export interface Building {
  index: number;
  /** Repository path. For clusters, the directory the files were merged into. */
  path: string;
  name: string;
  dir: string;
  districtIndex: number;
  size: number;
  language: LanguageId;
  cluster?: { count: number };
  /** Center of the footprint. */
  x: number;
  z: number;
  /** Ground level of the plot (top of the district plate). */
  baseY: number;
  /** Height of the tiers, excluding the roof ornament. */
  height: number;
  width: number;
  depth: number;
  tiers: Tier[];
  roof: RoofStyle;
  roofHeight: number;
  /** Shader window pattern (see WINDOW in styles.ts). */
  windowStyle: WindowPattern;
  /** Stable per-file random value in [0, 1), for shader variation. */
  seed: number;
  /** The grid cell reserved for this building; the footprint always fits inside it. */
  lot: Rect;
  landmark?: LandmarkKind;
}

export interface District {
  index: number;
  /** Directory path ("" for the repository root). Collapsed chains use the deepest path. */
  path: string;
  /** Display name; collapsed single-child chains read "src/main/java". */
  name: string;
  depth: number;
  parent: number;
  /** Plate the district's contents sit on (inside its street margin). */
  rect: Rect;
  /** Plate plus surrounding street — the area the parent allocated. */
  outer: Rect;
  /** Height of the plate top. */
  elevation: number;
  buildingCount: number;
  bytes: number;
  dominantLanguage: LanguageId;
  /** Index of the depth-1 ancestor (itself at depth 1), or -1 for the root. */
  topLevel: number;
  landmark?: LandmarkKind;
  /** Groups islands but has no ground of its own (no plate, outline or label). */
  virtual?: boolean;
}

export interface StreetSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** 0 = ring road / main avenue, 1 = district street. */
  level: 0 | 1;
}

export interface Bridge {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
}

export interface Landmark {
  kind: LandmarkKind;
  path: string;
  building?: number;
  district?: number;
  /** World position for beams and labels. */
  x: number;
  y: number;
  z: number;
}

export interface CityModel {
  name: string;
  form: CityForm;
  style: StyleId;
  /** Street-level ground (the root plate). Empty areas between are water or open ground. */
  ground: Rect[];
  water: Rect[];
  bridges: Bridge[];
  /** Central plaza / hub island, if the form has one. */
  plaza: { x: number; z: number; radius: number } | null;
  landmarks: Landmark[];
  buildings: Building[];
  districts: District[];
  streets: StreetSegment[];
  bounds: Rect;
  center: { x: number; z: number };
  /** Radius of the circle enclosing the city (for camera framing). */
  radius: number;
  maxHeight: number;
}

export interface CityInput {
  /** Used for labels; variation is seeded per file path so buildings keep their look across commits. */
  name: string;
  files: readonly SourceFile[];
  /** Style, shape and landmarks. Without one the city is a neon grid. */
  profile?: CityProfile;
}
