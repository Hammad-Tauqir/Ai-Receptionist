import "server-only";

import { dbAll, dbExecute, dbOne, table, type DbTransaction } from "./database";

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

export async function isApproved(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  if (isOwner(normalized)) return true;
  return Boolean(await dbOne(`SELECT 1 FROM ${table("allowed_email")} WHERE email = ?`, [normalized]));
}

export async function listApprovedUsers(): Promise<ApprovedUser[]> {
  const rows = await dbAll<Omit<ApprovedUser, "owner">>(`SELECT email, added_at AS "addedAt", added_by AS "addedBy" FROM ${table("allowed_email")} ORDER BY email`);
  const owner = ownerEmail();
  return [
    ...(owner ? [{ email: owner, addedAt: 0, addedBy: "environment", owner: true }] : []),
    ...rows.filter(row => row.email !== owner).map(row => ({ ...row, addedAt: Number(row.addedAt), owner: false })),
  ];
}

export async function addApprovedEmail(email: string, addedBy: string, transaction?: DbTransaction): Promise<ApprovedUser> {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new Error("invalid_email");
  if (isOwner(normalized)) return { email: normalized, addedAt: 0, addedBy: "environment", owner: true };
  const addedAt = Date.now();
  await dbExecute(`INSERT INTO ${table("allowed_email")} (email, added_at, added_by) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING`, [normalized, addedAt, normalizeEmail(addedBy)], transaction);
  const row = await dbOne<Omit<ApprovedUser, "owner">>(`SELECT email, added_at AS "addedAt", added_by AS "addedBy" FROM ${table("allowed_email")} WHERE email = ?`, [normalized], transaction);
  if (!row) throw new Error("approval_not_saved");
  return { ...row, addedAt: Number(row.addedAt), owner: false };
}

export async function revokeApprovedEmail(email: string, transaction?: DbTransaction): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (isOwner(normalized)) throw new Error("owner_cannot_be_revoked");
  return await dbExecute(`DELETE FROM ${table("allowed_email")} WHERE email = ?`, [normalized], transaction) > 0;
}
