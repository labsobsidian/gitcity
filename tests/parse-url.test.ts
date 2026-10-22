import { describe, expect, it } from "vitest";
import { formatRepoRef, parseRepoInput } from "@/lib/github/parse-url";

const ok = (input: string) => {
  const result = parseRepoInput(input);
  if (!result.ok) throw new Error(`expected ok for ${input}: ${result.reason}`);
  return result.value;
};

describe("parseRepoInput", () => {
  it.each([
    ["https://github.com/vercel/next.js", { owner: "vercel", repo: "next.js" }],
    ["http://github.com/vercel/next.js/", { owner: "vercel", repo: "next.js" }],
    ["github.com/vercel/next.js.git", { owner: "vercel", repo: "next.js" }],
    ["https://www.github.com/facebook/react?tab=readme", { owner: "facebook", repo: "react" }],
    ["https://github.com/facebook/react#readme", { owner: "facebook", repo: "react" }],
    ["git@github.com:rust-lang/rust.git", { owner: "rust-lang", repo: "rust" }],
    ["pmndrs/react-three-fiber", { owner: "pmndrs", repo: "react-three-fiber" }],
    ["  denoland/deno  ", { owner: "denoland", repo: "deno" }],
    ["denoland/deno@v2.0.0", { owner: "denoland", repo: "deno", ref: "v2.0.0" }],
    ["https://github.com/vercel/next.js/tree/canary", { owner: "vercel", repo: "next.js", ref: "canary" }],
    ["https://github.com/vercel/next.js/tree/canary/packages/next", { owner: "vercel", repo: "next.js", ref: "canary" }],
    ["https://github.com/vercel/next.js/blob/canary/readme.md", { owner: "vercel", repo: "next.js", ref: "canary" }],
    ["https://github.com/vercel/next.js/issues", { owner: "vercel", repo: "next.js" }],
  ])("accepts %s", (input, expected) => {
    expect(ok(input)).toEqual(expected);
  });

  it.each([
    "",
    "   ",
    "https://gitlab.com/owner/repo",
    "https://github.com.evil.com/owner/repo",
    "https://evil.com/github.com/owner/repo",
    "https://user:pass@github.com/owner/repo",
    "https://github.com:8443/owner/repo",
    "ftp://github.com/owner/repo",
    "javascript:alert(1)",
    "https://github.com/owner",
    "https://github.com/orgs/vercel",
    "https://github.com/-bad/repo",
    "https://github.com/owner/..",
    "owner/repo with space",
    "owner/re$po",
    "owner/repo@bad..ref",
    "https://github.com/%E0%A4%A/repo",
    `owner/${"a".repeat(500)}`,
  ])("rejects %j", (input) => {
    expect(parseRepoInput(input).ok).toBe(false);
  });

  it("formats refs canonically", () => {
    expect(formatRepoRef({ owner: "a", repo: "b" })).toBe("a/b");
    expect(formatRepoRef({ owner: "a", repo: "b", ref: "dev" })).toBe("a/b@dev");
  });
});
