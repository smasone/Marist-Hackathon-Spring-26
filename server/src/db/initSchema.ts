/**
 * Applies server/src/db/schema.sql to the database configured by DATABASE_URL.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { closePool, getPool } from "./client";

/**
 * Loads the SQL DDL file from this directory.
 *
 * @returns The full contents of schema.sql.
 */
function loadSchemaSql(): string {
  const schemaPath = path.join(__dirname, "schema.sql");
  return fs.readFileSync(schemaPath, "utf8");
}

/**
 * Runs the schema DDL against the database (multiple statements in one round-trip).
 *
 * @returns A promise that resolves when the schema has been applied.
 */
async function initSchema(): Promise<void> {
  const pool = getPool();
  const sql = loadSchemaSql();
  await pool.query(sql);
  console.log("Schema applied from schema.sql");
}

initSchema()
  .catch((error: unknown) => {
    console.error("db:init failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
