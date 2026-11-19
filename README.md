# ZONM NET

Stylometric Authorship Attribution Platform for Seychelles — Kreol Seselwa, English, French and code-mixed text.

## Repository layout

```
apps/web/          Next.js (React, TypeScript, Tailwind) — UI, auth, case management, API, job orchestration
services/engine/   Python 3.11 FastAPI — preprocessing, language ID, stylometry, ML, XAI, validation
infra/             docker-compose for local PostgreSQL 16 + Redis 7 (later: Nginx, production compose)
docs/              Architecture, build plan, decisions
```

## Local development

Prerequisites: Node 20+, Python 3.11, PostgreSQL 16, Redis 7 (via Docker or native install).

```bash
# infrastructure
docker compose -f infra/docker-compose.yml up -d

# analysis engine
cd services/engine
python -m venv .venv && .venv/Scripts/activate   # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# web app
cd apps/web
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in values.

See [docs/PLAN.md](docs/PLAN.md) for the build plan.
