# Marist-Hackathon-Spring-26

Hackathon workspace.

## Backend

The TypeScript/Postgres backend lives in **`server/`**.

- **Setup, env vars, database commands, and API / Swagger (`/api-docs`):** see **[server/README.md](server/README.md)**.
- **API tests:** from **`server/`**, run **`npm test`** (needs **`DATABASE_URL`** + **`npm run seed-db`** — details in `server/README.md`).

## Frontend

The Vite + React UI lives in **`frontend/`**.

- **Run:** `cd frontend && npm install && npm run dev` (with the backend running; Vite proxies **`/api`** to port **3001** by default).
- **Env:** optional **`VITE_API_BASE_URL`** — see **`frontend/.env.example`** and **`frontend/README.md`**.
