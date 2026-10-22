import { loadEnvConfig } from "@next/env";
import { getMigrations } from "better-auth/db/migration";

loadEnvConfig(process.cwd());
async function main() {
  const { authOptions } = await import("../src/lib/auth");
  const migrations = await getMigrations(authOptions);
  await migrations.runMigrations();
  console.log("Authentication database is ready.");
}
void main();
