import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache: the only page is a tiny client shell rendered per
// request, and nothing revalidates, so no R2/KV bucket is needed. The API
// routes cache their own responses at the edge (src/server/edge-cache.ts).
export default defineCloudflareConfig();
