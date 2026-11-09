import { parseRepoInput } from "@/lib/github/parse-url";
import { CLIENT_CACHE_CONTROL, edgeKey, withEdgeCache } from "@/server/edge-cache";
import { AppError, errorResponse } from "@/server/errors";
import { getRepoSummary, requirePublicRepo } from "@/server/github";
import { throttle } from "@/server/throttle";

export const runtime = "nodejs";

/** Branches move, so resolved SHAs are only shared briefly. */
const EDGE_TTL_SECONDS = 60;

/** GET /api/repo?repo=<url or owner/name> → RepoSummary (metadata + resolved commit SHA). */
export async function GET(request: Request) {
  try {
    throttle(request);
    const input = new URL(request.url).searchParams.get("repo") ?? "";
    const parsed = parseRepoInput(input);
    if (!parsed.ok) throw new AppError("INVALID_URL", parsed.reason);
    // Checked with GitHub on every request, before any cache is consulted.
    const meta = await requirePublicRepo(parsed.value.owner, parsed.value.repo);
    const ref = parsed.value.ref ?? meta.defaultBranch;
    return await withEdgeCache(
      edgeKey(request, "repo", meta.id, ref),
      async () => Response.json(await getRepoSummary(meta, ref), { headers: { "Cache-Control": CLIENT_CACHE_CONTROL } }),
      { ttlSeconds: EDGE_TTL_SECONDS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
