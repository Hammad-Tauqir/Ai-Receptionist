import "server-only";

import { database } from "./database";

export type ApprovedUser = { email: string; addedAt: number; addedBy: string; owner: boolean };

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function ownerEmail(): string {
  return normalizeEmail(process.env.OWNER_EMAIL || "");
}

export function isOwner(email: string | null | undefined): boolean {
  const owner = ownerEmail();
  return Boolean(owner && email && normalizeEmail(email) === owner);
}

export function isApproved(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  if (isOwner(normalized)) return true;
  return Boolean(database.prepare("SELECT 1 FROM allowed_email WHERE email = ?").get(normalized));
}

export function listApprovedUsers(): ApprovedUser[] {
  const rows = database.prepare("SELECT email, added_at AS addedAt, added_by AS addedBy FROM allowed_email ORDER BY email").all() as Omit<ApprovedUser, "owner">[];
  const owner = ownerEmail();
  return [
    ...(owner ? [{ email: owner, addedAt: 0, addedBy: "environment", owner: true }] : []),
    ...rows.filter(row => row.email !== owner).map(row => ({ ...row, owner: false })),
  ];
}

export function addApprovedEmail(email: string, addedBy: string): ApprovedUser {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new Error("invalid_email");
  if (isOwner(normalized)) return { email: normalized, addedAt: 0, addedBy: "environment", owner: true };
  const addedAt = Date.now();
  database.prepare("INSERT INTO allowed_email (email, added_at, added_by) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING").run(normalized, addedAt, normalizeEmail(addedBy));
  const row = database.prepare("SELECT email, added_at AS addedAt, added_by AS addedBy FROM allowed_email WHERE email = ?").get(normalized) as Omit<ApprovedUser, "owner">;
  return { ...row, owner: false };
}

export function revokeApprovedEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (isOwner(normalized)) throw new Error("owner_cannot_be_revoked");
  return database.prepare("DELETE FROM allowed_email WHERE email = ?").run(normalized).changes > 0;
}
