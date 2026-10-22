/**
 * Repository → city profile: the architecture style, city shape, sky,
 * weather, landmarks and signage that make each city its own. Pure and
 * deterministic: the same repository, commit and remix number always give
 * the same profile. `remix` only re-rolls artistic choices (shape among the
 * ones the structure allows, sky, weather, hue); the data mapping never changes.
 */
import { basename, detectLanguage, dirname } from "../languages";
import type { LanguageStat, SourceFile } from "../types";
import { hashString, seededRandom } from "./random";
import { LANGUAGE_STYLE, STYLES, type StyleId, type Weather } from "./styles";

export type CityForm = "grid" | "plaza" | "islands" | "river";
export type TimeOfDay = "dawn" | "dusk" | "night" | "midnight";
export type LandmarkKind = "hall" | "charter" | "port" | "shipyard" | "spire" | "giant" | "factory" | "proving" | "library";

export interface LandmarkSpec {
  kind: LandmarkKind;
  /** File path (file landmarks) or directory path (district landmarks). */
  path: string;
  target: "file" | "district";
}

export interface ProfileMeta {
  fullName: string;
  description: string | null;
  createdAt: string | null;
  pushedAt: string | null;
  stars: number;
  forks: number;
  archived: boolean;
  topics: string[];
  avatarUrl: string | null;
}

export interface ProfileInput {
  files: readonly SourceFile[];
  languages: readonly LanguageStat[];
  meta: ProfileMeta;
  remix?: number;
  /** "Now", injectable for tests. */
  now?: Date;
}

export interface CityProfile {
  seed: number;
  remix: number;
  style: StyleId;
  styleReason: string;
  form: CityForm;
  formReason: string;
  /** For `river`: top-level directories on the far bank. */
  riverBank: string[];
  /** For `islands`: the top-level monorepo folder whose packages become separate islands. */
  islandsOf: string | null;
  timeOfDay: TimeOfDay;
  skyReason: string;
  weather: Weather;
  aurora: boolean;
  /** 0 (dormant) … 1 (pushed this week): drives traffic and lit windows. */
  activity: number;
  activityReason: string;
  ruined: boolean;
  searchlights: number;
  suburbs: number;
  /** Small hue rotation (degrees) applied to accents by remixes. */
  hueShift: number;
  landmarks: LandmarkSpec[];
  signage: { title: string; owner: string; description: string | null; topics: string[]; avatarUrl: string | null; stars: number; forks: number };
}

const DAY = 86_400_000;
const NON_CODE = new Set(["markdown", "data", "svg", "other"]);
/** Styling and markup are often vendored or generated; they shouldn't outvote the actual program. */
const STYLE_VOTE_WEIGHT: Record<string, number> = { css: 0.35, html: 0.35 };
const MONOREPO_DIRS = new Set(["packages", "apps", "crates", "libs", "services", "modules", "plugins", "projects", "components"]);
const CODE_DIRS = new Set(["src", "lib", "app", "pkg", "cmd", "internal", "source", "core"]);
const TEST_DIRS = new Set(["test", "tests", "spec", "specs", "__tests__", "e2e", "testing"]);
const DOC_DIRS = new Set(["docs", "doc", "documentation", "website", "site"]);
const MANIFESTS = [
  "package.json", "cargo.toml", "go.mod", "pyproject.toml", "setup.py", "pom.xml", "build.gradle", "build.gradle.kts",
  "gemfile", "composer.json", "mix.exs", "pubspec.yaml", "deno.json", "cmakelists.txt", "makefile", "meson.build",
];
const ENTRY_STEMS = new Set(["main", "index", "app", "server", "cli", "lib", "mod", "program", "__main__"]);

function pickWeighted<T>(r: number, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((n, [, w]) => n + w, 0);
  let acc = 0;
  for (const [value, w] of options) {
    acc += w / total;
    if (r < acc) return value;
  }
  return options[options.length - 1]![0];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function chooseStyle(languages: readonly LanguageStat[]): { style: StyleId; reason: string } {
  const total = languages.reduce((n, l) => n + l.bytes, 0) || 1;
  const markdown = languages.find((l) => l.id === "markdown");
  const code = languages.filter((l) => !NON_CODE.has(l.id));
  const codeBytes = code.reduce((n, l) => n + l.bytes, 0);
  // Documentation-first repositories (handbooks, awesome-lists, docs sites) become libraries.
  if (markdown && markdown.bytes / total >= 0.5 && codeBytes / total < 0.3) {
    return { style: "archive", reason: `Markdown is ${pct(markdown.bytes / total)} of the repository` };
  }
  const votes = new Map<StyleId, number>();
  for (const l of code) {
    const style = LANGUAGE_STYLE[l.id];
    if (style) votes.set(style, (votes.get(style) ?? 0) + l.bytes * (STYLE_VOTE_WEIGHT[l.id] ?? 1));
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!ranked.length) return { style: "neon", reason: "No dominant programming language" };
  const [style, bytes] = ranked[0]!;
  const lead = code
    .filter((l) => LANGUAGE_STYLE[l.id] === style)
    .sort((a, b) => b.bytes * (STYLE_VOTE_WEIGHT[b.id] ?? 1) - a.bytes * (STYLE_VOTE_WEIGHT[a.id] ?? 1))[0]!;
  const langName = lead.id === "cpp" ? "C++" : lead.id === "csharp" ? "C#" : lead.id.charAt(0).toUpperCase() + lead.id.slice(1);
  const weighted = [...votes.values()].reduce((n, v) => n + v, 0) || 1;
  return { style, reason: `${langName} leads with ${pct(bytes / weighted)} of the code` };
}

interface TopDir {
  name: string;
  files: number;
  subdirs: Set<string>;
}

function topLevel(files: readonly SourceFile[]): { dirs: TopDir[]; rootFiles: number } {
  const map = new Map<string, TopDir>();
  let rootFiles = 0;
  for (const f of files) {
    const dir = f.cluster ? f.path : dirname(f.path);
    if (!dir) {
      rootFiles += 1;
      continue;
    }
    const [head, second] = dir.split("/");
    const entry = map.get(head!) ?? { name: head!, files: 0, subdirs: new Set<string>() };
    entry.files += f.cluster ? f.cluster.count : 1;
    if (second) entry.subdirs.add(second);
    map.set(head!, entry);
  }
  return { dirs: [...map.values()].sort((a, b) => b.files - a.files || (a.name < b.name ? -1 : 1)), rootFiles };
}

type FormChoice = { form: CityForm; reason: string; bank: string[]; islandsOf: string | null };

function chooseForm(files: readonly SourceFile[], rand: () => number, remix: number): FormChoice {
  const { dirs } = topLevel(files);
  const total = dirs.reduce((n, d) => n + d.files, 0) || 1;
  const candidates: FormChoice[] = [];

  const mono = dirs.find((d) => MONOREPO_DIRS.has(d.name.toLowerCase()) && d.subdirs.size >= 3 && d.subdirs.size <= 120);
  if (mono) candidates.push({ form: "islands", reason: `Monorepo: ${mono.subdirs.size} packages in ${mono.name}/`, bank: [], islandsOf: mono.name });

  const tests = dirs.find((d) => TEST_DIRS.has(d.name.toLowerCase()));
  const code = dirs.find((d) => CODE_DIRS.has(d.name.toLowerCase()));
  if (tests && code && tests.files / total >= 0.08) {
    const bank = dirs.filter((d) => TEST_DIRS.has(d.name.toLowerCase()) || DOC_DIRS.has(d.name.toLowerCase())).map((d) => d.name);
    candidates.push({ form: "river", reason: `${code.name}/ and ${tests.name}/ face each other across the river`, bank, islandsOf: null });
  }

  if (dirs.length >= 6 && (dirs[0]?.files ?? 0) / total < 0.45) {
    candidates.push({ form: "plaza", reason: `${dirs.length} neighborhoods around a central plaza`, bank: [], islandsOf: null });
  }

  if (dirs.length > 80 || (dirs.length < 2 && !mono)) {
    return { form: "grid", reason: dirs.length < 2 ? "A compact city block" : "A dense grid", bank: [], islandsOf: null };
  }
  // The natural shape wins by default; remixes cycle through every shape the structure supports.
  const all: FormChoice[] = [...candidates, { form: "grid", reason: "A classic city grid", bank: [], islandsOf: null }];
  if (dirs.length >= 4 && !candidates.some((c) => c.form === "plaza")) {
    all.push({ form: "plaza", reason: "Neighborhoods around a central plaza", bank: [], islandsOf: null });
  }
  if (remix === 0) return all[0]!;
  return all[Math.floor(rand() * all.length)]!;
}

function chooseLandmarks(files: readonly SourceFile[]): LandmarkSpec[] {
  const out: LandmarkSpec[] = [];
  const real = files.filter((f) => !f.cluster);
  const depth = (p: string) => p.split("/").length - 1;
  const byShallow = (a: SourceFile, b: SourceFile) => depth(a.path) - depth(b.path) || (a.path < b.path ? -1 : 1);
  const find = (pred: (name: string, f: SourceFile) => boolean) => real.filter((f) => pred(basename(f.path).toLowerCase(), f)).sort(byShallow)[0];
  const add = (kind: LandmarkKind, f: SourceFile | undefined) => {
    if (f && !out.some((l) => l.path === f.path)) out.push({ kind, path: f.path, target: "file" });
  };

  add("hall", find((n, f) => n.startsWith("readme") && depth(f.path) <= 1));
  add("charter", find((n, f) => /^(license|licence|copying)/.test(n) && depth(f.path) === 0));
  add("port", find((n, f) => MANIFESTS.includes(n) && depth(f.path) <= 1));
  add("shipyard", find((n) => n === "dockerfile" || n.startsWith("dockerfile.") || /^(docker-)?compose\.ya?ml$/.test(n)));
  const entries = real
    .filter((f) => {
      const stem = basename(f.path).toLowerCase().split(".")[0] ?? "";
      const lang = detectLanguage(f.path);
      return ENTRY_STEMS.has(stem) && !NON_CODE.has(lang) && depth(f.path) <= 3;
    })
    .sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : 1));
  add("spire", entries[0]);
  add("giant", [...real].sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : 1))[0]);

  const dirs = new Set(files.map((f) => (f.cluster ? f.path : dirname(f.path))));
  const allDirs = new Set<string>();
  for (const d of dirs) for (let p = d; p; p = dirname(p)) allDirs.add(p);
  const firstDir = (pred: (name: string, path: string) => boolean) =>
    [...allDirs].filter((p) => pred(basename(p).toLowerCase(), p)).sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1))[0];
  const addDir = (kind: LandmarkKind, path: string | undefined) => {
    if (path !== undefined) out.push({ kind, path, target: "district" });
  };
  addDir("factory", firstDir((_, p) => p === ".github/workflows" || p === ".circleci" || p === ".gitlab"));
  addDir("proving", firstDir((n) => TEST_DIRS.has(n)));
  addDir("library", firstDir((n) => DOC_DIRS.has(n)));
  return out.slice(0, 9);
}

export function buildProfile(input: ProfileInput): CityProfile {
  const { meta } = input;
  const remix = Math.max(0, Math.floor(input.remix ?? 0));
  const base = hashString(meta.fullName.toLowerCase());
  const seed = (base ^ Math.imul(remix, 0x9e3779b1)) >>> 0;
  const rand = seededRandom(seed);
  const now = (input.now ?? new Date()).getTime();

  const { style, reason: styleReason } = chooseStyle(input.languages);
  const formRand = seededRandom(seed ^ 0x51ed);
  const { form, reason: formReason, bank, islandsOf } = chooseForm(input.files, formRand, remix);

  // Sky: young repositories wake at dawn, veterans sit under a starry midnight.
  const created = meta.createdAt ? Date.parse(meta.createdAt) : now;
  const ageYears = Math.max(0, (now - created) / (365 * DAY));
  const skies: TimeOfDay[] = ["dawn", "dusk", "night", "midnight"];
  let skyIndex = ageYears < 1 ? 0 : ageYears < 4 ? 1 : ageYears < 9 ? 2 : 3;
  if (remix > 0) skyIndex = Math.min(3, Math.max(0, skyIndex + Math.floor(rand() * 3) - 1));
  else rand();
  const timeOfDay = skies[skyIndex]!;
  const ageText = ageYears < 1 ? `${Math.max(1, Math.round(ageYears * 12))} months old` : `${Math.round(ageYears)} years old`;

  // Activity: how recently anyone pushed.
  const pushed = meta.pushedAt ? Date.parse(meta.pushedAt) : now;
  const days = Math.max(0, (now - pushed) / DAY);
  const activity = meta.archived ? 0.05 : days < 7 ? 1 : days < 30 ? 0.85 : days < 180 ? 0.6 : days < 730 ? 0.35 : 0.18;
  const activityReason = meta.archived
    ? "Archived: the lights have gone out"
    : days < 1
      ? "Pushed today: rush hour"
      : days < 7
        ? `Pushed ${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} ago: the city is busy`
        : days < 180
          ? `Last push ${Math.round(days)} days ago`
          : `Quiet for ${Math.round(days / 30)} months`;

  const def = STYLES[style];
  const weather: Weather = meta.archived ? "haze" : pickWeighted(rand(), def.weather);
  const stars = Math.max(0, meta.stars);
  const forks = Math.max(0, meta.forks);
  const [owner = "", repoName = meta.fullName] = meta.fullName.split("/");

  return {
    seed,
    remix,
    style,
    styleReason,
    form,
    formReason,
    riverBank: form === "river" ? bank : [],
    islandsOf: form === "islands" ? islandsOf : null,
    timeOfDay,
    skyReason: `${ageText}: ${timeOfDay === "dawn" ? "a new day" : timeOfDay === "dusk" ? "dusk falls" : timeOfDay === "night" ? "night city" : "deep midnight"}`,
    weather,
    aurora: !meta.archived && stars >= 20_000 && skyIndex >= 2,
    activity,
    activityReason,
    ruined: meta.archived,
    searchlights: meta.archived ? 0 : Math.min(8, Math.round(Math.log10(stars + 1) * 1.6)),
    suburbs: Math.min(14, Math.round(Math.log2(forks + 1))),
    hueShift: remix === 0 ? 0 : Math.round((rand() - 0.5) * 50),
    landmarks: chooseLandmarks(input.files),
    signage: {
      title: repoName,
      owner,
      description: meta.description ? meta.description.slice(0, 140) : null,
      topics: meta.topics.slice(0, 6),
      avatarUrl: meta.avatarUrl,
      stars,
      forks,
    },
  };
}

export const LANDMARK_INFO: Record<LandmarkKind, { name: string; color: string }> = {
  hall: { name: "Town Hall", color: "#31E6B0" },
  charter: { name: "Charter Monument", color: "#f5c46b" },
  port: { name: "Dependency Port", color: "#31BDE6" },
  shipyard: { name: "Container Yard", color: "#5b8cff" },
  spire: { name: "Central Spire", color: "#ff5fa2" },
  giant: { name: "The Giant", color: "#ffb547" },
  factory: { name: "CI Factory", color: "#ff8a3d" },
  proving: { name: "Proving Grounds", color: "#a3e635" },
  library: { name: "Grand Library", color: "#9fc3d9" },
};
