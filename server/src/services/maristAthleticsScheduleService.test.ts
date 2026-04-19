import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import type { AthleticsEventSnippet } from "./maristAthleticsScheduleService";
import {
  buildAthleticsAskSupplementFromLookup,
  findOfficialAthleticsEventsNearTime,
  isAthleticsEventLikelyCampusParkingRelevant,
  resetAthleticsScheduleCachesForTests,
} from "./maristAthleticsScheduleService";

function snippet(partial: Partial<AthleticsEventSnippet> & Pick<AthleticsEventSnippet, "id" | "title">): AthleticsEventSnippet {
  return {
    startAtIso: partial.startAtIso ?? "2026-04-18T16:00:00",
    displayTime: partial.displayTime ?? "4:00 PM",
    location: partial.location ?? null,
    facilityTitle: partial.facilityTitle ?? null,
    locationIndicator: partial.locationIndicator ?? null,
    atVs: partial.atVs ?? null,
    ...partial,
  };
}

describe("maristAthleticsScheduleService", () => {
  beforeEach(() => {
    resetAthleticsScheduleCachesForTests();
  });

  afterEach(() => {
    resetAthleticsScheduleCachesForTests();
  });
  it("builds an advisory supplement when events match", () => {
    const sup = buildAthleticsAskSupplementFromLookup(
      {
        ok: true,
        lastCheckedAt: "2026-04-01T12:00:00.000Z",
        matchedEvents: [
          snippet({
            id: 1,
            startAtIso: "2026-04-18T16:00:00",
            displayTime: "4:00 PM",
            title: "Baseball vs Example University",
            location: "Heritage Financial Park",
            facilityTitle: null,
            locationIndicator: "H",
            atVs: "vs",
          }),
        ],
        monthsLoaded: ["2026-04"],
      },
      true
    );
    expect(sup.lookupAttempted).toBe(true);
    expect(sup.eventSignalFound).toBe(true);
    expect(sup.answerSuffix).toMatch(/Marist athletics event/i);
    expect(sup.eventImpactNote).toMatch(/advisory only/i);
  });

  it("does not advise campus parking for away or opponent-site events", () => {
    const sup = buildAthleticsAskSupplementFromLookup(
      {
        ok: true,
        lastCheckedAt: "2026-04-01T12:00:00.000Z",
        matchedEvents: [
          snippet({
            id: 2,
            startAtIso: "2026-04-18T16:00:00",
            displayTime: "4:00 PM",
            title: "Baseball at Niagara University",
            location: "Niagara University",
            facilityTitle: null,
            locationIndicator: "A",
            atVs: "at",
          }),
        ],
        monthsLoaded: ["2026-04"],
      },
      true
    );
    expect(sup.eventSignalFound).toBe(false);
    expect(sup.answerSuffix).toBeNull();
    expect(sup.eventImpactNote).toBeNull();
  });

  it("isAthleticsEventLikelyCampusParkingRelevant uses feed and title heuristics", () => {
    expect(
      isAthleticsEventLikelyCampusParkingRelevant(
        snippet({
          id: 1,
          title: "Soccer vs Other U",
          locationIndicator: null,
          atVs: null,
          location: null,
          facilityTitle: null,
        })
      )
    ).toBe(true);
    expect(
      isAthleticsEventLikelyCampusParkingRelevant(
        snippet({
          id: 2,
          title: "Baseball at Niagara University",
          locationIndicator: null,
          atVs: null,
          location: null,
          facilityTitle: null,
        })
      )
    ).toBe(false);
    expect(
      isAthleticsEventLikelyCampusParkingRelevant(
        snippet({
          id: 3,
          title: "Tournament game",
          locationIndicator: "N",
          atVs: null,
          location: "Syracuse University",
          facilityTitle: null,
        })
      )
    ).toBe(false);
  });

  it("surfaces a safe note when the schedule cannot be loaded", () => {
    const sup = buildAthleticsAskSupplementFromLookup(
      {
        ok: false,
        errorMessage: "network",
        lastCheckedAt: null,
        matchedEvents: [],
        monthsLoaded: [],
      },
      true
    );
    expect(sup.lookupOk).toBe(false);
    expect(sup.answerSuffix).toMatch(/could not verify current athletics events/i);
  });

  it("filters events within the requested window (mocked fetch)", async () => {
    const sample = [
      {
        date: "2026-04-18T00:00:00",
        events: [
          {
            id: 100,
            date: "2026-04-18T16:00:00",
            time: "4:00 PM",
            location: "Campus",
            location_indicator: "H",
            sport: { title: "Lacrosse" },
            opponent: { title: "Visitor U", prefix: null },
            at_vs: "vs",
          },
          {
            id: 101,
            date: "2026-04-19T12:00:00",
            time: "12:00 PM",
            location: "Away",
            location_indicator: "A",
            sport: { title: "Soccer" },
            opponent: { title: "Other U", prefix: null },
            at_vs: "at",
          },
        ],
      },
    ];

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(sample),
      } as unknown as Response;
    });

    const center = new Date("2026-04-18T16:05:00");
    const res = await findOfficialAthleticsEventsNearTime(center, 60 * 60 * 1000);
    global.fetch = originalFetch;
    resetAthleticsScheduleCachesForTests();

    expect(res.ok).toBe(true);
    expect(res.matchedEvents.length).toBe(1);
    expect(res.matchedEvents[0].id).toBe(100);
  });
});
