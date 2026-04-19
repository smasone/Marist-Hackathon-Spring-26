# Marist-Hackathon-Spring-26

## Team
Sophia Masone  
Joanna Picciano  
Lena Ishimwe  

## Project concept

This project is a smart campus parking helper designed to make parking decisions easier for students, faculty, and visitors. Its main goal is to turn parking occupancy data into useful guidance by tracking lot activity over time, storing it in a database, and using it to show current conditions, historical trends, and better parking recommendations.  

A key part of the long-term vision is using AI in a grounded, data-aware way. Rather than letting an AI model generate parking answers on its own, the system is intended to grow toward a retrieval-augmented generation (RAG) approach, where responses are based on real parking records, policy information, and other trusted sources. This helps reduce hallucinations and prevents the system from inventing parking history, availability patterns, or permit information.  

In that sense, the project is meant to be more than a parking dashboard or a generic chatbot. The goal is to combine stored data, historical context, and AI-based question answering into a tool that can provide useful, trustworthy parking guidance, even if the full vision is not yet implemented.   

## Backend

The TypeScript/Postgres backend lives in **`server/`**.

- **Setup, env vars, database commands, and API / Swagger (`/api-docs`):** see **[server/README.md](server/README.md)**.
- **API tests:** from **`server/`**, run **`npm test`** (needs **`DATABASE_URL`** + **`npm run seed-db`** — details in `server/README.md`).

## Frontend

The Vite + React UI lives in **`frontend/`**.

- **Run:** `cd frontend && npm install && npm run dev` (with the backend running; Vite proxies **`/api`** to port **3001** by default).
- **Env:** optional **`VITE_API_BASE_URL`** — see **`frontend/.env.example`** and **`frontend/README.md`**.

## Data sources: what is demo vs official

Most of the parking **occupancy**, **lot list**, **busy-before-9**, and **recommendation** behavior in this project uses **demo / seeded data** in Postgres (see **`server/README.md`** and the seed script). That data is useful for the hackathon and for tests, but it is **not** live campus instrumentation.

**Parking permits, fees, shuttle, and written parking policies** for the Ask feature are grounded in a **real, official** public source: Marist’s **[Parking FAQ](https://www.marist.edu/security/parking/faq)**. The backend downloads that page (on demand and on server start), stores a simplified plain-text cache under `server/data/` (see `officialParkingRulesService`), and answers matching “rules / permit” style questions only from retrieved FAQ excerpts. Optional OpenAI wording still must stay within those excerpts.

**Important:** Always treat occupancy charts and “best lot” suggestions as **demo-backed**, and double-check any **policy or fee** answer on the live FAQ or Marist Parking pages if the stakes are high.

A concise engineering summary also lives in **`design-docs/design-doc-current-build.md`**.
