import { validateRepoRef } from "@/lib/github/parse-url";
import { withEdgeCache } from "@/server/edge-cache";
import { AppError, errorResponse } from "@/server/errors";
import { getRepoTree, resolveBudget } from "@/server/github";
import { throttle } from "@/server/throttle";

export const runtime = "nodejs";

/**
 * GET /api/tree?owner=&repo=&sha=<40-hex>&budget= → RepoTree.
 * Keyed by an immutable commit SHA, so responses are cached aggressively.
 */
export function GET(request: Request) {
  return withEdgeCache(request, () => handle(request));
}

async function handle(request: Request) {
  try {
    throttle(request);
    const params = new URL(request.url).searchParams;
    const owner = params.get("owner") ?? "";
    const repo = params.get("repo") ?? "";
    const sha = (params.get("sha") ?? "").toLowerCase();
    const valid = validateRepoRef(owner, repo);
    if (!valid.ok) throw new AppError("INVALID_URL", valid.reason);
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new AppError("INVALID_URL", "A full 40-character commit SHA is required.");
    const tree = await getRepoTree(owner, repo, sha, resolveBudget(params.get("budget")));
    return Response.json(tree, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
