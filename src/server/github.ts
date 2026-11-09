/**
 * GitHub REST client (server-only: it reads GITHUB_TOKEN). Every response is
 * shape-checked before use and every body is read with a size cap.
 */
import { normalizeTree, type RawTreeEntry } from "@/lib/github/normalize";
import type { RepoSummary, RepoTree } from "@/lib/types";
import { TtlCache } from "./cache";
import { AppError } from "./errors";

const API = "https://api.github.com";
const TIMEOUT_MS = 20_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
/** GitHub caps recursive trees at 100k entries / ~7 MB; leave headroom for formatting. */
const MAX_TREE_BYTES = 48 * 1024 * 1024;

export const DEFAULT_BUDGET = 6000;
export const MIN_BUDGET = 200;
export const MAX_BUDGET = 15000;

export function resolveBudget(requested?: string | null): number {
  const fromEnv = Number.parseInt(process.env.GITCITY_BUILDING_BUDGET ?? "", 10);
  const base = Number.isFinite(fromEnv) ? fromEnv : DEFAULT_BUDGET;
  const parsed = requested ? Number.parseInt(requested, 10) : Number.NaN;
  const value = Number.isFinite(parsed) ? parsed : base;
  return Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, value));
}

export interface GitHubOptions {
  token?: string;
  fetchImpl?: typeof fetch;
}

type Context = "repo" | "commit" | "tree";

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function request(
  path: string,
  context: Context,
  opts: GitHubOptions,
  accept = "application/vnd.github+json",
  ifNoneMatch?: string,
) {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "GitCity/0.1 (+https://github.com)",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${API}${path}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new AppError("TIMEOUT", "GitHub took too long to respond. Please try again.", { cause: error });
    }
    throw new AppError("NETWORK", "Couldn't reach GitHub. Check the connection and try again.", { cause: error });
  }
  if (res.status === 304 && ifNoneMatch) return res;
  if (!res.ok) throw await toError(res, context);
  return res;
}

const NOT_FOUND_MESSAGE = "Check the spelling of the owner and repository. Private repositories also show up as not found.";

/** Private and missing repositories get the same answer, so a refusal doesn't confirm that a repository exists. */
function notFound(): AppError {
  return new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
}

async function toError(res: Response, context: Context): Promise<AppError> {
  let message = "";
  try {
    const body = JSON.parse(await readLimited(res, 64 * 1024)) as { message?: unknown };
    if (typeof body.message === "string") message = body.message;
  } catch {
    // Non-JSON error bodies are fine to ignore.
  }
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const retryAfter = Number(res.headers.get("retry-after"));

  if ((res.status === 403 || res.status === 429) && (remaining === "0" || retryAfter > 0 || /rate limit/i.test(message))) {
    const resetAt =
      retryAfter > 0 ? new Date(Date.now() + retryAfter * 1000) : reset > 0 ? new Date(reset * 1000) : new Date(Date.now() + 60_000);
    return new AppError("RATE_LIMITED", "GitHub's API rate limit was reached. Cities can be generated again shortly.", { resetAt });
  }
  switch (res.status) {
    case 401:
      console.error("[gitcity] GitHub rejected GITHUB_TOKEN (401)");
      return new AppError("UPSTREAM", "GitHub rejected this server's credentials. The site owner needs to update the token.");
    case 404:
      return context === "commit"
        ? new AppError("REF_NOT_FOUND", "That branch, tag or commit doesn't exist in this repository.")
        : notFound();
    case 409:
      return new AppError("EMPTY", "This repository is empty, so there's nothing to build yet.");
    case 422:
      return context === "commit"
        ? new AppError("REF_NOT_FOUND", "That branch, tag or commit doesn't exist in this repository.")
        : new AppError("BAD_RESPONSE", "GitHub couldn't process this request.");
    case 403:
    case 451:
      return new AppError("FORBIDDEN", "GitHub isn't serving this repository (it may be disabled or blocked).");
    default:
      return res.status >= 500
        ? new AppError("UPSTREAM", "GitHub is having trouble right now. Please try again in a moment.")
        : new AppError("BAD_RESPONSE", `GitHub returned an unexpected response (${res.status}).`);
  }
}

/** Read a response body as text, refusing to buffer more than `maxBytes`. */
export async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw tooLarge();
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function tooLarge() {
  return new AppError("TOO_LARGE", "This repository's file listing is too large to turn into a city.");
}

async function readJson(res: Response, maxBytes: number): Promise<unknown> {
  const text = await readLimited(res, maxBytes);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError("BAD_RESPONSE", "GitHub returned data that couldn't be read.", { cause: error });
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function badShape(what: string): AppError {
  return new AppError("BAD_RESPONSE", `GitHub returned an unexpected ${what} response.`);
}

export interface RepoMeta {
  /** GitHub's stable repository ID. A repository recreated under the same name gets a new one. */
  id: number;
  owner: string;
  repo: string;
  fullName: string;
  isPrivate: boolean;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  primaryLanguage: string | null;
  sizeKb: number;
  stars: number;
  forks: number;
  archived: boolean;
  createdAt: string | null;
  pushedAt: string | null;
  topics: string[];
  avatarUrl: string | null;
}

function isoDate(v: unknown): string | null {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
}

/** Only GitHub's avatar CDN over https, so the browser never loads an arbitrary URL from API data. */
function avatarUrl(owner: unknown): string | null {
  if (!isRecord(owner) || typeof owner.avatar_url !== "string") return null;
  try {
    const url = new URL(owner.avatar_url);
    if (url.protocol !== "https:" || url.hostname !== "avatars.githubusercontent.com") return null;
    url.searchParams.set("s", "256");
    return url.toString();
  } catch {
    return null;
  }
}

const repoPath = (owner: string, repo: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

/** Fail closed: anything not explicitly public is treated as private. */
function isPrivateBody(body: Record<string, unknown>): boolean {
  return body.private !== false || (body.visibility !== undefined && body.visibility !== "public");
}

export async function fetchRepoMeta(owner: string, repo: string, opts: GitHubOptions): Promise<RepoMeta> {
  const res = await request(repoPath(owner, repo), "repo", opts);
  return parseRepoMeta(await readJson(res, MAX_JSON_BYTES));
}

function parseRepoMeta(body: unknown): RepoMeta {
  if (!isRecord(body)) throw badShape("repository");
  const fullName = str(body.full_name);
  const defaultBranch = str(body.default_branch);
  const id = body.id;
  if (!fullName || !fullName.includes("/") || !defaultBranch) throw badShape("repository");
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw badShape("repository");
  const [canonicalOwner, canonicalRepo] = fullName.split("/") as [string, string];
  return {
    id,
    owner: canonicalOwner,
    repo: canonicalRepo,
    fullName,
    isPrivate: isPrivateBody(body),
    description: str(body.description),
    htmlUrl: `https://github.com/${fullName}`,
    defaultBranch,
    primaryLanguage: str(body.language),
    sizeKb: num(body.size),
    stars: num(body.stargazers_count),
    forks: num(body.forks_count),
    archived: body.archived === true,
    createdAt: isoDate(body.created_at),
    pushedAt: isoDate(body.pushed_at),
    topics: Array.isArray(body.topics)
      ? body.topics.filter((t): t is string => typeof t === "string" && /^[a-z0-9-]{1,50}$/.test(t)).slice(0, 20)
      : [],
    avatarUrl: avatarUrl(body.owner),
  };
}

export async function fetchCommitSha(owner: string, repo: string, ref: string, opts: GitHubOptions): Promise<string> {
  const res = await request(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodePath(ref)}`,
    "commit",
    opts,
    "application/vnd.github.sha",
  );
  const sha = (await readLimited(res, 1024)).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw badShape("commit");
  return sha;
}

export async function fetchTree(
  owner: string,
  repo: string,
  commitSha: string,
  opts: GitHubOptions,
): Promise<{ entries: RawTreeEntry[]; truncated: boolean }> {
  const res = await request(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${commitSha}?recursive=1`,
    "tree",
    opts,
  );
  const body = await readJson(res, MAX_TREE_BYTES);
  if (!isRecord(body) || !Array.isArray(body.tree)) throw badShape("tree");
  const entries: RawTreeEntry[] = [];
  for (const item of body.tree) {
    if (!isRecord(item)) continue;
    const path = str(item.path);
    const type = str(item.type);
    if (!path || !type) continue;
    entries.push({
      path,
      type,
      mode: str(item.mode) ?? undefined,
      size: typeof item.size === "number" ? item.size : undefined,
    });
  }
  return { entries, truncated: body.truncated === true };
}

// ---------------------------------------------------------------------------
// Cached service layer used by the route handlers.

/**
 * Last public answer per repository, kept only so the next visibility check
 * can be a conditional request. It never authorizes anything by itself: every
 * request asks GitHub again, and only a 304 for this exact representation
 * (same ID, still public) lets it be reused. Private answers are never stored.
 */
const validators = new TtlCache<{ meta: RepoMeta; etag: string }>(500);
const shaCache = new TtlCache<string>(500);
const treeCache = new TtlCache<RepoTree>(48);

const VALIDATOR_TTL = 60 * 60_000;
const SHA_TTL = 60_000;
const TREE_TTL = 6 * 60 * 60_000; // keyed by repository ID + commit SHA, so it never goes stale

function options(): GitHubOptions {
  return { token: process.env.GITHUB_TOKEN?.trim() || undefined };
}

/**
 * Visibility gate. Asks GitHub on every call (conditionally, so an unchanged
 * repository costs a 304, which doesn't count against an authenticated
 * token's primary rate limit) and throws NOT_FOUND unless the repository is
 * public right now. The server token may be able to read private
 * repositories, so their metadata is checked before parsing and never kept.
 */
export async function requirePublicRepo(owner: string, repo: string): Promise<RepoMeta> {
  const key = `${owner}/${repo}`.toLowerCase();
  const known = validators.get(key);
  try {
    const res = await request(repoPath(owner, repo), "repo", options(), undefined, known?.etag);
    if (res.status === 304 && known) return known.meta;
    const body = await readJson(res, MAX_JSON_BYTES);
    if (!isRecord(body) || isPrivateBody(body)) throw notFound();
    const meta = parseRepoMeta(body);
    const etag = res.headers.get("etag");
    if (etag) validators.set(key, { meta, etag }, VALIDATOR_TTL);
    else validators.delete(key);
    return meta;
  } catch (error) {
    validators.delete(key);
    throw error;
  }
}

/**
 * Run after every GitHub content read: the repository could have turned
 * private (or been replaced) between the gate and the read, and the token may
 * have been able to read it anyway.
 */
async function confirmStillPublic(meta: RepoMeta): Promise<void> {
  const now = await requirePublicRepo(meta.owner, meta.repo);
  if (now.id !== meta.id) throw notFound();
}

export async function getRepoSummary(meta: RepoMeta, requestedRef?: string): Promise<RepoSummary> {
  const ref = requestedRef ?? meta.defaultBranch;
  const opts = options();
  // Always resolve through GitHub, even for SHAs: it validates that the commit
  // belongs to this repository and expands abbreviated SHAs.
  const commitSha = await shaCache.getOrLoad(`${meta.id}@${ref}`.toLowerCase(), SHA_TTL, async () => {
    const sha = await fetchCommitSha(meta.owner, meta.repo, ref, opts);
    await confirmStillPublic(meta);
    return sha;
  });
  const { id: _id, isPrivate: _private, ...summary } = meta;
  return { ...summary, ref, commitSha };
}

export async function getRepoTree(meta: RepoMeta, commitSha: string, budget: number): Promise<RepoTree> {
  const opts = options();
  return treeCache.getOrLoad(`${meta.id}@${commitSha}#${budget}`.toLowerCase(), TREE_TTL, async () => {
    const { entries, truncated } = await fetchTree(meta.owner, meta.repo, commitSha, opts);
    await confirmStillPublic(meta);
    const { files, stats, simplified } = normalizeTree(entries, budget);
    if (files.length === 0) {
      throw new AppError("EMPTY", "No source files were found after skipping dependencies, binaries and generated output.");
    }
    return { fullName: meta.fullName, commitSha, truncated, simplified, budget, files, stats };
  });
}
