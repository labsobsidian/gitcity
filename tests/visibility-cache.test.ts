/**
 * Regression: a repository that is not public right now must not have its file
 * paths or metadata served from any cache layer, fetched on a cache miss, or
 * unlocked by a different repository that later takes the same name.
 * Everything here is synthetic: GitHub is a mocked fetch and the edge cache is
 * an in-memory fake that honours s-maxage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLIC_SHA = "0123456789abcdef0123456789abcdef01234567";
const PRIVATE_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const PUBLIC_PATH = "src/synthetic-public-file.ts";
const PRIVATE_PATH = "src/synthetic-private-only-file.ts";
const DESCRIPTION = "Synthetic fixture description";

class FakeEdgeCache {
  store = new Map<string, { res: Response; expiresAt: number }>();
  async match(req: Request) {
    const entry = this.store.get(req.url);
    return entry && entry.expiresAt > Date.now() ? entry.res.clone() : undefined;
  }
  async put(req: Request, res: Response) {
    const ttl = Number(/s-maxage=(\d+)/.exec(res.headers.get("Cache-Control") ?? "")?.[1] ?? 0);
    this.store.set(req.url, { res, expiresAt: Date.now() + ttl * 1000 });
  }
  bodies() {
    return Promise.all([...this.store.values()].map((e) => e.res.clone().text())).then((t) => t.join("\n"));
  }
}

/**
 * A mocked GitHub serving one synthetic repository at acme/widgets. The test
 * can flip its visibility, replace it with a different repository (new ID),
 * and decide whether the server token can read it while it is private.
 */
function mockGitHub() {
  const state = {
    id: 1001,
    private: false,
    exists: true,
    tokenSeesPrivate: true,
    metaStatus: 200,
    /** Paths in the current repository's tree, by SHA. */
    trees: { [PUBLIC_SHA]: [PUBLIC_PATH, "README.md"], [PRIVATE_SHA]: [PUBLIC_PATH, PRIVATE_PATH] } as Record<string, string[]>,
    branches: { main: PUBLIC_SHA, "secret-branch": PRIVATE_SHA } as Record<string, string>,
    /** Runs right after a content endpoint answers, to simulate a change mid-request. */
    afterContent: undefined as undefined | (() => void),
    calls: { repo: 0, notModified: 0, conditional: 0, commit: 0, tree: 0 },
    /** If-None-Match sent with each metadata request, in order (null = unconditional). */
    validatorsSent: [] as (string | null)[],
  };
  const etag = () => `W/"${state.id}-${state.private}"`;
  const notFound = () => Response.json({ message: "Not Found" }, { status: 404 });
  const visible = () => state.exists && (!state.private || state.tokenSeesPrivate);

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "api.github.com") throw new Error(`unexpected host ${url.hostname}`);
    const ifNoneMatch = new Headers(init?.headers).get("If-None-Match");

    if (url.pathname === "/repos/acme/widgets") {
      state.calls.repo++;
      if (ifNoneMatch) state.calls.conditional++;
      state.validatorsSent.push(ifNoneMatch);
      if (state.metaStatus !== 200) return new Response("upstream down", { status: state.metaStatus });
      if (!visible()) return notFound();
      if (ifNoneMatch === etag()) {
        state.calls.notModified++;
        return new Response(null, { status: 304, headers: { ETag: etag() } });
      }
      return Response.json(
        {
          id: state.id,
          full_name: "acme/widgets",
          private: state.private,
          visibility: state.private ? "private" : "public",
          default_branch: "main",
          description: DESCRIPTION,
          size: 10,
          topics: ["synthetic"],
        },
        { headers: { ETag: etag() } },
      );
    }
    const commit = /^\/repos\/acme\/widgets\/commits\/(.+)$/.exec(url.pathname);
    if (commit) {
      state.calls.commit++;
      const sha = visible() ? state.branches[decodeURIComponent(commit[1]!)] : undefined;
      const res = sha ? new Response(sha) : Response.json({ message: "No commit found" }, { status: 422 });
      state.afterContent?.();
      return res;
    }
    const tree = /^\/repos\/acme\/widgets\/git\/trees\/([0-9a-f]{40})$/.exec(url.pathname);
    if (tree) {
      state.calls.tree++;
      const paths = visible() ? state.trees[tree[1]!] : undefined;
      const res = paths
        ? Response.json({
            truncated: false,
            tree: [{ path: "src", type: "tree" }, ...paths.map((path) => ({ path, type: "blob", mode: "100644", size: 2048 }))],
          })
        : notFound();
      state.afterContent?.();
      return res;
    }
    return notFound();
  });
  return { state, fetchImpl };
}

const g = globalThis as { caches?: unknown };
const originalCaches = g.caches;
let github: ReturnType<typeof mockGitHub>;
let edge: FakeEdgeCache;

async function loadRoutes() {
  // Fresh modules so in-process caches and the throttle start empty for every test.
  vi.resetModules();
  const tree = await import("@/app/api/tree/route");
  const repo = await import("@/app/api/repo/route");
  return {
    tree: (sha = PUBLIC_SHA, extra = "") =>
      tree.GET(new Request(`https://gitcity.test/api/tree?owner=acme&repo=widgets&sha=${sha}${extra}`)),
    repo: (input = "acme/widgets") => repo.GET(new Request(`https://gitcity.test/api/repo?repo=${encodeURIComponent(input)}`)),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  vi.stubEnv("GITHUB_TOKEN", "");
  github = mockGitHub();
  vi.stubGlobal("fetch", github.fetchImpl);
  edge = new FakeEdgeCache();
  g.caches = { default: edge };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  g.caches = originalCaches;
});

/** A denial must carry no repository data and look exactly like a repository that doesn't exist. */
async function expectDenied(res: Response) {
  expect(res.status).toBe(404);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const text = await res.text();
  for (const secret of [PUBLIC_PATH, PRIVATE_PATH, DESCRIPTION, PUBLIC_SHA, PRIVATE_SHA, "synthetic", "1001"]) {
    expect(text).not.toContain(secret);
  }
  expect(JSON.parse(text).error.code).toBe("NOT_FOUND");
  return text;
}

describe("a repository that turns private", () => {
  it("is refused immediately, even with warm edge and in-process caches", async () => {
    const routes = await loadRoutes();
    expect((await routes.tree()).status).toBe(200);
    expect((await routes.repo()).status).toBe(200);

    github.state.private = true; // no clock change: there is no grace period

    await expectDenied(await routes.tree());
    await expectDenied(await routes.repo());
  });

  it("is refused immediately when there is no edge cache", async () => {
    g.caches = undefined;
    const routes = await loadRoutes();
    expect((await routes.tree()).status).toBe(200);
    github.state.private = true;
    await expectDenied(await routes.tree());
  });

  it("never fetches or caches a private-only tree on a cache miss, even when the token can read it", async () => {
    const routes = await loadRoutes();
    expect((await routes.tree()).status).toBe(200); // warm: the repository was public
    github.state.private = true;
    await expectDenied(await routes.tree(PRIVATE_SHA));
    await expectDenied(await routes.repo("acme/widgets@secret-branch"));
    expect(github.state.calls.tree).toBe(1);
    expect(github.state.calls.commit).toBe(0);
    expect(await edge.bodies()).not.toContain(PRIVATE_PATH);
  });

  it("is refused when it turns private while its tree is being fetched", async () => {
    const routes = await loadRoutes();
    github.state.afterContent = () => (github.state.private = true);
    await expectDenied(await routes.tree(PRIVATE_SHA));
    expect(github.state.calls.tree).toBe(1);
    expect(edge.store.size).toBe(0);
    // And nothing from that attempt is reused once it is public again.
    github.state.afterContent = undefined;
    github.state.private = false;
    github.state.trees[PRIVATE_SHA] = [PUBLIC_PATH];
    const res = await routes.tree(PRIVATE_SHA);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(PRIVATE_PATH);
  });

  it("is refused when it turns private while a ref is being resolved", async () => {
    const routes = await loadRoutes();
    github.state.afterContent = () => (github.state.private = true);
    await expectDenied(await routes.repo("acme/widgets@secret-branch"));
    expect(edge.store.size).toBe(0);
  });

  it("is refused for every budget variant", async () => {
    const routes = await loadRoutes();
    for (const budget of ["200", "6000"]) expect((await routes.tree(PUBLIC_SHA, `&budget=${budget}`)).status).toBe(200);
    github.state.private = true;
    for (const budget of ["200", "6000"]) await expectDenied(await routes.tree(PUBLIC_SHA, `&budget=${budget}`));
  });

  it("answers exactly like a repository that doesn't exist, and keeps none of its metadata", async () => {
    const routes = await loadRoutes();
    github.state.private = true;
    const privateText = await expectDenied(await routes.repo());
    github.state.exists = false;
    const missingText = await expectDenied(await routes.repo());
    expect(privateText).toBe(missingText);

    // The private answer was not kept as a validator: the next check is unconditional.
    github.state.exists = true;
    github.state.private = false;
    const next = github.state.validatorsSent.length;
    expect((await routes.repo()).status).toBe(200);
    expect(github.state.validatorsSent[next]).toBeNull();
  });
});

describe("a different repository at the same owner/name", () => {
  it("cannot unlock the previous repository's cached tree or summary", async () => {
    const routes = await loadRoutes();
    const first = await routes.tree();
    expect(await first.text()).toContain(PUBLIC_PATH);
    expect((await routes.repo()).status).toBe(200);

    // acme/widgets is deleted and recreated: a new public repository with a new ID and none of the old commits.
    github.state.id = 2002;
    github.state.trees = {};
    github.state.branches = { main: PRIVATE_SHA };

    const res = await routes.tree();
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(PUBLIC_PATH);
    expect(github.state.calls.tree).toBe(2); // looked up again under the new identity
    const summary = await routes.repo();
    expect((await summary.json()).commitSha).toBe(PRIVATE_SHA);
  });
});

describe("upstream failure during the visibility check", () => {
  it("serves no cached body", async () => {
    const routes = await loadRoutes();
    expect((await routes.tree()).status).toBe(200);
    github.state.metaStatus = 503;
    const res = await routes.tree();
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).not.toContain(PUBLIC_PATH);
  });

  it("keeps the validator, so recovery is a 304, and still refuses a repository that turned private meanwhile", async () => {
    const routes = await loadRoutes();
    expect((await routes.tree()).status).toBe(200);
    github.state.metaStatus = 503;
    expect((await routes.tree()).status).toBe(502);
    github.state.metaStatus = 200;
    const next = github.state.validatorsSent.length;
    expect((await routes.tree()).status).toBe(200);
    expect(github.state.validatorsSent[next]).not.toBeNull();
    github.state.metaStatus = 503;
    expect((await routes.tree()).status).toBe(502);
    github.state.metaStatus = 200;
    github.state.private = true;
    await expectDenied(await routes.tree());
  });
});

describe("response caching policy", () => {
  it("never lets shared caches outside the gate store repository data", async () => {
    const routes = await loadRoutes();
    for (const route of [() => routes.tree(), () => routes.repo()]) {
      for (const res of [await route(), await route()]) {
        // First call is a miss, second an edge hit; both reach the browser the same way.
        expect(res.status).toBe(200);
        const cacheControl = res.headers.get("Cache-Control") ?? "";
        expect(cacheControl).toContain("private");
        expect(cacheControl).not.toMatch(/public|s-maxage|stale-while-revalidate/);
      }
    }
  });

  it("keys edge entries by repository ID in a namespace legacy URL-keyed entries can't reach", async () => {
    const legacyUrl = `https://gitcity.test/api/tree?owner=acme&repo=widgets&sha=${PUBLIC_SHA}`;
    const legacy = Response.json({ files: [{ path: PRIVATE_PATH }] }, { headers: { "Cache-Control": "public, s-maxage=86400" } });
    await edge.put(new Request(legacyUrl), legacy);
    const routes = await loadRoutes();
    const res = await routes.tree();
    expect(await res.text()).not.toContain(PRIVATE_PATH);
    const keys = [...edge.store.keys()].filter((k) => k !== legacyUrl);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("/__edge/v2/tree/1001/");
  });

  it("does not edge-cache a refusal", async () => {
    github.state.private = true;
    const routes = await loadRoutes();
    await expectDenied(await routes.tree());
    await expectDenied(await routes.repo());
    expect(edge.store.size).toBe(0);
    expect(github.state.calls.tree).toBe(0);
  });
});

describe("public repositories keep working", () => {
  it("revalidates visibility on every request with a conditional request, and serves the cached tree", async () => {
    const routes = await loadRoutes();
    const a = await routes.tree();
    const b = await routes.tree();
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await b.text()).toContain(PUBLIC_PATH);
    expect(github.state.calls.tree).toBe(1);
    // Miss: one check before the fetch and one after. Hit: one conditional check answered 304.
    expect(github.state.calls.repo).toBe(3);
    expect(github.state.calls.notModified).toBe(2);
  });

  it("serves the edge copy when the in-process cache is gone (another isolate)", async () => {
    let routes = await loadRoutes();
    expect((await routes.tree()).status).toBe(200);
    routes = await loadRoutes(); // same edge cache, empty module caches
    const res = await routes.tree();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(PUBLIC_PATH);
    expect(github.state.calls.tree).toBe(1);
  });

  it.each([
    ["with", true],
    ["without", false],
  ])("resolves refs that differ only in case separately, %s an edge cache", async (_label, withEdge) => {
    if (!withEdge) g.caches = undefined;
    github.state.branches = { Main: PRIVATE_SHA, main: PUBLIC_SHA };
    const routes = await loadRoutes();
    const upper = await (await routes.repo("acme/widgets@Main")).json();
    const lower = await (await routes.repo("acme/widgets@main")).json();
    expect(upper).toMatchObject({ ref: "Main", commitSha: PRIVATE_SHA });
    expect(lower).toMatchObject({ ref: "main", commitSha: PUBLIC_SHA });
    expect(github.state.calls.commit).toBe(2);
    if (withEdge) expect(edge.store.size).toBe(2);
  });

  it("serves repository summaries", async () => {
    const routes = await loadRoutes();
    const res = await routes.repo();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ fullName: "acme/widgets", ref: "main", commitSha: PUBLIC_SHA });
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("isPrivate");
  });
});
