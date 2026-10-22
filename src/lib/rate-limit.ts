import "server-only";
import { isIP } from "node:net";

const WINDOW_MS = 60_000;
const PER_USER_LIMIT = 8;
const GLOBAL_LIMIT = 100;

type Window = { startedAt: number; count: number };
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Process-local per-user protection for the Node route, with a global cap.
 */
export function createRateLimiter(windowMs = WINDOW_MS, perUserLimit = PER_USER_LIMIT, globalLimit = GLOBAL_LIMIT) {
  const clients = new Map<string, Window>();
  let total: Window | undefined;

  function current(window: Window | undefined, now: number): Window {
    return !window || now - window.startedAt >= windowMs ? { startedAt: now, count: 0 } : window;
  }

  return {
    check(userId: string, now = Date.now()): RateLimitResult {
      if (total && now - total.startedAt >= windowMs) {
        for (const [key, value] of clients) {
          if (now - value.startedAt >= windowMs) clients.delete(key);
        }
      }
      total = current(total, now);
      const client = current(clients.get(userId), now);
      if (total.count >= globalLimit || client.count >= perUserLimit) {
        const waitMs = Math.max(
          total.count >= globalLimit ? windowMs - (now - total.startedAt) : 0,
          client.count >= perUserLimit ? windowMs - (now - client.startedAt) : 0,
        );
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
      }
      total.count++;
      client.count++;
      clients.set(userId, client);
      return { allowed: true };
    },
  };
}

export function clientIp(headers: Headers): string {
  // Prefer headers set by a trusted reverse proxy. The last X-Forwarded-For hop
  // resists a caller prepending a forged value when the proxy appends the real IP.
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",").at(-1)?.trim(),
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && isIP(candidate))) ?? "unknown";
}

export const chatRateLimiter = createRateLimiter();
