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
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return "";
  }
  return String(raw).replace(TRAILING_SLASH, "");
}

/** One row from `GET /api/parking/summary` (matches backend JSON field names). */
export interface ParkingLotSummary {
  lotCode: string;
  lotName: string;
  zoneType: string;
  occupancyPercent: number | null;
  latestSnapshotTime: string | null;
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
