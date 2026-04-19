/**
 * Ask-route regression: optional OpenAI phrasing must never take down the handler.
 * This file mocks `formatParkingAnswer` only; the real app and Postgres paths still run.
 */
jest.mock("./services/openAiService", () => {
  const actual =
    jest.requireActual<typeof import("./services/openAiService")>(
      "./services/openAiService"
    );
  return {
    ...actual,
    formatParkingAnswer: jest.fn(async () => {
      throw new Error("simulated OpenAI failure");
    }),
  };
});

import request from "supertest";
import { app } from "./app";

describe("POST /api/parking/ask (OpenAI phrasing throws)", () => {
  it("returns 200 and a deterministic DB-backed answer for recommendation", async () => {
    const res = await request(app)
      .post("/api/parking/ask")
      .send({ question: "What is the best lot right now?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        intent: "recommendation",
        answer: expect.any(String),
        data: expect.objectContaining({
          lotCode: expect.any(String),
          lotName: expect.any(String),
          zoneType: expect.any(String),
          occupancyPercent: expect.any(Number),
          reason: expect.any(String),
        }),
      })
    );
    expect(String(res.body.answer)).toMatch(/Best current option/i);
  });
});
