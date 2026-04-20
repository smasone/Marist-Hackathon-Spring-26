# Marist-Hackathon-Spring-26  
Created during the Marist Computer Society Spring 2026 48-Hour Hackathon.  

## Team
Sophia Masone  
Joanna Picciano  
Lena Ishimwe  

## Project concept

This project is a smart campus parking helper designed to make parking decisions easier for students, faculty, and visitors. Its main goal is to turn stored parking occupancy snapshots into useful forecast guidance by tracking lot activity over time, storing it in a database, and using historical patterns to estimate likely busyness and better parking recommendations.  

A key part of the long-term vision is using AI in a grounded, data-aware way. Rather than letting an AI model generate parking answers on its own, the system is intended to grow toward a retrieval-augmented generation (RAG) approach, where responses are based on real parking records, policy information, and other trusted sources. This helps reduce hallucinations and prevents the system from inventing parking history, availability patterns, or permit information.  

In that sense, the project is meant to be more than a parking dashboard or a generic chatbot. The goal is to combine stored data, historical context, and AI-based question answering into a tool that can provide useful, trustworthy parking guidance, even if the full vision is not yet implemented.   

## Tech Stack

- **Frontend:** React + TypeScript (Vite)
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL on Neon
- **API docs:** Swagger UI  
- **AI integration:** OpenAI API (retrieval-grounded responses)

## Quick Installation

```bash
# 1) Install dependencies
cd server && npm install
cd ../frontend && npm install

# 2) Configure env files
cd ../server && cp .env.example .env
cd ../frontend && cp .env.example .env

# 3) Initialize + seed database, then run backend
cd ../server && npm run db:init && npm run seed-db && npm run dev

# 4) In a second terminal, run frontend
cd ../frontend && npm run dev
```

## Backend

The TypeScript/Postgres backend lives in **`server/`**.

- **Setup, env vars, database commands, and API / Swagger (`/api-docs`):** see **[server/README.md](server/README.md)**.
- **API tests:** from **`server/`**, run **`npm test`** (needs **`DATABASE_URL`** + **`npm run seed-db`** — details in `server/README.md`).

## Frontend

The Vite + React UI lives in **`frontend/`**.

- **Run:** `cd frontend && npm install && npm run dev` (with the backend running; Vite proxies **`/api`** to port **3001** by default).
- **Env:** optional **`VITE_API_BASE_URL`** — see **`frontend/.env.example`** and **`frontend/README.md`**.

## Data sources: what is demo vs official

Most of the parking **occupancy forecast**, **lot list**, **busy-before-9**, and **recommendation** behavior in this project uses **demo / seeded historical data** in Postgres (see **`server/README.md`** and the seed script). That data is useful for the hackathon and for tests, but it is **not** live campus instrumentation.

**Parking permits, fees, shuttle, and written parking policies** for the Ask feature are grounded in a **real, official** public source: Marist’s **[Parking FAQ](https://www.marist.edu/security/parking/faq)**. The backend downloads that page (on demand and on server start), stores a simplified plain-text cache under `server/data/` (see `officialParkingRulesService`), and answers matching “rules / permit” style questions only from retrieved FAQ excerpts. Optional OpenAI wording still must stay within those excerpts.

**Athletics event awareness (Ask-the-AI only)** is a separate, lightweight advisory layer. For time- or future-shaped parking questions, the backend may read Marist’s official athletics **composite schedule** on **[goredfoxes.com](https://goredfoxes.com/calendar)** (JSON from the same official Sidearm endpoint the page uses). That signal only warns that **parking may be busier than usual** around a matched event window; it does **not** replace SQL-backed lot recommendations, does not assert lot closures or exact parking impact unless the athletics page explicitly did, and is ignored for permit-only FAQ routing.

**Important:** Always treat occupancy charts and “best lot” suggestions as **history-based forecasts**, and double-check any **policy or fee** answer on the live FAQ or Marist Parking pages if the stakes are high. Treat athletics-linked notes as **helpful context from a real schedule**, not a guarantee about campus parking operations.

A concise engineering summary also lives in **`design-docs/design-doc-current-build.md`**.

## AI Usage Disclosure  
The team uses AI tools, including Cursor & ChatGPT. Final implementation decisions and code-level acceptance remain team-reviewed. 