/**
 * API smoke tests for read-only routes (supertest + real Postgres when `DATABASE_URL` is set).
 *
 * **Database / seed:** These tests hit the real `ParkingAnalyticsService` and expect a working
 * `DATABASE_URL` plus the demo seed from `npm run seed-db` (lots `DEMO-N-01`, `DEMO-S-02`, `DEMO-E-03`).
 * Run from `server/` with `.env` configured like local development.
 */
import request from "supertest";
import { app } from "./app";

describe("GET /health", () => {
  it("returns 200 and a simple JSON health payload", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /api/parking/summary", () => {
  it("returns 200 with a JSON array of summary-shaped rows", async () => {
    const res = await request(app).get("/api/parking/summary");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    for (const row of res.body as unknown[]) {
      expect(row).toEqual(
        expect.objectContaining({
          lotCode: expect.any(String),
          lotName: expect.any(String),
          zoneType: expect.any(String),
        })
      );
      expect(row).toHaveProperty("occupancyPercent");
      expect(row).toHaveProperty("latestSnapshotTime");
    }

    const codes = (res.body as { lotCode: string }[]).map((r) => r.lotCode);
    expect(codes).toEqual(expect.arrayContaining(["DEMO-N-01", "DEMO-S-02", "DEMO-E-03"]));
  });
});

describe("GET /api/parking/lots", () => {
  it("returns 200 with list items that include id and lot fields", async () => {
    const res = await request(app).get("/api/parking/lots");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    for (const row of res.body as unknown[]) {
      expect(row).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          lotCode: expect.any(String),
          lotName: expect.any(String),
          zoneType: expect.any(String),
        })
      );
    }
  });
});

describe("GET /api/parking/snapshots/latest", () => {
  it("returns 200 with snapshot rows when data exists", async () => {
    const res = await request(app).get("/api/parking/snapshots/latest");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    for (const row of res.body as unknown[]) {
      expect(row).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          lotId: expect.any(Number),
          occupancyPercent: expect.any(Number),
        })
      );
      expect(row).toHaveProperty("snapshotAt");
    }
  });
});

describe("GET /api/parking/busy-before-nine", () => {
  it("returns 200 with an array (shape only; may be empty on unusual data)", async () => {
    const res = await request(app).get("/api/parking/busy-before-nine");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    for (const row of res.body as unknown[]) {
      expect(row).toEqual(
        expect.objectContaining({
          lotCode: expect.any(String),
          lotName: expect.any(String),
          zoneType: expect.any(String),
          averageOccupancyPercent: expect.any(Number),
          sampleCount: expect.any(Number),
        })
      );
    }
  });
});

describe("GET /api/parking/lots/:lotCode", () => {
  it("returns 200 and lot detail for a seeded demo code", async () => {
    const res = await request(app).get("/api/parking/lots/DEMO-N-01");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        lotCode: "DEMO-N-01",
        lotName: expect.any(String),
        zoneType: expect.any(String),
        id: expect.any(Number),
      })
    );
    expect(res.body).toHaveProperty("latestSnapshot");
  });

  it("returns 404 JSON for an unknown lot code", async () => {
    const res = await request(app).get("/api/parking/lots/NOT-A-REAL-LOT-CODE");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Lot not found" });
  });
});

describe("POST /api/parking/ask", () => {
  it("returns a recommendation answer from historical forecast summaries", async () => {
    const res = await request(app)
      .post("/api/parking/ask")
      .send({ question: "What faculty lot is usually best around 10am?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        intent: "recommendation",
        answer: expect.any(String),
        data: expect.objectContaining({
          lotCode: expect.any(String),
          sampleCount: expect.any(Number),
          reason: expect.any(String),
        }),
      })
    );
  });

  it("adds lot match metadata when question uses partial lot name wording", async () => {
    const res = await request(app)
      .post("/api/parking/ask")
      .send({ question: "What is the best lot near North Campus around noon?" });

    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("recommendation");
    expect(res.body.recommendationMeta).toEqual(
      expect.objectContaining({
        lotNameMatch: expect.objectContaining({
          lotName: expect.stringContaining("North Campus"),
          matchSource: expect.any(String),
          matchType: expect.any(String),
          score: expect.any(Number),
        }),
      })
    );
  });

  it("returns busy_before_nine with rows array and answer", async () => {
    const res = await request(app)
      .post("/api/parking/ask")
      .send({ question: "Which lots are usually busy before 9?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        intent: "busy_before_nine",
        answer: expect.any(String),
      })
    );
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("returns lots_list with lot rows", async () => {
    const res = await request(app)
      .post("/api/parking/ask")
      .send({ question: "Can you list the parking lots?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        intent: "lots_list",
        answer: expect.any(String),
      })
    );
    expect(Array.isArray(res.body.data)).toBe(true);
    expect((res.body.data as { lotCode: string }[]).map((r) => r.lotCode)).toEqual(
      expect.arrayContaining(["DEMO-N-01", "DEMO-S-02", "DEMO-E-03"])
    );
  });

  it("returns parking_rules_faq with FAQ-shaped payload (cached or network)", async () => {
    const res = await request(app)
      .post("/api/parking/ask")
      .send({ question: "Where will commuter students be assigned to park?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        intent: "parking_rules_faq",
        answer: expect.any(String),
        sourceType: "official_web",
        sourceUrl: expect.any(String),
      })
    );
    expect(res.body.data).toEqual(
      expect.objectContaining({
        matchedFaqExcerpts: expect.any(Array),
      })
    );
    expect((res.body.data as { matchedFaqExcerpts: string[] }).matchedFaqExcerpts.length).toBeGreaterThan(0);
  });

  it("returns unsupported with data null for unrelated questions", async () => {
    const res = await request(app)
      .post("/api/parking/ask")
      .send({ question: "What is the capital of France?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        intent: "unsupported",
        answer: expect.any(String),
        data: null,
      })
    );
  });

  it("returns 400 when question is missing", async () => {
    const res = await request(app).post("/api/parking/ask").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Question is required" });
  });

  it("returns 400 when question is only whitespace", async () => {
    const res = await request(app).post("/api/parking/ask").send({ question: "   \n\t  " });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Question is required" });
  });

  it("returns 400 when question is not a string", async () => {
    const res = await request(app).post("/api/parking/ask").send({ question: 123 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Question must be a non-empty string" });
  });

  it("returns 400 for malformed JSON body", async () => {
    const res = await request(app)
      .post("/api/parking/ask")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid JSON body" });
  });
});
