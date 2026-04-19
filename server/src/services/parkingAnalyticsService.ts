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

/** Row from `parking_lots` only (columns map 1:1 to the table). */
export interface ParkingLotRow {
    id: number;
    lotCode: string;
    lotName: string;
    zoneType: string;
}

/**
 * One `parking_snapshots` row per lot — the latest by `snapshot_at` for each `lot_id`.
 */
export interface LatestSnapshotPerLotRow {
    id: number;
    lotId: number;
    occupancyPercent: number;
    snapshotAt: Date;
}

/** One lot plus its most recent snapshot row, if any. */
export interface LotDetailRow {
    id: number;
    lotCode: string;
    lotName: string;
    zoneType: string;
    latestSnapshot: {
        id: number;
        occupancyPercent: number;
        snapshotAt: Date;
    } | null;
}

/** Recommendation derived only from latest summary rows in Postgres. */
export interface ParkingRecommendationRow {
    lotCode: string;
    lotName: string;
    zoneType: string;
    occupancyPercent: number;
    latestSnapshotTime: Date;
    reason: string;
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

    /**
     * Lists every row in `parking_lots` ordered by id.
     *
     * @returns All lots with real column data (no snapshot join).
     */
    public static async getAllLots(): Promise<ParkingLotRow[]> {
        const result = await pool.query(
            `
      SELECT
        id,
        lot_code AS "lotCode",
        lot_name AS "lotName",
        zone_type AS "zoneType"
      FROM parking_lots
      ORDER BY id ASC;
      `
        );

        return result.rows.map((row) => ({
            id: Number(row.id),
            lotCode: row.lotCode,
            lotName: row.lotName,
            zoneType: row.zoneType,
        }));
    }

    /**
     * Returns the newest `parking_snapshots` row per `lot_id` (by `snapshot_at`).
     * Lots with no snapshots do not appear.
     *
     * @returns Latest snapshot rows only; columns match the table (camelCase in JSON).
     */
    public static async getLatestSnapshotsPerLot(): Promise<
        LatestSnapshotPerLotRow[]
    > {
        const result = await pool.query(
            `
      SELECT DISTINCT ON (ps.lot_id)
        ps.id AS "id",
        ps.lot_id AS "lotId",
        ps.occupancy_percent AS "occupancyPercent",
        ps.snapshot_at AS "snapshotAt"
      FROM parking_snapshots ps
      ORDER BY ps.lot_id, ps.snapshot_at DESC;
      `
        );

        return result.rows.map((row) => ({
            id: Number(row.id),
            lotId: Number(row.lotId),
            occupancyPercent: Number(row.occupancyPercent),
            snapshotAt: row.snapshotAt as Date,
        }));
    }

    /**
     * Looks up one lot by `lot_code` and includes its latest snapshot if present.
     *
     * @param lotCode Case-sensitive `parking_lots.lot_code` (URL segment).
     * @returns The lot row or `null` when no matching lot exists.
     */
    public static async getLotByCode(
        lotCode: string
    ): Promise<LotDetailRow | null> {
        const result = await pool.query(
            `
      SELECT
        pl.id AS "id",
        pl.lot_code AS "lotCode",
        pl.lot_name AS "lotName",
        pl.zone_type AS "zoneType",
        latest.id AS "snapshotId",
        latest.occupancy_percent AS "snapshotOccupancyPercent",
        latest.snapshot_at AS "snapshotAt"
      FROM parking_lots pl
      LEFT JOIN LATERAL (
        SELECT ps.id, ps.occupancy_percent, ps.snapshot_at
        FROM parking_snapshots ps
        WHERE ps.lot_id = pl.id
        ORDER BY ps.snapshot_at DESC
        LIMIT 1
      ) latest ON true
      WHERE pl.lot_code = $1;
      `,
            [lotCode]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0] as {
            id: unknown;
            lotCode: string;
            lotName: string;
            zoneType: string;
            snapshotId: number | null;
            snapshotOccupancyPercent: string | number | null;
            snapshotAt: Date | null;
        };

        const latestSnapshot =
            row.snapshotId != null &&
            row.snapshotOccupancyPercent != null &&
            row.snapshotAt != null
                ? {
                      id: Number(row.snapshotId),
                      occupancyPercent: Number(row.snapshotOccupancyPercent),
                      snapshotAt: row.snapshotAt as Date,
                  }
                : null;

        return {
            id: Number(row.id),
            lotCode: row.lotCode,
            lotName: row.lotName,
            zoneType: row.zoneType,
            latestSnapshot,
        };
    }

    /**
     * Picks a simple "best" lot from current DB summaries.
     * Lowest occupancy wins; ties are broken by newer snapshot.
     */
    public static async getRecommendation(
        allowedZones?: string[]
    ): Promise<ParkingRecommendationRow | null> {
        const summaries = await this.getParkingLotSummaries();
        const zoneSet =
            allowedZones && allowedZones.length > 0
                ? new Set(allowedZones.map((zone) => zone.toLowerCase()))
                : null;

        const candidates = summaries.filter((row) => {
            if (row.occupancyPercent === null || row.latestSnapshotTime === null) {
                return false;
            }
            if (!zoneSet) {
                return true;
            }
            return zoneSet.has(row.zoneType.toLowerCase());
        });

        if (candidates.length === 0) {
            return null;
        }

        candidates.sort((a, b) => {
            const byOccupancy = (a.occupancyPercent as number) - (b.occupancyPercent as number);
            if (byOccupancy !== 0) {
                return byOccupancy;
            }
            return (
                (b.latestSnapshotTime as Date).getTime() -
                (a.latestSnapshotTime as Date).getTime()
            );
        });

        const selected = candidates[0];
        const zoneSummary =
            zoneSet && zoneSet.size > 0
                ? `Eligible by zone filter from your question: ${[...zoneSet].sort().join(", ")}. `
                : "No zone filter applied (all zone types considered). ";
        const reason = `${zoneSummary}Chosen for lowest current occupancy among lots that have a latest snapshot in the database; ties break toward the newer snapshot.`;
        return {
            lotCode: selected.lotCode,
            lotName: selected.lotName,
            zoneType: selected.zoneType,
            occupancyPercent: Number(selected.occupancyPercent),
            latestSnapshotTime: selected.latestSnapshotTime as Date,
            reason,
        };
    }
}