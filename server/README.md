# Backend (TypeScript + Postgres)

Small Node backend for the parking app. It uses **Neon** (or any Postgres) with the **`pg`** driver—no ORM.

## Prerequisites

- **Node.js** (LTS recommended) and **npm**
- A **Postgres** connection string (e.g. from [Neon](https://neon.tech))
- **`psql`** on your PATH (used by `npm run db:init` to apply `src/db/schema.sql`)

## Install

From the `server/` directory:

```bash
cd server
npm install
```

## Environment

1. Copy the example env file (repo includes **`.env.example`**):

   ```bash
   cp .env.example .env
   ```

2. Edit **`.env`** and set **`DATABASE_URL`** to your database URL (include `sslmode=require` if your host needs TLS).

**Do not commit `.env`** or real credentials. They are listed in `.gitignore`.

## Database setup (order)

Run these from **`server/`** with `DATABASE_URL` set in `.env`:

```bash
npm run db:init
npm run seed-db
npm run test-db
```

| Script        | What it does |
|---------------|----------------|
| `db:init`     | Creates tables from `src/db/schema.sql` (via `psql`). |
| `seed-db`     | Inserts demo lots and sample `spaces`/`history` rows for local demos and tests (including alt codes `DEMO-N-01`, `DEMO-S-02`, `DEMO-E-03`). |
| `test-db`     | Runs `SELECT NOW()` to verify the connection. |

## Seed data purpose

The seed script adds fake but deterministic rows so you can run queries and demos without real campus data. Replace or extend seed data as your schema grows.

## Automated API tests (Jest + supertest)

From **`server/`**, with **`DATABASE_URL`** in **`.env`** and demo data seeded (`npm run seed-db`):

```bash
npm test
```

- The Express app is built in **`src/app.ts`** and imported by **`src/index.ts`** (listen only) so tests can hit routes **without** opening a listening port.
- Tests call the **real** read-only handlers and Postgres (same as local dev). They expect seeded demo lots to exist (alt codes include **`DEMO-N-01`**, **`DEMO-S-02`**, **`DEMO-E-03`**).

## HTTP API

Entry point: **`src/index.ts`** (starts the server); routes live in **`src/app.ts`**. Requires **`DATABASE_URL`** in `.env` (the app loads DB config on startup).

```bash
npm run dev         # Watch mode (recommended while coding)
# or
npm run start       # Run once with tsx
```

| URL | Description |
|-----|-------------|
| [http://localhost:3001/health](http://localhost:3001/health) | Liveness JSON (`{ "status": "ok" }`). Port follows `PORT` or defaults to **3001** (see `src/config/env.ts`). |
| [http://localhost:3001/api/parking/summary](http://localhost:3001/api/parking/summary) | Forecasted lot busyness from historical snapshots. Optional query params: `hour` (0-23) and `dayOfWeek` (0=Sun..6=Sat). |
| [http://localhost:3001/api/parking/busy-before-nine](http://localhost:3001/api/parking/busy-before-nine) | Lots with high average occupancy before 9:00 (query: `?threshold=90`). |
| [http://localhost:3001/api/parking/lots](http://localhost:3001/api/parking/lots) | All rows from `lots` (with API-facing lot code/name/zone mapping). |
| [http://localhost:3001/api/parking/snapshots/latest](http://localhost:3001/api/parking/snapshots/latest) | Latest history-derived snapshot row per lot. |
| [http://localhost:3001/api/parking/lots/DEMO-N-01](http://localhost:3001/api/parking/lots/DEMO-N-01) | One lot by API lot code (`altname` when present, otherwise `lotid`), with latest derived snapshot or `null`. |
| `POST /api/parking/ask` | Ask routing: **forecast-style** questions (recommendation, busy-before-9, lot list) from historical Postgres snapshots; **permit/rules** questions from cached plain text of the [official Marist Parking FAQ](https://www.marist.edu/security/parking/faq) (see `src/services/officialParkingRulesService.ts`); **time-shaped** parking questions may also attach **advisory** metadata from the [official Marist athletics composite schedule](https://goredfoxes.com/calendar) via `src/services/maristAthleticsScheduleService.ts` (does not replace SQL recommendations). |
| [http://localhost:3001/api-docs](http://localhost:3001/api-docs) | **Swagger UI** for all routes. |

Quick checks with **curl** (use your real port if you changed `PORT`):

```bash
curl -s http://localhost:3001/health
curl -s http://localhost:3001/api/parking/summary
curl -s "http://localhost:3001/api/parking/busy-before-nine?threshold=85"
curl -s http://localhost:3001/api/parking/lots
curl -s http://localhost:3001/api/parking/snapshots/latest
curl -s http://localhost:3001/api/parking/lots/DEMO-N-01
curl -s -X POST http://localhost:3001/api/parking/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"which faculty lot is usually best around 11am?"}'
curl -s -X POST http://localhost:3001/api/parking/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"How do student parking permits work?"}'
```

**Do not commit `.env`** or real credentials.

## Official parking FAQ cache (rules / permits)

The server may write **`server/data/marist-parking-faq-cache.json`** after a successful fetch of the public Marist Parking FAQ (plain-text extraction for Ask). That file is **gitignored**; `server/data/.gitkeep` keeps the folder in the repo. On startup, the server attempts a best-effort warm of this cache (non-fatal if the network is down).

## Official athletics schedule cache (Ask advisory only)

For time- or future-shaped **parking** questions, Ask may call the official Sidearm JSON calendar used by **`https://goredfoxes.com/calendar`**. Successful month payloads may be cached under **`server/data/marist-athletics-schedule-cache.json`** (also **gitignored**). Startup runs a non-fatal warm fetch for the current month alongside the FAQ warm.

## Useful commands

```bash
npm test            # Jest + supertest API tests (needs DATABASE_URL + seed; see above)
npm run typecheck   # TypeScript check without emitting files
npm run build       # Compile to dist/
npm run start:dist  # Run compiled output from dist/ (after build)
```

Jest is configured with **`forceExit: true`** so the process exits reliably after closing the `pg` pool (some driver timers can otherwise keep Node alive briefly).
