/**
 * Jest global teardown: closes the shared `pg` pool so the process can exit cleanly.
 */
import { closePool } from "../db/client";

export default async function jestGlobalTeardown(): Promise<void> {
  await closePool();
}
