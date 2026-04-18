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
| `seed-db`     | Inserts demo lots `DEMO-N-01`, `DEMO-S-02`, `DEMO-E-03` and sample `parking_snapshots` rows for local demos and tests. Safe to re-run for those codes only. |
| `test-db`     | Runs `SELECT NOW()` to verify the connection. |

## Seed data purpose

The seed script adds fake but deterministic rows so you can run queries and demos without real campus data. Replace or extend seed data as your schema grows.

## Automated API tests (Jest + supertest)

From **`server/`**, with **`DATABASE_URL`** in **`.env`** and demo data seeded (`npm run seed-db`):

```bash
npm test
```

- The Express app is built in **`src/app.ts`** and imported by **`src/index.ts`** (listen only) so tests can hit routes **without** opening a listening port.
- Tests call the **real** read-only handlers and Postgres (same as local dev). They expect the seeded lot codes **`DEMO-N-01`**, **`DEMO-S-02`**, and **`DEMO-E-03`** to exist.

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
| [http://localhost:3001/api/parking/summary](http://localhost:3001/api/parking/summary) | Latest snapshot per lot (joins `parking_lots` + `parking_snapshots`; same idea as the seeded demo data). |
| [http://localhost:3001/api/parking/busy-before-nine](http://localhost:3001/api/parking/busy-before-nine) | Lots with high average occupancy before 9:00 (query: `?threshold=90`). |
| [http://localhost:3001/api/parking/lots](http://localhost:3001/api/parking/lots) | All rows from `parking_lots` (`id`, codes, names, zone). |
| [http://localhost:3001/api/parking/snapshots/latest](http://localhost:3001/api/parking/snapshots/latest) | Latest `parking_snapshots` row per `lot_id` (raw snapshot columns). |
| [http://localhost:3001/api/parking/lots/DEMO-N-01](http://localhost:3001/api/parking/lots/DEMO-N-01) | One lot by `lot_code`, with its latest snapshot object or `null`. |
| `POST /api/parking/ask` | Supported "Ask the AI" parking questions answered from live DB data only (recommendation, busy-before-9, lot list). |
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
  -d '{"question":"best faculty lot right now"}'
```

**Do not commit `.env`** or real credentials.

## Useful commands

```bash
npm test            # Jest + supertest API tests (needs DATABASE_URL + seed; see above)
npm run typecheck   # TypeScript check without emitting files
npm run build       # Compile to dist/
npm run start:dist  # Run compiled output from dist/ (after build)
```

Jest is configured with **`forceExit: true`** so the process exits reliably after closing the `pg` pool (some driver timers can otherwise keep Node alive briefly).
