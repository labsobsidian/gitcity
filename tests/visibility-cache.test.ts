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
/** A commit that only exists in another repository of the fork network, which GitHub still serves through this one. */
const FORK_SHA = "abababababababababababababababababababab";
const FORK_PATH = "src/synthetic-fork-only-file.ts";
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
    trees: {
      [PUBLIC_SHA]: [PUBLIC_PATH, "README.md"],
      [PRIVATE_SHA]: [PUBLIC_PATH, PRIVATE_PATH],
      [FORK_SHA]: [PUBLIC_PATH, FORK_PATH],
    } as Record<string, string[]>,
    branches: { main: PUBLIC_SHA, "secret-branch": PRIVATE_SHA } as Record<string, string>,
    /** Pull request refs (not branches), which GitHub resolves in the base repository. */
    pulls: {} as Record<string, string>,
    /** Commits reachable from each branch, newest first. FORK_SHA is in none of them. */
    history: { main: [PUBLIC_SHA], "secret-branch": [PRIVATE_SHA, PUBLIC_SHA] } as Record<string, string[]>,
    /** When set, the next metadata response is held until this promise settles (its answer is decided on arrival). */
    holdNextMeta: undefined as undefined | Promise<void>,
    /** Runs right after a content endpoint answers, to simulate a change mid-request. */
    afterContent: undefined as undefined | (() => void),
    calls: { repo: 0, notModified: 0, conditional: 0, commit: 0, tree: 0, compare: 0, branchesWhereHead: 0 },
    /** If-None-Match sent with each metadata request, in order (null = unconditional). */
    validatorsSent: [] as (string | null)[],
  };
  const etag = () => `W/"${state.id}-${state.private}"`;
  const notFound = () => Response.json({ message: "Not Found" }, { status: 404 });
  const visible = () => state.exists && (!state.private || state.tokenSeesPrivate);
  const metaAnswer = (ifNoneMatch: string | null): Response => {
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
  };

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "api.github.com") throw new Error(`unexpected host ${url.hostname}`);
    const ifNoneMatch = new Headers(init?.headers).get("If-None-Match");

    if (url.pathname === "/repos/acme/widgets") {
      state.calls.repo++;
      if (ifNoneMatch) state.calls.conditional++;
      state.validatorsSent.push(ifNoneMatch);
      const hold = state.holdNextMeta;
      state.holdNextMeta = undefined;
      const answer = metaAnswer(ifNoneMatch);
      if (hold) await hold;
      return answer;
    }
    const compare = /^\/repos\/acme\/widgets\/compare\/(.+)\.\.\.([0-9a-f]{40})$/.exec(url.pathname);
    if (compare) {
      state.calls.compare++;
      const base = decodeURIComponent(compare[1]!);
      const head = compare[2]!;
      if (!visible() || !state.history[base] || !state.trees[head]) return Response.json({ message: "Not Found" }, { status: 404 });
      const history = state.history[base]!;
      const status = history[0] === head ? "identical" : history.includes(head) ? "behind" : "diverged";
      return Response.json({ status, ahead_by: status === "diverged" ? 1 : 0, commits: [], files: [] });
    }
    const heads = /^\/repos\/acme\/widgets\/commits\/([0-9a-f]{40})\/branches-where-head$/.exec(url.pathname);
    if (heads) {
      state.calls.branchesWhereHead++;
      if (!visible()) return notFound();
      if (!state.trees[heads[1]!]) return Response.json({ message: "No commit found" }, { status: 422 });
      return Response.json(Object.entries(state.branches).filter(([, sha]) => sha === heads[1]).map(([name]) => ({ name })));
    }
    const commit = /^\/repos\/acme\/widgets\/commits\/(.+)$/.exec(url.pathname);
    if (commit) {
      state.calls.commit++;
      const name = decodeURIComponent(commit[1]!);
      // Like GitHub: branch names resolve in this repository, full SHAs anywhere in the fork network.
      const sha = visible() ? (state.branches[name] ?? state.pulls[name] ?? (state.trees[name] ? name : undefined)) : undefined;
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
    await expectDenied(await routes.tree(PRIVATE_SHA, "&ref=secret-branch"));
    expect(github.state.calls.tree).toBe(1);
    expect(edge.store.size).toBe(0);
    // And nothing from that attempt is reused once it is public again.
    github.state.afterContent = undefined;
    github.state.private = false;
    github.state.trees[PRIVATE_SHA] = [PUBLIC_PATH];
    const res = await routes.tree(PRIVATE_SHA, "&ref=secret-branch");
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
    github.state.history = { main: [PRIVATE_SHA] };

    const res = await routes.tree();
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(PUBLIC_PATH);
    // Checked again under the new identity, and the old commit isn't part of it, so its tree is never fetched.
    expect(github.state.calls.compare).toBe(2);
    expect(github.state.calls.tree).toBe(1);
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
    expect(keys[0]).toContain("/__edge/v3/tree/1001/");
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

describe("commits from elsewhere in the fork network", () => {
  it("are refused before their tree is fetched, exactly like a commit that doesn't exist", async () => {
    const routes = await loadRoutes();
    const res = await routes.tree(FORK_SHA);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain(FORK_PATH);
    expect(JSON.parse(text).error.code).toBe("REF_NOT_FOUND");
    expect(github.state.calls.tree).toBe(0);
    expect(edge.store.size).toBe(0);
    expect(await (await routes.tree("1".repeat(40))).text()).toBe(text);
  });

  it("can't be unlocked by passing a commit ID as the ref", async () => {
    const routes = await loadRoutes();
    expect((await routes.tree(FORK_SHA, `&ref=${FORK_SHA}`)).status).toBe(404);
    expect((await routes.tree(FORK_SHA, `&ref=${FORK_SHA.slice(0, 7)}`)).status).toBe(404);
    expect(github.state.calls.tree).toBe(0);
  });

  it("are refused as a summary ref", async () => {
    const routes = await loadRoutes();
    const res = await routes.repo(`acme/widgets@${FORK_SHA}`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("REF_NOT_FOUND");
  });

  it("doesn't get in the way of commits on the default branch or on the branch they came from", async () => {
    const routes = await loadRoutes();
    expect((await routes.repo(`acme/widgets@${PUBLIC_SHA}`)).status).toBe(200);
    expect((await routes.tree(PUBLIC_SHA)).status).toBe(200);
    expect((await routes.tree(PRIVATE_SHA)).status).toBe(200); // not on main, but the head of secret-branch
    const res = await routes.tree(PRIVATE_SHA, "&ref=secret-branch");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(PRIVATE_PATH);
  });
});

describe("one tree fetch per commit", () => {
  it("derives every building budget from a single tree fetch and proof", async () => {
    const routes = await loadRoutes();
    for (const budget of [200, 6000, 15000]) {
      const res = await routes.tree(PUBLIC_SHA, `&budget=${budget}`);
      expect(res.status).toBe(200);
      expect((await res.json()).budget).toBe(budget);
    }
    expect(github.state.calls.tree).toBe(1);
    expect(github.state.calls.compare).toBe(1);
    expect(github.state.calls.repo).toBe(4); // still checked on every request, plus the recheck after the one fetch
  });
});

describe("concurrent requests", () => {
  it("share one visibility check", async () => {
    const routes = await loadRoutes();
    const responses = await Promise.all([routes.tree(), routes.tree(), routes.tree()]);
    for (const res of responses) expect(res.status).toBe(200);
    expect(github.state.calls.repo).toBe(2); // one shared check, plus the recheck after the single tree fetch
  });

  it("never reuse an earlier check for the recheck after a content read", async () => {
    await loadRoutes();
    const gh = await import("@/server/github");
    const meta = await gh.requirePublicRepo("acme", "widgets");
    // Another request's check is in flight; GitHub answered it "public" on arrival...
    let release!: () => void;
    github.state.holdNextMeta = new Promise<void>((resolve) => (release = resolve));
    const earlier = gh.requirePublicRepo("acme", "widgets");
    // ...and then the repository turns private while the tree is being read.
    github.state.private = true;
    const tree = gh.getRepoTree(meta, PUBLIC_SHA, 6000);
    setTimeout(release, 20);
    await expect(tree).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(earlier).resolves.toMatchObject({ id: 1001 });
  });

  it("start a fresh check once the one in flight is over a second old", async () => {
    await loadRoutes();
    const gh = await import("@/server/github");
    let release!: () => void;
    github.state.holdNextMeta = new Promise<void>((resolve) => (release = resolve));
    const slow = gh.requirePublicRepo("acme", "widgets");
    vi.setSystemTime(Date.now() + 1_001);
    github.state.private = true;
    const later = gh.requirePublicRepo("acme", "widgets");
    release();
    await expect(slow).resolves.toMatchObject({ id: 1001 });
    await expect(later).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(github.state.calls.repo).toBe(2);
  });
});

describe("proof edge cases", () => {
  it("doesn't trust pull request refs, which point at commits in other forks", async () => {
    const routes = await loadRoutes();
    for (const ref of ["pull/7/head", "refs/pull/7/head"]) {
      github.state.history[ref] = [FORK_SHA];
      github.state.pulls[ref] = FORK_SHA;
    }
    for (const ref of ["pull/7/head", "refs/pull/7/head"]) {
      expect((await routes.tree(FORK_SHA, `&ref=${encodeURIComponent(ref)}`)).status).toBe(404);
    }
    expect((await routes.repo("acme/widgets@pull/7/head")).status).toBe(404);
    expect(github.state.calls.tree).toBe(0);
  });

  it("accepts a pasted commit ID that is the head of a non-default branch", async () => {
    const routes = await loadRoutes();
    const res = await routes.repo(`acme/widgets@${PRIVATE_SHA}`);
    expect(res.status).toBe(200);
    expect((await res.json()).commitSha).toBe(PRIVATE_SHA);
    expect((await routes.tree(PRIVATE_SHA, `&ref=${PRIVATE_SHA}`)).status).toBe(200);
  });

  it("compares against the ref the commit came from before the default branch", async () => {
    const routes = await loadRoutes();
    expect((await routes.tree(PRIVATE_SHA, "&ref=secret-branch")).status).toBe(200);
    expect(github.state.calls.compare).toBe(1);
  });

  it("doesn't let a request without the ref fail a concurrent one that has it", async () => {
    const routes = await loadRoutes();
    github.state.branches = { main: PUBLIC_SHA }; // PRIVATE_SHA is in secret-branch's history but no longer its head
    github.state.history["secret-branch"] = ["0".repeat(40), PRIVATE_SHA];
    const [without, withRef] = await Promise.all([routes.tree(PRIVATE_SHA), routes.tree(PRIVATE_SHA, "&ref=secret-branch")]);
    expect(without.status).toBe(404);
    expect(withRef.status).toBe(200);
  });

  it("can't reach tree entries stored before commits had to be proven", async () => {
    const routes = await loadRoutes();
    const legacy = Response.json({ files: [{ path: FORK_PATH, size: 1 }] }, { headers: { "Cache-Control": "public, s-maxage=86400" } });
    await edge.put(new Request(`https://gitcity.test/__edge/v2/tree/1001/${FORK_SHA}/6000`), legacy);
    const res = await routes.tree(FORK_SHA);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(FORK_PATH);
  });
});
