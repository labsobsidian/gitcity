/**
 * Best-effort per-client request limiter for the API routes, so one client
 * can't burn the server's GitHub quota. Per instance only — a determined
 * abuser on many IPs still needs a platform firewall rule.
 */
import { AppError } from "./errors";

const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 10_000;
const hits = new Map<string, number[]>();

function limitPerMinute(): number {
  const parsed = Number.parseInt(process.env.GITCITY_RATE_LIMIT_PER_MINUTE ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

export function throttle(request: Request, now = Date.now()): void {
  const key = clientKey(request);
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limitPerMinute()) {
    throw new AppError("THROTTLED", "You're generating cities very quickly. Take a breath and try again in a minute.", {
      resetAt: new Date(recent[0]! + WINDOW_MS),
    });
  }
  recent.push(now);
  hits.delete(key);
  hits.set(key, recent);
  if (hits.size > MAX_TRACKED_CLIENTS) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }
}
