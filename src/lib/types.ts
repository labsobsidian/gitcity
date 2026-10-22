/**
 * Wire contract between the server (GitHub data service) and the browser.
 * Everything here is plain JSON so it can be cached by a CDN and replayed.
 */

/** A file (or a merged cluster of files) that becomes one building. */
export interface SourceFile {
  /** Repository-relative path. For a cluster, the directory the files were merged into ("" = root). */
  path: string;
  /** Size in bytes (sum of member sizes for a cluster). */
  size: number;
  /** Present when this entry stands for several small files that were merged to respect the building budget. */
  cluster?: { count: number };
}

export type ExclusionReason =
  | "ignoredDirectory"
  | "lockfile"
  | "binary"
  | "generated"
  | "oversized"
  | "notAFile";

export interface LanguageStat {
  id: string;
  files: number;
  bytes: number;
}

export interface RepoStats {
  /** Entries returned by the Git tree (files + directories + submodules). */
  treeEntries: number;
  /** Files that survived filtering (before the building budget). */
  includedFiles: number;
  excludedFiles: number;
  excludedByReason: Partial<Record<ExclusionReason, number>>;
  /** Distinct directories containing at least one included file (excluding the root). */
  directories: number;
  /** Bytes across included files. */
  includedBytes: number;
  /** Buildings actually sent to the client (files + clusters). */
  buildings: number;
  /** Included files represented by cluster buildings rather than their own building. */
  clusteredFiles: number;
  /** Languages across included files, sorted by bytes descending. */
  languages: LanguageStat[];
}

export interface RepoSummary {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  /** The ref that was resolved (branch, tag or SHA as requested; defaults to the default branch). */
  ref: string;
  commitSha: string;
  primaryLanguage: string | null;
  /** Repository size reported by GitHub, in kilobytes. */
  sizeKb: number;
  stars: number;
  forks: number;
  archived: boolean;
}

export interface RepoTree {
  fullName: string;
  commitSha: string;
  /** GitHub truncated the recursive tree; the city shows only part of the repository. */
  truncated: boolean;
  /** Files were merged into clusters to fit the building budget. */
  simplified: boolean;
  budget: number;
  files: SourceFile[];
  stats: RepoStats;
}

export type ApiErrorCode =
  | "INVALID_URL"
  | "NOT_FOUND"
  | "PRIVATE"
  | "REF_NOT_FOUND"
  | "EMPTY"
  | "RATE_LIMITED"
  | "FORBIDDEN"
  | "TOO_LARGE"
  | "UPSTREAM"
  | "NETWORK"
  | "TIMEOUT"
  | "BAD_RESPONSE"
  | "THROTTLED";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** For RATE_LIMITED / THROTTLED: when requests may resume (ISO timestamp). */
    resetAt?: string;
  };
}
