/**
 * Cloudflare's per-data-center Cache API. Worker responses don't go through
 * the CDN cache on their own, so cacheable API responses are stored here
 * explicitly. Outside Workers (next dev, tests) `caches.default` doesn't
 * exist and this is a pass-through.
 */
function edgeCache(): Cache | null {
  const storage = (globalThis as { caches?: { default?: Cache } }).caches;
  return storage?.default ?? null;
}

export async function withEdgeCache(request: Request, produce: () => Promise<Response>): Promise<Response> {
  const cache = edgeCache();
  if (!cache) return produce();
  const key = new Request(request.url, { method: "GET" });
  try {
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch {
    // A cache failure must never break the request.
  }
  const response = await produce();
  if (response.ok && /s-maxage=\d+/.test(response.headers.get("Cache-Control") ?? "")) {
    try {
      await cache.put(key, response.clone());
    } catch {
      // Ignore (e.g. responses over the cache size limit).
    }
  }
  return response;
}
