import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { fetchCommitSha, fetchRepoMeta, fetchTree, readLimited, resolveBudget } from "@/server/github";

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers })) as unknown as typeof fetch;
}

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected rejection");
}

const repoBody = {
  full_name: "Vercel/next.js",
  private: false,
  visibility: "public",
  default_branch: "canary",
  description: "The React Framework",
  language: "JavaScript",
  size: 1234,
  stargazers_count: 10,
  forks_count: 2,
  archived: false,
  created_at: "2016-10-05T23:32:51Z",
  pushed_at: "2026-10-20T10:00:00Z",
  topics: ["react", "framework", "Bad Topic!", 5],
  owner: { avatar_url: "https://avatars.githubusercontent.com/u/14985020?v=4" },
};

describe("fetchRepoMeta", () => {
  it("parses metadata and canonical names", async () => {
    const meta = await fetchRepoMeta("vercel", "next.js", { fetchImpl: mockFetch(200, repoBody) });
    expect(meta).toMatchObject({ owner: "Vercel", repo: "next.js", defaultBranch: "canary", isPrivate: false, sizeKb: 1234 });
    expect(meta.createdAt).toBe("2016-10-05T23:32:51.000Z");
    expect(meta.topics).toEqual(["react", "framework"]);
    expect(meta.avatarUrl).toBe("https://avatars.githubusercontent.com/u/14985020?v=4&s=256");
  });

  it("drops avatar URLs that aren't GitHub's avatar CDN", async () => {
    for (const avatar_url of ["http://avatars.githubusercontent.com/u/1", "https://evil.example/a.png", "javascript:alert(1)"]) {
      const meta = await fetchRepoMeta("a", "b", { fetchImpl: mockFetch(200, { ...repoBody, owner: { avatar_url } }) });
      expect(meta.avatarUrl).toBeNull();
    }
  });

  it("fails closed on private or ambiguous visibility", async () => {
    for (const body of [{ ...repoBody, private: true }, { ...repoBody, private: undefined }, { ...repoBody, visibility: "internal" }]) {
      const meta = await fetchRepoMeta("a", "b", { fetchImpl: mockFetch(200, body) });
      expect(meta.isPrivate).toBe(true);
    }
  });

  it("maps HTTP errors to friendly codes", async () => {
    expect((await errorOf(fetchRepoMeta("a", "b", { fetchImpl: mockFetch(404, { message: "Not Found" }) }))).code).toBe("NOT_FOUND");
    expect((await errorOf(fetchRepoMeta("a", "b", { fetchImpl: mockFetch(451, {}) }))).code).toBe("FORBIDDEN");
    expect((await errorOf(fetchRepoMeta("a", "b", { fetchImpl: mockFetch(503, "oops") }))).code).toBe("UPSTREAM");
    expect((await errorOf(fetchRepoMeta("a", "b", { fetchImpl: mockFetch(200, "not json") }))).code).toBe("BAD_RESPONSE");
    expect((await errorOf(fetchRepoMeta("a", "b", { fetchImpl: mockFetch(200, { nope: 1 }) }))).code).toBe("BAD_RESPONSE");
  });

  it("detects rate limiting and reports the reset time", async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const error = await errorOf(
      fetchRepoMeta("a", "b", {
        fetchImpl: mockFetch(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }),
      }),
    );
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.resetAt?.getTime()).toBe(reset * 1000);
    expect(error.status).toBe(429);
  });

  it("maps network failures", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect((await errorOf(fetchRepoMeta("a", "b", { fetchImpl: failing }))).code).toBe("NETWORK");
  });
});

describe("fetchCommitSha", () => {
  it("accepts a bare SHA and rejects anything else", async () => {
    const sha = "a".repeat(40);
    expect(await fetchCommitSha("a", "b", "main", { fetchImpl: mockFetch(200, `${sha}\n`) })).toBe(sha);
    expect((await errorOf(fetchCommitSha("a", "b", "main", { fetchImpl: mockFetch(200, "<html>") }))).code).toBe("BAD_RESPONSE");
    expect((await errorOf(fetchCommitSha("a", "b", "nope", { fetchImpl: mockFetch(422, {}) }))).code).toBe("REF_NOT_FOUND");
    expect((await errorOf(fetchCommitSha("a", "b", "main", { fetchImpl: mockFetch(409, {}) }))).code).toBe("EMPTY");
  });
});

describe("fetchTree", () => {
  it("keeps well-formed entries and reports truncation", async () => {
    const body = {
      truncated: true,
      tree: [{ path: "a.ts", type: "blob", mode: "100644", size: 3 }, { path: 5, type: "blob" }, null, { path: "src", type: "tree" }],
    };
    const { entries, truncated } = await fetchTree("a", "b", "f".repeat(40), { fetchImpl: mockFetch(200, body) });
    expect(truncated).toBe(true);
    expect(entries).toEqual([
      { path: "a.ts", type: "blob", mode: "100644", size: 3 },
      { path: "src", type: "tree", mode: undefined, size: undefined },
    ]);
  });
});

describe("readLimited", () => {
  it("refuses bodies over the limit", async () => {
    const error = await errorOf(readLimited(new Response("x".repeat(2000)), 1000));
    expect(error.code).toBe("TOO_LARGE");
  });
});

describe("resolveBudget", () => {
  it("clamps requested budgets", () => {
    expect(resolveBudget("50")).toBe(200);
    expect(resolveBudget("99999")).toBe(15000);
    expect(resolveBudget("abc")).toBe(6000);
    expect(resolveBudget(null)).toBe(6000);
  });
});
