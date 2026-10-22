export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Encode a repository path for use in a github.com URL, segment by segment. */
export function encodeRepoPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function githubBlobUrl(htmlUrl: string, sha: string, path: string): string {
  return `${htmlUrl}/blob/${sha}/${encodeRepoPath(path)}`;
}

export function githubTreeUrl(htmlUrl: string, sha: string, dir: string): string {
  return dir ? `${htmlUrl}/tree/${sha}/${encodeRepoPath(dir)}` : `${htmlUrl}/tree/${sha}`;
}
