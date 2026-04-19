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
import {
  athleticsSupplementToResponseFields,
  computeAthleticsAskSupplementForQuestion,
  emptyAthleticsAskSupplement,
  type AthleticsAskSupplement,
} from "./services/maristAthleticsScheduleService";
import {
  inferReferenceInstantFromQuestion,
  mentionsCampusParkingContext,
  shouldConsiderAthleticsSchedule,
} from "./services/questionTimeHeuristics";
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
        "Reads parking history data from Postgres (`lots` + `spaces` + `history`).",
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
            "Matches `ParkingLotSummaryRow` from `ParkingAnalyticsService.getParkingLotSummaries` (historical forecast estimate).",
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
                "Most recent snapshot timestamp that contributed to the estimate.",
            },
            sampleCount: {
              type: "integer",
              description: "Historical snapshot count used for this lot estimate.",
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
          description: "Matches `ParkingLotRow` from `getAllLots` (`lots` table).",
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
  // Recommendation filtering currently uses umbrella zone buckets:
  // - student (resident + commuter), faculty, visitor.
  // So commuter/resident wording intentionally maps to "student".
  if (
    question.includes("student") ||
    question.includes("commuter") ||
    question.includes("resident")
  ) {
    zones.push("student");
  }
  return zones;
}

function extractLotSearchText(normalizedQuestion: string): string | null {
  const cleaned = normalizedQuestion
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return null;
  }
  const stopWords = new Set([
    "what",
    "which",
    "where",
    "should",
    "is",
    "are",
    "the",
    "a",
    "an",
    "best",
    "recommend",
    "recommended",
    "parking",
    "lot",
    "lots",
    "for",
    "to",
    "at",
    "around",
    "near",
    "by",
    "on",
    "in",
    "me",
    "my",
    "usually",
    "right",
    "now",
    "today",
    "tomorrow",
    "noon",
    "morning",
    "afternoon",
    "evening",
    "commuter",
    "resident",
    "student",
    "faculty",
    "visitor",
  ]);
  const filtered = cleaned
    .split(" ")
    .filter((token) => token.length >= 2 && !stopWords.has(token));
  if (filtered.length === 0) {
    return null;
  }
  return filtered.join(" ");
}

function extractDestinationFromQuestion(normalizedQuestion: string): string | null {
  const q = normalizedQuestion.replace(/\s+/g, " ").trim();
  const m = q.match(
    /\b(?:to be at|be at|to|at|near)\s+([a-z0-9][a-z0-9 '&-]{1,80}?)(?=\s+(?:by|around|at)\b|[?.!,]|$)/
  );
  if (!m || !m[1]) {
    return null;
  }
  const destination = m[1]
    .replace(/\s+/g, " ")
    .replace(/\b(the|building|hall)\b/g, "")
    .trim();
  return destination.length >= 3 ? destination : null;
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

const DEMO_TIMELINESS_PREFIX =
  "Forecast note: this app estimates lot busyness from stored historical snapshots, not live sensor feeds. ";

const FORECAST_DISCLAIMER =
  "This is a forecast based on stored historical parking data, not live sensor tracking.";

const HIDDEN_LOT_IDENTIFIER_KEYS = new Set(["id", "lotId", "lotCode"]);

function stripHiddenLotIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripHiddenLotIdentifiers(item));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const obj = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(obj)) {
    if (HIDDEN_LOT_IDENTIFIER_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = stripHiddenLotIdentifiers(nested);
  }
  return sanitized;
}

function sendSanitizedAskResponse(res: Response, payload: Record<string, unknown>): void {
  res.json(stripHiddenLotIdentifiers(payload));
}

function mergeFactsWithTimelinessNote(
  facts: Record<string, unknown>
): Record<string, unknown> {
  const f = { ...facts };
  f.dataTimelinessNote =
    "Occupancy figures in FACTS are forecast estimates based on stored historical snapshots, not live parking availability.";
  return f;
}

function parseForecastQueryContext(req: Request): {
  targetHour: number | null;
  targetDayOfWeek: number | null;
} {
  const rawHour = req.query.hour;
  const rawDow = req.query.dayOfWeek;
  const parsedHour =
    rawHour === undefined ? NaN : Number(Array.isArray(rawHour) ? rawHour[0] : rawHour);
  const parsedDow =
    rawDow === undefined ? NaN : Number(Array.isArray(rawDow) ? rawDow[0] : rawDow);
  return {
    targetHour: Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : null,
    targetDayOfWeek:
      Number.isInteger(parsedDow) && parsedDow >= 0 && parsedDow <= 6 ? parsedDow : null,
  };
}

function parsePretendNowQuery(req: Request): Date | null {
  const raw = req.query.pretendNow;
  if (raw === undefined) {
    return null;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function busynessCategory(occupancyPercent: number): "light" | "moderate" | "heavy" {
  if (occupancyPercent >= 85) {
    return "heavy";
  }
  if (occupancyPercent >= 60) {
    return "moderate";
  }
  return "light";
}

function buildRecommendationAnswer(recommendation: {
  lotName: string;
}): string {
  return `Best forecasted commuter option right now: ${recommendation.lotName}.`;
}

function buildRecommendationExplanation(
  inferredInstant: ReturnType<typeof inferReferenceInstantFromQuestion> | null
): string {
  if (inferredInstant?.inferredFromQuestion) {
    return `For the time you asked about, it is expected to be one of the least busy matching lots.`;
  }
  return `It is expected to be one of the least busy matching lots around this time.`;
}

function buildRecommendationSupportingDetails(
  recommendation: {
    occupancyPercent: number;
    zoneType: string;
  },
  inferredInstant: ReturnType<typeof inferReferenceInstantFromQuestion> | null
): string[] {
  const details = [
    `Expected occupancy: ${recommendation.occupancyPercent}% (${busynessCategory(recommendation.occupancyPercent)}).`,
    `Zone type: ${recommendation.zoneType}.`,
  ];
  if (inferredInstant?.inferredFromQuestion) {
    details.push(`Time context inferred from your question: ${inferredInstant.label}.`);
  }
  return details;
}

function appendAthleticsSuffix(base: string, athletics: AthleticsAskSupplement): string {
  const tail = athletics.answerSuffix?.trim();
  if (!tail) {
    return base;
  }
  if (base.includes(tail)) {
    return base;
  }
  return `${base.trimEnd()} ${tail}`;
}

async function resolveMentionedLotFromQuestion(
  normalizedQuestion: string
): Promise<Awaited<ReturnType<typeof ParkingAnalyticsService.findBestLotNameMatch>>> {
  const lotHint = extractLotSearchText(normalizedQuestion);
  if (!lotHint) {
    return null;
  }
  return ParkingAnalyticsService.findBestLotNameMatch(lotHint);
}

type AskRoutingIntent = "lot_specific" | "recommendation" | "other";

function classifyAskParkingIntent(input: {
  normalizedQuestion: string;
  lotNameMatch: Awaited<ReturnType<typeof ParkingAnalyticsService.findBestLotNameMatch>>;
}): AskRoutingIntent {
  const q = input.normalizedQuestion;
  const hasRecommendationKeyword =
    q.includes("best") || q.includes("recommend") || q.includes("where should");
  if (!input.lotNameMatch) {
    return hasRecommendationKeyword ? "recommendation" : "other";
  }
  const strongLotMatch =
    input.lotNameMatch.matchType === "exact" ||
    input.lotNameMatch.matchType === "prefix" ||
    input.lotNameMatch.score >= 200;
  if (!strongLotMatch) {
    return hasRecommendationKeyword ? "recommendation" : "other";
  }
  const lotSpecificLanguage =
    q.includes(" in ") ||
    q.includes(" at ") ||
    q.includes(" near ") ||
    q.includes("about") ||
    q.includes("how busy") ||
    q.includes("can i park") ||
    q.includes("what about");
  if (lotSpecificLanguage && !hasRecommendationKeyword) {
    return "lot_specific";
  }
  return hasRecommendationKeyword ? "recommendation" : "lot_specific";
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
    sendSanitizedAskResponse(res, {
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
    sendSanitizedAskResponse(res, {
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

  sendSanitizedAskResponse(res, {
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
 *     summary: All rows in lots
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
 *     summary: Latest history-derived snapshot row per lot_id
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
 *     summary: Forecasted lot busyness from historical snapshots
 *     parameters:
 *       - in: query
 *         name: hour
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 23
 *         description: Optional hour-of-day bucket (0-23) for historical forecast matching.
 *       - in: query
 *         name: dayOfWeek
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 6
 *         description: Optional day-of-week bucket (0=Sun..6=Sat) for historical forecast matching.
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
    const context = parseForecastQueryContext(_req);
    const rows = await ParkingAnalyticsService.getParkingLotSummaries(context);
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
 *     summary: Answers supported parking questions from historical DB forecasts and/or the official Marist Parking FAQ
 *     description: >
 *       Supported categories: (1) **Postgres forecast** — questions containing best/recommend/where should
 *       (recommendation), busy before 9 / before nine (busy_before_nine), or list / how many / which lot
 *       (lots_list), plus time-shaped campus parking questions routed like **recommendation** when the question
 *       references a time/date but not the keywords above. (2) **Official FAQ** — permit, policy, shuttle,
 *       enforcement, and similar heuristics (`parking_rules_faq`) using cached plain text from
 *       https://www.marist.edu/security/parking/faq with stale on-disk fallback when the live page cannot be
 *       fetched. (3) **unsupported** — safe template when no route matches. For forecast intents, when the
 *       question looks time- or future-shaped, the server may attach **advisory** metadata from Marist's
 *       official athletics composite schedule (`https://goredfoxes.com/calendar` / Sidearm JSON); this never
 *       replaces SQL-backed recommendations. Forecast answers are estimates from stored historical snapshots (not live availability). When `OPENAI_API_KEY` is set, DB and FAQ answers may be rephrased;
 *       on missing key, HTTP/model errors, or unexpected failures, the API returns deterministic template or
 *       excerpt text so facts always come from SQL results or FAQ excerpts.
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
 *                 example: What lot is usually best for faculty around 11am?
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
 *                 eventSignalFound:
 *                   type: boolean
 *                   description: Present when an athletics schedule lookup ran for a time-shaped question
 *                 eventImpactNote:
 *                   type: string
 *                   nullable: true
 *                 eventSnippet:
 *                   type: string
 *                   nullable: true
 *                 eventTitle:
 *                   type: string
 *                   nullable: true
 *                 eventTime:
 *                   type: string
 *                   nullable: true
 *                 eventSources:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       title: { type: string }
 *                       url: { type: string }
 *       400:
 *         description: Missing/blank question, non-string question, or invalid JSON body
 *       500:
 *         description: Server error
 */
const askParkingHandler = async (req: Request, res: Response) => {
  try {
    const isSimulatedNowRoute = req.path === "/api/parking/ask-simulated-now";
    let referenceNow = new Date();
    if (isSimulatedNowRoute) {
      const parsedNow = parsePretendNowQuery(req);
      if (parsedNow === null) {
        res.status(400).json({
          error:
            "pretendNow query parameter is required on this route and must be a valid ISO timestamp",
        });
        return;
      }
      referenceNow = parsedNow;
    }

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
    const lotNameMatch = await resolveMentionedLotFromQuestion(normalizedQuestion);
    const destinationHint = extractDestinationFromQuestion(normalizedQuestion);
    const routingIntent = classifyAskParkingIntent({
      normalizedQuestion,
      lotNameMatch,
    });

    console.log("[ask] POST /api/parking/ask", {
      questionPreview: askLogPreview(question),
      openaiConfigured: Boolean(env.openaiApiKey),
    });

    if (routingIntent === "lot_specific" && lotNameMatch !== null) {
      console.log("[ask] routed intent=lot_specific", {
        lotCode: lotNameMatch.lotCode,
        lotName: lotNameMatch.lotName,
        matchType: lotNameMatch.matchType,
      });
      const inferredInstant = inferReferenceInstantFromQuestion(question, referenceNow);
      const lotForecast = await ParkingAnalyticsService.getLotForecastByLotId(
        lotNameMatch.lotId,
        {
          targetHour: inferredInstant?.at.getHours() ?? null,
          targetDayOfWeek: inferredInstant?.at.getDay() ?? null,
          targetBuildingName: destinationHint,
        }
      );
      if (lotForecast === null || lotForecast.occupancyPercent === null) {
        sendSanitizedAskResponse(res, {
          intent: "lot_specific",
          answer: `I could not estimate a forecast for ${lotNameMatch.lotName} from stored historical snapshots yet.`,
          explanation:
            "Try asking for a best-lot recommendation, and I can suggest an alternative with available forecast data.",
          disclaimer: FORECAST_DISCLAIMER,
          lotSpecificMeta: {
            lotNameMatch,
            lotForecast: null,
          },
          alternativeRecommendation: null,
          comparisonDeltaPercent: null,
          data: null,
        });
        return;
      }
      const lotAnswer = `For ${lotForecast.lotName}, the expected occupancy around this time is ${lotForecast.occupancyPercent}% (${busynessCategory(
        lotForecast.occupancyPercent
      )}).`;
      const lotExplanation =
        "That estimate comes from historical parking patterns for matching times, not live occupancy sensors.";
      const recommendation = await ParkingAnalyticsService.getRecommendation(zones, {
        targetHour: inferredInstant?.at.getHours() ?? null,
        targetDayOfWeek: inferredInstant?.at.getDay() ?? null,
        targetBuildingName: destinationHint,
      });
      const comparisonDeltaPercent =
        recommendation && recommendation.lotCode !== lotForecast.lotCode
          ? Number((lotForecast.occupancyPercent - recommendation.occupancyPercent).toFixed(2))
          : null;
      // Keep a low threshold so users see an alternate lot when it is even modestly better.
      const materiallyBetterAlternative =
        recommendation &&
        recommendation.lotCode !== lotForecast.lotCode &&
        comparisonDeltaPercent !== null &&
        comparisonDeltaPercent >= 1
          ? recommendation
          : null;
      const supportingDetails = [
        `Requested lot zone: ${lotForecast.zoneType}.`,
        `Historical samples used: ${lotForecast.sampleCount}.`,
      ];
      if (destinationHint) {
        supportingDetails.push(`Destination context detected: ${destinationHint}.`);
      }
      if (inferredInstant?.inferredFromQuestion) {
        supportingDetails.push(`Time context inferred from your question: ${inferredInstant.label}.`);
      }
      if (materiallyBetterAlternative) {
        supportingDetails.push(
          `A better forecasted option is ${materiallyBetterAlternative.lotName} at about ${materiallyBetterAlternative.occupancyPercent}% occupancy.`
        );
      }
      const factsLotSpecific = mergeFactsWithTimelinessNote({
        lotNameMatch,
        requestedLot: {
          lotId: lotForecast.lotId,
          lotCode: lotForecast.lotCode,
          lotName: lotForecast.lotName,
          zoneType: lotForecast.zoneType,
          occupancyPercent: lotForecast.occupancyPercent,
          busynessCategory: busynessCategory(lotForecast.occupancyPercent),
          sampleCount: lotForecast.sampleCount,
          latestSnapshotTime: lotForecast.latestSnapshotTime?.toISOString() ?? null,
        },
        alternativeRecommendation:
          materiallyBetterAlternative === null
            ? null
            : {
                lotCode: materiallyBetterAlternative.lotCode,
                lotName: materiallyBetterAlternative.lotName,
                zoneType: materiallyBetterAlternative.zoneType,
                occupancyPercent: materiallyBetterAlternative.occupancyPercent,
                sampleCount: materiallyBetterAlternative.sampleCount,
              },
        comparisonDeltaPercent,
        destinationHint,
      });
      const phrasedLotAnswer = await parkingAnswerWithOptionalAiPhrasing(
        question,
        "recommendation",
        factsLotSpecific,
        lotAnswer
      );
      sendSanitizedAskResponse(res, {
        intent: "lot_specific",
        answer: phrasedLotAnswer,
        explanation: lotExplanation,
        disclaimer: FORECAST_DISCLAIMER,
        supportingDetails,
        lotSpecificMeta: {
          lotNameMatch,
          lotForecast,
        },
        alternativeRecommendation: materiallyBetterAlternative,
        comparisonDeltaPercent,
        data: lotForecast,
      });
      return;
    }

    if (routingIntent === "recommendation") {
      console.log("[ask] routed intent=recommendation", { zones });
      const inferredInstant = inferReferenceInstantFromQuestion(question, referenceNow);
      const recommendation = await ParkingAnalyticsService.getRecommendation(zones, {
        targetHour: inferredInstant?.at.getHours() ?? null,
        targetDayOfWeek: inferredInstant?.at.getDay() ?? null,
        targetBuildingName: destinationHint,
      });
      if (recommendation === null) {
        console.log("[ask] recommendation: no historical forecast data for zones");
        sendSanitizedAskResponse(res, {
          intent: "recommendation",
          answer:
            "I could not estimate a lot forecast from historical snapshots for that request yet.",
          data: null,
        });
        return;
      }
      const fallbackAnswer = buildRecommendationAnswer(recommendation);
      const explanation = buildRecommendationExplanation(inferredInstant);
      const supportingDetails = buildRecommendationSupportingDetails(
        recommendation,
        inferredInstant
      );
      if (lotNameMatch) {
        supportingDetails.push(
          `Matched lot reference: ${lotNameMatch.lotName} (${lotNameMatch.matchType} match on ${lotNameMatch.matchSource === "lotName" ? "lot name" : "alt name"}).`
        );
      }
      const facts = {
        zonesRequested: zones,
        destinationHint,
        lotNameMatch:
          lotNameMatch === null
            ? null
            : {
                lotId: lotNameMatch.lotId,
                lotCode: lotNameMatch.lotCode,
                lotName: lotNameMatch.lotName,
                altName: lotNameMatch.altName,
                matchSource: lotNameMatch.matchSource,
                matchType: lotNameMatch.matchType,
                score: lotNameMatch.score,
              },
        forecastContext: inferredInstant?.at.toISOString() ?? null,
        selectedLot: {
          lotCode: recommendation.lotCode,
          lotName: recommendation.lotName,
          zoneType: recommendation.zoneType,
          occupancyPercent: recommendation.occupancyPercent,
          busynessCategory: busynessCategory(recommendation.occupancyPercent),
          sampleCount: recommendation.sampleCount,
          latestSnapshotTime: recommendation.latestSnapshotTime.toISOString(),
          selectionReason: recommendation.reason,
        },
      };
      let athletics: AthleticsAskSupplement = emptyAthleticsAskSupplement();
      try {
        athletics = await computeAthleticsAskSupplementForQuestion(
          question,
          normalizedQuestion,
          referenceNow
        );
      } catch (error) {
        console.error("[ask] athletics supplement failed (non-fatal)", {
          message: error instanceof Error ? error.message : String(error),
        });
        athletics = emptyAthleticsAskSupplement();
      }
      const factsForModel = mergeFactsWithTimelinessNote(facts);
      const answer = await parkingAnswerWithOptionalAiPhrasing(
        question,
        "recommendation",
        factsForModel,
        fallbackAnswer
      );
      const finalAnswer = appendAthleticsSuffix(answer, athletics);
      sendSanitizedAskResponse(res, {
        intent: "recommendation",
        answer: finalAnswer,
        explanation,
        disclaimer: FORECAST_DISCLAIMER,
        supportingDetails,
        recommendationMeta: {
          inferredTimeContext: inferredInstant?.label ?? null,
          inferredTimeContextIso: inferredInstant?.at.toISOString() ?? null,
          inferredFromQuestion: inferredInstant?.inferredFromQuestion ?? false,
          selectionReason: recommendation.reason,
          sampleCount: recommendation.sampleCount,
          latestSnapshotTime: recommendation.latestSnapshotTime.toISOString(),
          lotNameMatch:
            lotNameMatch === null
              ? null
              : {
                  lotId: lotNameMatch.lotId,
                  lotCode: lotNameMatch.lotCode,
                  lotName: lotNameMatch.lotName,
                  altName: lotNameMatch.altName,
                  matchSource: lotNameMatch.matchSource,
                  matchType: lotNameMatch.matchType,
                  score: lotNameMatch.score,
                },
        },
        data: recommendation,
        ...athleticsSupplementToResponseFields(athletics),
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
          ? `${DEMO_TIMELINESS_PREFIX}No lots in historical snapshots meet the 90% average occupancy threshold before 9 AM.`
          : `${DEMO_TIMELINESS_PREFIX}Before 9 AM, historical patterns suggest ${rows[0].lotName} is typically the busiest at an average ${rows[0].averageOccupancyPercent}% occupancy.`;
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
      let athleticsBusy: AthleticsAskSupplement = emptyAthleticsAskSupplement();
      try {
        athleticsBusy = await computeAthleticsAskSupplementForQuestion(
          question,
          normalizedQuestion,
          referenceNow
        );
      } catch (error) {
        console.error("[ask] athletics supplement failed (non-fatal)", {
          message: error instanceof Error ? error.message : String(error),
        });
        athleticsBusy = emptyAthleticsAskSupplement();
      }
      const factsBusy = mergeFactsWithTimelinessNote(facts);
      const answer = await parkingAnswerWithOptionalAiPhrasing(
        question,
        "busy_before_nine",
        factsBusy,
        fallbackAnswer
      );
      const finalAnswerBusy = appendAthleticsSuffix(answer, athleticsBusy);
      sendSanitizedAskResponse(res, {
        intent: "busy_before_nine",
        answer: finalAnswerBusy,
        data: rows,
        ...athleticsSupplementToResponseFields(athleticsBusy),
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
        .map((lot) => `${lot.lotName} (${lot.zoneType})`)
        .join(", ")}.`;
      const facts = {
        totalCount: lots.length,
        lots: lots.map((lot) => ({
          lotCode: lot.lotCode,
          lotName: lot.lotName,
          zoneType: lot.zoneType,
        })),
      };
      let athleticsLots: AthleticsAskSupplement = emptyAthleticsAskSupplement();
      try {
        athleticsLots = await computeAthleticsAskSupplementForQuestion(
          question,
          normalizedQuestion,
          referenceNow
        );
      } catch (error) {
        console.error("[ask] athletics supplement failed (non-fatal)", {
          message: error instanceof Error ? error.message : String(error),
        });
        athleticsLots = emptyAthleticsAskSupplement();
      }
      const factsLots = mergeFactsWithTimelinessNote(facts);
      const answer = await parkingAnswerWithOptionalAiPhrasing(
        question,
        "lots_list",
        factsLots,
        fallbackAnswer
      );
      const finalAnswerLots = appendAthleticsSuffix(answer, athleticsLots);
      sendSanitizedAskResponse(res, {
        intent: "lots_list",
        answer: finalAnswerLots,
        data: lots,
        ...athleticsSupplementToResponseFields(athleticsLots),
      });
      return;
    }

    if (
      shouldConsiderAthleticsSchedule(normalizedQuestion) &&
      mentionsCampusParkingContext(normalizedQuestion)
    ) {
      console.log("[ask] routed intent=recommendation (time-based parking context)");
      const zones = parseZonesFromQuestion(normalizedQuestion);
      const inferredInstant = inferReferenceInstantFromQuestion(question, referenceNow);
      const recommendation = await ParkingAnalyticsService.getRecommendation(zones, {
        targetHour: inferredInstant?.at.getHours() ?? null,
        targetDayOfWeek: inferredInstant?.at.getDay() ?? null,
        targetBuildingName: destinationHint,
      });
      if (recommendation === null) {
        let athleticsOnly: AthleticsAskSupplement = emptyAthleticsAskSupplement();
        try {
          athleticsOnly = await computeAthleticsAskSupplementForQuestion(
            question,
            normalizedQuestion,
            referenceNow
          );
        } catch (error) {
          console.error("[ask] athletics supplement failed (non-fatal)", {
            message: error instanceof Error ? error.message : String(error),
          });
          athleticsOnly = emptyAthleticsAskSupplement();
        }
        const baseNoData =
          "I could not estimate a lot forecast from historical snapshots for that request yet.";
        const answerNoData = appendAthleticsSuffix(baseNoData, athleticsOnly);
        sendSanitizedAskResponse(res, {
          intent: "recommendation",
          answer: answerNoData,
          data: null,
          ...athleticsSupplementToResponseFields(athleticsOnly),
        });
        return;
      }
      const fallbackAnswerTime = buildRecommendationAnswer(recommendation);
      const explanationTime = buildRecommendationExplanation(inferredInstant);
      const supportingDetailsTime = buildRecommendationSupportingDetails(
        recommendation,
        inferredInstant
      );
      if (lotNameMatch) {
        supportingDetailsTime.push(
          `Matched lot reference: ${lotNameMatch.lotName} (${lotNameMatch.matchType} match on ${lotNameMatch.matchSource === "lotName" ? "lot name" : "alt name"}).`
        );
      }
      if (destinationHint) {
        supportingDetailsTime.push(`Destination context detected: ${destinationHint}.`);
      }
      const factsTime = {
        zonesRequested: zones,
        destinationHint,
        lotNameMatch:
          lotNameMatch === null
            ? null
            : {
                lotId: lotNameMatch.lotId,
                lotCode: lotNameMatch.lotCode,
                lotName: lotNameMatch.lotName,
                altName: lotNameMatch.altName,
                matchSource: lotNameMatch.matchSource,
                matchType: lotNameMatch.matchType,
                score: lotNameMatch.score,
              },
        forecastContext: inferredInstant?.at.toISOString() ?? null,
        selectedLot: {
          lotCode: recommendation.lotCode,
          lotName: recommendation.lotName,
          zoneType: recommendation.zoneType,
          occupancyPercent: recommendation.occupancyPercent,
          busynessCategory: busynessCategory(recommendation.occupancyPercent),
          sampleCount: recommendation.sampleCount,
          latestSnapshotTime: recommendation.latestSnapshotTime.toISOString(),
          selectionReason: recommendation.reason,
        },
      };
      let athleticsTime: AthleticsAskSupplement = emptyAthleticsAskSupplement();
      try {
        athleticsTime = await computeAthleticsAskSupplementForQuestion(
          question,
          normalizedQuestion,
          referenceNow
        );
      } catch (error) {
        console.error("[ask] athletics supplement failed (non-fatal)", {
          message: error instanceof Error ? error.message : String(error),
        });
        athleticsTime = emptyAthleticsAskSupplement();
      }
      const factsTimeForModel = mergeFactsWithTimelinessNote(factsTime);
      const answerTime = await parkingAnswerWithOptionalAiPhrasing(
        question,
        "recommendation",
        factsTimeForModel,
        fallbackAnswerTime
      );
      const finalAnswerTime = appendAthleticsSuffix(answerTime, athleticsTime);
      sendSanitizedAskResponse(res, {
        intent: "recommendation",
        answer: finalAnswerTime,
        explanation: explanationTime,
        disclaimer: FORECAST_DISCLAIMER,
        supportingDetails: supportingDetailsTime,
        recommendationMeta: {
          inferredTimeContext: inferredInstant?.label ?? null,
          inferredTimeContextIso: inferredInstant?.at.toISOString() ?? null,
          inferredFromQuestion: inferredInstant?.inferredFromQuestion ?? false,
          selectionReason: recommendation.reason,
          sampleCount: recommendation.sampleCount,
          latestSnapshotTime: recommendation.latestSnapshotTime.toISOString(),
          lotNameMatch:
            lotNameMatch === null
              ? null
              : {
                  lotId: lotNameMatch.lotId,
                  lotCode: lotNameMatch.lotCode,
                  lotName: lotNameMatch.lotName,
                  altName: lotNameMatch.altName,
                  matchSource: lotNameMatch.matchSource,
                  matchType: lotNameMatch.matchType,
                  score: lotNameMatch.score,
                },
        },
        data: recommendation,
        ...athleticsSupplementToResponseFields(athleticsTime),
      });
      return;
    }

    console.log("[ask] routed intent=unsupported");
    sendSanitizedAskResponse(res, {
      intent: "unsupported",
      answer:
        "I can answer supported questions about forecasted lot recommendations, busy-before-9 trends from historical snapshots, and lot lists from the app's parking database, plus permit and parking policy topics from Marist's official Parking FAQ when your question matches that page. Time-based campus parking questions may also receive optional advisory context from Marist's official athletics composite schedule when they clearly mention parking and a time or date.",
      data: null,
    });
  } catch (error) {
    console.error("POST /api/parking/ask failed:", error);
    res.status(500).json({ error: "Failed to answer parking question" });
  }
};

app.post("/api/parking/ask", askParkingHandler);

/**
 * @openapi
 * /api/parking/ask-simulated-now:
 *   post:
 *     tags: [Parking]
 *     summary: Swagger-only ask route that simulates "now" for time parsing and athletics advisories
 *     description: >
 *       Behaves like `/api/parking/ask`, but requires `pretendNow` so relative time phrases
 *       (for example "today", "tomorrow", "tonight", weekday names) are interpreted as if that
 *       timestamp were the current moment. Useful for historical scenario testing in Swagger.
 *     parameters:
 *       - in: query
 *         name: pretendNow
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *           example: 2026-04-18T10:00:00-04:00
 *         description: ISO timestamp used as the reference "now" for question time inference.
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
 *                 example: Will parking be worse tonight because of a game?
 *     responses:
 *       200:
 *         description: Same response shape as /api/parking/ask
 *       400:
 *         description: Missing/invalid pretendNow, missing/blank question, non-string question, or invalid JSON body
 *       500:
 *         description: Server error
 */
app.post("/api/parking/ask-simulated-now", askParkingHandler);

export { app };
