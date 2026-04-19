import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import * as maristAthletics from "./services/maristAthleticsScheduleService";
import { ParkingAnalyticsService } from "./services/parkingAnalyticsService";
import { app } from "./app";

const spy = jest.spyOn(maristAthletics, "computeAthleticsAskSupplementForQuestion");
const lotMatchSpy = jest.spyOn(ParkingAnalyticsService, "findBestLotNameMatch");
const recommendationSpy = jest.spyOn(ParkingAnalyticsService, "getRecommendation");

afterAll(() => {
  spy.mockRestore();
  lotMatchSpy.mockRestore();
  recommendationSpy.mockRestore();
});

describe("POST /api/parking/ask-simulated-now", () => {
  beforeEach(() => {
    spy.mockReset();
    lotMatchSpy.mockReset();
    recommendationSpy.mockReset();
    lotMatchSpy.mockResolvedValue(null);
    recommendationSpy.mockResolvedValue({
      lotCode: "LC",
      lotName: "Lower Campus",
      zoneType: "student",
      occupancyPercent: 55,
      sampleCount: 10,
      latestSnapshotTime: new Date("2026-04-18T09:00:00.000Z"),
      reason: "lowest_occupancy",
    });
  });

  it("requires pretendNow query parameter", async () => {
    const res = await request(app)
      .post("/api/parking/ask-simulated-now")
      .send({ question: "Will parking be bad tonight?" });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("pretendNow");
  });

  it("passes pretendNow into athletics supplement time inference", async () => {
    spy.mockResolvedValue(maristAthletics.emptyAthleticsAskSupplement());
    const pretendNow = "2026-04-18T10:00:00-04:00";

    const res = await request(app)
      .post(`/api/parking/ask-simulated-now?pretendNow=${encodeURIComponent(pretendNow)}`)
      .send({ question: "What is the best commuter lot tonight?" });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    const thirdArg = spy.mock.calls[0]?.[2] as Date | undefined;
    expect(thirdArg).toBeInstanceOf(Date);
    expect(thirdArg?.toISOString()).toBe(new Date(pretendNow).toISOString());
  });
});
