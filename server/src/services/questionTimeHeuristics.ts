/**
 * Minimal date/time heuristics for Ask-the-AI athletics schedule lookups.
 * Interpretation uses the host system's local timezone (typical dev: US Eastern).
 */

const TIME_HINTS =
  /\b(tomorrow|today|tonight|yesterday|morning|afternoon|evening|noon|midnight|next week|this weekend|weekend)\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b|\b\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}\s*(a\.?m\.?|p\.?m\.?)\b|\b(at|around|by)\s+\d/i;

const FUTURE_CONDITION_HINTS =
  /\b(will|going to|gonna|might|may be|expect|forecast|busy|worse|bad|crazy|chaotic|packed|crowded)\b/i;

const RIGHT_NOW_HINTS =
  /\b(right now|currently|at the moment|this moment|snapshot|latest reading|as of now)\b/i;

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function nextWeekdayFrom(from: Date, targetDow: number): Date {
  const base = startOfLocalDay(from);
  const cur = base.getDay();
  let delta = (targetDow - cur + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  return addDays(base, delta);
}

function parseHourMinuteFromMatch(
  hourStr: string,
  minStr: string | undefined,
  ampm: string | undefined
): { hour: number; minute: number } | null {
  let hour = Number(hourStr);
  let minute = minStr !== undefined ? Number(minStr) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  minute = Math.min(59, Math.max(0, minute));
  const ap = ampm?.replace(/\./g, "").toLowerCase();
  if (ap === "pm" && hour < 12) {
    hour += 12;
  }
  if (ap === "am" && hour === 12) {
    hour = 0;
  }
  if (hour < 0 || hour > 23) {
    return null;
  }
  return { hour, minute };
}

/**
 * True when the question clearly references a calendar time, clock time, or
 * future/conditional campus conditions — used to optionally query athletics.
 */
export function shouldConsiderAthleticsSchedule(normalizedQuestion: string): boolean {
  if (TIME_HINTS.test(normalizedQuestion)) {
    return true;
  }
  if (FUTURE_CONDITION_HINTS.test(normalizedQuestion)) {
    return true;
  }
  return false;
}

/**
 * True for Ask questions about campus parking conditions (not permit-only trivia).
 */
export function mentionsCampusParkingContext(normalizedQuestion: string): boolean {
  const q = normalizedQuestion;
  return (
    q.includes("parking") ||
    q.includes(" lot") ||
    q.includes("lots ") ||
    q.startsWith("lots ") ||
    q.includes("campus") ||
    q.includes("commuter") ||
    q.includes("garage") ||
    q.includes("where to park") ||
    q.includes("find parking") ||
    q.includes("park on") ||
    q.includes("park at")
  );
}

/**
 * When true, occupancy answers should clarify that estimates are derived from
 * stored historical snapshots rather than a live parking feed.
 */
export function shouldAddDemoTimelinessDisclaimer(normalizedQuestion: string): boolean {
  if (RIGHT_NOW_HINTS.test(normalizedQuestion)) {
    return false;
  }
  if (TIME_HINTS.test(normalizedQuestion)) {
    return true;
  }
  if (FUTURE_CONDITION_HINTS.test(normalizedQuestion)) {
    return true;
  }
  return false;
}

export interface InferredQuestionInstant {
  /** Wall-clock instant in local timezone. */
  at: Date;
  /** "high" when an explicit clock time was parsed; "low" for vague buckets (evening). */
  confidence: "high" | "low";
}

/**
 * Best-effort parse of a single reference instant from free text.
 * Returns null when no reasonable date anchor exists.
 */
export function inferReferenceInstantFromQuestion(
  rawQuestion: string,
  now: Date = new Date()
): InferredQuestionInstant | null {
  const q = rawQuestion.trim();
  const lower = q.toLowerCase();

  let base = startOfLocalDay(now);
  let anchorFromWeekday = false;

  if (/\bday after tomorrow\b/i.test(lower)) {
    base = addDays(startOfLocalDay(now), 2);
  } else if (/\bnext week\b/i.test(lower)) {
    base = addDays(startOfLocalDay(now), 7);
  } else if (/\b(this weekend|weekend)\b/i.test(lower)) {
    const sat = 6;
    base = nextWeekdayFrom(now, sat);
  } else if (/\b tomorrow\b/i.test(lower) || lower.startsWith("tomorrow")) {
    base = addDays(startOfLocalDay(now), 1);
  } else if (/\b yesterday\b/i.test(lower)) {
    base = addDays(startOfLocalDay(now), -1);
  } else if (/\b today\b/i.test(lower) || /\b tonight\b/i.test(lower)) {
    base = startOfLocalDay(now);
  } else {
    let picked: Date | null = null;
    for (const [name, dow] of Object.entries(WEEKDAYS)) {
      if (lower.includes(name)) {
        picked = nextWeekdayFrom(now, dow);
        anchorFromWeekday = true;
        break;
      }
    }
    if (picked) {
      base = picked;
    } else {
      const md = lower.match(
        /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,\s*(\d{4}))?\b/
      );
      if (md) {
        const mon = MONTHS[md[1]];
        const day = Number(md[2]);
        const year = md[3] ? Number(md[3]) : now.getFullYear();
        if (Number.isFinite(mon) && Number.isFinite(day) && Number.isFinite(year)) {
          base = new Date(year, mon, day, 0, 0, 0, 0);
        }
      } else {
        const slash = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
        if (slash) {
          const m0 = Number(slash[1]);
          const d0 = Number(slash[2]);
          let y0 = slash[3] ? Number(slash[3]) : now.getFullYear();
          if (slash[3] && y0 < 100) {
            y0 += 2000;
          }
          if (Number.isFinite(m0) && Number.isFinite(d0) && Number.isFinite(y0)) {
            base = new Date(y0, m0 - 1, d0, 0, 0, 0, 0);
          }
        }
      }
    }
  }

  let hour = 12;
  let minute = 0;
  let confidence: "high" | "low" = "low";

  if (/\bnoon\b/i.test(lower)) {
    hour = 12;
    minute = 0;
    confidence = "high";
  } else if (/\bmidnight\b/i.test(lower)) {
    hour = 0;
    minute = 0;
    confidence = "high";
  }

  const hm = q.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (hm) {
    const parsed = parseHourMinuteFromMatch(hm[1], hm[2], hm[3]);
    if (parsed) {
      hour = parsed.hour;
      minute = parsed.minute;
      confidence = "high";
    }
  }

  if (!hm && /\b morning\b/i.test(lower)) {
    hour = 9;
    minute = 0;
    confidence = confidence === "high" ? "high" : "low";
  }
  if (!hm && /\b afternoon\b/i.test(lower)) {
    hour = 15;
    minute = 0;
    confidence = confidence === "high" ? "high" : "low";
  }
  if (!hm && /\b evening\b/i.test(lower)) {
    hour = 18;
    minute = 0;
    confidence = confidence === "high" ? "high" : "low";
  }
  if (!hm && /\b tonight\b/i.test(lower)) {
    hour = 19;
    minute = 0;
    confidence = "low";
  }

  const at = new Date(base);
  at.setHours(hour, minute, 0, 0);

  const usedExplicitCalendar =
    /\b(tomorrow|today|tonight|yesterday|day after tomorrow|next week|this weekend|weekend)\b/i.test(
      lower
    ) ||
    Object.keys(WEEKDAYS).some((d) => lower.includes(d)) ||
    Object.keys(MONTHS).some((m) => lower.includes(m)) ||
    /\b\d{1,2}\/\d{1,2}/.test(lower);

  if (!usedExplicitCalendar && !anchorFromWeekday) {
    const clockOnly = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.test(lower);
    if (!clockOnly) {
      if (!FUTURE_CONDITION_HINTS.test(lower)) {
        return null;
      }
      at.setTime(now.getTime());
      return { at, confidence: "low" };
    }
  }

  return { at, confidence };
}
