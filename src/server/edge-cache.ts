/**
 * Cloudflare's per-data-center Cache API. Worker responses don't go through
 * the CDN cache on their own, so cacheable API responses are stored here
 * explicitly. Outside Workers (next dev, tests) `caches.default` doesn't
 * exist and this is a pass-through.
 *
 * Callers must run their authorization (the repository visibility check)
 * BEFORE calling this: a hit is returned without running `produce`.
 */

/**
 * What browsers and any proxy in between are told. Repository data may only
 * be shared from this cache, behind the caller's visibility check; a shared
 * cache outside the Worker would keep serving it after a repository turns
 * private.
 */
export const CLIENT_CACHE_CONTROL = "private, no-store";

/**
 * Edge entries are keyed by what the response actually depends on (GitHub's
 * stable repository ID first), under a versioned path no route serves.
 * Entries stored before v2 were keyed by the request URL, and v2 trees were
 * stored before commits had to be proven part of the repository; neither can
 * match. A repository recreated under the same name can't reach old entries.
 */
export function edgeKey(request: Request, kind: "repo" | "tree", ...parts: (string | number)[]): string {
  const path = [kind, ...parts].map((part) => encodeURIComponent(String(part))).join("/");
  return new URL(`/__edge/v3/${path}`, request.url).href;
}

function edgeCache(): Cache | null {
  const storage = (globalThis as { caches?: { default?: Cache } }).caches;
  return storage?.default ?? null;
}

function withCacheControl(response: Response, value: string): Response {
  const copy = new Response(response.body, response);
  copy.headers.set("Cache-Control", value);
  return copy;
}

export async function withEdgeCache(
  key: string,
  produce: () => Promise<Response>,
  { ttlSeconds }: { ttlSeconds: number },
): Promise<Response> {
  const forClient = (response: Response) => (response.ok ? withCacheControl(response, CLIENT_CACHE_CONTROL) : response);
  const cache = edgeCache();
  if (!cache) return forClient(await produce());
  const cacheKey = new Request(key, { method: "GET" });
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return forClient(hit);
  } catch {
    // A cache failure must never break the request.
  }
  const response = await produce();
  if (response.ok && ttlSeconds > 0) {
    try {
      await cache.put(cacheKey, withCacheControl(response.clone(), `public, s-maxage=${ttlSeconds}`));
    } catch {
      // Ignore (e.g. responses over the cache size limit).
    }
  }
  return forClient(response);
}
