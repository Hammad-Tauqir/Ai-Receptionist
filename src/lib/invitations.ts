import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { addApprovedEmail, isOwner, normalizeEmail, revokeApprovedEmail, type ApprovedUser } from "./access";
import { auth } from "./auth";
import { dbAll, dbExecute, dbOne, table, withTransaction } from "./database";

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

async function invitationByToken(token: string): Promise<InvitationRow | undefined> {
  if (!TOKEN_PATTERN.test(token)) return undefined;
  const row = await dbOne<InvitationRow>(`SELECT id, email, created_at AS "createdAt", expires_at AS "expiresAt",
    claimed_at AS "claimedAt", used_at AS "usedAt", created_by AS "createdBy"
    FROM ${table("invitation")} WHERE token_hash = ?`, [tokenHash(token)]);
  return row ? { ...row, id: Number(row.id), createdAt: Number(row.createdAt), expiresAt: Number(row.expiresAt) } : undefined;
}

export async function listPendingInvitations(now = Date.now()): Promise<PendingInvitation[]> {
  const rows = await dbAll<PendingInvitation>(`SELECT id, email, created_at AS "createdAt", expires_at AS "expiresAt",
    created_by AS "createdBy" FROM ${table("invitation")}
    WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC`, [now]);
  return rows.map(row => ({ ...row, id: Number(row.id), createdAt: Number(row.createdAt), expiresAt: Number(row.expiresAt) }));
}

export async function inviteOrApprove(email: string, owner: string): Promise<
  | { kind: "approved"; user: ApprovedUser }
  | { kind: "invited"; invitation: PendingInvitation; url: string }> {
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) throw new Error("invalid_email");
  if (isOwner(normalized)) return { kind: "approved", user: await addApprovedEmail(normalized, owner) };

  // A previously registered user can be reapproved without changing a password.
  const existing = await dbOne(`SELECT 1 FROM ${table("user")} WHERE email = ?`, [normalized]);
  if (existing) return withTransaction(async transaction => {
    await dbExecute(`DELETE FROM ${table("invitation")} WHERE email = ? AND used_at IS NULL`, [normalized], transaction);
    return { kind: "approved" as const, user: await addApprovedEmail(normalized, owner, transaction) };
  });

  const baseURL = process.env.BETTER_AUTH_URL;
  if (!baseURL) throw new Error("base_url_missing");
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + INVITE_LIFETIME_MS;
  const createdBy = normalizeEmail(owner);
  const id = await withTransaction(async transaction => {
    await dbExecute(`DELETE FROM ${table("invitation")} WHERE email = ? AND used_at IS NULL`, [normalized], transaction);
    const result = await dbOne<{ id: number }>(`INSERT INTO ${table("invitation")} (email, token_hash, created_at, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?) RETURNING id`, [normalized, tokenHash(token), now, expiresAt, createdBy], transaction);
    if (!result) throw new Error("invitation_not_saved");
    return Number(result.id);
  });
  const url = new URL("/accept-invite", baseURL);
  // Fragment tokens are not sent in GET requests or Referer headers.
  url.hash = `token=${token}`;
  return { kind: "invited", invitation: { id, email: normalized, createdAt: now, expiresAt, createdBy }, url: url.toString() };
}

export async function revokeEmailAndInvitations(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) throw new Error("invalid_email");
  if (isOwner(normalized)) throw new Error("owner_cannot_be_revoked");
  return withTransaction(async transaction => {
    const removedInvitations = await dbExecute(`DELETE FROM ${table("invitation")} WHERE email = ? AND used_at IS NULL`, [normalized], transaction);
    const removedApproval = await revokeApprovedEmail(normalized, transaction);
    return removedInvitations > 0 || removedApproval;
  });
}

export async function acceptInvitation(token: string, name: string, password: string): Promise<string> {
  const row = await invitationByToken(token);
  const now = Date.now();
  if (!row || row.usedAt || row.claimedAt || row.expiresAt <= now) throw new Error("invalid_invitation");
  const claim = await dbExecute(`UPDATE ${table("invitation")} SET claimed_at = ?
    WHERE id = ? AND claimed_at IS NULL AND used_at IS NULL AND expires_at > ?`, [now, row.id, now]);
  if (claim !== 1) throw new Error("invalid_invitation");

  try {
    if (await dbOne(`SELECT 1 FROM ${table("user")} WHERE email = ?`, [row.email])) throw new Error("account_exists");
    await auth.api.signUpEmail({ body: { email: row.email, name, password } });
    await withTransaction(async transaction => {
      const current = await dbOne(`SELECT 1 FROM ${table("invitation")} WHERE id = ? AND claimed_at = ? AND used_at IS NULL`, [row.id, now], transaction);
      if (!current) throw new Error("invalid_invitation");
      await addApprovedEmail(row.email, row.createdBy, transaction);
      await dbExecute(`UPDATE ${table("invitation")} SET used_at = ? WHERE id = ?`, [Date.now(), row.id], transaction);
    });
    return row.email;
  } catch (error) {
    await dbExecute(`UPDATE ${table("invitation")} SET claimed_at = NULL WHERE id = ? AND claimed_at = ? AND used_at IS NULL`, [row.id, now]);
    throw error;
  }
}
