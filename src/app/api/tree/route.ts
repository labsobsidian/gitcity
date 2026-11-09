import { validateRepoRef } from "@/lib/github/parse-url";
import { CLIENT_CACHE_CONTROL, edgeKey, withEdgeCache } from "@/server/edge-cache";
import { AppError, errorResponse } from "@/server/errors";
import { getRepoTree, requirePublicRepo, resolveBudget } from "@/server/github";
import { throttle } from "@/server/throttle";

export const runtime = "nodejs";

/** Keyed by repository ID + immutable commit SHA, so the edge keeps trees for a day (behind the visibility check). */
const EDGE_TTL_SECONDS = 86_400;

/** GET /api/tree?owner=&repo=&sha=<40-hex>&budget= → RepoTree. */
export async function GET(request: Request) {
  try {
    throttle(request);
    const params = new URL(request.url).searchParams;
    const owner = params.get("owner") ?? "";
    const repo = params.get("repo") ?? "";
    const sha = (params.get("sha") ?? "").toLowerCase();
    const valid = validateRepoRef(owner, repo);
    if (!valid.ok) throw new AppError("INVALID_URL", valid.reason);
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new AppError("INVALID_URL", "A full 40-character commit SHA is required.");
    const budget = resolveBudget(params.get("budget"));
    // Checked with GitHub on every request, before any cache is consulted.
    const meta = await requirePublicRepo(owner, repo);
    return await withEdgeCache(
      edgeKey(request, "tree", meta.id, sha, budget),
      async () => Response.json(await getRepoTree(meta, sha, budget), { headers: { "Cache-Control": CLIENT_CACHE_CONTROL } }),
      { ttlSeconds: EDGE_TTL_SECONDS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
