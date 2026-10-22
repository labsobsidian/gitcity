/**
 * Pure normalization of a GitHub recursive tree into the files that become
 * buildings. No network, no Node APIs — fully unit-tested.
 */
import { basename, detectLanguage, dirname, extensionOf } from "../languages";
import type { ExclusionReason, LanguageStat, RepoStats, SourceFile } from "../types";

/** Shape of an entry in GET /repos/{o}/{r}/git/trees/{sha}?recursive=1. */
export interface RawTreeEntry {
  path: string;
  type: string;
  mode?: string;
  size?: number;
}

export const IGNORED_DIRECTORIES = new Set([
  "node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel", ".cache",
  ".parcel-cache", ".output", "dist", "build", "coverage", ".nyc_output", "__pycache__",
  ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", "bower_components",
  "jspm_packages", ".yarn", ".pnpm-store", ".gradle", ".idea", ".terraform",
]);

export const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb",
  "cargo.lock", "poetry.lock", "pipfile.lock", "uv.lock", "pdm.lock", "composer.lock", "gemfile.lock",
  "go.sum", "flake.lock", "mix.lock", "pubspec.lock", "podfile.lock", "packages.lock.json",
  "gradle.lockfile", "deno.lock", "package.resolved",
]);

export const BINARY_EXTENSIONS = new Set([
  // images
  "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp", "tif", "tiff", "avif", "heic", "psd", "ai", "sketch", "fig",
  // fonts
  "woff", "woff2", "ttf", "otf", "eot",
  // audio / video
  "mp3", "mp4", "m4a", "m4v", "wav", "ogg", "oga", "webm", "mov", "avi", "mkv", "flac", "aac",
  // archives & packages
  "zip", "gz", "tgz", "tar", "rar", "7z", "bz2", "xz", "zst", "jar", "war", "ear", "whl", "nupkg", "deb", "rpm", "dmg", "iso", "apk", "aab", "ipa",
  // compiled artifacts
  "exe", "dll", "so", "dylib", "a", "lib", "o", "obj", "class", "pyc", "pyo", "wasm", "bin", "dat", "pdb", "node",
  // databases & documents
  "db", "sqlite", "sqlite3", "mdb", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "key", "pages", "numbers",
  // 3D, ML weights, data blobs
  "glb", "fbx", "blend", "3ds", "usdz", "onnx", "pt", "pth", "ckpt", "safetensors", "npy", "npz", "h5", "pkl", "parquet", "arrow", "tflite",
]);

/** Files bigger than this are treated as generated/vendored data rather than code. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function classifyPath(path: string, size: number): ExclusionReason | null {
  const segments = path.split("/");
  for (let i = 0; i < segments.length - 1; i++) {
    if (IGNORED_DIRECTORIES.has(segments[i]!.toLowerCase())) return "ignoredDirectory";
  }
  const name = basename(path).toLowerCase();
  if (LOCKFILES.has(name)) return "lockfile";
  const ext = extensionOf(name);
  if (BINARY_EXTENSIONS.has(ext)) return "binary";
  if (/\.min\.(js|css|mjs)$/.test(name) || ext === "map" || /\.(bundle|chunk)\.js$/.test(name)) {
    return "generated";
  }
  if (size > MAX_FILE_BYTES) return "oversized";
  return null;
}

export interface NormalizeResult {
  files: SourceFile[];
  stats: RepoStats;
  simplified: boolean;
}

export function normalizeTree(entries: readonly RawTreeEntry[], budget: number): NormalizeResult {
  const excludedByReason: Partial<Record<ExclusionReason, number>> = {};
  const exclude = (reason: ExclusionReason) => {
    excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
  };

  const included: SourceFile[] = [];
  for (const entry of entries) {
    if (entry.type === "tree") continue;
    // Submodules ("commit") and symlinks (mode 120000) don't have content of their own.
    if (entry.type !== "blob" || entry.mode === "120000") {
      exclude("notAFile");
      continue;
    }
    if (!isSafePath(entry.path)) {
      exclude("notAFile");
      continue;
    }
    const size = Number.isFinite(entry.size) && entry.size! >= 0 ? Math.floor(entry.size!) : 0;
    const reason = classifyPath(entry.path, size);
    if (reason) {
      exclude(reason);
      continue;
    }
    included.push({ path: entry.path, size });
  }

  const directories = new Set<string>();
  const languages = new Map<string, LanguageStat>();
  let includedBytes = 0;
  for (const file of included) {
    includedBytes += file.size;
    for (let dir = dirname(file.path); dir && !directories.has(dir); dir = dirname(dir)) {
      directories.add(dir);
    }
    const id = detectLanguage(file.path);
    const stat = languages.get(id) ?? { id, files: 0, bytes: 0 };
    stat.files += 1;
    stat.bytes += file.size;
    languages.set(id, stat);
  }

  const { files, clusteredFiles } = applyBudget(included, budget);
  const excludedFiles = Object.values(excludedByReason).reduce((a, b) => a + (b ?? 0), 0);

  return {
    files,
    simplified: clusteredFiles > 0,
    stats: {
      treeEntries: entries.length,
      includedFiles: included.length,
      excludedFiles,
      excludedByReason,
      directories: directories.size,
      includedBytes,
      buildings: files.length,
      clusteredFiles,
      languages: [...languages.values()].sort((a, b) => b.bytes - a.bytes || b.files - a.files || a.id.localeCompare(b.id)),
    },
  };
}

/** Paths come from GitHub, but are still treated as untrusted text. */
function isSafePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  if (path.startsWith("/") || path.endsWith("/")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return !path.split("/").some((s) => s === "" || s === "." || s === "..");
}

/**
 * Keep the city within `budget` buildings. The largest files keep their own
 * building; the rest are merged into one cluster building per directory,
 * coarsening the directory depth until the clusters fit in ~10% of the budget.
 * Deterministic: ties break on path.
 */
export function applyBudget(files: readonly SourceFile[], budget: number): { files: SourceFile[]; clusteredFiles: number } {
  const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (files.length <= budget) return { files: [...files].sort(byPath), clusteredFiles: 0 };

  const reserve = Math.max(1, Math.floor(budget * 0.1));
  const sorted = [...files].sort((a, b) => b.size - a.size || byPath(a, b));
  const kept = sorted.slice(0, budget - reserve);
  const dropped = sorted.slice(budget - reserve);

  const maxDepth = dropped.reduce((m, f) => Math.max(m, f.path.split("/").length - 1), 0);
  let groups = new Map<string, { size: number; count: number }>();
  for (let depth = maxDepth; depth >= 0; depth--) {
    groups = new Map();
    for (const file of dropped) {
      const key = dirname(file.path).split("/").slice(0, depth).join("/");
      const group = groups.get(key) ?? { size: 0, count: 0 };
      group.size += file.size;
      group.count += 1;
      groups.set(key, group);
    }
    if (groups.size <= reserve) break;
  }

  const clusters: SourceFile[] = [...groups].map(([path, g]) => ({ path, size: g.size, cluster: { count: g.count } }));
  return { files: [...kept, ...clusters].sort(byPath), clusteredFiles: dropped.length };
}
