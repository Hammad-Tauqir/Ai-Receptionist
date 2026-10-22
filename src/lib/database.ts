import "server-only";

import Database from "better-sqlite3";
import { PostgresDialect } from "kysely";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

const AUTH_SCHEMA = "nova_auth";
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString && (process.env.VERCEL === "1" || process.env.VERCEL_ENV)) {
  throw new Error("database_url_missing");
}
export const usesPostgres = Boolean(connectionString);

const globalDatabase = globalThis as typeof globalThis & {
  novaSqlite?: Database.Database;
  novaPgPool?: Pool;
};

function createPool(): Pool {
  if (!connectionString) throw new Error("database_url_missing");
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error("database_url_invalid"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.password) {
    throw new Error("database_url_invalid");
  }
  // node-postgres replaces the explicit TLS settings when these URI options
  // are present. Drop sslmode (we require verified TLS below) and reject custom
  // certificate paths that a serverless deployment cannot safely assume exist.
  if (["sslcert", "sslkey", "sslrootcert"].some(key => url.searchParams.has(key))) {
    throw new Error("database_url_invalid");
  }
  url.searchParams.delete("sslmode");
  const pool = new Pool({
    connectionString: url.toString(),
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ssl: { rejectUnauthorized: true },
  });
  pool.on("error", () => { /* The next query reports failure without printing connection secrets. */ });
  return pool;
}

const pgPool = connectionString ? (globalDatabase.novaPgPool ?? createPool()) : undefined;
if (pgPool && process.env.NODE_ENV !== "production") globalDatabase.novaPgPool = pgPool;

function createSqlite(): Database.Database {
  const databasePath = path.resolve(/* turbopackIgnore: true */ process.env.AUTH_DATABASE_PATH || "data/auth.db");
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
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
  return database;
}

const sqlite = pgPool ? undefined : (globalDatabase.novaSqlite ?? createSqlite());
if (sqlite && process.env.NODE_ENV !== "production") globalDatabase.novaSqlite = sqlite;

// Better Auth owns its user, account, session, and verification tables.
// The private PostgreSQL schema is not exposed by Supabase's Data API.
export const authDatabase = pgPool
  ? { dialect: new PostgresDialect({ pool: pgPool }), type: "postgres" as const, schemaName: AUTH_SCHEMA }
  : sqlite!;

type Params = readonly (string | number | boolean | Date | null)[];
export type DbTransaction = { kind: "postgres"; client: PoolClient } | { kind: "sqlite" };

export function table(name: "allowed_email" | "invitation" | "user" | "chat_rate_limit"): string {
  return usesPostgres ? `"${AUTH_SCHEMA}"."${name}"` : `"${name}"`;
}

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

let sqliteQueue: Promise<void> = Promise.resolve();

async function sqliteQuery<T>(query: () => T, transaction?: DbTransaction): Promise<T> {
  if (transaction?.kind !== "sqlite") await sqliteQueue;
  return query();
}

export async function dbOne<T>(sql: string, params: Params = [], transaction?: DbTransaction): Promise<T | undefined> {
  if (pgPool) {
    const client = transaction?.kind === "postgres" ? transaction.client : pgPool;
    const result = await client.query(postgresSql(sql), [...params]);
    return result.rows[0] as T | undefined;
  }
  return sqliteQuery(() => sqlite!.prepare(sql).get(...params) as T | undefined, transaction);
}

export async function dbAll<T>(sql: string, params: Params = [], transaction?: DbTransaction): Promise<T[]> {
  if (pgPool) {
    const client = transaction?.kind === "postgres" ? transaction.client : pgPool;
    const result = await client.query(postgresSql(sql), [...params]);
    return result.rows as T[];
  }
  return sqliteQuery(() => sqlite!.prepare(sql).all(...params) as T[], transaction);
}

export async function dbExecute(sql: string, params: Params = [], transaction?: DbTransaction): Promise<number> {
  if (pgPool) {
    const client = transaction?.kind === "postgres" ? transaction.client : pgPool;
    const result = await client.query(postgresSql(sql), [...params]);
    return result.rowCount ?? 0;
  }
  return sqliteQuery(() => sqlite!.prepare(sql).run(...params).changes, transaction);
}

export async function withTransaction<T>(callback: (transaction: DbTransaction) => Promise<T>): Promise<T> {
  if (pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback({ kind: "postgres", client });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  const previous = sqliteQueue;
  let release!: () => void;
  sqliteQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    sqlite!.exec("BEGIN IMMEDIATE");
    const result = await callback({ kind: "sqlite" });
    sqlite!.exec("COMMIT");
    return result;
  } catch (error) {
    sqlite!.exec("ROLLBACK");
    throw error;
  } finally { release(); }
}

export async function migrateCustomTables(): Promise<void> {
  if (!pgPool) return; // SQLite tables are created when the local database opens.
  await pgPool.query(`CREATE TABLE IF NOT EXISTS ${table("allowed_email")} (
    email TEXT PRIMARY KEY,
    added_at BIGINT NOT NULL,
    added_by TEXT NOT NULL
  )`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS ${table("invitation")} (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    claimed_at BIGINT,
    used_at BIGINT,
    created_by TEXT NOT NULL
  )`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS invitation_email ON ${table("invitation")}(email)`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS ${table("chat_rate_limit")} (
    key TEXT PRIMARY KEY,
    window_start BIGINT NOT NULL,
    used INTEGER NOT NULL
  )`);
}
