/**
 * Quick Neon/Postgres connection test (CLI only; not imported by the HTTP server).
 */
import { closePool, getPool } from "./client";

/**
 * Tests whether the database connection works.
 *
 * @returns A promise that resolves when the test completes.
 */
async function testConnection(): Promise<void> {
  const pool = getPool();
  const result = await pool.query("SELECT NOW() as now");
  console.log("Database connected:", result.rows[0]);
  await closePool();
}

testConnection().catch((error: unknown) => {
  console.error("Database connection failed:", error);
  process.exit(1);
});