/**
 * Express application factory: routes and middleware only (no listen).
 * Import this in tests via supertest without starting a real HTTP server.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import express, { type Request, type Response } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { ParkingAnalyticsService } from "./services/parkingAnalyticsService";

const app = express();
app.use(express.json());

/**
 * Path to this file for swagger-jsdoc (`.ts` under `tsx`, `.js` when running compiled output).
 */
function getSwaggerApiGlob(): string {
  const tsPath = path.join(__dirname, "app.ts");
  if (fs.existsSync(tsPath)) {
    return tsPath;
  }
  return path.join(__dirname, "app.js");
}

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Parking Hackathon API",
      version: "1.0.0",
      description:
        "Reads demo parking data from Postgres (`parking_lots` + `parking_snapshots`).",
    },
    servers: [
      {
        url: `http://localhost:${env.port}`,
        description: "Local development",
      },
    ],
    components: {
      schemas: {
        HealthResponse: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", example: "ok" },
          },
        },
        ParkingLotSummary: {
          type: "object",
          description:
            "Matches `ParkingLotSummaryRow` from `ParkingAnalyticsService.getParkingLotSummaries`.",
          properties: {
            lotCode: { type: "string" },
            lotName: { type: "string" },
            zoneType: { type: "string" },
            occupancyPercent: {
              type: "number",
              format: "float",
              nullable: true,
            },
            latestSnapshotTime: {
              type: "string",
              format: "date-time",
              nullable: true,
              description:
                "ISO 8601 in JSON (Express serializes `Date` from the service).",
            },
          },
        },
        BusyLotBeforeNine: {
          type: "object",
          description:
            "Matches `BusyLotBeforeNineRow` from `getBusyLotsBeforeNineAm`.",
          properties: {
            lotCode: { type: "string" },
            lotName: { type: "string" },
            zoneType: { type: "string" },
            averageOccupancyPercent: { type: "number", format: "float" },
            sampleCount: { type: "integer" },
          },
        },
        ParkingLotListItem: {
          type: "object",
          description: "Matches `ParkingLotRow` from `getAllLots` (`parking_lots` only).",
          properties: {
            id: { type: "integer" },
            lotCode: { type: "string" },
            lotName: { type: "string" },
            zoneType: { type: "string" },
          },
        },
        LatestSnapshotPerLot: {
          type: "object",
          description:
            "Matches `LatestSnapshotPerLotRow` from `getLatestSnapshotsPerLot`.",
          properties: {
            id: { type: "integer" },
            lotId: { type: "integer" },
            occupancyPercent: { type: "number", format: "float" },
            snapshotAt: { type: "string", format: "date-time" },
          },
        },
        LotDetail: {
          type: "object",
          description: "Matches `LotDetailRow` from `getLotByCode`.",
          properties: {
            id: { type: "integer" },
            lotCode: { type: "string" },
            lotName: { type: "string" },
            zoneType: { type: "string" },
            latestSnapshot: {
              nullable: true,
              type: "object",
              properties: {
                id: { type: "integer" },
                occupancyPercent: { type: "number", format: "float" },
                snapshotAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
        ErrorMessage: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  },
  apis: [getSwaggerApiGlob()],
});

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, { customCss: ".swagger-ui .topbar { display: none }" })
);

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness check
 *     responses:
 *       200:
 *         description: Server is running
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

/**
 * Parses `threshold` query for busy-lot analytics (defaults to 90).
 *
 * @param req Express request
 * @returns Numeric threshold for `getBusyLotsBeforeNineAm`
 */
function parseBusyThresholdQuery(req: Request): number {
  const raw = req.query.threshold;
  if (raw === undefined || raw === "") {
    return 90;
  }
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) ? n : 90;
}

/**
 * @openapi
 * /api/parking/busy-before-nine:
 *   get:
 *     tags: [Parking]
 *     summary: Lots with high average occupancy before 9 AM (see service SQL)
 *     parameters:
 *       - in: query
 *         name: threshold
 *         required: false
 *         schema:
 *           type: number
 *           default: 90
 *         description: Minimum average occupancy percent (same as `getBusyLotsBeforeNineAm`)
 *     responses:
 *       200:
 *         description: Matching lots, most occupied first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/BusyLotBeforeNine'
 *       500:
 *         description: Server error
 */
app.get("/api/parking/busy-before-nine", async (req: Request, res: Response) => {
  try {
    const threshold = parseBusyThresholdQuery(req);
    const rows = await ParkingAnalyticsService.getBusyLotsBeforeNineAm(threshold);
    res.json(rows);
  } catch (error) {
    console.error("GET /api/parking/busy-before-nine failed:", error);
    res.status(500).json({ error: "Failed to load busy lots" });
  }
});

/**
 * @openapi
 * /api/parking/lots:
 *   get:
 *     tags: [Parking]
 *     summary: All rows in parking_lots
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ParkingLotListItem'
 *       500:
 *         description: Server error
 */
app.get("/api/parking/lots", async (_req: Request, res: Response) => {
  try {
    const rows = await ParkingAnalyticsService.getAllLots();
    res.json(rows);
  } catch (error) {
    console.error("GET /api/parking/lots failed:", error);
    res.status(500).json({ error: "Failed to load lots" });
  }
});

/**
 * @openapi
 * /api/parking/snapshots/latest:
 *   get:
 *     tags: [Parking]
 *     summary: Latest parking_snapshots row per lot_id (raw table columns)
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/LatestSnapshotPerLot'
 *       500:
 *         description: Server error
 */
app.get("/api/parking/snapshots/latest", async (_req: Request, res: Response) => {
  try {
    const rows = await ParkingAnalyticsService.getLatestSnapshotsPerLot();
    res.json(rows);
  } catch (error) {
    console.error("GET /api/parking/snapshots/latest failed:", error);
    res.status(500).json({ error: "Failed to load snapshots" });
  }
});

/**
 * @openapi
 * /api/parking/summary:
 *   get:
 *     tags: [Parking]
 *     summary: Latest snapshot per lot
 *     responses:
 *       200:
 *         description: One row per lot from the database
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ParkingLotSummary'
 *       500:
 *         description: Failed to load data from the database
 */
app.get("/api/parking/summary", async (_req: Request, res: Response) => {
  try {
    const rows = await ParkingAnalyticsService.getParkingLotSummaries();
    res.json(rows);
  } catch (error) {
    console.error("GET /api/parking/summary failed:", error);
    res.status(500).json({ error: "Failed to load parking summaries" });
  }
});

/**
 * @openapi
 * /api/parking/lots/{lotCode}:
 *   get:
 *     tags: [Parking]
 *     summary: One lot by lot_code with latest snapshot
 *     parameters:
 *       - in: path
 *         name: lotCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LotDetail'
 *       404:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       500:
 *         description: Server error
 */
app.get("/api/parking/lots/:lotCode", async (req: Request, res: Response) => {
  try {
    const raw = req.params.lotCode;
    const lotCode = Array.isArray(raw) ? raw[0] : raw;
    if (lotCode === undefined) {
      res.status(400).json({ error: "Missing lot code" });
      return;
    }
    const row = await ParkingAnalyticsService.getLotByCode(lotCode);
    if (row === null) {
      res.status(404).json({ error: "Lot not found" });
      return;
    }
    res.json(row);
  } catch (error) {
    console.error("GET /api/parking/lots/:lotCode failed:", error);
    res.status(500).json({ error: "Failed to load lot" });
  }
});

export { app };
