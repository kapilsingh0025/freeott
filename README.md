# just99

just99 is a standalone Node.js web app with an Express API, a static frontend, and MongoDB storage.

## Requirements
- Node.js 18 or newer
- MongoDB (local or MongoDB Atlas)

## Setup
1. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`).
2. Replace all example values in `.env` with your own `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`. The app cannot log in or sign up until MongoDB is reachable. Never commit `.env`.
3. Install packages with `npm install`.

## Run locally
- `npm run dev` starts the app with automatic reloads.
- `npm run typecheck` checks the TypeScript sources.
- `npm run build` compiles the server to `dist/`.
- `npm start` runs the compiled production server.

The app listens on port `3000` by default. Set `PORT` and optionally `HOST` to change the bind address. `/health` provides a lightweight health check. The frontend is served from `public/`; API endpoints are served from `/api`.

## Project layout
```text
public/              Static frontend
src/
  database/          MongoDB connection and database definitions
  server/
    api.ts           Authentication, movie, and admin API
  server.ts          Express app, static hosting, and process lifecycle
dist/                Generated production build (not committed)
```

Collections used: `users`, `movies`, and `settings`.

Admins can add YouTube videos, direct video URLs, or regular `http`/`https` website links. YouTube thumbnails and public webpage preview images (`og:image`/Twitter image) are used automatically when no custom poster is uploaded; site icons are used if a webpage has no preview image. Websites that disallow embedding can still be opened directly from the player. Mark any number of movies as **Home content** to show them in the right-to-left homepage banner. Users can change their password from the header menu.
