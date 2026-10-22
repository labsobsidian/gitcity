import { describe, expect, it } from "vitest";
import { demoFiles } from "@/lib/city/demo";
import { generateCity, gridFor, heightForSize, MAX_HEIGHT, MIN_HEIGHT } from "@/lib/city/generate";
import { squarify } from "@/lib/city/squarify";
import type { Building, CityModel, Rect } from "@/lib/city/types";
import { applyBudget } from "@/lib/github/normalize";
import type { SourceFile } from "@/lib/types";

const EPS = 1e-6;

function footprint(b: Building): Rect {
  return { x: b.x - b.width / 2, z: b.z - b.depth / 2, w: b.width, d: b.depth };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.z < b.z + b.d - EPS && b.z < a.z + a.d - EPS;
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.z >= outer.z - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.z + inner.d <= outer.z + outer.d + EPS
  );
}

/** Pairwise overlap check through a coarse spatial hash. */
function findOverlap(city: CityModel): [Building, Building] | null {
  const size = 8;
  const buckets = new Map<string, Building[]>();
  for (const b of city.buildings) {
    const f = footprint(b);
    for (let gx = Math.floor(f.x / size); gx <= Math.floor((f.x + f.w) / size); gx++) {
      for (let gz = Math.floor(f.z / size); gz <= Math.floor((f.z + f.d) / size); gz++) {
        const key = `${gx},${gz}`;
        const list = buckets.get(key) ?? [];
        for (const other of list) if (overlaps(footprint(other), f)) return [other, b];
        list.push(b);
        buckets.set(key, list);
      }
    }
  }
  return null;
}

function syntheticRepo(count: number, seed = 1): SourceFile[] {
  const files: SourceFile[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const dirs = ["", "src", "src/components", "src/components/ui", "src/lib", "docs", "a/b/c/d/e/f", "tests", "packages/x/src", "packages/y"];
  for (let i = 0; i < count; i++) {
    const dir = dirs[Math.floor(rnd() * dirs.length)]!;
    const ext = ["ts", "tsx", "py", "rs", "go", "css", "md", "json"][i % 8];
    files.push({ path: dir ? `${dir}/f${i}.${ext}` : `f${i}.${ext}`, size: Math.floor(rnd() ** 3 * 200000) });
  }
  return files;
}

describe("squarify", () => {
  it("tiles the rectangle exactly with proportional areas", () => {
    const rect = { x: 0, z: 0, w: 30, d: 20 };
    const weights = [60, 30, 20, 10, 5, 5, 1];
    const rects = squarify(weights, rect);
    const total = weights.reduce((a, b) => a + b, 0);
    rects.forEach((r, i) => {
      expect(r.w * r.d).toBeCloseTo((weights[i]! / total) * 600, 6);
      expect(inside(r, rect)).toBe(true);
    });
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
  });
});

describe("gridFor", () => {
  it("fits n cells and prefers square-ish cells", () => {
    for (const [n, w, d] of [[1, 5, 5], [7, 10, 10], [12, 40, 5], [30, 3, 50]] as const) {
      const { cols, rows } = gridFor(n, w, d);
      expect(cols * rows).toBeGreaterThanOrEqual(n);
      expect(cols).toBeLessThanOrEqual(n);
    }
    expect(gridFor(12, 40, 5).cols).toBeGreaterThan(gridFor(12, 40, 5).rows);
  });
});

describe("heightForSize", () => {
  it("is monotonic, logarithmic and clamped", () => {
    expect(heightForSize(0)).toBe(MIN_HEIGHT);
    expect(heightForSize(1e12)).toBe(MAX_HEIGHT);
    expect(heightForSize(10_000)).toBeGreaterThan(heightForSize(1_000));
    // 10× more bytes adds far less than 10× height.
    expect(heightForSize(100_000) / heightForSize(10_000)).toBeLessThan(2);
  });
});

describe("generateCity", () => {
  const files = syntheticRepo(1500);
  const city = generateCity({ name: "test/repo", files });

  it("creates one building per file", () => {
    expect(city.buildings).toHaveLength(files.length);
    expect(new Set(city.buildings.map((b) => b.path))).toEqual(new Set(files.map((f) => f.path)));
  });

  it("places buildings without overlaps", () => {
    expect(findOverlap(city)).toBeNull();
  });

  it("keeps every building inside its lot and its district plate", () => {
    for (const b of city.buildings) {
      expect(inside(footprint(b), b.lot)).toBe(true);
      expect(inside(footprint(b), city.districts[b.districtIndex]!.rect)).toBe(true);
      for (const tier of b.tiers) {
        expect(tier.width).toBeLessThanOrEqual(b.width + EPS);
        expect(tier.depth).toBeLessThanOrEqual(b.depth + EPS);
      }
    }
  });

  it("nests districts inside their parents and maps buildings to their directory", () => {
    for (const d of city.districts) {
      if (d.parent === -1) continue;
      expect(inside(d.outer, city.districts[d.parent]!.rect)).toBe(true);
    }
    for (const b of city.buildings) {
      const dir = b.path.includes("/") ? b.path.slice(0, b.path.lastIndexOf("/")) : "";
      expect(city.districts[b.districtIndex]!.path).toBe(dir);
    }
  });

  it("collapses single-child directory chains into one district", () => {
    const chain = city.districts.find((d) => d.path === "a/b/c/d/e/f");
    expect(chain?.name).toBe("a/b/c/d/e/f");
    expect(city.districts.some((d) => d.path === "a/b")).toBe(false);
  });

  it("is deterministic and independent of input order", () => {
    const again = generateCity({ name: "test/repo", files: [...files].reverse() });
    expect(again).toEqual(city);
  });

  it("keeps a file's look stable when unrelated files change", () => {
    const changed = generateCity({ name: "test/repo", files: [...files.slice(0, 1000), { path: "new/file.ts", size: 10 }] });
    const before = city.buildings.find((b) => b.path === files[0]!.path)!;
    const after = changed.buildings.find((b) => b.path === files[0]!.path)!;
    expect(after.roof).toBe(before.roof);
    expect(after.windowStyle).toBe(before.windowStyle);
    expect(after.height).toBe(before.height);
  });

  it("rolls building counts up to every ancestor district", () => {
    expect(city.districts[0]!.buildingCount).toBe(files.length);
    expect(city.districts[0]!.bytes).toBe(files.reduce((n, f) => n + f.size, 0));
  });

  it("handles a single root file and the demo repository", () => {
    const tiny = generateCity({ name: "t", files: [{ path: "README.md", size: 10 }] });
    expect(tiny.buildings).toHaveLength(1);
    const demo = generateCity({ name: "demo", files: demoFiles() });
    expect(findOverlap(demo)).toBeNull();
  });

  it("lays out clustered (budgeted) repositories without overlaps", () => {
    const big = syntheticRepo(20000, 7);
    const { files: budgeted } = applyBudget(big, 3000);
    const clustered = generateCity({ name: "big", files: budgeted });
    expect(clustered.buildings).toHaveLength(budgeted.length);
    expect(clustered.buildings.some((b) => b.cluster)).toBe(true);
    expect(findOverlap(clustered)).toBeNull();
  });

  it("generates a 15k-building city quickly", () => {
    const huge = syntheticRepo(15000, 3);
    const start = performance.now();
    generateCity({ name: "huge", files: huge });
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
