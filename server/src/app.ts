/**
 * Express application factory: routes and middleware only (no listen).
 * Import this in tests via supertest without starting a real HTTP server.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import {
  formatParkingAnswer,
  formatParkingRulesFaqAnswer,
  type ParkingAskFormatIntent,
} from "./services/openAiService";
import {
  isParkingRulesOrPermitQuestion,
  loadOfficialParkingFaqText,
  OFFICIAL_MARIST_PARKING_FAQ_URL,
  OFFICIAL_PARKING_FAQ_PAGE_TITLE,
  selectFaqExcerptsForQuestion,
} from "./services/officialParkingRulesService";
import { ParkingAnalyticsService } from "./services/parkingAnalyticsService";

const app = express();

/**
 * Allow browsers on localhost (Vite dev/preview, other ports) to call the API directly.
 * Same-origin `/api` via Vite proxy does not need CORS; `VITE_API_BASE_URL=http://localhost:3001` does.
 */
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (
    origin &&
    /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin.trim())
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());

/**
 * Express passes JSON parse failures to error middleware (`entity.parse.failed`).
 * Keeps `POST /api/parking/ask` demo-stable when clients send malformed JSON.
 */
function isMalformedJsonBodyError(err: unknown): boolean {
  if (err === null || err === undefined || typeof err !== "object") {
    return false;
  }
  return (err as { type?: unknown }).type === "entity.parse.failed";
}

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (isMalformedJsonBodyError(err)) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  next(err);
});

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
  if (!Number.isFinite(n)) {
    return 90;
  }
  return Math.min(100, Math.max(0, n));
}

interface AskParkingRequestBody {
  question?: string;
}

function normalizeQuestion(rawQuestion: string): string {
  return rawQuestion.trim().toLowerCase();
}

function parseZonesFromQuestion(question: string): string[] {
  const zones: string[] = [];
  if (question.includes("faculty")) {
    zones.push("faculty");
  }
  if (question.includes("visitor")) {
    zones.push("visitor");
  }
  if (
    question.includes("student") ||
    question.includes("commuter") ||
    question.includes("resident")
  ) {
    zones.push("student");
  }
  return zones;
}

/** Truncated single-line question for debug logs only. */
function askLogPreview(q: string, max = 100): string {
  const s = q.replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/**
 * Uses OpenAI only for wording when `OPENAI_API_KEY` is set; otherwise returns the template.
 * On model/network errors, returns the deterministic fallback (backend remains authoritative).
 */
async function parkingAnswerWithOptionalAiPhrasing(
  userQuestion: string,
  intent: ParkingAskFormatIntent,
  facts: Record<string, unknown>,
  fallbackAnswer: string
): Promise<string> {
  try {
    const phrased = await formatParkingAnswer({
      userQuestion,
      intent,
      facts,
    });
    console.log("[ask] optionalDbAiPhrasing", {
      intent,
      usedOpenAi: phrased !== null,
      openaiConfigured: Boolean(env.openaiApiKey),
    });
    return phrased ?? fallbackAnswer;
  } catch (error) {
    console.error("[ask] optionalDbAiPhrasing: unexpected error, using template", {
      intent,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallbackAnswer;
  }
}

const RULES_FAQ_GROUNDING_NOTE =
  "Answer is based only on retrieved excerpts from the official Marist Parking FAQ; confirm details on the live page if needed.";

/**
 * Permit / policy answers: official FAQ text only (separate from DB occupancy).
 */
async function respondParkingRulesFaq(
  question: string,
  normalizedQuestion: string,
  res: Response
): Promise<void> {
  console.log("[ask] parking_rules_faq: start", {
    questionPreview: askLogPreview(question),
  });
  const load = await loadOfficialParkingFaqText();
  console.log("[ask] parking_rules_faq: faq load", {
    ok: load.ok,
    plainTextChars: load.plainText?.length ?? 0,
    servedFromStaleDiskCache: load.servedFromStaleDiskCache,
  });
  const sourceTitle = OFFICIAL_PARKING_FAQ_PAGE_TITLE;
  const sourceUrl = OFFICIAL_MARIST_PARKING_FAQ_URL;
  const lastCheckedAt = load.lastFetchedAt?.toISOString() ?? null;
  const note = load.servedFromStaleDiskCache
    ? `${RULES_FAQ_GROUNDING_NOTE} (Served from a saved on-disk copy of the FAQ because the live page could not be reached.)`
    : RULES_FAQ_GROUNDING_NOTE;

  const baseMeta = {
    sourceType: "official_web" as const,
    sourceTitle,
    sourceUrl,
    lastCheckedAt,
    sources: [{ title: sourceTitle, url: sourceUrl }],
    note,
  };

  if (!load.ok || !load.plainText) {
    console.log("[ask] parking_rules_faq: response faqUnavailable=true");
    res.json({
      intent: "parking_rules_faq",
      answer:
        "The official parking FAQ could not be loaded right now. Please try again later, or read the Parking FAQ directly on Marist's website.",
      ...baseMeta,
      data: { matchedFaqExcerpts: [], faqUnavailable: true },
    });
    return;
  }

  const excerpts = selectFaqExcerptsForQuestion(normalizedQuestion, load.plainText);
  const noMatchAnswer = "I couldn't verify that from the official parking FAQ.";

  if (excerpts.length === 0) {
    console.log("[ask] parking_rules_faq: response no excerpt match");
    res.json({
      intent: "parking_rules_faq",
      answer: noMatchAnswer,
      ...baseMeta,
      data: { matchedFaqExcerpts: [] as string[] },
    });
    return;
  }

  const joined = excerpts.join("\n\n");
  const clipped = joined.length > 800 ? `${joined.slice(0, 797)}...` : joined;
  const deterministicAnswer = `${clipped}\n\nSource: ${sourceUrl}`;

  let aiAnswer: string | null = null;
  try {
    aiAnswer = await formatParkingRulesFaqAnswer({
      userQuestion: question,
      faqExcerpts: excerpts,
      sourceUrl,
    });
  } catch (error) {
    console.error("[ask] parking_rules_faq: OpenAI phrasing failed, using excerpts", {
      error: error instanceof Error ? error.message : String(error),
    });
    aiAnswer = null;
  }

  console.log("[ask] parking_rules_faq: response", {
    excerptCount: excerpts.length,
    usedOpenAi: aiAnswer !== null,
    openaiConfigured: Boolean(env.openaiApiKey),
    answerChars: (aiAnswer ?? deterministicAnswer).length,
  });

  res.json({
    intent: "parking_rules_faq",
    answer: aiAnswer ?? deterministicAnswer,
    ...baseMeta,
    data: { matchedFaqExcerpts: excerpts },
  });
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

/**
 * @openapi
 * /api/parking/ask:
 *   post:
 *     tags: [Parking]
 *     summary: Answers supported parking questions from DB data and/or the official Marist Parking FAQ
 *     description: >
 *       Supported categories: (1) **Postgres occupancy** — questions containing best/recommend/where should
 *       (recommendation), busy before 9 / before nine (busy_before_nine), or list / how many / which lot
 *       (lots_list). (2) **Official FAQ** — permit, policy, shuttle, enforcement, and similar heuristics
 *       (`parking_rules_faq`) using cached plain text from https://www.marist.edu/security/parking/faq
 *       with stale on-disk fallback when the live page cannot be fetched. (3) **unsupported** — safe template
 *       when no route matches. When `OPENAI_API_KEY` is set, DB and FAQ answers may be rephrased; on missing key,
 *       HTTP/model errors, or unexpected failures, the API returns deterministic template or excerpt text so
 *       facts always come from SQL results or FAQ excerpts.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [question]
 *             properties:
 *               question:
 *                 type: string
 *                 example: What is the best faculty lot right now?
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [intent, answer, data]
 *               properties:
 *                 answer:
 *                   type: string
 *                 intent:
 *                   type: string
 *                   description: recommendation | busy_before_nine | lots_list | parking_rules_faq | unsupported
 *                 data:
 *                   nullable: true
 *                   description: >
 *                     Analytics intents return arrays or a recommendation object from Postgres; `parking_rules_faq`
 *                     returns `{ matchedFaqExcerpts, faqUnavailable? }`; `unsupported` and recommendation-without-data
 *                     use `null`.
 *                 sourceType:
 *                   type: string
 *                   description: Present for parking_rules_faq (official_web)
 *                 sourceTitle:
 *                   type: string
 *                 sourceUrl:
 *                   type: string
 *                 lastCheckedAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 sources:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       title: { type: string }
 *                       url: { type: string }
 *                 note:
 *                   type: string
 *       400:
 *         description: Missing/blank question, non-string question, or invalid JSON body
 *       500:
 *         description: Server error
 */
app.post("/api/parking/ask", async (req: Request, res: Response) => {
  try {
    const body = req.body as AskParkingRequestBody;
    if (body.question === undefined || body.question === null) {
      res.status(400).json({ error: "Question is required" });
      return;
    }
    if (typeof body.question !== "string") {
      res.status(400).json({ error: "Question must be a non-empty string" });
      return;
    }
    const question = body.question.trim();
    if (question.length === 0) {
      res.status(400).json({ error: "Question is required" });
      return;
    }

    const normalizedQuestion = normalizeQuestion(question);
    const zones = parseZonesFromQuestion(normalizedQuestion);

    console.log("[ask] POST /api/parking/ask", {
      questionPreview: askLogPreview(question),
      openaiConfigured: Boolean(env.openaiApiKey),
    });

    if (
      normalizedQuestion.includes("best") ||
      normalizedQuestion.includes("recommend") ||
      normalizedQuestion.includes("where should")
    ) {
      console.log("[ask] routed intent=recommendation", { zones });
      const recommendation = await ParkingAnalyticsService.getRecommendation(zones);
      if (recommendation === null) {
        console.log("[ask] recommendation: no snapshot data for zones");
        res.json({
          intent: "recommendation",
          answer:
            "I could not find a lot with current snapshot data for that request yet.",
          data: null,
        });
        return;
      }
      const fallbackAnswer = `Best current option: ${recommendation.lotName} (${recommendation.lotCode}) in ${recommendation.zoneType} zone at ${recommendation.occupancyPercent}% occupancy. ${recommendation.reason}`;
      const facts = {
        zonesRequested: zones,
        selectedLot: {
          lotCode: recommendation.lotCode,
          lotName: recommendation.lotName,
          zoneType: recommendation.zoneType,
          occupancyPercent: recommendation.occupancyPercent,
          latestSnapshotTime: recommendation.latestSnapshotTime.toISOString(),
          selectionReason: recommendation.reason,
        },
      };
      const answer = await parkingAnswerWithOptionalAiPhrasing(
        question,
        "recommendation",
        facts,
        fallbackAnswer
      );
      res.json({
        intent: "recommendation",
        answer,
        data: recommendation,
      });
      return;
    }

    if (
      normalizedQuestion.includes("busy before") ||
      normalizedQuestion.includes("before 9") ||
      normalizedQuestion.includes("before nine")
    ) {
      console.log("[ask] routed intent=busy_before_nine");
      const busyThreshold = 90;
      const rows = await ParkingAnalyticsService.getBusyLotsBeforeNineAm(busyThreshold);
      const fallbackAnswer =
        rows.length === 0
          ? "No lots currently meet the 90% average occupancy threshold before 9 AM."
          : `Before 9 AM, ${rows[0].lotName} (${rows[0].lotCode}) is the busiest at an average ${rows[0].averageOccupancyPercent}% occupancy.`;
      const facts = {
        occupancyThresholdPercent: busyThreshold,
        matchingLots: rows.map((row) => ({
          lotCode: row.lotCode,
          lotName: row.lotName,
          zoneType: row.zoneType,
          averageOccupancyPercent: row.averageOccupancyPercent,
          sampleCount: row.sampleCount,
        })),
      };
      const answer = await parkingAnswerWithOptionalAiPhrasing(
        question,
        "busy_before_nine",
        facts,
        fallbackAnswer
      );
      res.json({
        intent: "busy_before_nine",
        answer,
        data: rows,
      });
      return;
    }

    if (isParkingRulesOrPermitQuestion(normalizedQuestion)) {
      console.log("[ask] routed intent=parking_rules_faq");
      await respondParkingRulesFaq(question, normalizedQuestion, res);
      return;
    }

    if (
      normalizedQuestion.includes("how many") ||
      normalizedQuestion.includes("list") ||
      normalizedQuestion.includes("which lot")
    ) {
      console.log("[ask] routed intent=lots_list");
      const lots = await ParkingAnalyticsService.getAllLots();
      const fallbackAnswer = `There are ${lots.length} lots in the database: ${lots
        .map((lot) => `${lot.lotCode} (${lot.zoneType})`)
        .join(", ")}.`;
      const facts = {
        totalCount: lots.length,
        lots: lots.map((lot) => ({
          lotCode: lot.lotCode,
          lotName: lot.lotName,
          zoneType: lot.zoneType,
        })),
      };
      const answer = await parkingAnswerWithOptionalAiPhrasing(
        question,
        "lots_list",
        facts,
        fallbackAnswer
      );
      res.json({
        intent: "lots_list",
        answer,
        data: lots,
      });
      return;
    }

    console.log("[ask] routed intent=unsupported");
    res.json({
      intent: "unsupported",
      answer:
        "I can answer supported questions about best lot recommendations, busy-before-9 trends, and lot lists from the app's parking database, plus permit and parking policy topics from Marist's official Parking FAQ when your question matches that page.",
      data: null,
    });
  } catch (error) {
    console.error("POST /api/parking/ask failed:", error);
    res.status(500).json({ error: "Failed to answer parking question" });
  }
});

export { app };
