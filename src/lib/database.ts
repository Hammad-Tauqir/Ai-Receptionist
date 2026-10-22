import "server-only";

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

// The production database path is intentionally configurable for a durable volume.
const databasePath = path.resolve(/* turbopackIgnore: true */ process.env.AUTH_DATABASE_PATH || "data/auth.db");
mkdirSync(path.dirname(databasePath), { recursive: true });

const globalDatabase = globalThis as typeof globalThis & { novaDatabase?: Database.Database };
export const database = globalDatabase.novaDatabase ?? new Database(databasePath);
if (process.env.NODE_ENV !== "production") globalDatabase.novaDatabase = database;

database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.exec(`
  CREATE TABLE IF NOT EXISTS allowed_email (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    added_at INTEGER NOT NULL,
    added_by TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invitation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    claimed_at INTEGER,
    used_at INTEGER,
    created_by TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS invitation_email ON invitation(email);
`);
