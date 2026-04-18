/**
 * Shared Postgres connection pool for scripts and application code.
 */
import { Pool } from "pg";
import { env } from "../config/env";

let pool: Pool | null = null;

/**
 * Returns the singleton {@link Pool} backed by `DATABASE_URL` from env.
 *
 * @returns The shared Postgres pool instance.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
    });
  }
  return pool;
}

/**
 * Ends the shared pool. Call from one-off scripts before process exit;
 * avoids leaving connections open after CLI runs.
 *
 * @returns A promise that resolves when the pool has closed.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
