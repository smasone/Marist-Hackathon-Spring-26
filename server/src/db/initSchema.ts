/**
 * Applies server/src/db/schema.sql using the local `psql` client and DATABASE_URL.
 * Loads env the same way as the rest of the server (dotenv via src/config/env.ts).
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { env } from "../config/env";

/**
 * Resolves the path to schema.sql next to this script.
 *
 * @returns Absolute path to schema.sql.
 */
function getSchemaPath(): string {
  return path.join(__dirname, "schema.sql");
}

/**
 * Runs `psql` with ON_ERROR_STOP so a failed statement aborts the script.
 *
 * @returns void
 */
function initSchema(): void {
  const schemaPath = getSchemaPath();
  execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-f", schemaPath, env.databaseUrl],
    { stdio: "inherit" }
  );
  console.log("Schema applied from schema.sql (via psql).");
}

try {
  initSchema();
} catch (error: unknown) {
  console.error("db:init failed:", error);
  process.exitCode = 1;
}
