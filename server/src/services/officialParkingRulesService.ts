/**
 * Lightweight official parking rules text from Marist's public Parking FAQ.
 * Separate from DB occupancy analytics — used only for permit / policy style questions.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Canonical public FAQ URL (human-readable source of truth). */
export const OFFICIAL_MARIST_PARKING_FAQ_URL =
  "https://www.marist.edu/security/parking/faq";

export const OFFICIAL_PARKING_FAQ_PAGE_TITLE = "Marist University — Parking FAQ";

const CACHE_FILENAME = "marist-parking-faq-cache.json";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

interface DiskCacheShape {
  fetchedAt: string;
  plainText: string;
}

let memoryCache: { fetchedAt: number; plainText: string } | null = null;

function cacheFilePath(): string {
  return path.join(process.cwd(), "data", CACHE_FILENAME);
}

/**
 * Heuristic: permit / policy / shuttle / enforcement questions → official FAQ path.
 * Checked before the generic "list" / "which lot" ask routes so phrases like
 * "which lots need a permit" do not get misclassified as a DB lot list.
 */
export function isParkingRulesOrPermitQuestion(normalizedQuestion: string): boolean {
  const q = normalizedQuestion;
  const hints = [
    "permit",
    "decal",
    "hangtag",
    "hang tag",
    "parking fee",
    "parking pass",
    "parking policy",
    "parking rules",
    "parking rule",
    "policy",
    "regulations",
    "citation",
    "violation",
    "enforcement",
    "fine",
    "tow",
    "overnight",
    "guest pass",
    "visitor pass",
    "allowed to park",
    "where can i park",
    "where may i park",
    "vehicle registration",
    "accessible parking",
    "handicap",
    "shuttle",
    "marist id",
    "faculty/staff",
    "off-peak",
    "4:30",
    "byrne house",
    "kieran",
    "commuter students",
    "residential students",
    "designated parking",
    "apply for",
    "parking website",
    "faq",
    "rules for",
    "rules about",
    "need a permit",
    "need permit",
    "get a permit",
    "get permit",
  ];
  if (hints.some((h) => q.includes(h))) {
    return true;
  }
  return q.includes("rules") && q.includes("parking");
}

/**
 * Strips HTML to plain text (no cheerio — keeps dependencies minimal).
 */
export function htmlToPlainText(html: string): string {
  let s = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  s = s.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr)\s*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/&amp;/gi, "&");
  s = s.replace(/&lt;/gi, "<");
  s = s.replace(/&gt;/gi, ">");
  s = s.replace(/&#(\d+);/g, (_, n: string) => {
    const code = Number(n);
    return Number.isFinite(code) ? String.fromCharCode(code) : "";
  });
  s = s.replace(/\s+/g, " ");
  s = s.replace(/\n\s*\n/g, "\n\n");
  return s.trim();
}

async function readDiskCache(): Promise<DiskCacheShape | null> {
  try {
    const raw = await fs.readFile(cacheFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as DiskCacheShape).plainText !== "string" ||
      typeof (parsed as DiskCacheShape).fetchedAt !== "string"
    ) {
      return null;
    }
    return parsed as DiskCacheShape;
  } catch {
    return null;
  }
}

async function writeDiskCache(payload: DiskCacheShape): Promise<void> {
  const dir = path.dirname(cacheFilePath());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cacheFilePath(), JSON.stringify(payload, null, 2), "utf8");
}

async function fetchFaqHtml(): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(OFFICIAL_MARIST_PARKING_FAQ_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "MaristHackathonParkingApp/1.0 (+educational demo; FAQ cache)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export interface OfficialFaqLoadResult {
  ok: boolean;
  plainText: string | null;
  /** When the text we are using was last successfully fetched from the network. */
  lastFetchedAt: Date | null;
  /** True when live fetch failed but an on-disk snapshot was used. */
  servedFromStaleDiskCache: boolean;
  errorMessage?: string;
}

/**
 * Returns cached FAQ plain text, refreshing from the network when stale or missing.
 * On fetch failure, falls back to the last good on-disk cache (any age) when present.
 */
export async function loadOfficialParkingFaqText(): Promise<OfficialFaqLoadResult> {
  const now = Date.now();
  if (
    memoryCache &&
    now - memoryCache.fetchedAt < REFRESH_INTERVAL_MS &&
    memoryCache.plainText.length > 0
  ) {
    console.log("[faq] loadOfficialParkingFaqText: memory cache hit", {
      plainTextChars: memoryCache.plainText.length,
      ageMs: now - memoryCache.fetchedAt,
    });
    return {
      ok: true,
      plainText: memoryCache.plainText,
      lastFetchedAt: new Date(memoryCache.fetchedAt),
      servedFromStaleDiskCache: false,
    };
  }

  console.log("[faq] loadOfficialParkingFaqText: fetching", {
    url: OFFICIAL_MARIST_PARKING_FAQ_URL,
  });

  try {
    const t0 = performance.now();
    const html = await fetchFaqHtml();
    const fetchMs = Math.round(performance.now() - t0);
    const plainText = htmlToPlainText(html);
    if (plainText.length < 80) {
      throw new Error("Extracted FAQ text unexpectedly short");
    }
    const fetchedAt = Date.now();
    memoryCache = { plainText, fetchedAt };
    await writeDiskCache({
      plainText,
      fetchedAt: new Date(fetchedAt).toISOString(),
    });
    console.log("[faq] loadOfficialParkingFaqText: network ok", {
      htmlChars: html.length,
      plainTextChars: plainText.length,
      fetchMs,
    });
    return {
      ok: true,
      plainText,
      lastFetchedAt: new Date(fetchedAt),
      servedFromStaleDiskCache: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[faq] loadOfficialParkingFaqText: fetch failed", { message });

    const disk = await readDiskCache();
    if (disk && disk.plainText.length >= 80) {
      const fetchedDate = new Date(disk.fetchedAt);
      // Treat TTL as expired so the next request tries the network again soon.
      memoryCache = {
        plainText: disk.plainText,
        fetchedAt: Date.now() - REFRESH_INTERVAL_MS,
      };
      console.warn("[faq] loadOfficialParkingFaqText: using stale disk cache", {
        diskFetchedAt: disk.fetchedAt,
        plainTextChars: disk.plainText.length,
        error: message,
      });
      return {
        ok: true,
        plainText: disk.plainText,
        lastFetchedAt: fetchedDate,
        servedFromStaleDiskCache: true,
        errorMessage: message,
      };
    }

    console.error("[faq] loadOfficialParkingFaqText: no usable cache", {
      message,
    });
    return {
      ok: false,
      plainText: null,
      lastFetchedAt: null,
      servedFromStaleDiskCache: false,
      errorMessage: message,
    };
  }
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "as",
  "or",
  "and",
  "but",
  "if",
  "what",
  "when",
  "where",
  "who",
  "why",
  "how",
  "this",
  "that",
  "these",
  "those",
  "i",
  "my",
  "me",
  "we",
  "our",
  "you",
  "your",
  "it",
  "its",
  "there",
  "their",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "up",
  "out",
  "off",
  "over",
  "under",
  "again",
  "then",
  "once",
  "here",
  "parking",
  "park",
  "marist",
  "student",
  "students",
]);

/**
 * Splits FAQ body into coarse paragraphs for keyword matching.
 */
function splitIntoParagraphs(plainText: string): string[] {
  const chunks = plainText.split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim());
  return chunks.filter((c) => c.length > 40);
}

/**
 * Picks a few FAQ paragraphs that overlap the question tokens (simple grounding).
 * Returns empty when nothing matches strongly enough — caller must use safe fallback.
 */
export function selectFaqExcerptsForQuestion(
  normalizedQuestion: string,
  plainText: string,
  maxExcerpts: number = 3,
  maxTotalChars: number = 4000
): string[] {
  const paras = splitIntoParagraphs(plainText);
  if (paras.length === 0) {
    return [];
  }

  const rawTokens = normalizedQuestion
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));

  const tokens = [...new Set(rawTokens)];
  if (tokens.length === 0) {
    return [];
  }

  const scored = paras.map((para, idx) => {
    const p = para.toLowerCase();
    let score = 0;
    for (const tok of tokens) {
      if (p.includes(tok)) {
        score += tok.length >= 5 ? 3 : 2;
      }
    }
    return { idx, para, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 2) {
    return [];
  }

  const out: string[] = [];
  let total = 0;
  for (const row of scored) {
    if (row.score < 2) {
      break;
    }
    if (out.length >= maxExcerpts) {
      break;
    }
    if (out.includes(row.para)) {
      continue;
    }
    if (total + row.para.length > maxTotalChars) {
      break;
    }
    out.push(row.para);
    total += row.para.length;
  }
  return out;
}

/**
 * Non-blocking warm on server start (best-effort).
 */
export async function warmOfficialParkingFaqCache(): Promise<void> {
  console.log("[faq] warmOfficialParkingFaqCache: start");
  const r = await loadOfficialParkingFaqText();
  console.log("[faq] warmOfficialParkingFaqCache: done", {
    ok: r.ok,
    plainTextChars: r.plainText?.length ?? 0,
    servedFromStaleDiskCache: r.servedFromStaleDiskCache,
  });
}
