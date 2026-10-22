import { parseRepoInput } from "@/lib/github/parse-url";
import { withEdgeCache } from "@/server/edge-cache";
import { AppError, errorResponse } from "@/server/errors";
import { getRepoSummary } from "@/server/github";
import { throttle } from "@/server/throttle";

export const runtime = "nodejs";

/** GET /api/repo?repo=<url or owner/name> → RepoSummary (metadata + resolved commit SHA). */
export function GET(request: Request) {
  return withEdgeCache(request, () => handle(request));
}

async function handle(request: Request) {
  try {
    throttle(request);
    const input = new URL(request.url).searchParams.get("repo") ?? "";
    const parsed = parseRepoInput(input);
    if (!parsed.ok) throw new AppError("INVALID_URL", parsed.reason);
    const summary = await getRepoSummary(parsed.value);
    return Response.json(summary, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
