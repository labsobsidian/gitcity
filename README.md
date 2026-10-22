# GitCity

**Every codebase has a skyline.**

GitCity turns any public GitHub repository into an explorable 3D cyberpunk city. Directories become districts, files become
buildings: taller for bigger files, lit in the color of their language. Paste a URL and watch the city rise.

```
https://github.com/vercel/next.js   →   a 5,700-building metropolis with Turbopack's Rust quarter glowing orange
```

## Features (v0.1)

- **Any public repo**: `https://github.com/owner/repo`, `github.com/owner/repo/tree/branch`, `git@github.com:owner/repo.git`,
  `owner/repo` or `owner/repo@ref`. Deep links work: `/?repo=facebook/react`.
- **Deterministic cities**: the same commit always produces the same layout. Each file's silhouette is seeded by its path, so it
  keeps its look across commits (groundwork for the v0.2 "Living City").
- **Real GitHub data, pinned to a commit**: the inspector shows each file's real size, language and district, and links to the
  file at that exact commit.
- **Built for big repos**: a building budget (default 6,000) keeps the largest files as their own buildings and merges the rest
  into grey "cluster" blocks per directory, with a notice in the stats panel. Truncated Git trees are detected and flagged.
- **Rendered on the GPU**: windows, neon outlines, the rise animation and hover/selection highlights run in one custom shader on
  instanced meshes. A whole city is about a dozen draw calls.
- **Polish**: district-by-district reveal, scan pulses while loading, traffic on the avenues, blinking antenna beacons, bloom,
  an auto-orbit, keyboard shortcuts, `prefers-reduced-motion` support, and quality that drops automatically on slow GPUs.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add GITHUB_TOKEN
npm run dev                  # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit tests (URL parsing, normalization, budgeting, layout, GitHub client) |
| `npm run typecheck` | TypeScript |
| `npm run preview` | Build for Cloudflare and run it locally in the Workers runtime |
| `npm run deploy` | Build for Cloudflare and deploy the Worker |

Opt-in live tests hit the real GitHub API:

```bash
GITCITY_LIVE=1 GITHUB_TOKEN=... npx vitest run tests/live-github.test.ts
# Also prove a private repo the token CAN read is still refused:
GITCITY_LIVE=1 GITCITY_LIVE_PRIVATE_REPO=owner/private-repo GITHUB_TOKEN=... npx vitest run tests/live-github.test.ts
```

## Configuration

All optional. Server-side only, never sent to the browser.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | none | Raises GitHub's limit from 60 to 5,000 requests/hour. Use a **fine-grained token with public-repository read access only**. GitCity refuses private repos regardless (it fails closed on `private`/`visibility`). |
| `GITCITY_BUILDING_BUDGET` | `6000` | Default buildings per city (clamped to 200 – 15,000). |
| `GITCITY_RATE_LIMIT_PER_MINUTE` | `40` | Per-client requests per minute to the API routes (best effort, per instance). |

A city costs 3 GitHub requests (repo metadata, commit SHA, recursive tree). Without a token GitHub allows 60 requests an
hour per IP, and on Cloudflare the outbound IPs are shared with other Workers, so **a deployed instance needs a token**.

## Architecture

```
src/
  lib/                      Pure TypeScript, shared by server and browser, no React or three.js
    github/parse-url.ts     Strict input → { owner, repo, ref }
    github/normalize.ts     Git tree → filtered files, stats, building budget (clusters)
    city/generate.ts        Files → CityModel (districts, buildings, streets)
    city/squarify.ts        Squarified treemap
    city/random.ts          Seeded hashing / PRNG
    languages.ts            Extension → language → neon color
    types.ts                Wire contract (RepoSummary, RepoTree, errors)
  server/                   GitHub REST client, in-process + edge caches, throttling (server-only)
  app/api/repo              GET ?repo=…                → metadata + resolved commit SHA
  app/api/tree              GET ?owner&repo&sha&budget → normalized files + stats (immutable per SHA)
  components/scene/         React Three Fiber renderer
    cityMeshes.ts           CityModel → instanced meshes (bodies, roofs, plates, outlines, traffic)
    shaders.ts              Building / line / traffic GLSL
    CameraRig, Ground, labels, CityScene, CityContent
  components/ui/            Top bar, stats, inspector, controls, status overlays
  components/CityExperience.tsx   State machine: demo → loading → city / error
```

### Data flow

1. The browser validates the input, then calls `/api/repo`, which fetches metadata, refuses private repositories and resolves
   the ref to a 40-character commit SHA.
2. It then calls `/api/tree` with that SHA. The server downloads the recursive tree (size-capped), normalizes it and applies
   the building budget. The response is keyed by an immutable SHA, so it's cached for a long time: in-process LRU, plus
   Cloudflare's Cache API in each data center (`src/server/edge-cache.ts`).
3. The browser streams the tree (showing bytes received), runs `generateCity`, and hands the model to the renderer.

### Mapping

| GitHub | City |
| --- | --- |
| Repository | City (with a ring road) |
| Directory | District plate with neon outline; nested directories form terraces. Single-child chains (`src/main/java/com/acme`) collapse into one district, like GitHub's file browser. |
| File | Building, one per plot in its district's grid, so overlaps can't happen |
| File size | Height: `0.9 + 3.4·ln(1 + bytes/220)`, clamped to 0.9 – 40 |
| Language | Window and outline color |
| Path hash | Tiers, roof (spire / antenna / crown / dome / helipad), window pattern, footprint jitter |

**Layout**: each directory asks for the area its contents need plus a street margin. A squarified treemap splits that area
between subdirectories and a lot for the directory's own files, and files fill the lot's grid in name order. Tests check for no
overlaps, containment and determinism on repositories of up to 20k files.

**Filtered out**: `node_modules`, `.git`, `.next`, `dist`, `build`, `coverage` and similar folders; lockfiles; binary assets
(images, fonts, media, archives, compiled artifacts, model weights); minified files and source maps; files over 5 MB;
submodules and symlinks. The stats panel lists what was skipped.

### Security notes

- Owner, repo and ref are validated strictly and only ever reach `api.github.com` paths, URI-encoded. Hosts other than
  github.com and URLs with credentials are rejected.
- Every GitHub response is shape-checked, and bodies are read with byte caps (2 MB metadata, 48 MB tree).
- Paths and names are rendered as text only. Paths with `..`, empty segments or control characters are dropped.
- Private repositories are refused even when the token can see them (verified by the opt-in live test).
- Nothing is stored. Caches are in memory and keyed by public commit SHAs.

## Deploying to Cloudflare Workers

GitCity runs on Cloudflare Workers through the [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare).
Configuration lives in `wrangler.jsonc` (worker `gitcity`) and `open-next.config.ts`. The Worker is about 1 MB gzipped,
inside the free plan's 3 MB limit, and needs no KV, R2 or D1.

```bash
npx wrangler login                       # once
npx wrangler secret put GITHUB_TOKEN     # fine-grained token, public repositories read-only
npm run deploy                           # → https://gitcity.<your-subdomain>.workers.dev
```

- Set `account_id` in `wrangler.jsonc` to your own account (or remove it and pick one interactively).
- Non-secret settings (`GITCITY_BUILDING_BUDGET`, `GITCITY_RATE_LIMIT_PER_MINUTE`) are `vars` in `wrangler.jsonc`.
- `npm run preview` runs the production build locally in `workerd` before you ship.
- `/api/tree` responses (immutable per commit SHA) are stored in each data center's Cache API, so repeat visits to the same
  city skip GitHub entirely (`CF-Cache-Status: HIT`). This works on `*.workers.dev` as well as custom domains.
- For abuse protection beyond the per-isolate throttle, add a Cloudflare rate-limiting rule on `/api/*`.

## Known limitations

- **Truncated trees**: GitHub's recursive tree API stops at 100,000 entries / 7 MB. Bigger repositories (e.g. the Linux
  kernel) render partially, and the stats panel says so.
- **Refs with slashes** in `/tree/<ref>` URLs are ambiguous, so only the first segment is used. Use `owner/repo@feature/x`
  instead.
- **Size, not complexity**: height is file size in bytes. Line counts would need one request per file.
- **Rate limits** are global to the server token. The in-process throttle is per Worker isolate, so add a Cloudflare
  rate-limiting rule for real abuse protection.
- The UI is dark by design: the cyberpunk palette is the product, and the app sets `color-scheme: dark`.

## Roadmap

v0.2 Living City (commits as construction events) · v0.3 Time Travel (history scrubber) · v0.4 Contributors as citizens ·
v0.5 Account-wide worlds. The generator is pure and per-path seeded, so a future version can diff two `CityModel`s and
animate the changes without touching the renderer's contract.
