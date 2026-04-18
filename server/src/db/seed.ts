/**
 * Inserts deterministic fake parking data for demos and local testing.
 * Safe to re-run: removes prior rows for the same seed lot codes, then inserts fresh rows.
 */
import { closePool, getPool } from "./client";

/** Lot codes used only by this seed script (avoid clashing with manual DB edits). */
const SEED_LOT_CODES = ["DEMO-N-01", "DEMO-S-02", "DEMO-E-03"] as const;

/**
 * Deletes existing seed rows and inserts sample lots and snapshots inside a transaction.
 *
 * @returns A promise that resolves when seeding completes.
 */
async function seed(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Remove old seed snapshots and lots so re-runs do not duplicate rows.
    await client.query(
      `
      DELETE FROM parking_snapshots
      WHERE lot_id IN (
        SELECT id FROM parking_lots WHERE lot_code = ANY($1::text[])
      );
      `,
      [SEED_LOT_CODES]
    );
    await client.query(
      `DELETE FROM parking_lots WHERE lot_code = ANY($1::text[]);`,
      [SEED_LOT_CODES]
    );

    await client.query(
      `
      INSERT INTO parking_lots (lot_code, lot_name, zone_type)
      VALUES
        ('DEMO-N-01', 'North Campus Lot', 'student'),
        ('DEMO-S-02', 'South Field Lot', 'faculty'),
        ('DEMO-E-03', 'East Visitor Lot', 'visitor');
      `
    );

    const lots = await client.query<{ id: number; lot_code: string }>(
      `SELECT id, lot_code FROM parking_lots WHERE lot_code = ANY($1::text[]) ORDER BY lot_code;`,
      [SEED_LOT_CODES]
    );

    const idByCode = new Map(
      lots.rows.map((row) => [row.lot_code, row.id] as const)
    );

    const northId = idByCode.get("DEMO-N-01");
    const southId = idByCode.get("DEMO-S-02");
    const eastId = idByCode.get("DEMO-E-03");

    if (northId === undefined || southId === undefined || eastId === undefined) {
      throw new Error("Seed failed: could not resolve inserted lot IDs.");
    }

    // Sample snapshots: some before 9:00 local time for analytics demos (busy lots before 9 AM).
    await client.query(
      `
      INSERT INTO parking_snapshots (lot_id, occupancy_percent, snapshot_at)
      VALUES
        ($1, 92.5, TIMESTAMPTZ '2026-04-10 07:30:00-04'),
        ($1, 95.0, TIMESTAMPTZ '2026-04-11 08:15:00-04'),
        ($2, 88.0, TIMESTAMPTZ '2026-04-10 07:45:00-04'),
        ($2, 91.0, TIMESTAMPTZ '2026-04-12 08:00:00-04'),
        ($3, 40.0, TIMESTAMPTZ '2026-04-10 10:00:00-04'),
        ($3, 35.0, TIMESTAMPTZ '2026-04-11 11:30:00-04');
      `,
      [northId, southId, eastId]
    );

    await client.query("COMMIT");
    console.log("Seed data inserted for codes:", SEED_LOT_CODES.join(", "));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error: unknown) => {
    console.error("seed-db failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
