import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_CACHE_CONTROL, edgeKey, withEdgeCache } from "@/server/edge-cache";

class FakeCache {
  store = new Map<string, Response>();
  async match(req: Request) {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response) {
    this.store.set(req.url, res);
  }
}

const g = globalThis as { caches?: unknown };
const original = g.caches;
afterEach(() => {
  g.caches = original;
});

const ttl = { ttlSeconds: 60 };

describe("withEdgeCache", () => {
  it("passes through when not running on Workers", async () => {
    g.caches = undefined;
    let calls = 0;
    const produce = async () => (calls++, Response.json({ ok: true }));
    const a = await withEdgeCache("https://x/api/repo?repo=a/b", produce, ttl);
    await withEdgeCache("https://x/api/repo?repo=a/b", produce, ttl);
    expect(calls).toBe(2);
    expect(a.headers.get("Cache-Control")).toBe(CLIENT_CACHE_CONTROL);
  });

  it("serves repeat requests from the edge cache, keyed by the given key", async () => {
    const cache = new FakeCache();
    g.caches = { default: cache };
    let calls = 0;
    const produce = async () => (calls++, Response.json({ n: calls }));
    const a = await withEdgeCache("https://x/api/tree?sha=1", produce, ttl);
    const b = await withEdgeCache("https://x/api/tree?sha=1", produce, ttl);
    const c = await withEdgeCache("https://x/api/tree?sha=2", produce, ttl);
    expect(await a.json()).toEqual({ n: 1 });
    expect(await b.json()).toEqual({ n: 1 });
    expect(await c.json()).toEqual({ n: 2 });
    expect(calls).toBe(2);
  });

  it("stores with an edge TTL but tells clients and proxies not to store", async () => {
    const cache = new FakeCache();
    g.caches = { default: cache };
    const produce = async () => Response.json({}, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
    const miss = await withEdgeCache("https://x/t", produce, ttl);
    const hit = await withEdgeCache("https://x/t", produce, ttl);
    expect(cache.store.get("https://x/t")?.headers.get("Cache-Control")).toBe("public, s-maxage=60");
    expect(miss.headers.get("Cache-Control")).toBe(CLIENT_CACHE_CONTROL);
    expect(hit.headers.get("Cache-Control")).toBe(CLIENT_CACHE_CONTROL);
  });

  it("never caches errors", async () => {
    const cache = new FakeCache();
    g.caches = { default: cache };
    const res = await withEdgeCache(
      "https://x/e",
      async () => Response.json({}, { status: 429, headers: { "Cache-Control": "no-store" } }),
      ttl,
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(cache.store.size).toBe(0);
  });

  it("builds versioned keys on the request's origin that no route URL can collide with", () => {
    const request = new Request("https://gitcity.test/api/tree?owner=a&repo=b&sha=1&junk=x");
    expect(edgeKey(request, "tree", 42, "abc", 6000)).toBe("https://gitcity.test/__edge/v3/tree/42/abc/6000");
    expect(edgeKey(request, "repo", 42, "feature/x")).toBe("https://gitcity.test/__edge/v3/repo/42/feature%2Fx");
  });
});
