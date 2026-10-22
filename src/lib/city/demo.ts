/**
 * A fictional polyglot monorepo used for the landing-page skyline, so the
 * first thing visitors see is a living city rather than an empty grid.
 */
import type { SourceFile } from "../types";
import { seededRandom } from "./random";

export const DEMO_NAME = "neon-labs/hyperion";

const SPEC: Record<string, { exts: string[]; count: number; scale: number; names?: string[] }> = {
  "apps/web/app": { exts: ["tsx", "ts", "css"], count: 26, scale: 3200, names: ["page", "layout", "loading", "error", "route", "actions"] },
  "apps/web/app/dashboard": { exts: ["tsx", "ts"], count: 14, scale: 4200 },
  "apps/web/components": { exts: ["tsx"], count: 34, scale: 2600, names: ["Button", "Card", "Dialog", "Navbar", "Sidebar", "Chart", "Table", "Avatar", "Badge", "Tooltip"] },
  "apps/web/lib": { exts: ["ts"], count: 16, scale: 3000 },
  "apps/web/public": { exts: ["svg", "txt"], count: 6, scale: 900 },
  "apps/mobile/src": { exts: ["swift"], count: 18, scale: 5200 },
  "apps/mobile/src/views": { exts: ["swift"], count: 12, scale: 3800 },
  "packages/ui/src": { exts: ["tsx", "css"], count: 28, scale: 2200 },
  "packages/core/src": { exts: ["rs"], count: 22, scale: 9000, names: ["lib", "engine", "parser", "graph", "scheduler", "codec", "net"] },
  "packages/core/benches": { exts: ["rs"], count: 5, scale: 4000 },
  "packages/sdk/src": { exts: ["ts"], count: 15, scale: 3400 },
  "services/gateway": { exts: ["go"], count: 18, scale: 6400, names: ["main", "router", "auth", "proxy", "metrics", "config"] },
  "services/gateway/internal": { exts: ["go"], count: 14, scale: 5000 },
  "services/ingest": { exts: ["go", "sql"], count: 12, scale: 5600 },
  "ml/models": { exts: ["py"], count: 16, scale: 7200, names: ["train", "dataset", "transformer", "tokenizer", "eval"] },
  "ml/notebooks": { exts: ["py"], count: 6, scale: 12000 },
  "infra/terraform": { exts: ["toml", "yaml", "sh"], count: 12, scale: 1800 },
  "docs": { exts: ["md", "mdx"], count: 20, scale: 4800 },
  "scripts": { exts: ["sh", "js"], count: 9, scale: 1400 },
  ".github/workflows": { exts: ["yml"], count: 7, scale: 1600 },
  "": { exts: ["md", "json", "toml"], count: 7, scale: 1800, names: ["README", "package", "tsconfig", "Cargo", "LICENSE", "CONTRIBUTING", "turbo"] },
};

export function demoFiles(): SourceFile[] {
  const rand = seededRandom(0x6c17c1);
  const files: SourceFile[] = [];
  for (const [dir, spec] of Object.entries(SPEC)) {
    for (let i = 0; i < spec.count; i++) {
      const ext = spec.exts[i % spec.exts.length]!;
      const stem = spec.names?.[i] ?? `${dir.split("/").pop() || "file"}-${(i + 1).toString(36)}`;
      // Log-normal-ish sizes: mostly modest files with a few towering ones.
      const size = Math.round(spec.scale * Math.exp((rand() - 0.5) * 3.2) * (rand() < 0.08 ? 6 : 1));
      files.push({ path: dir ? `${dir}/${stem}.${ext}` : `${stem}.${ext}`, size });
    }
  }
  return files;
}
