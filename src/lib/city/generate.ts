/**
 * Repository → city. Pure and deterministic: the same files (and profile)
 * always produce the same districts, positions and building shapes.
 *
 * Layout: directories form a tree; each directory becomes a district whose
 * area is what its contents need (plus a street margin), split among
 * subdirectories and a "lot" for its own files with a squarified treemap.
 * Files are placed one per grid cell inside the lot, so buildings can never
 * overlap by construction. The profile's form decides how the top-level
 * districts are arranged: a single grid, around a plaza, as islands joined
 * by bridges, or on two river banks.
 */
import { basename, detectLanguage, dirname, type LanguageId } from "../languages";
import type { SourceFile } from "../types";
import type { CityForm, CityProfile, LandmarkKind } from "./profile";
import { hashString, seededRandom } from "./random";
import { squarify } from "./squarify";
import { STYLES, type RoofKind, type StyleDef, type WindowPattern } from "./styles";
import type { Bridge, Building, CityInput, CityModel, District, Landmark, Rect, StreetSegment, Tier } from "./types";

/** Nominal edge length of one building plot. */
export const CELL = 4.2;
/** Half the street width around a district at each depth (root has no street of its own). */
const PADDING = [0, 1.8, 0.95, 0.6, 0.42];
const LOT_PADDING = 0.25;
/** Plate thickness added per nesting level, so nested districts read as terraces. */
const PLATE_STEP = 0.06;
/** Treemap rectangles aren't perfectly square, so ask for a little more room than the ideal. */
const SLACK = 1.12;
const RING_ROAD = 6;
export const MIN_HEIGHT = 0.9;
export const MAX_HEIGHT = 40;

const padding = (depth: number) => PADDING[Math.min(depth, PADDING.length - 1)]!;
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface DirNode {
  path: string;
  name: string;
  depth: number;
  files: SourceFile[];
  children: DirNode[];
  need: number;
}

/** Height from file size: logarithmic, clamped. Exported for tests and the legend. */
export function heightForSize(bytes: number): number {
  const h = MIN_HEIGHT + 3.4 * Math.log1p(Math.max(0, bytes) / 220);
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h));
}

function lotNeed(files: number): number {
  return files * CELL * CELL * SLACK;
}

function buildTree(files: readonly SourceFile[]): DirNode {
  type Mutable = { path: string; files: SourceFile[]; children: Map<string, Mutable> };
  const root: Mutable = { path: "", files: [], children: new Map() };
  for (const file of files) {
    const dir = file.cluster ? file.path : dirname(file.path);
    let node = root;
    if (dir) {
      let path = "";
      for (const segment of dir.split("/")) {
        path = path ? `${path}/${segment}` : segment;
        let child = node.children.get(segment);
        if (!child) {
          child = { path, files: [], children: new Map() };
          node.children.set(segment, child);
        }
        node = child;
      }
    }
    node.files.push(file);
  }

  // Convert, collapsing chains of directories that only contain one subdirectory
  // (src/main/java/com/acme → one district), like GitHub's file browser does.
  const convert = (node: Mutable, name: string, depth: number): DirNode => {
    let current = node;
    let label = name;
    while (depth > 0 && current.files.length === 0 && current.children.size === 1) {
      const [segment, only] = [...current.children][0]!;
      label = `${label}/${segment}`;
      current = only;
    }
    const children = [...current.children].sort(([a], [b]) => byName(a, b)).map(([segment, child]) => convert(child, segment, depth + 1));
    const filesSorted = [...current.files].sort((a, b) => byName(a.path, b.path));
    const inner = filesSorted.length * CELL * CELL + children.reduce((a, c) => a + c.need, 0);
    const side = Math.sqrt(inner * SLACK) + 2 * padding(depth) + (filesSorted.length && children.length ? 2 * LOT_PADDING : 0);
    return { path: current.path, name: label, depth, files: filesSorted, children, need: side * side };
  };
  return convert(root, "", 0);
}

/** Choose a cols × rows grid for n cells in a w × d lot, maximizing the cell's smaller side. */
export function gridFor(n: number, w: number, d: number): { cols: number; rows: number } {
  const ideal = Math.sqrt((n * w) / Math.max(d, 1e-9));
  let best = { cols: 1, rows: n, score: -1 };
  for (const c of [Math.floor(ideal), Math.ceil(ideal), Math.floor(ideal) - 1, Math.ceil(ideal) + 1]) {
    const cols = Math.min(n, Math.max(1, c));
    const rows = Math.ceil(n / cols);
    const score = Math.min(w / cols, d / rows);
    if (score > best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

function shrink(rect: Rect, by: number): Rect {
  const dx = Math.min(by, rect.w / 2 - 1e-6);
  const dz = Math.min(by, rect.d / 2 - 1e-6);
  return { x: rect.x + Math.max(0, dx), z: rect.z + Math.max(0, dz), w: Math.max(0, rect.w - 2 * dx), d: Math.max(0, rect.d - 2 * dz) };
}

function pick<T>(r: number, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((n, [, w]) => n + w, 0);
  let acc = 0;
  for (const [value, weight] of options) {
    acc += weight / total;
    if (r < acc) return value;
  }
  return options[options.length - 1]![0];
}

function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.z < b.z + b.d + gap && b.z < a.z + a.d + gap;
}

/** Distance from a point to the nearest point of a rectangle (0 inside). */
function pointRectDistance(px: number, pz: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dz = Math.max(r.z - pz, 0, pz - (r.z + r.d));
  return Math.hypot(dx, dz);
}

function boundsOf(rects: readonly Rect[]): Rect {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minZ = Math.min(minZ, r.z);
    maxX = Math.max(maxX, r.x + r.w);
    maxZ = Math.max(maxZ, r.z + r.d);
  }
  return Number.isFinite(minX) ? { x: minX, z: minZ, w: maxX - minX, d: maxZ - minZ } : { x: 0, z: 0, w: 0, d: 0 };
}

/**
 * Place squares of the given sides on an outward spiral around the origin,
 * keeping `gap` between them and clear of a central circle of radius `reserve`.
 * Returns each square's min corner. Deterministic for the same inputs.
 */
export function spiralPack(sides: readonly number[], gap: number, reserve: number, startAngle: number): { x: number; z: number }[] {
  const placed: Rect[] = [];
  const out: { x: number; z: number }[] = [];
  const minSide = Math.min(...sides, 10);
  const pitch = Math.max(2, (minSide + gap) * 0.35) / (Math.PI * 2);
  for (const side of sides) {
    if (reserve <= 0 && placed.length === 0) {
      const rect = { x: -side / 2, z: -side / 2, w: side, d: side };
      placed.push(rect);
      out.push({ x: rect.x, z: rect.z });
      continue;
    }
    let theta = 0;
    let found: Rect | null = null;
    const r0 = reserve > 0 ? reserve + gap + side / 2 : 0;
    for (let i = 0; i < 200_000 && !found; i++) {
      const r = r0 + pitch * theta;
      const cx = Math.cos(theta + startAngle) * r;
      const cz = Math.sin(theta + startAngle) * r;
      const rect = { x: cx - side / 2, z: cz - side / 2, w: side, d: side };
      const clearOfCenter = reserve <= 0 || pointRectDistance(0, 0, rect) >= reserve + gap;
      if (clearOfCenter && !placed.some((p) => rectsOverlap(p, rect, gap))) found = rect;
      // Step along the arc by a fraction of the block size.
      theta += Math.max(0.01, (Math.max(1, side * 0.2) / Math.max(r, 1)));
    }
    const rect = found ?? { x: placed.length * (side + gap) * 2, z: 0, w: side, d: side };
    placed.push(rect);
    out.push({ x: rect.x, z: rect.z });
  }
  return out;
}

const LANDMARK_ROOF: Partial<Record<LandmarkKind, RoofKind>> = {
  hall: "dome",
  charter: "pyramid",
  port: "crown",
  shipyard: "tanks",
  spire: "spire",
};

function makeBuilding(file: SourceFile, index: number, districtIndex: number, cell: Rect, baseY: number, style: StyleDef): Building {
  // Seeded by path only, so a file keeps its silhouette across commits (v0.2 "Living City").
  const seed = hashString(file.path || "/");
  const rand = seededRandom(seed);
  const r = () => rand();
  const s = Math.min(cell.w, cell.d);
  const isCluster = Boolean(file.cluster);
  const language: LanguageId = isCluster ? "other" : detectLanguage(file.path);

  let height: number;
  let width: number;
  let depth: number;
  if (isCluster) {
    height = Math.min(9, 0.7 + 1.1 * Math.log1p(file.cluster!.count));
    width = s * 0.84;
    depth = s * 0.84;
  } else {
    height = Math.min(MAX_HEIGHT * style.heightScale, heightForSize(file.size) * style.heightScale);
    const prominence = (heightForSize(file.size) - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT);
    const [lo, hi] = style.fill;
    const base = s * (lo + (hi - lo - 0.14) * r() + 0.14 * prominence);
    width = base * (0.86 + 0.26 * r());
    depth = base * (0.86 + 0.26 * r());
  }
  width = Math.min(width, cell.w * 0.86);
  depth = Math.min(depth, cell.d * 0.86);

  // Nudge off-center within the free margin of the cell, never past it.
  const freeX = Math.max(0, (cell.w * 0.92 - width) / 2);
  const freeZ = Math.max(0, (cell.d * 0.92 - depth) / 2);
  const x = cell.x + cell.w / 2 + (r() - 0.5) * freeX;
  const z = cell.z + cell.d / 2 + (r() - 0.5) * freeZ;

  const tiers: Tier[] = [];
  const tierRoll = r();
  const scaledTall = 18 * style.heightScale;
  const scaledMid = 9 * style.heightScale;
  if (!isCluster && height > scaledTall && tierRoll < 0.76 * style.tierChance) {
    const h1 = height * (0.48 + 0.08 * r());
    const h2 = (height - h1) * (0.58 + 0.1 * r());
    const k1 = 0.66 + 0.12 * r();
    const k2 = k1 * (0.66 + 0.12 * r());
    tiers.push({ y: 0, height: h1, width, depth });
    tiers.push({ y: h1, height: h2, width: width * k1, depth: depth * k1 });
    tiers.push({ y: h1 + h2, height: height - h1 - h2, width: width * k2, depth: depth * k2 });
  } else if (!isCluster && height > scaledMid && tierRoll < 1.13 * style.tierChance) {
    const h1 = height * (0.56 + 0.16 * r());
    const k = 0.6 + 0.2 * r();
    tiers.push({ y: 0, height: h1, width, depth });
    tiers.push({ y: h1, height: height - h1, width: width * k, depth: depth * k });
  } else {
    tiers.push({ y: 0, height, width, depth });
  }

  const roofRoll = r();
  const roof: RoofKind = isCluster
    ? "flat"
    : height > 17 * style.heightScale
      ? pick(roofRoll, style.roofs.tall)
      : height > 7 * style.heightScale
        ? pick(roofRoll, style.roofs.mid)
        : pick(roofRoll, style.roofs.low);
  const top = tiers[tiers.length - 1]!;
  const topSide = Math.min(top.width, top.depth);
  const roofExtra = r();
  const roofHeight = roofHeightFor(roof, height, topSide, roofExtra);
  const windowRoll = r();

  return {
    index,
    path: file.path,
    name: isCluster ? `${file.cluster!.count.toLocaleString("en-US")} smaller files` : basename(file.path),
    dir: isCluster ? file.path : dirname(file.path),
    districtIndex,
    size: file.size,
    language,
    ...(isCluster ? { cluster: { count: file.cluster!.count } } : {}),
    x,
    z,
    baseY,
    height,
    width,
    depth,
    tiers,
    roof,
    roofHeight,
    windowStyle: pick<WindowPattern>(windowRoll, style.windows),
    seed: r(),
    lot: cell,
  };
}

function roofHeightFor(roof: RoofKind, height: number, topSide: number, r: number): number {
  switch (roof) {
    case "spire":
      return Math.min(topSide * 1.6, height * 0.35);
    case "antenna":
      return 1 + height * 0.22;
    case "crown":
      return 0.3 + 0.5 * r;
    case "dome":
      return topSide * 0.42;
    case "helipad":
      return 0.12;
    case "smokestack":
      return 2 + height * 0.3 + r * 2;
    case "tanks":
      return 0.6 + r * 0.6;
    case "solar":
      return 0.25;
    case "garden":
      return topSide * 0.3;
    case "pyramid":
      return topSide * (0.35 + 0.25 * r);
    default:
      return 0;
  }
}

interface Block {
  key: string;
  side: number;
  need: number;
  /** A directory, or (null) the own files of `lotOf`. */
  node: DirNode | null;
  /** For lot blocks: the directory whose files they hold. */
  lotOf?: DirNode;
  /** Set for packages spread out of a monorepo folder (islands form). */
  group?: DirNode;
}

export function generateCity(input: CityInput): CityModel {
  const profile: CityProfile | undefined = input.profile;
  const style = STYLES[profile?.style ?? "neon"];
  const tree = buildTree(input.files);
  const buildings: Building[] = [];
  const districts: District[] = [];
  const streets: StreetSegment[] = [];
  const bridges: Bridge[] = [];
  const water: Rect[] = [];
  let ground: Rect[] = [];
  let plaza: CityModel["plaza"] = null;

  const placeLot = (files: readonly SourceFile[], lot: Rect, districtIndex: number, baseY: number) => {
    const { cols, rows } = gridFor(files.length, lot.w, lot.d);
    const cellW = lot.w / cols;
    const cellD = lot.d / rows;
    files.forEach((file, n) => {
      const cell: Rect = { x: lot.x + (n % cols) * cellW, z: lot.z + Math.floor(n / cols) * cellD, w: cellW, d: cellD };
      buildings.push(makeBuilding(file, buildings.length, districtIndex, cell, baseY, style));
    });
  };

  const newDistrict = (node: DirNode, outer: Rect, rect: Rect, parent: number, topLevel: number): District => {
    const index = districts.length;
    const district: District = {
      index,
      path: node.path,
      name: node.depth === 0 ? input.name : node.name,
      depth: node.depth,
      parent,
      rect,
      outer,
      elevation: node.depth * PLATE_STEP,
      buildingCount: 0,
      bytes: 0,
      dominantLanguage: "other",
      topLevel: node.depth === 1 ? index : topLevel,
    };
    districts.push(district);
    if (node.depth === 1) {
      const { x, z, w, d } = outer;
      streets.push(
        { x1: x, z1: z, x2: x + w, z2: z, level: 1 },
        { x1: x + w, z1: z, x2: x + w, z2: z + d, level: 1 },
        { x1: x + w, z1: z + d, x2: x, z2: z + d, level: 1 },
        { x1: x, z1: z + d, x2: x, z2: z, level: 1 },
      );
    }
    return district;
  };

  /** Split `rect` among a node's subdirectories and its own lot, recursively. */
  const fillDistrict = (node: DirNode, rect: Rect, index: number, topLevel: number, elevation: number) => {
    type Item = { kind: "lot" } | { kind: "dir"; node: DirNode };
    const items: { item: Item; weight: number; key: string }[] = node.children.map((child) => ({
      item: { kind: "dir", node: child },
      weight: child.need,
      key: child.name,
    }));
    if (node.files.length) items.push({ item: { kind: "lot" }, weight: lotNeed(node.files.length), key: "" });
    items.sort((a, b) => b.weight - a.weight || byName(a.key, b.key));
    const rects = squarify(
      items.map((i) => i.weight),
      rect,
    );
    items.forEach(({ item }, k) => {
      const area = rects[k]!;
      if (item.kind === "dir") place(item.node, area, index, topLevel);
      else placeLot(node.files, items.length > 1 ? shrink(area, LOT_PADDING) : area, index, elevation + PLATE_STEP);
    });
  };

  const place = (node: DirNode, outer: Rect, parent: number, topLevel: number) => {
    const district = newDistrict(node, outer, shrink(outer, padding(node.depth)), parent, topLevel);
    fillDistrict(node, district.rect, district.index, district.topLevel, district.elevation);
  };

  const form: CityForm = profile?.form ?? "grid";
  // In the islands form a monorepo folder (packages/, crates/ …) is spread out: each package is its own island.
  const group =
    form === "islands" && profile?.islandsOf ? tree.children.find((c) => c.name === profile.islandsOf && c.children.length >= 2) : undefined;
  const lotBlock = (owner: DirNode, extra: Partial<Block> = {}): Block => {
    const side = Math.sqrt(lotNeed(owner.files.length)) + 2 * padding(owner.depth + 1);
    return { key: `${owner.path}/`, side, need: side * side, node: null, lotOf: owner, ...extra };
  };
  const dirBlock = (node: DirNode, extra: Partial<Block> = {}): Block => ({ key: node.path, side: Math.sqrt(node.need), need: node.need, node, ...extra });
  const blocks: Block[] = [
    ...tree.children.filter((c) => c !== group).map((c) => dirBlock(c)),
    ...(group ? group.children.map((c) => dirBlock(c, { group })) : []),
    ...(group?.files.length ? [lotBlock(group, { group })] : []),
    ...(tree.files.length ? [lotBlock(tree)] : []),
  ];
  blocks.sort((a, b) => b.need - a.need || byName(a.key, b.key));

  // Root district first so its index is 0; its rect is fixed up once the layout is known.
  const rootDistrict = newDistrict(tree, { x: 0, z: 0, w: 0, d: 0 }, { x: 0, z: 0, w: 0, d: 0 }, -1, -1);
  const groupDistrict = group ? newDistrict(group, { x: 0, z: 0, w: 0, d: 0 }, { x: 0, z: 0, w: 0, d: 0 }, rootDistrict.index, -1) : undefined;
  if (groupDistrict) groupDistrict.virtual = true;
  const groupRects: Rect[] = [];
  const placeBlock = (block: Block, rect: Rect) => {
    const parent = block.group && groupDistrict ? groupDistrict : rootDistrict;
    if (block.group) groupRects.push(rect);
    if (block.node) {
      place(block.node, rect, parent.index, block.group && groupDistrict ? groupDistrict.index : -1);
      if (block.group) {
        // Packages are islands too: give them a shoreline road.
        const { x, z, w, d } = rect;
        streets.push(
          { x1: x, z1: z, x2: x + w, z2: z, level: 1 },
          { x1: x + w, z1: z, x2: x + w, z2: z + d, level: 1 },
          { x1: x + w, z1: z + d, x2: x, z2: z + d, level: 1 },
          { x1: x, z1: z + d, x2: x, z2: z, level: 1 },
        );
      }
    } else {
      const owner = block.lotOf ?? tree;
      placeLot(owner.files, shrink(rect, padding(owner.depth + 1)), parent.index, parent.elevation + PLATE_STEP);
    }
  };

  const effectiveForm: CityForm = blocks.length < 2 ? "grid" : form;
  if (effectiveForm === "plaza" || effectiveForm === "islands") {
    const islands = effectiveForm === "islands";
    const largest = blocks[0]?.side ?? 10;
    const gap = islands ? Math.max(7, largest * 0.12) : 3.6;
    const reserve = Math.max(10, Math.min(largest * 0.45, 40));
    const start = ((profile?.seed ?? 0) % 628) / 100;
    const corners = spiralPack(
      blocks.map((b) => b.side),
      gap,
      reserve,
      start,
    );
    const rects = blocks.map((b, i) => ({ x: corners[i]!.x, z: corners[i]!.z, w: b.side, d: b.side }));
    blocks.forEach((b, i) => placeBlock(b, rects[i]!));
    plaza = { x: 0, z: 0, radius: reserve };
    const all = boundsOf([...rects, { x: -reserve, z: -reserve, w: reserve * 2, d: reserve * 2 }]);
    rootDistrict.rect = all;
    rootDistrict.outer = all;
    if (islands) {
      // Each district is its own island; loose files (root, monorepo folder) get a small plot of ground.
      ground = blocks.flatMap((b, i) => (b.node ? [] : [rects[i]!]));
      if (groupDistrict && groupRects.length) {
        const box = boundsOf(groupRects);
        groupDistrict.rect = box;
        groupDistrict.outer = box;
      }
      const margin = Math.max(30, gap * 4);
      water.push({ x: all.x - margin, z: all.z - margin, w: all.w + margin * 2, d: all.d + margin * 2 });
      // Bridge each island to the hub or to the nearest island placed before it.
      rects.forEach((rect, i) => {
        let best: { d: number; bridge: Bridge } | null = null;
        const hubPoint = nearestPointOnRect(0, 0, rect);
        const hubDist = Math.hypot(hubPoint.x, hubPoint.z) - reserve;
        if (hubDist > 0) {
          const len = Math.hypot(hubPoint.x, hubPoint.z) || 1;
          best = {
            d: hubDist,
            bridge: { x1: (hubPoint.x / len) * reserve, z1: (hubPoint.z / len) * reserve, x2: hubPoint.x, z2: hubPoint.z, width: 1.8 },
          };
        }
        for (let j = 0; j < i; j++) {
          const link = rectLink(rects[j]!, rect);
          if (link && (!best || link.d < best.d)) best = { d: link.d, bridge: { ...link.bridge, width: 1.6 } };
        }
        if (best && best.d > 0.5) bridges.push(best.bridge);
      });
    } else {
      ground = [all];
      // Ring road around the plaza.
      const segments = 24;
      for (let k = 0; k < segments; k++) {
        const a0 = (k / segments) * Math.PI * 2;
        const a1 = ((k + 1) / segments) * Math.PI * 2;
        const rr = reserve - 1.5;
        streets.push({ x1: Math.cos(a0) * rr, z1: Math.sin(a0) * rr, x2: Math.cos(a1) * rr, z2: Math.sin(a1) * rr, level: 0 });
      }
    }
  } else if (effectiveForm === "river") {
    const farBank = new Set(profile?.riverBank ?? []);
    const near = blocks.filter((b) => !b.node || !farBank.has(b.node.name));
    const far = blocks.filter((b) => b.node && farBank.has(b.node.name));
    if (!far.length || !near.length) {
      layoutGrid();
    } else {
      const needNear = near.reduce((n, b) => n + b.need, 0) * SLACK;
      const needFar = far.reduce((n, b) => n + b.need, 0) * SLACK;
      const depth = Math.sqrt((needNear + needFar) * 1.1);
      const river = Math.max(12, depth * 0.1);
      const wNear = needNear / depth;
      const wFar = needFar / depth;
      const nearRect = { x: -river / 2 - wNear, z: -depth / 2, w: wNear, d: depth };
      const farRect = { x: river / 2, z: -depth / 2, w: wFar, d: depth };
      for (const [bank, rect] of [[near, nearRect], [far, farRect]] as const) {
        const rects = squarify(
          bank.map((b) => b.need),
          rect,
        );
        bank.forEach((b, i) => placeBlock(b, rects[i]!));
      }
      const all = boundsOf([nearRect, farRect]);
      rootDistrict.rect = all;
      rootDistrict.outer = all;
      ground = [nearRect, farRect];
      water.push({ x: -river / 2, z: all.z - 40, w: river, d: all.d + 80 });
      const count = Math.max(2, Math.min(5, Math.round(depth / 60)));
      for (let k = 1; k <= count; k++) {
        const z = all.z + (all.d * k) / (count + 1);
        bridges.push({ x1: -river / 2 - 1, z1: z, x2: river / 2 + 1, z2: z, width: 2.4 });
        streets.push({ x1: -river / 2 - 1, z1: z, x2: river / 2 + 1, z2: z, level: 0 });
      }
    }
  } else {
    layoutGrid();
  }

  function layoutGrid() {
    const side = Math.sqrt(tree.need);
    const bounds: Rect = { x: -side / 2, z: -side / 2, w: side, d: side };
    rootDistrict.rect = bounds;
    rootDistrict.outer = bounds;
    ground = [bounds];
    fillDistrict(tree, bounds, rootDistrict.index, -1, 0);
  }

  // Roll up counts, bytes and dominant language from buildings to every ancestor district.
  const languageBytes = districts.map(() => new Map<LanguageId, number>());
  for (const b of buildings) {
    for (let d = b.districtIndex; d !== -1; d = districts[d]!.parent) {
      const district = districts[d]!;
      district.buildingCount += 1;
      district.bytes += b.size;
      if (!b.cluster) {
        const map = languageBytes[d]!;
        map.set(b.language, (map.get(b.language) ?? 0) + Math.max(1, b.size));
      }
    }
  }
  districts.forEach((district, i) => {
    let best: LanguageId = "other";
    let bestBytes = -1;
    for (const [lang, bytes] of languageBytes[i]!) {
      if (bytes > bestBytes || (bytes === bestBytes && lang < best)) {
        best = lang;
        bestBytes = bytes;
      }
    }
    district.dominantLanguage = best;
  });

  // Landmarks: resolve the profile's paths to buildings / districts.
  const landmarks: Landmark[] = [];
  const byPath = new Map(buildings.filter((b) => !b.cluster).map((b) => [b.path, b]));
  for (const spec of profile?.landmarks ?? []) {
    if (spec.target === "file") {
      const b = byPath.get(spec.path);
      if (!b || b.landmark) continue;
      b.landmark = spec.kind;
      const roof = LANDMARK_ROOF[spec.kind];
      if (roof) {
        const top = b.tiers[b.tiers.length - 1]!;
        b.roof = roof;
        b.roofHeight = roofHeightFor(roof, b.height, Math.min(top.width, top.depth), 0.6) * (spec.kind === "spire" ? 1.6 : 1);
      }
      landmarks.push({ kind: spec.kind, path: b.path, building: b.index, x: b.x, y: b.baseY + b.height + b.roofHeight, z: b.z });
    } else {
      const d = districts
        .filter((x) => x.depth > 0 && (x.path === spec.path || x.path.startsWith(`${spec.path}/`)))
        .sort((a, b) => a.depth - b.depth)[0];
      if (!d || d.landmark) continue;
      d.landmark = spec.kind;
      landmarks.push({ kind: spec.kind, path: d.path, district: d.index, x: d.rect.x + d.rect.w / 2, y: d.elevation, z: d.rect.z + d.rect.d / 2 });
    }
  }

  const all = rootDistrict.rect;
  if (effectiveForm === "grid" || effectiveForm === "plaza") {
    // Ring road around the whole city.
    const ring = { x: all.x - RING_ROAD / 2, z: all.z - RING_ROAD / 2, w: all.w + RING_ROAD, d: all.d + RING_ROAD };
    streets.push(
      { x1: ring.x, z1: ring.z, x2: ring.x + ring.w, z2: ring.z, level: 0 },
      { x1: ring.x + ring.w, z1: ring.z, x2: ring.x + ring.w, z2: ring.z + ring.d, level: 0 },
      { x1: ring.x + ring.w, z1: ring.z + ring.d, x2: ring.x, z2: ring.z + ring.d, level: 0 },
      { x1: ring.x, z1: ring.z + ring.d, x2: ring.x, z2: ring.z, level: 0 },
    );
  }
  for (const b of bridges) streets.push({ x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2, level: 0 });

  const bounds = { x: all.x - RING_ROAD / 2, z: all.z - RING_ROAD / 2, w: all.w + RING_ROAD, d: all.d + RING_ROAD };
  const center = { x: bounds.x + bounds.w / 2, z: bounds.z + bounds.d / 2 };
  const maxHeight = buildings.reduce((m, b) => Math.max(m, b.baseY + b.height + b.roofHeight), 0);
  return {
    name: input.name,
    form: effectiveForm,
    style: style.id,
    ground,
    water,
    bridges,
    plaza,
    landmarks,
    buildings,
    districts,
    streets,
    bounds,
    center,
    radius: Math.hypot(bounds.w, bounds.d) / 2,
    maxHeight,
  };
}

function nearestPointOnRect(px: number, pz: number, r: Rect): { x: number; z: number } {
  return { x: Math.min(Math.max(px, r.x), r.x + r.w), z: Math.min(Math.max(pz, r.z), r.z + r.d) };
}

/** Shortest axis-aligned (or corner-to-corner) connection between two rectangles. */
function rectLink(a: Rect, b: Rect): { d: number; bridge: Omit<Bridge, "width"> } | null {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
  if (ox > 2) {
    const x = Math.max(a.x, b.x) + ox / 2;
    const [top, bottom] = a.z < b.z ? [a, b] : [b, a];
    const z1 = top.z + top.d;
    const z2 = bottom.z;
    return z2 > z1 ? { d: z2 - z1, bridge: { x1: x, z1, x2: x, z2 } } : null;
  }
  if (oz > 2) {
    const z = Math.max(a.z, b.z) + oz / 2;
    const [left, right] = a.x < b.x ? [a, b] : [b, a];
    const x1 = left.x + left.w;
    const x2 = right.x;
    return x2 > x1 ? { d: x2 - x1, bridge: { x1, z1: z, x2, z2: z } } : null;
  }
  return null;
}
