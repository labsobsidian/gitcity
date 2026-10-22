import { afterEach, describe, expect, it } from "vitest";
import { withEdgeCache } from "@/server/edge-cache";

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

describe("withEdgeCache", () => {
  it("passes through when not running on Workers", async () => {
    g.caches = undefined;
    let calls = 0;
    const produce = async () => (calls++, Response.json({ ok: true }, { headers: { "Cache-Control": "public, s-maxage=60" } }));
    await withEdgeCache(new Request("https://x/api/repo?repo=a/b"), produce);
    await withEdgeCache(new Request("https://x/api/repo?repo=a/b"), produce);
    expect(calls).toBe(2);
  });

  it("serves repeat requests from the edge cache, keyed by full URL", async () => {
    const cache = new FakeCache();
    g.caches = { default: cache };
    let calls = 0;
    const produce = async () => (calls++, Response.json({ n: calls }, { headers: { "Cache-Control": "public, s-maxage=60" } }));
    const a = await withEdgeCache(new Request("https://x/api/tree?sha=1"), produce);
    const b = await withEdgeCache(new Request("https://x/api/tree?sha=1"), produce);
    const c = await withEdgeCache(new Request("https://x/api/tree?sha=2"), produce);
    expect(await a.json()).toEqual({ n: 1 });
    expect(await b.json()).toEqual({ n: 1 });
    expect(await c.json()).toEqual({ n: 2 });
    expect(calls).toBe(2);
  });

  it("never caches errors or uncacheable responses", async () => {
    const cache = new FakeCache();
    g.caches = { default: cache };
    await withEdgeCache(new Request("https://x/e"), async () => Response.json({}, { status: 429, headers: { "Cache-Control": "no-store" } }));
    await withEdgeCache(new Request("https://x/n"), async () => Response.json({}, { headers: { "Cache-Control": "no-store" } }));
    expect(cache.store.size).toBe(0);
  });
});
