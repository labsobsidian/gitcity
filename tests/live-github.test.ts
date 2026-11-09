/**
 * Opt-in live checks against api.github.com (skipped unless GITCITY_LIVE=1).
 * GITCITY_LIVE_PRIVATE_REPO=owner/name additionally verifies that a private
 * repository visible to GITHUB_TOKEN is still refused.
 */
import { describe, expect, it } from "vitest";
import { getRepoSummary, getRepoTree, requirePublicRepo } from "@/server/github";

const live = process.env.GITCITY_LIVE === "1";
const privateRepo = process.env.GITCITY_LIVE_PRIVATE_REPO;

describe.runIf(live)("live GitHub", () => {
  it("resolves and normalizes a public repository", async () => {
    const meta = await requirePublicRepo("pmndrs", "zustand");
    const summary = await getRepoSummary(meta);
    expect(summary.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const tree = await getRepoTree(meta, summary.commitSha, 6000);
    expect(tree.files.length).toBeGreaterThan(50);
    expect(tree.files.every((f) => !f.path.includes("node_modules/"))).toBe(true);
  }, 30_000);

  it.runIf(Boolean(privateRepo))("refuses a private repository even when the token can read it", async () => {
    const [owner, repo] = privateRepo!.split("/") as [string, string];
    // Same answer as a repository that doesn't exist, so existence isn't confirmed.
    await expect(requirePublicRepo(owner, repo)).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 30_000);
});
