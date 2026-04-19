# Marist-Hackathon-Spring-26

## Team
Sophia Masone  
Joanna Picciano  
Lena Ishimwe  

## Project concept

This project is a smart campus parking helper designed to make parking decisions easier for students, faculty, and visitors. The idea is to collect and store parking lot occupancy data over time, use that data to show current and historical parking conditions, and provide recommendations for where to park based on availability patterns. We also planned an AI assistant layer that can answer parking-related questions by referencing the tracked data, helping users ask things in plain language instead of only clicking through dashboards or lists.  

## Backend

The TypeScript/Postgres backend lives in **`server/`**.

- **Setup, env vars, database commands, and API / Swagger (`/api-docs`):** see **[server/README.md](server/README.md)**.
- **API tests:** from **`server/`**, run **`npm test`** (needs **`DATABASE_URL`** + **`npm run seed-db`** — details in `server/README.md`).

## Frontend

The Vite + React UI lives in **`frontend/`**.

- **Run:** `cd frontend && npm install && npm run dev` (with the backend running; Vite proxies **`/api`** to port **3001** by default).
- **Env:** optional **`VITE_API_BASE_URL`** — see **`frontend/.env.example`** and **`frontend/README.md`**.
