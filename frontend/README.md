# Frontend (React + TypeScript + Vite)

Parking UI for the Marist hackathon project.

## Prerequisites

- Node.js (LTS recommended) and npm
- Backend API running from `server/` (default: `http://127.0.0.1:3001`)

## Install and run

From `frontend/`:

```bash
npm install
npm run dev
```

## Environment

Copy `.env.example` to `.env` only if you need to call the API directly by origin (for example, when not using Vite proxy):

```bash
cp .env.example .env
```

- `VITE_API_BASE_URL` is optional.
- If unset, the app uses same-origin `/api/...` paths.

## API routing behavior

- During `npm run dev`, Vite proxies `/api/*` to `http://127.0.0.1:3001`.
- During `npm run preview`, the same `/api` proxy is configured.
- When `VITE_API_BASE_URL` is set, requests go directly to that origin instead.

## Useful commands

```bash
npm run dev
npm run build
npm run preview
npm run lint
```
