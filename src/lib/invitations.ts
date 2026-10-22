import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { addApprovedEmail, isOwner, normalizeEmail, revokeApprovedEmail, type ApprovedUser } from "./access";
import { auth } from "./auth";
import { database } from "./database";

const INVITE_LIFETIME_MS = 48 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type PendingInvitation = { id: number; email: string; createdAt: number; expiresAt: number; createdBy: string };
type InvitationRow = PendingInvitation & { claimedAt: number | null; usedAt: number | null };

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function invitationByToken(token: string): InvitationRow | undefined {
  if (!TOKEN_PATTERN.test(token)) return undefined;
  return database.prepare(`SELECT id, email, created_at AS createdAt, expires_at AS expiresAt,
    claimed_at AS claimedAt, used_at AS usedAt, created_by AS createdBy
    FROM invitation WHERE token_hash = ?`).get(tokenHash(token)) as InvitationRow | undefined;
}

export function listPendingInvitations(now = Date.now()): PendingInvitation[] {
  return database.prepare(`SELECT id, email, created_at AS createdAt, expires_at AS expiresAt,
    created_by AS createdBy FROM invitation
    WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC`).all(now) as PendingInvitation[];
}

export function inviteOrApprove(email: string, owner: string):
  | { kind: "approved"; user: ApprovedUser }
  | { kind: "invited"; invitation: PendingInvitation; url: string } {
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) throw new Error("invalid_email");
  if (isOwner(normalized)) return { kind: "approved", user: addApprovedEmail(normalized, owner) };

  // A previously registered user can be reapproved without changing a password.
  const existing = database.prepare("SELECT 1 FROM user WHERE email = ?").get(normalized);
  if (existing) return database.transaction(() => {
    database.prepare("DELETE FROM invitation WHERE email = ? AND used_at IS NULL").run(normalized);
    return { kind: "approved" as const, user: addApprovedEmail(normalized, owner) };
  })();

  const baseURL = process.env.BETTER_AUTH_URL;
  if (!baseURL) throw new Error("base_url_missing");
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + INVITE_LIFETIME_MS;
  const createdBy = normalizeEmail(owner);
  const create = database.transaction(() => {
    database.prepare("DELETE FROM invitation WHERE email = ? AND used_at IS NULL").run(normalized);
    const result = database.prepare(`INSERT INTO invitation (email, token_hash, created_at, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?)`).run(normalized, tokenHash(token), now, expiresAt, createdBy);
    return Number(result.lastInsertRowid);
  });
  const id = create();
  const url = new URL("/accept-invite", baseURL);
  // Fragment tokens are not sent in GET requests or Referer headers.
  url.hash = `token=${token}`;
  return { kind: "invited", invitation: { id, email: normalized, createdAt: now, expiresAt, createdBy }, url: url.toString() };
}

export function revokeEmailAndInvitations(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) throw new Error("invalid_email");
  if (isOwner(normalized)) throw new Error("owner_cannot_be_revoked");
  return database.transaction(() => {
    const removedInvitations = database.prepare("DELETE FROM invitation WHERE email = ? AND used_at IS NULL").run(normalized).changes;
    const removedApproval = revokeApprovedEmail(normalized);
    return removedInvitations > 0 || removedApproval;
  })();
}

export async function acceptInvitation(token: string, name: string, password: string): Promise<string> {
  const row = invitationByToken(token);
  const now = Date.now();
  if (!row || row.usedAt || row.claimedAt || row.expiresAt <= now) throw new Error("invalid_invitation");
  const claim = database.prepare(`UPDATE invitation SET claimed_at = ?
    WHERE id = ? AND claimed_at IS NULL AND used_at IS NULL AND expires_at > ?`).run(now, row.id, now);
  if (claim.changes !== 1) throw new Error("invalid_invitation");

  try {
    if (database.prepare("SELECT 1 FROM user WHERE email = ?").get(row.email)) throw new Error("account_exists");
    await auth.api.signUpEmail({ body: { email: row.email, name, password } });
    const finalize = database.transaction(() => {
      const current = database.prepare("SELECT 1 FROM invitation WHERE id = ? AND claimed_at = ? AND used_at IS NULL").get(row.id, now);
      if (!current) throw new Error("invalid_invitation");
      addApprovedEmail(row.email, row.createdBy);
      database.prepare("UPDATE invitation SET used_at = ? WHERE id = ?").run(Date.now(), row.id);
    });
    finalize();
    return row.email;
  } catch (error) {
    database.prepare("UPDATE invitation SET claimed_at = NULL WHERE id = ? AND claimed_at = ? AND used_at IS NULL").run(row.id, now);
    throw error;
  }
}
