import { getPool } from "../db/client";

const pool = getPool();

export interface BusyLotBeforeNineRow {
    lotCode: string;
    lotName: string;
    zoneType: string;
    averageOccupancyPercent: number;
    sampleCount: number;
}

export interface ParkingLotSummaryRow {
    lotCode: string;
    lotName: string;
    zoneType: string;
    occupancyPercent: number | null;
    latestSnapshotTime: Date | null;
    sampleCount: number;
    allowedZones: string[];
    walkingMinutes?: number | null;
}

export interface ParkingLotRow {
    id: number;
    lotCode: string;
    lotName: string;
    zoneType: string;
}

export interface LatestSnapshotPerLotRow {
    id: number;
    lotId: number;
    occupancyPercent: number;
    snapshotAt: Date;
}

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

export interface ParkingRecommendationRow {
    lotCode: string;
    lotName: string;
    zoneType: string;
    occupancyPercent: number;
    latestSnapshotTime: Date;
    sampleCount: number;
    reason: string;
}

export interface ParkingForecastContext {
    targetHour?: number | null;
    targetDayOfWeek?: number | null;
}

function inferZoneType(row: {
    allowsResidents: boolean;
    allowsCommuters: boolean;
    allowsFaculty: boolean;
    allowsVisitors: boolean;
}): string {
    const studentAllowed = row.allowsResidents || row.allowsCommuters;
    const zones = [
        studentAllowed ? "student" : null,
        row.allowsFaculty ? "faculty" : null,
        row.allowsVisitors ? "visitor" : null,
    ].filter((z): z is string => z !== null);
    if (zones.length === 1) {
        return zones[0];
    }
    if (zones.length === 0) {
        return "unknown";
    }
    return "mixed";
}

function allowedZonesForLot(row: {
    allowsResidents: boolean;
    allowsCommuters: boolean;
    allowsFaculty: boolean;
    allowsVisitors: boolean;
}): string[] {
    const out: string[] = [];
    if (row.allowsResidents || row.allowsCommuters) {
        out.push("student");
    }
    if (row.allowsFaculty) {
        out.push("faculty");
    }
    if (row.allowsVisitors) {
        out.push("visitor");
    }
    return out;
}

export class ParkingAnalyticsService {
    public static async getParkingLotSummaries(
        context?: ParkingForecastContext
    ): Promise<ParkingLotSummaryRow[]> {
        const mapSummaryRows = (rows: any[]): ParkingLotSummaryRow[] =>
            rows.map((row) => {
                const access = {
                    allowsResidents: Boolean(row.allowsResidents),
                    allowsCommuters: Boolean(row.allowsCommuters),
                    allowsFaculty: Boolean(row.allowsFaculty),
                    allowsVisitors: Boolean(row.allowsVisitors),
                };
                return {
                    lotCode: row.lotCode,
                    lotName: row.lotName,
                    zoneType: inferZoneType(access),
                    occupancyPercent:
                        row.occupancyPercent != null ? Number(row.occupancyPercent) : null,
                    latestSnapshotTime:
                        row.latestSnapshotTime != null
                            ? (row.latestSnapshotTime as Date)
                            : null,
                    sampleCount: Number(row.sampleCount),
                    allowedZones: allowedZonesForLot(access),
                };
            });

        const runSummaryQuery = async (
            targetHour: number | null,
            targetDayOfWeek: number | null
        ): Promise<ParkingLotSummaryRow[]> => {
            const result = await pool.query(
                `
      WITH lot_capacity AS (
        SELECT lotid, COUNT(*)::int AS capacity
        FROM spaces
        GROUP BY lotid
      ),
      daily_usage AS (
        SELECT
          s.lotid,
          DATE(h.entrancetime) AS usage_day,
          COUNT(*)::int AS entry_count,
          MAX(h.entrancetime) AS latest_time
        FROM history h
        INNER JOIN spaces s ON s.spacenum = h.spacenum
        WHERE ($1::int IS NULL OR EXTRACT(HOUR FROM h.entrancetime) = $1)
          AND ($2::int IS NULL OR EXTRACT(DOW FROM h.entrancetime) = $2)
        GROUP BY s.lotid, DATE(h.entrancetime)
      )
      SELECT
        COALESCE(l.altname, l.lotid::text) AS "lotCode",
        l.lotname AS "lotName",
        l.allowsresidents AS "allowsResidents",
        l.allowscommuters AS "allowsCommuters",
        l.allowsfaculty AS "allowsFaculty",
        l.allowsvisitors AS "allowsVisitors",
        ROUND(
          AVG(
            CASE
              WHEN du.entry_count IS NULL THEN NULL
              WHEN lc.capacity IS NULL OR lc.capacity = 0 THEN 0
              ELSE LEAST(100, (du.entry_count::numeric / lc.capacity::numeric) * 100)
            END
          ),
          2
        ) AS "occupancyPercent",
        MAX(du.latest_time) AS "latestSnapshotTime",
        COUNT(du.usage_day)::int AS "sampleCount"
      FROM lots l
      LEFT JOIN lot_capacity lc ON lc.lotid = l.lotid
      LEFT JOIN daily_usage du ON du.lotid = l.lotid
      GROUP BY
        l.lotid,
        l.lotname,
        l.allowsresidents,
        l.allowscommuters,
        l.allowsfaculty,
        l.allowsvisitors
      ORDER BY l.lotid ASC;
      `,
                [targetHour, targetDayOfWeek]
            );
            return mapSummaryRows(result.rows);
        };

        const targetHour = context?.targetHour ?? null;
        const targetDayOfWeek = context?.targetDayOfWeek ?? null;
        const contextRows = await runSummaryQuery(targetHour, targetDayOfWeek);

        // If a forecast bucket has no samples at all, fall back to overall historical patterns.
        const hasAnySamples = contextRows.some((row) => row.sampleCount > 0);
        if (!hasAnySamples && (targetHour !== null || targetDayOfWeek !== null)) {
            return runSummaryQuery(null, null);
        }

        return contextRows;
    }

    public static async getBusyLotsBeforeNineAm(
        occupancyThreshold: number = 90
    ): Promise<BusyLotBeforeNineRow[]> {
        const result = await pool.query(
            `
      WITH lot_capacity AS (
        SELECT lotid, COUNT(*)::int AS capacity
        FROM spaces
        GROUP BY lotid
      ),
      before_nine_daily AS (
        SELECT
          s.lotid,
          DATE(h.entrancetime) AS usage_day,
          COUNT(*)::int AS entry_count
        FROM history h
        INNER JOIN spaces s ON s.spacenum = h.spacenum
        WHERE EXTRACT(HOUR FROM h.entrancetime) < 9
        GROUP BY s.lotid, DATE(h.entrancetime)
      )
      SELECT
        COALESCE(l.altname, l.lotid::text) AS "lotCode",
        l.lotname AS "lotName",
        CASE
          WHEN (l.allowsresidents OR l.allowscommuters) AND NOT l.allowsfaculty AND NOT l.allowsvisitors THEN 'student'
          WHEN l.allowsfaculty AND NOT (l.allowsresidents OR l.allowscommuters) AND NOT l.allowsvisitors THEN 'faculty'
          WHEN l.allowsvisitors AND NOT (l.allowsresidents OR l.allowscommuters) AND NOT l.allowsfaculty THEN 'visitor'
          WHEN (l.allowsresidents OR l.allowscommuters OR l.allowsfaculty OR l.allowsvisitors) THEN 'mixed'
          ELSE 'unknown'
        END AS "zoneType",
        ROUND(
          AVG(
            CASE
              WHEN bnd.entry_count IS NULL THEN NULL
              WHEN lc.capacity IS NULL OR lc.capacity = 0 THEN 0
              ELSE LEAST(100, (bnd.entry_count::numeric / lc.capacity::numeric) * 100)
            END
          ),
          2
        ) AS "averageOccupancyPercent",
        COUNT(bnd.usage_day)::int AS "sampleCount"
      FROM lots l
      LEFT JOIN lot_capacity lc ON lc.lotid = l.lotid
      LEFT JOIN before_nine_daily bnd ON bnd.lotid = l.lotid
      GROUP BY
        l.lotid,
        l.lotname,
        l.allowsresidents,
        l.allowscommuters,
        l.allowsfaculty,
        l.allowsvisitors
      HAVING ROUND(
        AVG(
          CASE
            WHEN bnd.entry_count IS NULL THEN NULL
            WHEN lc.capacity IS NULL OR lc.capacity = 0 THEN 0
            ELSE LEAST(100, (bnd.entry_count::numeric / lc.capacity::numeric) * 100)
          END
        ),
        2
      ) >= $1
      ORDER BY "averageOccupancyPercent" DESC;
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

    public static async getAllLots(): Promise<ParkingLotRow[]> {
        const result = await pool.query(
            `
      SELECT
        lotid AS id,
        COALESCE(altname, lotid::text) AS "lotCode",
        lotname AS "lotName",
        CASE
          WHEN (allowsresidents OR allowscommuters) AND NOT allowsfaculty AND NOT allowsvisitors THEN 'student'
          WHEN allowsfaculty AND NOT (allowsresidents OR allowscommuters) AND NOT allowsvisitors THEN 'faculty'
          WHEN allowsvisitors AND NOT (allowsresidents OR allowscommuters) AND NOT allowsfaculty THEN 'visitor'
          WHEN (allowsresidents OR allowscommuters OR allowsfaculty OR allowsvisitors) THEN 'mixed'
          ELSE 'unknown'
        END AS "zoneType"
      FROM lots
      ORDER BY lotid ASC;
      `
        );

        return result.rows.map((row) => ({
            id: Number(row.id),
            lotCode: row.lotCode,
            lotName: row.lotName,
            zoneType: row.zoneType,
        }));
    }

    public static async getLatestSnapshotsPerLot(): Promise<
        LatestSnapshotPerLotRow[]
    > {
        const result = await pool.query(
            `
      WITH lot_capacity AS (
        SELECT lotid, COUNT(*)::int AS capacity
        FROM spaces
        GROUP BY lotid
      ),
      daily_usage AS (
        SELECT
          s.lotid,
          DATE(h.entrancetime) AS usage_day,
          COUNT(*)::int AS entry_count,
          MAX(h.entrancetime) AS snapshot_at
        FROM history h
        INNER JOIN spaces s ON s.spacenum = h.spacenum
        GROUP BY s.lotid, DATE(h.entrancetime)
      ),
      ranked AS (
        SELECT
          ROW_NUMBER() OVER (
            PARTITION BY du.lotid
            ORDER BY du.usage_day DESC
          ) AS rk,
          du.lotid,
          du.entry_count,
          du.snapshot_at,
          lc.capacity
        FROM daily_usage du
        LEFT JOIN lot_capacity lc ON lc.lotid = du.lotid
      )
      SELECT
        ROW_NUMBER() OVER (ORDER BY r.lotid)::int AS id,
        r.lotid AS "lotId",
        ROUND(
          LEAST(
            100,
            CASE
              WHEN r.capacity IS NULL OR r.capacity = 0 THEN 0
              ELSE (r.entry_count::numeric / r.capacity::numeric) * 100
            END
          ),
          2
        ) AS "occupancyPercent",
        r.snapshot_at AS "snapshotAt"
      FROM ranked r
      WHERE r.rk = 1
      ORDER BY r.lotid ASC;
      `
        );

        return result.rows.map((row) => ({
            id: Number(row.id),
            lotId: Number(row.lotId),
            occupancyPercent: Number(row.occupancyPercent),
            snapshotAt: row.snapshotAt as Date,
        }));
    }

    public static async getLotByCode(
        lotCode: string
    ): Promise<LotDetailRow | null> {
        const result = await pool.query(
            `
      WITH lot_capacity AS (
        SELECT lotid, COUNT(*)::int AS capacity
        FROM spaces
        GROUP BY lotid
      ),
      daily_usage AS (
        SELECT
          s.lotid,
          DATE(h.entrancetime) AS usage_day,
          COUNT(*)::int AS entry_count,
          MAX(h.entrancetime) AS snapshot_at
        FROM history h
        INNER JOIN spaces s ON s.spacenum = h.spacenum
        GROUP BY s.lotid, DATE(h.entrancetime)
      ),
      latest_usage AS (
        SELECT
          du.lotid,
          du.entry_count,
          du.snapshot_at,
          ROW_NUMBER() OVER (
            PARTITION BY du.lotid
            ORDER BY du.usage_day DESC
          ) AS rk
        FROM daily_usage du
      )
      SELECT
        l.lotid AS "id",
        COALESCE(l.altname, l.lotid::text) AS "lotCode",
        l.lotname AS "lotName",
        CASE
          WHEN (l.allowsresidents OR l.allowscommuters) AND NOT l.allowsfaculty AND NOT l.allowsvisitors THEN 'student'
          WHEN l.allowsfaculty AND NOT (l.allowsresidents OR l.allowscommuters) AND NOT l.allowsvisitors THEN 'faculty'
          WHEN l.allowsvisitors AND NOT (l.allowsresidents OR l.allowscommuters) AND NOT l.allowsfaculty THEN 'visitor'
          WHEN (l.allowsresidents OR l.allowscommuters OR l.allowsfaculty OR l.allowsvisitors) THEN 'mixed'
          ELSE 'unknown'
        END AS "zoneType",
        lu.lotid AS "snapshotId",
        ROUND(
          LEAST(
            100,
            CASE
              WHEN lc.capacity IS NULL OR lc.capacity = 0 THEN 0
              ELSE (lu.entry_count::numeric / lc.capacity::numeric) * 100
            END
          ),
          2
        ) AS "snapshotOccupancyPercent",
        lu.snapshot_at AS "snapshotAt"
      FROM lots l
      LEFT JOIN lot_capacity lc ON lc.lotid = l.lotid
      LEFT JOIN latest_usage lu ON lu.lotid = l.lotid AND lu.rk = 1
      WHERE l.lotid::text = $1
        OR l.lotname = $1
        OR COALESCE(l.altname, '') = $1;
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

    public static async getRecommendation(
        allowedZones?: string[],
        context?: ParkingForecastContext
    ): Promise<ParkingRecommendationRow | null> {
        const summaries = await this.getParkingLotSummaries(context);
        const zoneSet =
            allowedZones && allowedZones.length > 0
                ? new Set(allowedZones.map((zone) => zone.toLowerCase()))
                : null;

        const candidates = summaries.filter((row) => {
            if (row.occupancyPercent === null || row.latestSnapshotTime === null) {
                return false;
            }
            if (row.sampleCount <= 0) {
                return false;
            }
            if (!zoneSet) {
                return true;
            }
            if (row.allowedZones.length === 0) {
                return false;
            }
            return row.allowedZones.some((zone) => zoneSet.has(zone.toLowerCase()));
        });

        if (candidates.length === 0) {
            return null;
        }

        candidates.sort((a, b) => {
            const aHasDistance = a.walkingMinutes != null;
            const bHasDistance = b.walkingMinutes != null;

            // Preserve teammate logic when both candidates include distance context.
            if (aHasDistance && bHasDistance) {
                const scoreA = computeRecommendationScore(a);
                const scoreB = computeRecommendationScore(b);
                if (scoreA !== scoreB) {
                    return scoreA - scoreB;
                }
            }

            const byOccupancy = (a.occupancyPercent as number) - (b.occupancyPercent as number);
            if (byOccupancy !== 0) {
                return byOccupancy;
            }
            const bySampleCount = b.sampleCount - a.sampleCount;
            if (bySampleCount !== 0) {
                return bySampleCount;
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
        const contextSummary =
            context?.targetHour !== null && context?.targetHour !== undefined
                ? `Forecast uses historical snapshots from hour ${context.targetHour}:00`
                : "Forecast uses overall historical parking patterns";
        const daySummary =
            context?.targetDayOfWeek !== null && context?.targetDayOfWeek !== undefined
                ? ` on weekday index ${context.targetDayOfWeek}`
                : "";
        const distanceSummary =
            selected.walkingMinutes != null
                ? ` Distance-aware scoring was applied with ~${selected.walkingMinutes} walking minutes context.`
                : "";
        const reason = `${zoneSummary}${contextSummary}${daySummary}. Selected for lowest expected occupancy among matching lots (${selected.sampleCount} historical samples); ties favor stronger sample coverage, then newer supporting snapshots.${distanceSummary}`;
        return {
            lotCode: selected.lotCode,
            lotName: selected.lotName,
            zoneType: selected.zoneType,
            occupancyPercent: Number(selected.occupancyPercent),
            latestSnapshotTime: selected.latestSnapshotTime as Date,
            sampleCount: selected.sampleCount,
            reason,
        };
    }

}

function computeRecommendationScore(row: {
    occupancyPercent: number | null;
    latestSnapshotTime: Date | null;
    walkingMinutes?: number | null; // optional for future distance support
}): number {
    // If missing required data, treat as very bad candidate
    if (row.occupancyPercent === null || row.latestSnapshotTime === null) {
        return Number.POSITIVE_INFINITY;
    }

    const distanceWeight = 0.6;
    const availabilityWeight = 0.4;

    // For now: fallback distance (you can replace this later with real data)
    const walkingMinutes = row.walkingMinutes ?? 5;

    // Convert occupancy → penalty (0 = empty, 1 = full)
    const availabilityPenalty = row.occupancyPercent / 100;

    const score =
        walkingMinutes * distanceWeight +
        availabilityPenalty * availabilityWeight * 10;

    return score;
}