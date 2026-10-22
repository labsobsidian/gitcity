/** Browser-side calls to the GitCity API routes. */
import type { RepoRef } from "../github/parse-url";
import type { ApiErrorBody, ApiErrorCode, RepoSummary, RepoTree } from "../types";

export class ClientError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly resetAt?: Date,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

async function failure(res: Response): Promise<ClientError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (body.error && typeof body.error.code === "string" && typeof body.error.message === "string") {
      return new ClientError(body.error.code, body.error.message, body.error.resetAt ? new Date(body.error.resetAt) : undefined);
    }
  } catch {
    // fall through
  }
  return new ClientError(res.status >= 500 ? "UPSTREAM" : "BAD_RESPONSE", `The server responded with ${res.status}.`);
}

async function send(url: string, signal: AbortSignal): Promise<Response> {
  try {
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw await failure(res);
    return res;
  } catch (error) {
    if (error instanceof ClientError || (error as { name?: string })?.name === "AbortError") throw error;
    throw new ClientError("NETWORK", "Couldn't reach GitCity. Check your connection and try again.");
  }
}

export async function fetchSummary(ref: RepoRef, signal: AbortSignal): Promise<RepoSummary> {
  const query = ref.ref ? `${ref.owner}/${ref.repo}@${ref.ref}` : `${ref.owner}/${ref.repo}`;
  const res = await send(`/api/repo?repo=${encodeURIComponent(query)}`, signal);
  return (await res.json()) as RepoSummary;
}

/** Download the tree, reporting bytes received so the loading screen can show real progress. */
export async function fetchTree(summary: RepoSummary, signal: AbortSignal, onProgress: (bytes: number) => void): Promise<RepoTree> {
  const params = new URLSearchParams({ owner: summary.owner, repo: summary.repo, sha: summary.commitSha });
  const res = await send(`/api/tree?${params}`, signal);
  if (!res.body) return (await res.json()) as RepoTree;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received);
  }
  const text = new TextDecoder().decode(concat(chunks, received));
  try {
    return JSON.parse(text) as RepoTree;
  } catch {
    throw new ClientError("BAD_RESPONSE", "The city data arrived incomplete. Please try again.");
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
