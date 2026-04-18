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

1. Copy the example env file:

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

## HTTP API

Entry point: **`src/index.ts`**. Requires **`DATABASE_URL`** in `.env` (the app loads DB config on startup).

```bash
npm run dev         # Watch mode (recommended while coding)
# or
npm run start       # Run once with tsx
```

| URL | Description |
|-----|-------------|
| [http://localhost:3001/health](http://localhost:3001/health) | Liveness JSON (`{ "status": "ok" }`). Port follows `PORT` or defaults to **3001** (see `src/config/env.ts`). |
| [http://localhost:3001/api/parking/summary](http://localhost:3001/api/parking/summary) | Latest snapshot per lot (seed data after `npm run seed-db`). |
| [http://localhost:3001/api-docs](http://localhost:3001/api-docs) | **Swagger UI** for the routes above. |

Quick checks with **curl** (use your real port if you changed `PORT`):

```bash
curl -s http://localhost:3001/health
curl -s http://localhost:3001/api/parking/summary
```

**Do not commit `.env`** or real credentials.

## Useful commands

```bash
npm run typecheck   # TypeScript check without emitting files
npm run build       # Compile to dist/
npm run start:dist  # Run compiled output from dist/ (after build)
```
