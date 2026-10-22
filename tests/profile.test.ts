import { describe, expect, it } from "vitest";
import { generateCity } from "@/lib/city/generate";
import { buildProfile, type ProfileMeta } from "@/lib/city/profile";
import type { Building, CityModel, Rect } from "@/lib/city/types";
import { normalizeTree } from "@/lib/github/normalize";
import type { SourceFile } from "@/lib/types";

const NOW = new Date("2026-10-22T00:00:00Z");

function meta(over: Partial<ProfileMeta> = {}): ProfileMeta {
  return {
    fullName: "acme/widget",
    description: "A widget",
    createdAt: "2019-01-01T00:00:00Z",
    pushedAt: "2026-10-20T00:00:00Z",
    stars: 1200,
    forks: 40,
    archived: false,
    topics: ["widgets"],
    avatarUrl: null,
    ...over,
  };
}

function repo(files: [string, number][]) {
  const { files: normalized, stats } = normalizeTree(
    files.map(([path, size]) => ({ path, type: "blob", size })),
    6000,
  );
  return { files: normalized, languages: stats.languages };
}

const rustRepo = repo([
  ["Cargo.toml", 900],
  ["README.md", 4000],
  ["LICENSE", 1000],
  ["src/main.rs", 30000],
  ["src/lib.rs", 12000],
  ["src/parser/mod.rs", 9000],
  ["src/parser/lexer.rs", 15000],
  ["tests/integration.rs", 6000],
  ["tests/parser.rs", 5000],
  ["docs/guide.md", 3000],
  [".github/workflows/ci.yml", 800],
  ["Dockerfile", 400],
]);

const monorepo = repo(
  ["a", "b", "c", "d", "e"].flatMap((pkg) => [
    [`packages/${pkg}/package.json`, 600] as [string, number],
    [`packages/${pkg}/src/index.ts`, 4000] as [string, number],
    [`packages/${pkg}/src/util.ts`, 2000] as [string, number],
  ]).concat([["package.json", 900], ["README.md", 2000]]),
);

describe("buildProfile", () => {
  it("is deterministic", () => {
    const a = buildProfile({ ...rustRepo, meta: meta(), now: NOW });
    const b = buildProfile({ ...rustRepo, meta: meta(), now: NOW });
    expect(b).toEqual(a);
  });

  it("derives the architecture style from the language mix", () => {
    expect(buildProfile({ ...rustRepo, meta: meta(), now: NOW }).style).toBe("foundry");
    expect(buildProfile({ ...monorepo, meta: meta(), now: NOW }).style).toBe("neon");
    const py = repo([["app/main.py", 9000], ["app/models.py", 7000], ["README.md", 800]]);
    expect(buildProfile({ ...py, meta: meta(), now: NOW }).style).toBe("greenhouse");
    // Vendored CSS shouldn't outvote the Java application it styles.
    const java = repo([["src/main/java/App.java", 9000], ["src/main/java/Owner.java", 6000], ["src/main/resources/static/app.css", 30000]]);
    expect(buildProfile({ ...java, meta: meta(), now: NOW }).style).toBe("corporate");
    const docs = repo([["README.md", 90000], ["chapters/one.md", 40000], ["tools/build.js", 2000]]);
    expect(buildProfile({ ...docs, meta: meta(), now: NOW }).style).toBe("archive");
  });

  it("derives the city shape from the folder structure", () => {
    expect(buildProfile({ ...monorepo, meta: meta(), now: NOW }).form).toBe("islands");
    const river = buildProfile({ ...rustRepo, meta: meta(), now: NOW });
    expect(river.form).toBe("river");
    expect(river.riverBank).toEqual(expect.arrayContaining(["tests", "docs"]));
  });

  it("maps age to the sky and recency to activity", () => {
    const young = buildProfile({ ...rustRepo, meta: meta({ createdAt: "2026-06-01T00:00:00Z" }), now: NOW });
    const old = buildProfile({ ...rustRepo, meta: meta({ createdAt: "2012-01-01T00:00:00Z" }), now: NOW });
    expect(young.timeOfDay).toBe("dawn");
    expect(old.timeOfDay).toBe("midnight");
    const busy = buildProfile({ ...rustRepo, meta: meta(), now: NOW });
    const quiet = buildProfile({ ...rustRepo, meta: meta({ pushedAt: "2022-01-01T00:00:00Z" }), now: NOW });
    expect(busy.activity).toBeGreaterThan(quiet.activity);
    const archived = buildProfile({ ...rustRepo, meta: meta({ archived: true }), now: NOW });
    expect(archived.ruined).toBe(true);
    expect(archived.searchlights).toBe(0);
  });

  it("scales searchlights with stars and suburbs with forks", () => {
    const small = buildProfile({ ...rustRepo, meta: meta({ stars: 3, forks: 0 }), now: NOW });
    const huge = buildProfile({ ...rustRepo, meta: meta({ stars: 200_000, forks: 40_000 }), now: NOW });
    expect(huge.searchlights).toBeGreaterThan(small.searchlights);
    expect(huge.suburbs).toBeGreaterThan(small.suburbs);
    expect(huge.searchlights).toBeLessThanOrEqual(8);
    expect(huge.suburbs).toBeLessThanOrEqual(14);
  });

  it("finds landmarks from well-known files and folders", () => {
    const p = buildProfile({ ...rustRepo, meta: meta(), now: NOW });
    const kinds = Object.fromEntries(p.landmarks.map((l) => [l.kind, l.path]));
    expect(kinds).toMatchObject({
      hall: "README.md",
      charter: "LICENSE",
      port: "Cargo.toml",
      shipyard: "Dockerfile",
      spire: "src/main.rs",
      factory: ".github/workflows",
      proving: "tests",
      library: "docs",
    });
  });

  it("remix changes the art, never the data mapping", () => {
    const base = buildProfile({ ...rustRepo, meta: meta(), now: NOW });
    const remixes = [1, 2, 3, 4, 5].map((remix) => buildProfile({ ...rustRepo, meta: meta(), now: NOW, remix }));
    for (const r of remixes) {
      expect(r.style).toBe(base.style);
      expect(r.landmarks).toEqual(base.landmarks);
      expect(r.activity).toBe(base.activity);
    }
    const variety = new Set(remixes.map((r) => `${r.form}|${r.timeOfDay}|${r.weather}|${r.hueShift}`));
    expect(variety.size).toBeGreaterThan(1);
  });
});

function footprint(b: Building): Rect {
  return { x: b.x - b.width / 2, z: b.z - b.depth / 2, w: b.width, d: b.depth };
}
const EPS = 1e-6;
function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.z < b.z + b.d - EPS && b.z < a.z + a.d - EPS;
}
function inside(inner: Rect, outer: Rect) {
  return inner.x >= outer.x - EPS && inner.z >= outer.z - EPS && inner.x + inner.w <= outer.x + outer.w + EPS && inner.z + inner.d <= outer.z + outer.d + EPS;
}
function hasOverlap(city: CityModel) {
  const fs = city.buildings.map(footprint);
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) if (overlaps(fs[i]!, fs[j]!)) return true;
  return false;
}

function bigRepo(dirs: number, filesPerDir: number): SourceFile[] {
  const out: SourceFile[] = [];
  for (let d = 0; d < dirs; d++) for (let f = 0; f < filesPerDir + (d % 5) * 3; f++) out.push({ path: `dir${d}/sub${f % 3}/file${f}.ts`, size: 500 + ((d * 97 + f * 31) % 9000) });
  out.push({ path: "README.md", size: 3000 }, { path: "package.json", size: 800 });
  return out;
}

describe("generateCity forms", () => {
  const files = bigRepo(14, 12);
  for (const form of ["grid", "plaza", "islands", "river"] as const) {
    it(`${form}: no overlapping buildings or districts, everything nested`, () => {
      const p = buildProfile({ files, languages: [{ id: "typescript", files: 1, bytes: 1 }], meta: meta(), now: NOW });
      const profile = { ...p, form, riverBank: form === "river" ? ["dir0", "dir3", "dir7"] : [] };
      const city = generateCity({ name: "acme/widget", files, profile });
      expect(city.form).toBe(form);
      expect(city.buildings).toHaveLength(files.length);
      expect(hasOverlap(city)).toBe(false);
      const tops = city.districts.filter((d) => d.depth === 1);
      for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) expect(overlaps(tops[i]!.outer, tops[j]!.outer)).toBe(false);
      for (const d of city.districts) if (d.parent >= 0) expect(inside(d.outer, city.districts[d.parent]!.rect)).toBe(true);
      for (const b of city.buildings) expect(inside(footprint(b), city.districts[b.districtIndex]!.rect)).toBe(true);
      if (form === "islands" || form === "river") {
        expect(city.water.length).toBeGreaterThan(0);
        expect(city.bridges.length).toBeGreaterThan(0);
      }
      if (form === "plaza") {
        // Nothing is built on the plaza.
        for (const b of city.buildings) expect(Math.hypot(b.x, b.z)).toBeGreaterThan(city.plaza!.radius * 0.99 - Math.max(b.width, b.depth));
      }
      expect(generateCity({ name: "acme/widget", files: [...files].reverse(), profile })).toEqual(city);
    });
  }

  it("islands: a monorepo's packages each become an island", () => {
    const files: SourceFile[] = [];
    for (const pkg of ["core", "cli", "ui", "server", "utils"]) {
      for (let f = 0; f < 8; f++) files.push({ path: `packages/${pkg}/src/file${f}.ts`, size: 800 + f * 300 });
      files.push({ path: `packages/${pkg}/package.json`, size: 500 });
    }
    files.push({ path: "packages/README.md", size: 900 }, { path: "README.md", size: 2000 }, { path: "scripts/release.js", size: 1500 });
    const p = buildProfile({ files, languages: [{ id: "typescript", files: 1, bytes: 1 }], meta: meta(), now: NOW });
    expect(p.form).toBe("islands");
    expect(p.islandsOf).toBe("packages");
    const city = generateCity({ name: "acme/mono", files, profile: p });
    expect(hasOverlap(city)).toBe(false);
    const group = city.districts.find((d) => d.path === "packages")!;
    expect(group.virtual).toBe(true);
    const islands = city.districts.filter((d) => d.parent === group.index);
    expect(islands.map((d) => d.name).sort()).toEqual(["cli", "core", "server", "ui", "utils"]);
    // Real (non-virtual) top-level districts and package islands never overlap each other.
    const solid = city.districts.filter((d) => !d.virtual && d.depth > 0 && (d.parent === 0 || d.parent === group.index));
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) expect(overlaps(solid[i]!.outer, solid[j]!.outer)).toBe(false);
    for (const b of city.buildings) expect(inside(footprint(b), city.districts[b.districtIndex]!.rect)).toBe(true);
    expect(city.bridges.length).toBeGreaterThanOrEqual(islands.length);
  });

  it("marks resolved landmarks on buildings and districts", () => {
    const p = buildProfile({ ...rustRepo, meta: meta(), now: NOW });
    const city = generateCity({ name: "acme/widget", files: rustRepo.files, profile: p });
    const kinds = new Set(city.landmarks.map((l) => l.kind));
    expect(kinds).toEqual(new Set(["hall", "charter", "port", "shipyard", "spire", "factory", "proving", "library"]));
    const hall = city.landmarks.find((l) => l.kind === "hall")!;
    expect(city.buildings[hall.building!]!.path).toBe("README.md");
    expect(city.buildings[hall.building!]!.roof).toBe("dome");
  });

  it("applies style massing and roofs", () => {
    const base = buildProfile({ ...rustRepo, meta: meta(), now: NOW });
    const foundry = generateCity({ name: "x", files: rustRepo.files, profile: { ...base, style: "foundry", form: "grid" } });
    const corporate = generateCity({ name: "x", files: rustRepo.files, profile: { ...base, style: "corporate", form: "grid" } });
    const h = (c: CityModel) => c.buildings.reduce((n, b) => n + b.height, 0);
    expect(h(corporate)).toBeGreaterThan(h(foundry));
    expect(foundry.style).toBe("foundry");
  });

  it("packs 80 top-level districts around a plaza quickly", () => {
    const files = bigRepo(80, 6);
    const p = buildProfile({ files, languages: [], meta: meta(), now: NOW });
    const start = performance.now();
    const city = generateCity({ name: "wide", files, profile: { ...p, form: "plaza" } });
    expect(performance.now() - start).toBeLessThan(2000);
    expect(hasOverlap(city)).toBe(false);
  });
});
