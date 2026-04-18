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
  it("returns a recommendation answer from live DB summaries", async () => {
    const res = await request(app)
      .post("/api/parking/ask")
      .send({ question: "What is the best faculty lot right now?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        intent: "recommendation",
        answer: expect.any(String),
      })
    );
  });

  it("returns 400 when question is missing", async () => {
    const res = await request(app).post("/api/parking/ask").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Question is required" });
  });
});
