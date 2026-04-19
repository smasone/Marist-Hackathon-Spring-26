/**
 * Lightweight read of Marist's official athletics composite schedule (Sidearm).
 * Separate from occupancy analytics — advisory context only for Ask-the-AI.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  inferReferenceInstantFromQuestion,
  shouldConsiderAthleticsSchedule,
} from "./questionTimeHeuristics";

/** Human-readable official composite calendar (Marist Red Foxes athletics site). */
export const OFFICIAL_MARIST_ATHLETICS_COMPOSITE_CALENDAR_URL =
  "https://goredfoxes.com/calendar";

/**
 * Official Sidearm JSON endpoint used by the composite calendar page (same origin as goredfoxes.com).
 */
export const OFFICIAL_MARIST_ATHLETICS_SCHEDULE_JSON_URL =
  "https://goredfoxes.com/services/responsive-calendar.ashx";

const CACHE_FILENAME = "marist-athletics-schedule-cache.json";
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 18_000;
const DEFAULT_WINDOW_MS = 4 * 60 * 60 * 1000;

interface DiskMonthEntry {
  fetchedAt: string;
  /** Raw JSON string from the official endpoint for that month. */
  payload: string;
}

interface DiskCacheShape {
  version: 1;
  months: Record<string, DiskMonthEntry>;
}

interface SidearmCalendarEvent {
  id: number;
  date: string;
  time: string;
  location: string | null;
  location_indicator?: string;
  at_vs?: string | null;
  sport?: { title?: string; short_display?: string };
  opponent?: { title?: string; prefix?: string | null } | null;
  tournament?: { title?: string } | null;
  facility?: { title?: string } | null;
}

interface SidearmCalendarDay {
  date: string;
  events?: SidearmCalendarEvent[];
}

const memoryMonthCache = new Map<string, { fetchedAt: number; days: SidearmCalendarDay[] }>();

/** Clears in-memory month responses (Jest only). */
export function resetAthleticsScheduleCachesForTests(): void {
  memoryMonthCache.clear();
}

function cacheFilePath(): string {
  return path.join(process.cwd(), "data", CACHE_FILENAME);
}

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0);
}

async function readDiskCache(): Promise<DiskCacheShape | null> {
  try {
    const raw = await fs.readFile(cacheFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as DiskCacheShape).version !== 1 ||
      typeof (parsed as DiskCacheShape).months !== "object"
    ) {
      return null;
    }
    return parsed as DiskCacheShape;
  } catch {
    return null;
  }
}

async function writeDiskMonth(key: string, payload: string): Promise<void> {
  const disk = (await readDiskCache()) ?? { version: 1 as const, months: {} };
  disk.months[key] = {
    fetchedAt: new Date().toISOString(),
    payload,
  };
  const dir = path.dirname(cacheFilePath());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cacheFilePath(), JSON.stringify(disk, null, 2), "utf8");
}

function parseMonthPayload(jsonText: string): SidearmCalendarDay[] {
  const parsed: unknown = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed as SidearmCalendarDay[];
}

async function fetchMonthFromNetwork(monthDate: Date): Promise<SidearmCalendarDay[]> {
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth() + 1;
  const dateParam = `${y}-${String(m).padStart(2, "0")}-01`;
  const url = `${OFFICIAL_MARIST_ATHLETICS_SCHEDULE_JSON_URL}?type=month&sport=0&location=all&date=${encodeURIComponent(
    dateParam
  )}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "MaristHackathonParkingApp/1.0 (+educational demo; athletics schedule cache)",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await res.text();
    const days = parseMonthPayload(text);
    if (days.length === 0) {
      throw new Error("Empty athletics calendar month payload");
    }
    const key = monthKeyFromDate(monthDate);
    memoryMonthCache.set(key, { fetchedAt: Date.now(), days });
    await writeDiskMonth(key, text).catch((err) => {
      console.warn("[athletics] writeDiskMonth failed (non-fatal)", {
        key,
        message: err instanceof Error ? err.message : String(err),
      });
    });
    return days;
  } finally {
    clearTimeout(t);
  }
}

async function loadMonthDays(monthDate: Date): Promise<{
  days: SidearmCalendarDay[];
  fromStaleDisk: boolean;
  lastFetchedAt: Date | null;
}> {
  const key = monthKeyFromDate(monthDate);
  const mem = memoryMonthCache.get(key);
  const now = Date.now();
  if (mem && now - mem.fetchedAt < MEMORY_TTL_MS) {
    return { days: mem.days, fromStaleDisk: false, lastFetchedAt: new Date(mem.fetchedAt) };
  }

  try {
    const days = await fetchMonthFromNetwork(monthDate);
    return { days, fromStaleDisk: false, lastFetchedAt: new Date() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[athletics] fetchMonthFromNetwork failed", { key, message });
    const disk = await readDiskCache();
    const entry = disk?.months[key];
    if (entry?.payload) {
      try {
        const days = parseMonthPayload(entry.payload);
        memoryMonthCache.set(key, {
          fetchedAt: Date.now() - MEMORY_TTL_MS,
          days,
        });
        return {
          days,
          fromStaleDisk: true,
          lastFetchedAt: new Date(entry.fetchedAt),
        };
      } catch {
        /* fall through */
      }
    }
    return { days: [], fromStaleDisk: false, lastFetchedAt: null };
  }
}

export interface AthleticsEventSnippet {
  id: number;
  /** ISO string from the official feed (`event.date`). */
  startAtIso: string;
  displayTime: string;
  title: string;
  /** Game site / neutral description from the feed when present. */
  location: string | null;
  facilityTitle: string | null;
  /** Sidearm `location_indicator`: H = home, A = away, N = neutral (heuristics apply). */
  locationIndicator: string | null;
  /** Sidearm `at_vs`, e.g. `vs` (home-style) or `at` (away-style). */
  atVs: string | null;
}

/** Lowercase strings that suggest the event is in/near Marist’s usual home footprint. */
const HOME_VENUE_OR_CAMPUS_HINTS: readonly string[] = [
  "marist",
  "mccann",
  "tenney",
  "heritage financial",
  "leonidoff",
  "north field",
  "longview park",
  "poughkeepsie",
  "new windsor",
  "sportsplex",
];

function normalizeAtVsToken(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) {
    return "";
  }
  return raw.trim().toLowerCase().replace(/\./g, "");
}

/**
 * Returns true only when an event plausibly draws people to Marist’s campus area
 * (home / on-campus style). Away games and obvious opponent-site locations are excluded.
 *
 * **Assumptions:** Sidearm `location_indicator` and `at_vs` are authoritative when present.
 * When both are missing, we use conservative title/location heuristics and default to false.
 */
export function isAthleticsEventLikelyCampusParkingRelevant(ev: AthleticsEventSnippet): boolean {
  const locInd = (ev.locationIndicator ?? "").trim().toUpperCase();
  if (locInd === "A") {
    return false;
  }
  if (locInd === "H") {
    return true;
  }

  const atVs = normalizeAtVsToken(ev.atVs);
  if (atVs === "at") {
    return false;
  }
  if (atVs === "vs" || atVs === "v") {
    return true;
  }

  const titleLower = ev.title.toLowerCase();
  if (/\bat\s+[a-z0-9]/i.test(titleLower)) {
    return false;
  }
  if (/\bvs\.?\s/i.test(titleLower)) {
    return true;
  }

  const locLower = (ev.location ?? "").toLowerCase();
  const facLower = (ev.facilityTitle ?? "").toLowerCase();
  const blob = `${titleLower} ${locLower} ${facLower}`;

  if (HOME_VENUE_OR_CAMPUS_HINTS.some((hint) => blob.includes(hint))) {
    return true;
  }

  if (locLower.length > 0 && /\b(university|college)\b/.test(locLower) && !locLower.includes("marist")) {
    return false;
  }

  return false;
}

function buildEventTitle(ev: SidearmCalendarEvent): string {
  const sport = ev.sport?.title ?? ev.sport?.short_display ?? "Marist athletics";
  const opp = ev.opponent?.title;
  const tourn = ev.tournament?.title;
  if (tourn) {
    return `${sport} — ${tourn}`;
  }
  if (opp) {
    const prefix = ev.opponent?.prefix ? `${ev.opponent.prefix} ` : "";
    const vs = ev.at_vs ? ` ${ev.at_vs} ` : " vs ";
    return `${sport}${vs}${prefix}${opp}`.replace(/\s+/g, " ").trim();
  }
  return sport;
}

function flattenEvents(days: SidearmCalendarDay[]): AthleticsEventSnippet[] {
  const out: AthleticsEventSnippet[] = [];
  for (const day of days) {
    const list = day.events ?? [];
    for (const ev of list) {
      if (!ev?.date) {
        continue;
      }
      const start = new Date(ev.date);
      if (!Number.isFinite(start.getTime())) {
        continue;
      }
      out.push({
        id: ev.id,
        startAtIso: ev.date,
        displayTime: typeof ev.time === "string" ? ev.time : "",
        title: buildEventTitle(ev),
        location: ev.location ?? null,
        facilityTitle: ev.facility?.title ?? null,
        locationIndicator:
          typeof ev.location_indicator === "string" ? ev.location_indicator : null,
        atVs: typeof ev.at_vs === "string" ? ev.at_vs : null,
      });
    }
  }
  return out;
}

export interface AthleticsNearTimeResult {
  ok: boolean;
  errorMessage?: string;
  lastCheckedAt: string | null;
  matchedEvents: AthleticsEventSnippet[];
  /** Months actually merged for this lookup (YYYY-MM). */
  monthsLoaded: string[];
}

/**
 * Loads official schedule month(s) covering [center - window, center + window] and
 * returns events whose start time falls in that interval.
 */
export async function findOfficialAthleticsEventsNearTime(
  center: Date,
  windowMs: number = DEFAULT_WINDOW_MS
): Promise<AthleticsNearTimeResult> {
  const start = new Date(center.getTime() - windowMs);
  const end = new Date(center.getTime() + windowMs);

  const months = new Set<string>();
  months.add(monthKeyFromDate(start));
  months.add(monthKeyFromDate(end));
  if (monthKeyFromDate(center) !== monthKeyFromDate(start)) {
    months.add(monthKeyFromDate(center));
  }

  const loadedKeys: string[] = [];
  const allDays: SidearmCalendarDay[] = [];
  let newestFetch: Date | null = null;
  let anyOk = false;

  for (const key of months) {
    const [y, m] = key.split("-").map((x) => Number(x));
    if (!Number.isFinite(y) || !Number.isFinite(m)) {
      continue;
    }
    const monthDate = new Date(y, m - 1, 1, 12, 0, 0, 0);
    const { days, lastFetchedAt } = await loadMonthDays(monthDate);
    loadedKeys.push(key);
    if (days.length > 0) {
      anyOk = true;
      allDays.push(...days);
    }
    if (lastFetchedAt && (!newestFetch || lastFetchedAt > newestFetch)) {
      newestFetch = lastFetchedAt;
    }
  }

  if (!anyOk) {
    return {
      ok: false,
      errorMessage: "Official athletics schedule could not be loaded.",
      lastCheckedAt: null,
      matchedEvents: [],
      monthsLoaded: loadedKeys,
    };
  }

  const flat = flattenEvents(allDays);
  const dedup = new Map<number, AthleticsEventSnippet>();
  for (const ev of flat) {
    dedup.set(ev.id, ev);
  }
  const flatUnique = [...dedup.values()];
  const matched = flatUnique.filter((ev) => {
    const t = new Date(ev.startAtIso).getTime();
    return Number.isFinite(t) && t >= start.getTime() && t <= end.getTime();
  });
  matched.sort(
    (a, b) =>
      Math.abs(new Date(a.startAtIso).getTime() - center.getTime()) -
      Math.abs(new Date(b.startAtIso).getTime() - center.getTime())
  );

  return {
    ok: true,
    lastCheckedAt: newestFetch?.toISOString() ?? null,
    matchedEvents: matched.slice(0, 5),
    monthsLoaded: loadedKeys,
  };
}

export interface AthleticsAskSupplement {
  lookupAttempted: boolean;
  lookupOk: boolean;
  lastCheckedAt: string | null;
  eventSignalFound: boolean;
  eventTitle: string | null;
  eventTime: string | null;
  eventSnippet: string | null;
  eventImpactNote: string | null;
  eventSources: { title: string; url: string }[];
  /** Advisory sentence(s) to append to the parking answer (deterministic). */
  answerSuffix: string | null;
}

export function emptyAthleticsAskSupplement(): AthleticsAskSupplement {
  return {
    lookupAttempted: false,
    lookupOk: false,
    lastCheckedAt: null,
    eventSignalFound: false,
    eventTitle: null,
    eventTime: null,
    eventSnippet: null,
    eventImpactNote: null,
    eventSources: [],
    answerSuffix: null,
  };
}

/**
 * When the question is time- or future-condition-shaped, optionally loads the
 * official composite schedule and matches events near the inferred instant.
 */
export async function computeAthleticsAskSupplementForQuestion(
  question: string,
  normalizedQuestion: string,
  now: Date = new Date()
): Promise<AthleticsAskSupplement> {
  if (!shouldConsiderAthleticsSchedule(normalizedQuestion)) {
    return emptyAthleticsAskSupplement();
  }
  const inferred = inferReferenceInstantFromQuestion(question, now);
  if (!inferred) {
    return emptyAthleticsAskSupplement();
  }
  const lookup = await findOfficialAthleticsEventsNearTime(inferred.at);
  return buildAthleticsAskSupplementFromLookup(lookup, true);
}

/** Optional flat metadata for `POST /api/parking/ask` JSON (occupancy intents only). */
export function athleticsSupplementToResponseFields(
  s: AthleticsAskSupplement
): Record<string, unknown> {
  if (!s.lookupAttempted) {
    return {};
  }
  if (s.lookupOk && !s.eventSignalFound) {
    return {};
  }
  const out: Record<string, unknown> = {
    eventSignalFound: s.eventSignalFound,
    eventImpactNote: s.eventImpactNote,
    eventSources: s.eventSources,
    eventTitle: s.eventTitle,
    eventTime: s.eventTime,
    eventSnippet: s.eventSnippet,
    sourceType: "official_athletics_schedule",
    sourceUrl: OFFICIAL_MARIST_ATHLETICS_COMPOSITE_CALENDAR_URL,
    lastCheckedAt: s.lastCheckedAt,
  };
  return out;
}

const SOURCE_TITLE = "Marist Red Foxes — Official Composite Schedule";

export function buildAthleticsAskSupplementFromLookup(
  lookup: AthleticsNearTimeResult,
  /** When false, omit "could not verify" noise for non-time questions (should not happen). */
  includeFetchFailureNote: boolean
): AthleticsAskSupplement {
  const baseSources = [
    {
      title: SOURCE_TITLE,
      url: OFFICIAL_MARIST_ATHLETICS_COMPOSITE_CALENDAR_URL,
    },
  ];

  if (!lookup.ok) {
    return {
      lookupAttempted: true,
      lookupOk: false,
      lastCheckedAt: lookup.lastCheckedAt,
      eventSignalFound: false,
      eventTitle: null,
      eventTime: null,
      eventSnippet: null,
      eventImpactNote: includeFetchFailureNote
        ? "I could not verify current athletics events at this time."
        : null,
      eventSources: baseSources,
      answerSuffix: includeFetchFailureNote
        ? "I could not verify current athletics events at this time."
        : null,
    };
  }

  const campusRelevant = lookup.matchedEvents.filter(isAthleticsEventLikelyCampusParkingRelevant);

  if (campusRelevant.length === 0) {
    return {
      lookupAttempted: true,
      lookupOk: true,
      lastCheckedAt: lookup.lastCheckedAt,
      eventSignalFound: false,
      eventTitle: null,
      eventTime: null,
      eventSnippet: null,
      eventImpactNote: null,
      eventSources: baseSources,
      answerSuffix: null,
    };
  }

  const primary = campusRelevant[0];
  const extra = campusRelevant.slice(1, 3);
  const locationLabel = primary.location ?? primary.facilityTitle;
  const snippetParts = [
    `${primary.title}${locationLabel ? ` — ${locationLabel}` : ""}`,
    ...extra.map((e) => {
      const lab = e.location ?? e.facilityTitle;
      return lab ? `${e.title} — ${lab}` : e.title;
    }),
  ];
  const snippet = snippetParts.join("; ");

  const advisory =
    "There appears to be a Marist athletics event around that time on the official composite schedule, so parking may be busier than usual. " +
    `Listed event(s): ${snippet}. This is advisory only and does not describe specific lot closures or parking rules.`;

  return {
    lookupAttempted: true,
    lookupOk: true,
    lastCheckedAt: lookup.lastCheckedAt,
    eventSignalFound: true,
    eventTitle: primary.title,
    eventTime: primary.startAtIso,
    eventSnippet: snippet,
    eventImpactNote: advisory,
    eventSources: baseSources,
    answerSuffix: advisory,
  };
}

/**
 * Best-effort warm of the current calendar month (non-fatal).
 */
export async function warmAthleticsScheduleCache(): Promise<void> {
  try {
    await loadMonthDays(firstOfMonth(new Date()));
    console.log("[athletics] warmAthleticsScheduleCache ok");
  } catch (error) {
    console.warn("[athletics] warmAthleticsScheduleCache failed (non-fatal)", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
