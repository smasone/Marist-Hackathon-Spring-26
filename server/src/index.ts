/**
 * HTTP entry point: Express API + Swagger UI.
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
  const tsPath = path.join(__dirname, "index.ts");
  if (fs.existsSync(tsPath)) {
    return tsPath;
  }
  return path.join(__dirname, "index.js");
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
 * Starts the HTTP server on `env.port` (see `src/config/env.ts`).
 */
function startServer(): void {
  app.listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port}`);
    console.log(`Swagger UI: http://localhost:${env.port}/api-docs`);
  });
}

startServer();
