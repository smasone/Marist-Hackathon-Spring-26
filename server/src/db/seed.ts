import { closePool, getPool } from "./client";

const SEED_LOT_IDS = [9001, 9002, 9003] as const;

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

    await client.query(
      `
      DELETE FROM history
      WHERE spacenum IN (
        SELECT spacenum FROM spaces WHERE lotid = ANY($1::int[])
      );
      `,
      [SEED_LOT_IDS]
    );
    await client.query(`DELETE FROM spaces WHERE lotid = ANY($1::int[]);`, [SEED_LOT_IDS]);
    await client.query(`DELETE FROM lots WHERE lotid = ANY($1::int[]);`, [SEED_LOT_IDS]);

    await client.query(
      `
      INSERT INTO lots (
        lotid,
        lotname,
        altname,
        allowsresidents,
        allowscommuters,
        allowsfaculty,
        allowsvisitors
      )
      VALUES
        (9001, 'North Campus Lot', 'DEMO-N-01', true, true, false, false),
        (9002, 'South Field Lot', 'DEMO-S-02', false, false, true, false),
        (9003, 'East Visitor Lot', 'DEMO-E-03', false, false, false, true);
      `
    );

    await client.query(
      `
      INSERT INTO spaces (spacenum, lotid, ishandicap)
      SELECT gs, 9001, (gs % 10 = 0) FROM generate_series(91001, 91080) AS gs
      UNION ALL
      SELECT gs, 9002, (gs % 12 = 0) FROM generate_series(92001, 92060) AS gs
      UNION ALL
      SELECT gs, 9003, (gs % 8 = 0) FROM generate_series(93001, 93040) AS gs;
      `
    );

    await client.query(
      `
      INSERT INTO history (spacenum, entrancetime, exittime)
      VALUES
        (91001, TIMESTAMP '2026-04-10 07:10:00', TIMESTAMP '2026-04-10 10:20:00'),
        (91002, TIMESTAMP '2026-04-10 07:30:00', TIMESTAMP '2026-04-10 09:45:00'),
        (91003, TIMESTAMP '2026-04-11 08:00:00', TIMESTAMP '2026-04-11 10:50:00'),
        (91004, TIMESTAMP '2026-04-12 08:25:00', TIMESTAMP '2026-04-12 11:00:00'),
        (92001, TIMESTAMP '2026-04-10 07:40:00', TIMESTAMP '2026-04-10 12:05:00'),
        (92002, TIMESTAMP '2026-04-11 08:10:00', TIMESTAMP '2026-04-11 11:40:00'),
        (92003, TIMESTAMP '2026-04-12 09:15:00', TIMESTAMP '2026-04-12 12:00:00'),
        (93001, TIMESTAMP '2026-04-10 10:00:00', TIMESTAMP '2026-04-10 13:00:00'),
        (93002, TIMESTAMP '2026-04-11 11:30:00', TIMESTAMP '2026-04-11 14:10:00'),
        (93003, TIMESTAMP '2026-04-12 12:20:00', TIMESTAMP '2026-04-12 15:00:00');
      `
    );

    await client.query("COMMIT");
    console.log("Seed data inserted for lot IDs:", SEED_LOT_IDS.join(", "));
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
