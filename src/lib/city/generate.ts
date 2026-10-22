/**
 * Repository → city. Pure and deterministic: the same files always produce
 * the same districts, positions and building shapes.
 *
 * Layout: directories form a tree; each directory becomes a district whose
 * area is what its contents need (plus a street margin), split among
 * subdirectories and a "lot" for its own files with a squarified treemap.
 * Files are placed one per grid cell inside the lot, so buildings can never
 * overlap by construction.
 */
import { basename, detectLanguage, dirname, type LanguageId } from "../languages";
import type { SourceFile } from "../types";
import { hashString, seededRandom } from "./random";
import { squarify } from "./squarify";
import type { Building, CityInput, CityModel, District, Rect, RoofStyle, StreetSegment, Tier } from "./types";

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
    const children = [...current.children]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([segment, child]) => convert(child, segment, depth + 1));
    const filesSorted = [...current.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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
  let acc = 0;
  for (const [value, weight] of options) {
    acc += weight;
    if (r < acc) return value;
  }
  return options[options.length - 1]![0];
}

function makeBuilding(file: SourceFile, index: number, districtIndex: number, cell: Rect, baseY: number): Building {
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
    height = heightForSize(file.size);
    const prominence = (height - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT);
    const base = s * (0.5 + 0.18 * r() + 0.14 * prominence);
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
  if (!isCluster && height > 18 && tierRoll < 0.42) {
    const h1 = height * (0.48 + 0.08 * r());
    const h2 = (height - h1) * (0.58 + 0.1 * r());
    const k1 = 0.66 + 0.12 * r();
    const k2 = k1 * (0.66 + 0.12 * r());
    tiers.push({ y: 0, height: h1, width, depth });
    tiers.push({ y: h1, height: h2, width: width * k1, depth: depth * k1 });
    tiers.push({ y: h1 + h2, height: height - h1 - h2, width: width * k2, depth: depth * k2 });
  } else if (!isCluster && height > 9 && tierRoll < 0.62) {
    const h1 = height * (0.56 + 0.16 * r());
    const k = 0.6 + 0.2 * r();
    tiers.push({ y: 0, height: h1, width, depth });
    tiers.push({ y: h1, height: height - h1, width: width * k, depth: depth * k });
  } else {
    tiers.push({ y: 0, height, width, depth });
  }

  const roofRoll = r();
  const roof: RoofStyle = isCluster
    ? "flat"
    : height > 17
      ? pick(roofRoll, [["spire", 0.3], ["antenna", 0.35], ["crown", 0.2], ["helipad", 0.15]])
      : height > 7
        ? pick(roofRoll, [["antenna", 0.25], ["crown", 0.25], ["dome", 0.15], ["flat", 0.35]])
        : pick(roofRoll, [["flat", 0.7], ["crown", 0.3]]);
  const top = tiers[tiers.length - 1]!;
  const topSide = Math.min(top.width, top.depth);
  const roofHeight =
    roof === "spire" ? Math.min(topSide * 1.6, height * 0.35)
    : roof === "antenna" ? 1 + height * 0.22
    : roof === "crown" ? 0.3 + 0.5 * r()
    : roof === "dome" ? topSide * 0.42
    : roof === "helipad" ? 0.12
    : 0;

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
    windowStyle: Math.floor(r() * 4) as 0 | 1 | 2 | 3,
    seed: r(),
    lot: cell,
  };
}

export function generateCity(input: CityInput): CityModel {
  const tree = buildTree(input.files);
  const side = Math.sqrt(tree.need);
  const bounds: Rect = { x: -side / 2, z: -side / 2, w: side, d: side };
  const buildings: Building[] = [];
  const districts: District[] = [];
  const streets: StreetSegment[] = [];

  const place = (node: DirNode, outer: Rect, parent: number, topLevel: number) => {
    const rect = shrink(outer, padding(node.depth));
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

    // Lot for this directory's own files competes with subdirectories for space.
    type Item = { kind: "lot" } | { kind: "dir"; node: DirNode };
    const items: { item: Item; weight: number; key: string }[] = node.children.map((child) => ({
      item: { kind: "dir", node: child },
      weight: child.need,
      key: child.name,
    }));
    if (node.files.length) {
      items.push({ item: { kind: "lot" }, weight: node.files.length * CELL * CELL * SLACK, key: "" });
    }
    items.sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const rects = squarify(
      items.map((i) => i.weight),
      rect,
    );

    items.forEach(({ item }, k) => {
      const area = rects[k]!;
      if (item.kind === "dir") {
        place(item.node, area, index, district.topLevel);
        return;
      }
      const lot = items.length > 1 ? shrink(area, LOT_PADDING) : area;
      const { cols, rows } = gridFor(node.files.length, lot.w, lot.d);
      const cellW = lot.w / cols;
      const cellD = lot.d / rows;
      node.files.forEach((file, n) => {
        const cell: Rect = { x: lot.x + (n % cols) * cellW, z: lot.z + Math.floor(n / cols) * cellD, w: cellW, d: cellD };
        buildings.push(makeBuilding(file, buildings.length, index, cell, district.elevation + PLATE_STEP));
      });
    });
  };

  place(tree, bounds, -1, -1);

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

  // Ring road around the whole city.
  const ring = { x: bounds.x - RING_ROAD / 2, z: bounds.z - RING_ROAD / 2, w: bounds.w + RING_ROAD, d: bounds.d + RING_ROAD };
  streets.push(
    { x1: ring.x, z1: ring.z, x2: ring.x + ring.w, z2: ring.z, level: 0 },
    { x1: ring.x + ring.w, z1: ring.z, x2: ring.x + ring.w, z2: ring.z + ring.d, level: 0 },
    { x1: ring.x + ring.w, z1: ring.z + ring.d, x2: ring.x, z2: ring.z + ring.d, level: 0 },
    { x1: ring.x, z1: ring.z + ring.d, x2: ring.x, z2: ring.z, level: 0 },
  );

  const maxHeight = buildings.reduce((m, b) => Math.max(m, b.baseY + b.height + b.roofHeight), 0);
  return {
    name: input.name,
    buildings,
    districts,
    streets,
    bounds: ring,
    center: { x: 0, z: 0 },
    radius: Math.hypot(ring.w, ring.d) / 2,
    maxHeight,
  };
}
