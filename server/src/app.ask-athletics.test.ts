/**
 * Ask route: athletics advisory is layered without breaking DB-backed answers.
 */
import { describe, expect, it, jest, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import * as maristAthletics from "./services/maristAthleticsScheduleService";
import { app } from "./app";

const spy = jest.spyOn(maristAthletics, "computeAthleticsAskSupplementForQuestion");

afterAll(() => {
  spy.mockRestore();
});

describe("POST /api/parking/ask (athletics advisory)", () => {
  beforeEach(() => {
    spy.mockReset();
  });

  it("appends athletics suffix on recommendation when supplement returns a note", async () => {
    spy.mockResolvedValue({
      lookupAttempted: true,
      lookupOk: true,
      lastCheckedAt: "2026-04-01T12:00:00.000Z",
      eventSignalFound: true,
      eventTitle: "Baseball vs Example University",
      eventTime: "2026-04-18T16:00:00",
      eventSnippet: "Baseball vs Example University",
      eventImpactNote: "ADVISORY_NOTE",
      eventSources: [{ title: "Composite Schedule", url: "https://goredfoxes.com/calendar" }],
      answerSuffix: "ADVISORY_NOTE",
    });

    const res = await request(app)
      .post("/api/parking/ask")
      .send({ question: "What is the best commuter lot tomorrow at 11am?" });

    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("recommendation");
    expect(String(res.body.answer)).toContain("ADVISORY_NOTE");
    expect(res.body.eventSignalFound).toBe(true);
    expect(res.body.sourceType).toBe("official_athletics_schedule");
  });

  it("omits athletics response metadata when supplementation is inapplicable", async () => {
    spy.mockResolvedValue(maristAthletics.emptyAthleticsAskSupplement());

    const res = await request(app)
      .post("/api/parking/ask")
      .send({ question: "What is the best faculty lot right now?" });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    expect(res.body.eventSignalFound).toBeUndefined();
  });
});
