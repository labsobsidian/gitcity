/**
 * File → language classification. Shared by the server (stats) and the
 * client (building colors), so it must stay free of Node/DOM APIs.
 */

export interface Language {
  id: string;
  name: string;
  /** Neon tint used for windows, outlines and the legend. */
  color: string;
}

const L = (id: string, name: string, color: string): Language => ({ id, name, color });

export const LANGUAGES = {
  typescript: L("typescript", "TypeScript", "#3d8bff"),
  javascript: L("javascript", "JavaScript", "#f5d742"),
  python: L("python", "Python", "#43e97b"),
  rust: L("rust", "Rust", "#ff8a3d"),
  go: L("go", "Go", "#31d7f0"),
  css: L("css", "CSS", "#c27dff"),
  html: L("html", "HTML", "#ff5f7a"),
  java: L("java", "Java", "#ff7562"),
  kotlin: L("kotlin", "Kotlin", "#a68bff"),
  swift: L("swift", "Swift", "#ff9d5c"),
  c: L("c", "C", "#8aa2ff"),
  cpp: L("cpp", "C++", "#6f7dff"),
  csharp: L("csharp", "C#", "#9b6bff"),
  ruby: L("ruby", "Ruby", "#ff4d6d"),
  php: L("php", "PHP", "#8f9bff"),
  shell: L("shell", "Shell", "#a3e635"),
  vue: L("vue", "Vue", "#42d392"),
  svelte: L("svelte", "Svelte", "#ff6a3d"),
  dart: L("dart", "Dart", "#3ec6ff"),
  elixir: L("elixir", "Elixir", "#b57bff"),
  scala: L("scala", "Scala", "#ff5c5c"),
  lua: L("lua", "Lua", "#5b7cff"),
  zig: L("zig", "Zig", "#f7a41d"),
  haskell: L("haskell", "Haskell", "#9d7bff"),
  sql: L("sql", "SQL", "#e6b450"),
  markdown: L("markdown", "Markdown", "#9fc3d9"),
  data: L("data", "Data & Config", "#ffb547"),
  svg: L("svg", "SVG", "#ff8fd0"),
  other: L("other", "Other", "#7a8ca3"),
} as const satisfies Record<string, Language>;

export type LanguageId = keyof typeof LANGUAGES;

const BY_EXTENSION: Record<string, LanguageId> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", pyi: "python", ipynb: "python", pyx: "python",
  rs: "rust",
  go: "go",
  css: "css", scss: "css", sass: "css", less: "css", styl: "css", pcss: "css",
  html: "html", htm: "html", astro: "html", hbs: "html", ejs: "html", njk: "html", liquid: "html",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  swift: "swift",
  c: "c", h: "c",
  cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", ino: "cpp",
  cs: "csharp", csx: "csharp", fs: "csharp", vb: "csharp",
  rb: "ruby", erb: "ruby", rake: "ruby", gemspec: "ruby",
  php: "php", phtml: "php",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell", ps1: "shell", bat: "shell", cmd: "shell",
  vue: "vue",
  svelte: "svelte",
  dart: "dart",
  ex: "elixir", exs: "elixir", heex: "elixir", erl: "elixir",
  scala: "scala", sc: "scala", sbt: "scala", clj: "scala", cljs: "scala",
  lua: "lua",
  zig: "zig",
  hs: "haskell", ml: "haskell", mli: "haskell", elm: "haskell", purs: "haskell",
  sql: "sql", prisma: "sql", graphql: "sql", gql: "sql",
  md: "markdown", mdx: "markdown", rst: "markdown", txt: "markdown", adoc: "markdown",
  json: "data", jsonc: "data", json5: "data", yaml: "data", yml: "data", toml: "data",
  xml: "data", ini: "data", cfg: "data", conf: "data", env: "data", csv: "data",
  tsv: "data", properties: "data", gradle: "data", lock: "data", proto: "data",
  svg: "svg",
};

const BY_FILENAME: Record<string, LanguageId> = {
  dockerfile: "shell",
  makefile: "shell",
  justfile: "shell",
  rakefile: "ruby",
  gemfile: "ruby",
  procfile: "shell",
  license: "markdown",
  readme: "markdown",
  changelog: "markdown",
  ".gitignore": "data",
  ".gitattributes": "data",
  ".editorconfig": "data",
  ".npmrc": "data",
  ".nvmrc": "data",
  ".prettierrc": "data",
  ".eslintrc": "data",
};

export function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Lower-cased extension without the dot, or "" when there is none (dotfiles have none). */
export function extensionOf(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function detectLanguage(path: string): LanguageId {
  const name = basename(path).toLowerCase();
  const byName = BY_FILENAME[name];
  if (byName) return byName;
  const ext = extensionOf(name);
  if (ext && BY_EXTENSION[ext]) return BY_EXTENSION[ext];
  // "Dockerfile.dev", "README.old" and friends.
  const stem = name.split(".")[0] ?? "";
  return BY_FILENAME[stem] ?? "other";
}

export function languageOf(id: string): Language {
  return (LANGUAGES as Record<string, Language>)[id] ?? LANGUAGES.other;
}
