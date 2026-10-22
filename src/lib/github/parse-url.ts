/**
 * Turn user input into a validated { owner, repo, ref } triple.
 *
 * Accepted forms:
 *   https://github.com/owner/repo            github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/ref   git@github.com:owner/repo.git
 *   owner/repo                               owner/repo@ref
 *
 * Anything that is not github.com is rejected — the value ends up in API
 * paths, so it is validated strictly instead of being passed through.
 */

export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit SHA. Undefined means "the default branch". */
  ref?: string;
}

export type ParseResult = { ok: true; value: RepoRef } | { ok: false; reason: string };

const MAX_INPUT_LENGTH = 400;
// GitHub user/org names: alphanumerics and single hyphens, no leading/trailing hyphen, max 39.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
// Repository names: letters, digits, ".", "-", "_"; max 100.
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
// Git ref names: conservative subset of git-check-ref-format.
const REF_RE = /^(?!\/|.*\/\/|.*\.\.|.*@\{|.*\.lock$|.*\/$)[A-Za-z0-9._\/-]{1,200}$/;
// First path segments on github.com that are not users.
const RESERVED_OWNERS = new Set([
  "about", "account", "apps", "blog", "collections", "contact", "customer-stories", "enterprise",
  "explore", "features", "issues", "login", "logout", "marketplace", "new", "notifications",
  "orgs", "organizations", "pricing", "pulls", "search", "security", "settings", "site",
  "sponsors", "topics", "trending", "users",
]);

function fail(reason: string): ParseResult {
  return { ok: false, reason };
}

export function validateRepoRef(owner: string, repo: string, ref?: string): ParseResult {
  if (!OWNER_RE.test(owner) || RESERVED_OWNERS.has(owner.toLowerCase())) {
    return fail("That doesn't look like a GitHub user or organization name.");
  }
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    return fail("That doesn't look like a GitHub repository name.");
  }
  if (ref !== undefined && !REF_RE.test(ref)) {
    return fail("That branch, tag or commit name isn't valid.");
  }
  return { ok: true, value: ref === undefined ? { owner, repo } : { owner, repo, ref } };
}

function stripGitSuffix(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

export function parseRepoInput(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) return fail("Paste a GitHub repository URL, like https://github.com/vercel/next.js.");
  if (input.length > MAX_INPUT_LENGTH) return fail("That URL is too long.");
  if (/\s/.test(input)) return fail("Repository URLs can't contain spaces.");
  // A bare name like "gitcity" would otherwise be read as a hostname.
  if (/^[A-Za-z0-9._-]+$/.test(input) && !input.includes(".")) {
    return fail(`Add the owner too, like someone/${input} or https://github.com/someone/${input}.`);
  }

  // SSH form: git@github.com:owner/repo(.git)
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)\/?$/i.exec(input);
  if (ssh) return validateRepoRef(ssh[1]!, stripGitSuffix(ssh[2]!));

  // Shorthand: owner/repo or owner/repo@ref
  const short = /^([^/:@?#]+)\/([^/:@?#]+)(?:@([^\s?#]+))?$/.exec(input);
  if (short && !/^(?:www\.)?github\.com$/i.test(short[1]!)) {
    return validateRepoRef(short[1]!, stripGitSuffix(short[2]!), short[3]);
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return fail("That isn't a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return fail("Only https://github.com links are supported.");
  }
  if (url.username || url.password) return fail("URLs with credentials aren't accepted.");
  if (url.port) return fail("Only https://github.com links are supported.");
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    return fail("Only public repositories on github.com are supported.");
  }

  let segments: string[];
  try {
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return fail("That URL contains invalid characters.");
  }
  if (segments.length < 2) return fail("The URL needs both an owner and a repository, like github.com/owner/repo.");

  const [owner, repoSegment, kind, ...rest] = segments as [string, string, ...string[]];
  // /owner/repo/tree/<ref> — refs with slashes are ambiguous in URLs, so only the
  // first segment after /tree/ is used. /blob/… links resolve the same way.
  const ref = (kind === "tree" || kind === "blob" || kind === "commit") && rest[0] ? rest[0] : undefined;
  return validateRepoRef(owner, stripGitSuffix(repoSegment), ref);
}

/** Canonical short form used in the address bar: owner/repo or owner/repo@ref. */
export function formatRepoRef({ owner, repo, ref }: RepoRef): string {
  return ref ? `${owner}/${repo}@${ref}` : `${owner}/${repo}`;
}
