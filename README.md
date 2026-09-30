# URL Shortner

A URL shortener with custom aliases, link expiry, editing, QR codes and per-link delete tokens. There are no accounts: whoever creates a link gets a secret token, kept in their browser, that lets them edit or delete it.

## Features

- Shorten any http(s) URL, with an optional custom alias (`3–20` chars of `A-Za-z0-9_-`)
- Optional expiry (presets or a custom date/time); expired links stop redirecting and can be revived by editing
- Edit a link's destination or expiry, or delete it, using its delete token
- QR code for every link, downloadable as PNG
- Click counting on redirect, plus a read-only stats endpoint
- Rate limiting on create/modify requests
- Light, dark and system themes

## Stack

| Part | Tech |
| --- | --- |
| Backend (`backend/`) | FastAPI, SQLAlchemy, Alembic, PostgreSQL, managed with `uv` (Python 3.14) |
| Frontend (`frontend/`) | Next.js 16 (App Router), React, Tailwind CSS, shadcn/ui |
| Tests | pytest · Vitest + React Testing Library · Playwright (e2e) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

## How it fits together

```
Browser ──► Next.js (public) ──/api/*──► FastAPI (private) ──► PostgreSQL
```

The browser never talks to the backend directly. The Next.js app proxies `/api/*` to the backend at `BACKEND_INTERNAL_URL`, so in production the backend only needs to be reachable on a private network. The proxy also enforces the rate limits, since the backend only ever sees the proxy's IP.

### Delete tokens

Creating a link returns a one-time `delete_token`. The backend stores only its SHA-256 hash; the frontend keeps the token in `localStorage`. `PATCH` and `DELETE` require it in the `X-Delete-Token` header. If the token is lost (cleared browser data, another device), the link can no longer be edited or deleted. Links without a token appear as read-only in the UI.

## Getting started

Prerequisites: [uv](https://docs.astral.sh/uv/), Node.js 20+, and a PostgreSQL database.

### Backend

```bash
cd backend
uv sync
```

Create `backend/.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/url_shortner
ORIGIN=http://localhost:3000
# ENVIRONMENT=production   # disables /docs and /redoc
```

Run migrations and start the server:

```bash
uv run alembic upgrade head
uv run fastapi dev app/main.py    # http://localhost:8000 (docs at /docs)
```

### Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```env
BACKEND_INTERNAL_URL=http://localhost:8000
```

```bash
npm run dev    # http://localhost:3000
```

## API

All routes live under `/api/v1/url`.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/v1/url` | Create a link (`url`, optional `alias`, optional `expiry`). Returns `delete_token` once. |
| `GET` | `/api/v1/url/{code}` | Resolve a link and count a click |
| `GET` | `/api/v1/url/stats/{code}` | Link stats, without counting a click |
| `PATCH` | `/api/v1/url/{code}` | Edit `url` and/or `expiry`. Requires `X-Delete-Token` |
| `DELETE` | `/api/v1/url/{code}` | Delete a link. Requires `X-Delete-Token` |

Notable responses: `409` for a URL that was already shortened, or `{"error": "alias_taken"}` for a taken alias; `403` for a missing or wrong delete token; `429` (from the frontend proxy) when rate limited.

## Testing

```bash
# backend
cd backend && uv run pytest

# frontend
cd frontend
npm run lint
npm run test        # Vitest unit/component tests
npm run test:e2e    # Playwright; starts a real backend on a throwaway SQLite DB
```

CI runs all of the above on every push and pull request.

## Deployment

Frontend and backend deploy as two separate apps. Only the frontend is public; the backend is reached over a private network via `BACKEND_INTERNAL_URL`.

- Backend start command: `uv run uvicorn app.main:app` (from `backend/`). Set `DATABASE_URL`, `ORIGIN` and `ENVIRONMENT=production`.
- Run `uv run alembic upgrade head` before or with each backend deploy that includes a migration.
- Deploy the backend before (or together with) the frontend when the API response shape changes.
- Optional frontend env vars: `RATE_LIMIT_CREATE_PER_MINUTE` and `RATE_LIMIT_MODIFY_PER_MINUTE` override the default limits (10 and 30 per minute per client IP).

## Project layout

```
backend/
  app/
    core/database/        # engine, session, Base
    features/
      models|schemas|services|routes/url.py
  alembic/                # migrations
  tests/
frontend/
  app/                    # pages, [code] redirect route, /api proxy
  features/links/         # shorten form, links table, edit and QR dialogs
  components/ lib/ hooks/
  tests/ e2e/
```
