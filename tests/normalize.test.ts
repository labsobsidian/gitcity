import { describe, expect, it } from "vitest";
import { applyBudget, classifyPath, normalizeTree, type RawTreeEntry } from "@/lib/github/normalize";
import { detectLanguage } from "@/lib/languages";

const blob = (path: string, size = 100): RawTreeEntry => ({ path, type: "blob", mode: "100644", size });

describe("classifyPath", () => {
  it.each([
    ["node_modules/react/index.js", "ignoredDirectory"],
    ["packages/a/node_modules/x.js", "ignoredDirectory"],
    ["dist/main.js", "ignoredDirectory"],
    [".next/server/page.js", "ignoredDirectory"],
    ["coverage/lcov.info", "ignoredDirectory"],
    ["package-lock.json", "lockfile"],
    ["apps/web/pnpm-lock.yaml", "lockfile"],
    ["Cargo.lock", "lockfile"],
    ["public/logo.png", "binary"],
    ["fonts/Inter.woff2", "binary"],
    ["vendor/lib.min.js", "generated"],
    ["static/app.js.map", "generated"],
  ])("%s → %s", (path, reason) => {
    expect(classifyPath(path, 100)).toBe(reason);
  });

  it("keeps ordinary source and dotfiles", () => {
    expect(classifyPath("src/index.ts", 100)).toBeNull();
    expect(classifyPath(".github/workflows/ci.yml", 100)).toBeNull();
    expect(classifyPath("builder/build.ts", 100)).toBeNull(); // "build" only matches as a directory
    expect(classifyPath("docs/build.md", 100)).toBeNull();
  });

  it("flags oversized files", () => {
    expect(classifyPath("data/huge.json", 6 * 1024 * 1024)).toBe("oversized");
  });
});

describe("normalizeTree", () => {
  const entries: RawTreeEntry[] = [
    { path: "src", type: "tree" },
    blob("src/index.ts", 1200),
    blob("src/util/math.ts", 300),
    blob("src/styles.css", 400),
    blob("README.md", 500),
    blob("package-lock.json", 90000),
    blob("node_modules/x/index.js"),
    blob("assets/hero.png", 50000),
    { path: "vendor/sub", type: "commit", mode: "160000" },
    { path: "link", type: "blob", mode: "120000", size: 10 },
    blob("../escape.ts"),
    blob("weird//path.ts"),
  ];

  it("filters, counts exclusions and computes stats", () => {
    const { files, stats, simplified } = normalizeTree(entries, 1000);
    expect(files.map((f) => f.path)).toEqual(["README.md", "src/index.ts", "src/styles.css", "src/util/math.ts"]);
    expect(simplified).toBe(false);
    expect(stats.treeEntries).toBe(entries.length);
    expect(stats.includedFiles).toBe(4);
    expect(stats.excludedByReason).toEqual({ lockfile: 1, ignoredDirectory: 1, binary: 1, notAFile: 4 });
    expect(stats.excludedFiles).toBe(7);
    expect(stats.directories).toBe(2); // src, src/util
    expect(stats.includedBytes).toBe(2400);
    expect(stats.languages.map((l) => l.id)).toEqual(["typescript", "markdown", "css"]);
    expect(stats.languages[0]).toEqual({ id: "typescript", files: 2, bytes: 1500 });
  });

  it("is deterministic regardless of input order", () => {
    const a = normalizeTree(entries, 1000);
    const b = normalizeTree([...entries].reverse(), 1000);
    expect(b.files).toEqual(a.files);
  });

  it("treats missing or invalid sizes as zero", () => {
    const { files } = normalizeTree([{ path: "a.ts", type: "blob" }, { path: "b.ts", type: "blob", size: -5 }], 10);
    expect(files.map((f) => f.size)).toEqual([0, 0]);
  });
});

describe("applyBudget", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    path: `pkg${i % 7}/dir${i % 13}/file${i}.ts`,
    size: (i * 7919) % 10007,
  }));

  it("returns everything when under budget", () => {
    const { files, clusteredFiles } = applyBudget(many, 1000);
    expect(files).toHaveLength(500);
    expect(clusteredFiles).toBe(0);
  });

  it("never exceeds the budget and accounts for every file", () => {
    for (const budget of [10, 50, 200, 499]) {
      const { files, clusteredFiles } = applyBudget(many, budget);
      expect(files.length).toBeLessThanOrEqual(budget);
      const represented = files.reduce((n, f) => n + (f.cluster ? f.cluster.count : 1), 0);
      expect(represented).toBe(500);
      expect(clusteredFiles).toBe(files.filter((f) => f.cluster).reduce((n, f) => n + f.cluster!.count, 0));
      const bytes = files.reduce((n, f) => n + f.size, 0);
      expect(bytes).toBe(many.reduce((n, f) => n + f.size, 0));
    }
  });

  it("keeps the largest files as individual buildings", () => {
    const { files } = applyBudget(many, 100);
    const kept = files.filter((f) => !f.cluster);
    const smallestKept = Math.min(...kept.map((f) => f.size));
    const largestOverall = [...many].sort((a, b) => b.size - a.size).slice(0, kept.length);
    expect(Math.min(...largestOverall.map((f) => f.size))).toBe(smallestKept);
  });

  it("is deterministic", () => {
    expect(applyBudget([...many].reverse(), 120)).toEqual(applyBudget(many, 120));
  });
});

describe("detectLanguage", () => {
  it.each([
    ["src/a.tsx", "typescript"],
    ["lib/b.mjs", "javascript"],
    ["main.py", "python"],
    ["src/lib.rs", "rust"],
    ["cmd/main.go", "go"],
    ["styles/x.scss", "css"],
    ["Dockerfile", "shell"],
    ["Dockerfile.dev", "shell"],
    ["README", "markdown"],
    [".gitignore", "data"],
    ["config.yml", "data"],
    ["weird.xyz", "other"],
    ["noext", "other"],
  ])("%s → %s", (path, id) => {
    expect(detectLanguage(path)).toBe(id);
  });
});
