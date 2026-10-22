import { loadEnvConfig } from "@next/env";
import { getMigrations } from "better-auth/db/migration";

loadEnvConfig(process.cwd());
async function main() {
  const { authOptions } = await import("../src/lib/auth");
  const { migrateCustomTables } = await import("../src/lib/database");
  const migrations = await getMigrations(authOptions);
  await migrations.runMigrations();
  await migrateCustomTables();
  console.log("Authentication database is ready.");
}
void main().catch(() => {
  process.stderr.write("Authentication migration failed. Check database connectivity and permissions.\n");
  process.exitCode = 1;
});
