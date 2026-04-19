# Design doc — current build (Spring ’26 hackathon)

This document tracks what the repository **actually implements** today. Update it when behavior or data sources change in a material way.

## Parking occupancy and analytics

- **Source:** Postgres tables `parking_lots` and `parking_snapshots`, populated for demos via **`npm run seed-db`** (deterministic demo lot codes such as `DEMO-N-01`, etc.).
- **Nature of data:** Demo / mock-style occupancy for hackathon use — **not** live campus telemetry.
- **APIs:** Summary, busy-before-9, lot list, per-lot detail, and recommendation-style logic read **only** from this database layer (`ParkingAnalyticsService`).

## “Ask the AI” (`POST /api/parking/ask`)

- **Occupancy / lots / trends:** Questions are keyword-routed to the same SQL-backed analytics as above. Optional OpenAI phrasing (`OPENAI_API_KEY`) may reword answers but facts come from query results.
- **Permits / rules / policy:** Questions matching a lightweight rules detector are answered from **cached plain text** of Marist’s official public page: [Parking FAQ](https://www.marist.edu/security/parking/faq). The backend fetches HTML, strips tags to plain text, caches in memory and under `server/data/marist-parking-faq-cache.json` (gitignored). Relevant paragraphs are selected by simple token overlap; the model (if configured) must not invent beyond those excerpts.
- **Athletics advisory (separate source):** When a question is time- or future-shaped (simple heuristics in `questionTimeHeuristics.ts`), the handler may call Marist’s official athletics composite schedule JSON (`goredfoxes.com` Sidearm `responsive-calendar.ashx`, same feed as [the calendar page](https://goredfoxes.com/calendar)), match events near the inferred instant (±4 hours), then **filter** to events that look home/on-campus-relevant (`isAthleticsEventLikelyCampusParkingRelevant` in `maristAthleticsScheduleService.ts` — away/`at` games and obvious opponent-campus locations are dropped). Only passing events get deterministic advisory text and metadata (`eventSignalFound`, `eventImpactNote`, etc.). This **never** replaces the SQL recommendation; failures are non-fatal and may append a short “could not verify athletics events” note only when a lookup was attempted.
- **Time-shaped parking without recommend keywords:** Questions that mention parking and a time/date but do not match the FAQ detector may be answered like a recommendation (same `ParkingAnalyticsService.getRecommendation` path) with the same demo-data timeliness disclaimer when applicable.
- **Unsupported:** Safe generic fallback when no route matches.

### Ask response metadata (rules intent)

For intent `parking_rules_faq`, responses include `sourceType`, `sourceTitle`, `sourceUrl`, `lastCheckedAt`, `sources`, `note`, and `data.matchedFaqExcerpts` for transparency.

### Ask response metadata (athletics advisory)

For occupancy intents when a schedule lookup runs, responses may add `sourceType: official_athletics_schedule`, `sourceUrl` (composite calendar), `lastCheckedAt`, `eventSignalFound`, `eventImpactNote`, `eventSnippet`, `eventTitle`, `eventTime`, and `eventSources`. These fields are absent when the question is not treated as time-shaped for athletics purposes.

## Limitations (explicit)

- Demo occupancy data does not reflect real-time campus availability.
- FAQ answers depend on fetch success, cache age, and excerpt matching; users should **verify** critical policy details on the live Marist site.
- Athletics matching uses naive time parsing and a fixed ±4 hour window; it can miss events, mis-parse ambiguous phrases, or reference the host’s local timezone assumptions—treat any note as **non-authoritative** for parking operations. Home vs away detection is heuristic (Sidearm `location_indicator` / `at_vs` when present, else title/location keywords); edge cases may still slip through.
- HTML-to-text is intentionally simple (no full browser DOM); edge-case formatting may be imperfect.

## Related files

- Routes / OpenAPI comments: `server/src/app.ts`
- DB analytics: `server/src/services/parkingAnalyticsService.ts`
- Official FAQ cache: `server/src/services/officialParkingRulesService.ts`
- Official athletics schedule (advisory): `server/src/services/maristAthleticsScheduleService.ts`
- Ask time heuristics: `server/src/services/questionTimeHeuristics.ts`
- Optional LLM phrasing: `server/src/services/openAiService.ts`
- FAQ warm on startup: `server/src/index.ts`
