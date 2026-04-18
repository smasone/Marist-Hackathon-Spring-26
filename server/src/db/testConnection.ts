/**
 * Quick Neon/Postgres connection test.
 */
import { Pool } from "pg";
import { env } from "../config/env";

const pool = new Pool({
  connectionString: env.databaseUrl,
});

/**
 * Tests whether the database connection works.
 *
 * @returns A promise that resolves when the test completes.
 */
async function testConnection(): Promise<void> {
  const result = await pool.query("SELECT NOW() as now");
  console.log("Database connected:", result.rows[0]);
  await pool.end();
}

testConnection().catch((error: unknown) => {
  console.error("Database connection failed:", error);
  process.exit(1);
});