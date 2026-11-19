# ZONM NET — project context

A stylometric authorship attribution platform for a Seychelles client, covering Kreol Seselwa, English, French and code-mixed text. The full client specification has modules M1–M17 with F-numbered functions. The build plan, architecture, agreed scope limits and open client questions are in [docs/PLAN.md](docs/PLAN.md).

## Background
- The client first tried famous.ai. It produced a polished prototype that is not production-grade: the engine was a TypeScript approximation running in the browser, MFA was fake, and capture only polled while the browser was open. We are rebuilding on the stack the spec requires and treating famous.ai's output only as a reference for features and UI.
- The sibling repo `H:\poc-apify` is our proof of concept for collecting public Facebook/Instagram posts with Apify and SHA-256 hashing them. Reuse its approach for social capture.

## Stack (spec M16)
- `apps/web`: Next.js 15 (App Router, TypeScript), Tailwind, shadcn/ui, Auth.js with TOTP MFA, Prisma on PostgreSQL 16, BullMQ on Redis
- `services/engine`: Python 3.11, FastAPI, NumPy, scikit-learn, SHAP. The engine is stateless; persistence, auth and audit stay in the web tier.
- Deployment: Docker behind Nginx

## Local environment (Windows)
- Python 3.11 is available as `py -3.11`. The engine venv is `services/engine/.venv`.
- Postgres, Redis and Docker are installed by `infra/setup-windows.ps1`, which must be run as Administrator. Dev DB: `postgresql://zonm:zonm_dev_password@localhost:5432/zonm`.

## Status
- Done: monorepo scaffold, engine `/health` with a passing test, web build passing.
- Next (Phase 1): engine preprocessing and language ID (M5), Delta/n-gram/style-marker ensemble (M6), Prisma schema, auth and RBAC (M1), hash-chained audit log (M12), cases, candidates and ingestion (M2–M4).
