/**
 * Small helper for calling the parking HTTP API from the Vite dev app.
 *
 * - Leave **`VITE_API_BASE_URL` unset** (or empty) during local dev so requests use **same-origin**
 *   paths like `/api/...`. Vite proxies `/api` to the backend (see `vite.config.ts`).
 * - Set **`VITE_API_BASE_URL`** (no trailing slash) when the UI is served separately from the API,
 *   e.g. `https://your-api.example.com`.
 */
const TRAILING_SLASH = /\/$/;

/**
 * Normalized API origin with no trailing slash, or empty string for same-origin + dev proxy.
 */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (raw === undefined || raw === null) {
    return "";
  }
  const s = String(raw).trim();
  if (s === "" || s === "undefined" || s === "null") {
    return "";
  }
  return s.replace(TRAILING_SLASH, "");
}

/** One row from `GET /api/parking/summary` (matches backend JSON field names). */
export interface ParkingLotSummary {
  lotCode: string;
  lotName: string;
  zoneType: string;
  occupancyPercent: number | null;
  latestSnapshotTime: string | null;
}

/** One row from `GET /api/parking/lots`. */
export interface ParkingLotListItem {
  id: number;
  lotCode: string;
  lotName: string;
  zoneType: string;
}

/** Optional citation when the answer comes from the official Marist Parking FAQ. */
export interface ParkingAskSourceRef {
  title: string;
  url: string;
}

/** JSON shape from `POST /api/parking/ask`. */
export interface ParkingAskResponse {
  intent: string;
  answer: string;
  data?: unknown;
  /** Present for `parking_rules_faq` intent. */
  sourceType?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  lastCheckedAt?: string | null;
  sources?: ParkingAskSourceRef[];
  note?: string;
  /** Optional official athletics schedule advisory (occupancy intents, time-shaped questions). */
  eventSignalFound?: boolean;
  eventImpactNote?: string | null;
  eventSnippet?: string | null;
  eventTitle?: string | null;
  eventTime?: string | null;
  eventSources?: ParkingAskSourceRef[];
}

/**
 * Fetches the latest snapshot summary for every lot in the database.
 *
 * @returns Parsed JSON array from the backend.
 * @throws On non-OK HTTP status or invalid JSON.
 */
export async function fetchParkingSummary(): Promise<ParkingLotSummary[]> {
  const base = getApiBaseUrl();
  const url = `${base}/api/parking/summary`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Request failed (${res.status} ${res.statusText})`);
  }

  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Expected a JSON array from /api/parking/summary");
  }

  return data as ParkingLotSummary[];
}

/**
 * Fetches lot metadata from the database-backed endpoint.
 */
export async function fetchParkingLots(): Promise<ParkingLotListItem[]> {
  const base = getApiBaseUrl();
  const url = `${base}/api/parking/lots`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status} ${res.statusText})`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Expected a JSON array from /api/parking/lots");
  }
  return data as ParkingLotListItem[];
}

/**
 * Sends one user question to the backend AI router.
 */
export async function askParking(question: string): Promise<ParkingAskResponse> {
  const base = getApiBaseUrl();
  const url = `${base}/api/parking/ask`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question }),
  });

  if (!res.ok) {
    throw new Error(`Request failed (${res.status} ${res.statusText})`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("Invalid JSON from /api/parking/ask (is the API URL correct?)");
  }
  if (typeof data !== "object" || data === null || !("intent" in data)) {
    throw new Error("Expected a JSON object with intent from /api/parking/ask");
  }
  const body = data as Record<string, unknown>;
  const intent = body.intent;
  if (typeof intent !== "string") {
    throw new Error("Expected intent string from /api/parking/ask");
  }
  const rawAnswer = body.answer;
  const answer =
    typeof rawAnswer === "string"
      ? rawAnswer
      : rawAnswer === null || rawAnswer === undefined
        ? ""
        : String(rawAnswer);
  return {
    ...(data as ParkingAskResponse),
    intent,
    answer,
  };
}
