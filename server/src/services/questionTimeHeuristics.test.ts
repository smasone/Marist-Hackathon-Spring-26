import { describe, expect, it } from "@jest/globals";
import {
  inferReferenceInstantFromQuestion,
  mentionsCampusParkingContext,
  shouldAddDemoTimelinessDisclaimer,
  shouldConsiderAthleticsSchedule,
} from "./questionTimeHeuristics";

describe("questionTimeHeuristics", () => {
  const fixedNow = new Date("2026-04-15T14:30:00");

  it("detects clock and calendar phrases for athletics lookup", () => {
    expect(shouldConsiderAthleticsSchedule("best lot tomorrow at 11am")).toBe(true);
    expect(shouldConsiderAthleticsSchedule("will parking be bad friday evening")).toBe(true);
    expect(shouldConsiderAthleticsSchedule("best lot on friday evening")).toBe(true);
  });

  it("does not treat generic policy questions as time-shaped", () => {
    expect(shouldConsiderAthleticsSchedule("how do commuter permits work")).toBe(false);
  });

  it("parses tomorrow at 11am into the following day", () => {
    const r = inferReferenceInstantFromQuestion("What lot is best for a commuter tomorrow at 11am?", fixedNow);
    expect(r).not.toBeNull();
    expect(r!.at.getFullYear()).toBe(2026);
    expect(r!.at.getMonth()).toBe(3);
    expect(r!.at.getDate()).toBe(16);
    expect(r!.at.getHours()).toBe(11);
    expect(r!.confidence).toBe("high");
  });

  it("mentionsCampusParkingContext matches parking phrasing", () => {
    expect(mentionsCampusParkingContext("will parking be bad on friday")).toBe(true);
    expect(mentionsCampusParkingContext("what is the capital of france")).toBe(false);
  });

  it("shouldAddDemoTimelinessDisclaimer skips explicit right-now wording", () => {
    expect(shouldAddDemoTimelinessDisclaimer("best lot right now")).toBe(false);
    expect(shouldAddDemoTimelinessDisclaimer("best lot tomorrow")).toBe(true);
  });
});
