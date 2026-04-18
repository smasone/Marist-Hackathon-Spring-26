/**
 * Provides parking analytics queries for the hackathon backend.
 */

import { getPool } from "../db/client";

/**
 * Shared database pool for analytics queries.
 */
const pool = getPool();

/**
 * Represents a summary row for lots that are highly occupied before 9 AM.
 */
export interface BusyLotBeforeNineRow {
    lotCode: string;
    lotName: string;
    zoneType: string;
    averageOccupancyPercent: number;
    sampleCount: number;
}

/**
 * One row per lot with its latest reading from `parking_snapshots`.
 * The schema stores occupancy as a percentage only (no per-lot space counts yet).
 */
export interface ParkingLotSummaryRow {
    lotCode: string;
    lotName: string;
    zoneType: string;
    /** Latest `occupancy_percent` for this lot, or null if there are no snapshots. */
    occupancyPercent: number | null;
    /** Timestamp of the latest snapshot, or null if there are no snapshots. */
    latestSnapshotTime: Date | null;
}

/**
 * Parking analytics service.
 */
export class ParkingAnalyticsService {
    /**
     * Returns each lot in `parking_lots` with its most recent snapshot (if any).
     * Uses `DISTINCT ON` so each lot appears once with the latest `snapshot_at`.
     *
     * @returns Rows ordered by lot id (insertion order for SERIAL ids).
     */
    public static async getParkingLotSummaries(): Promise<ParkingLotSummaryRow[]> {
        const result = await pool.query(
            `
      SELECT DISTINCT ON (pl.id)
        pl.lot_code AS "lotCode",
        pl.lot_name AS "lotName",
        pl.zone_type AS "zoneType",
        ps.occupancy_percent AS "occupancyPercent",
        ps.snapshot_at AS "latestSnapshotTime"
      FROM parking_lots pl
      LEFT JOIN parking_snapshots ps ON ps.lot_id = pl.id
      ORDER BY pl.id, ps.snapshot_at DESC NULLS LAST;
      `
        );

        return result.rows.map((row) => ({
            lotCode: row.lotCode,
            lotName: row.lotName,
            zoneType: row.zoneType,
            occupancyPercent:
                row.occupancyPercent != null ? Number(row.occupancyPercent) : null,
            latestSnapshotTime:
                row.latestSnapshotTime != null
                    ? (row.latestSnapshotTime as Date)
                    : null,
        }));
    }

    /**
     * Finds lots whose average occupancy percentage is at or above the provided
     * threshold before 9:00 AM.
     *
     * Example use:
     * - threshold 90 -> "usually very full before 9 AM"
     *
     * @param occupancyThreshold The minimum average occupancy percentage.
     * @returns A list of matching lot summaries sorted from most full to less full.
     */
    public static async getBusyLotsBeforeNineAm(
        occupancyThreshold: number = 90
    ): Promise<BusyLotBeforeNineRow[]> {
        const result = await pool.query(
            `
      SELECT
        parking_lots.lot_code AS "lotCode",
        parking_lots.lot_name AS "lotName",
        parking_lots.zone_type AS "zoneType",
        ROUND(AVG(parking_snapshots.occupancy_percent), 2) AS "averageOccupancyPercent",
        COUNT(*)::int AS "sampleCount"
      FROM parking_snapshots
      INNER JOIN parking_lots
        ON parking_snapshots.lot_id = parking_lots.id
      WHERE EXTRACT(HOUR FROM parking_snapshots.snapshot_at) < 9
      GROUP BY
        parking_lots.lot_code,
        parking_lots.lot_name,
        parking_lots.zone_type
      HAVING AVG(parking_snapshots.occupancy_percent) >= $1
      ORDER BY AVG(parking_snapshots.occupancy_percent) DESC;
      `,
            [occupancyThreshold]
        );

        return result.rows.map((row) => ({
            lotCode: row.lotCode,
            lotName: row.lotName,
            zoneType: row.zoneType,
            averageOccupancyPercent: Number(row.averageOccupancyPercent),
            sampleCount: Number(row.sampleCount),
        }));
    }
}