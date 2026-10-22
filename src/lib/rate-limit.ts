import "server-only";
import { isIP } from "node:net";
import { dbExecute, dbOne, table, usesPostgres, withTransaction, type DbTransaction } from "./database";

const WINDOW_MS = 60_000;
const PER_USER_LIMIT = 8;
const GLOBAL_LIMIT = 100;

type Window = { startedAt: number; count: number };
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Process-local protection for SQLite development. PostgreSQL uses shared rows below. */
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

type RateRow = { windowStart: number | string; used: number };

async function lockedWindow(key: string, now: number, transaction: DbTransaction): Promise<{ startedAt: number; count: number }> {
  await dbExecute(`INSERT INTO ${table("chat_rate_limit")} (key, window_start, used) VALUES (?, ?, 0) ON CONFLICT(key) DO NOTHING`, [key, now], transaction);
  const row = await dbOne<RateRow>(`SELECT window_start AS "windowStart", used FROM ${table("chat_rate_limit")} WHERE key = ? FOR UPDATE`, [key], transaction);
  if (!row) throw new Error("rate_limit_unavailable");
  const startedAt = Number(row.windowStart);
  if (now - startedAt < WINDOW_MS) return { startedAt, count: row.used };
  await dbExecute(`UPDATE ${table("chat_rate_limit")} SET window_start = ?, used = 0 WHERE key = ?`, [now, key], transaction);
  return { startedAt: now, count: 0 };
}

/** Shared, atomic limits across Vercel instances when PostgreSQL is configured. */
export async function checkChatRate(userId: string, now = Date.now()): Promise<RateLimitResult> {
  if (!usesPostgres) return chatRateLimiter.check(userId, now);
  return withTransaction(async transaction => {
    // Lock in a consistent order across instances to avoid deadlocks.
    const total = await lockedWindow("global", now, transaction);
    const client = await lockedWindow(`user:${userId}`, now, transaction);
    if (total.count >= GLOBAL_LIMIT || client.count >= PER_USER_LIMIT) {
      const waitMs = Math.max(
        total.count >= GLOBAL_LIMIT ? WINDOW_MS - (now - total.startedAt) : 0,
        client.count >= PER_USER_LIMIT ? WINDOW_MS - (now - client.startedAt) : 0,
      );
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    await dbExecute(`UPDATE ${table("chat_rate_limit")} SET used = used + 1 WHERE key = ?`, ["global"], transaction);
    await dbExecute(`UPDATE ${table("chat_rate_limit")} SET used = used + 1 WHERE key = ?`, [`user:${userId}`], transaction);
    return { allowed: true };
  });
}
