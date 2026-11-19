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

- Run vitest from an upper-case drive path (`H:\zonm-net\apps\web`). From `h:\...`, Windows loads vitest twice and every suite fails with "failed to find the current suite".

## Tests
- Engine: `services/engine/.venv/Scripts/python -m pytest -q` (from `services/engine`)
- Web: `npm test` (from `H:\zonm-net\apps\web`). `src/lib/db-integrity.test.ts` applies the real migrations to PGlite (in-process Postgres), so DB triggers are tested without a server.

## Status
- Done: scaffold; engine M5 (normalisation, tokeniser, Kreol/EN/FR word-level language ID, CMI) and M6 (Burrows/Eder/Cosine Delta, char n-gram, style markers, ensemble, provisional confidence grade, run record) at `/v1/preprocess` and `/v1/analyze`; Prisma schema + migrations for M1–M4, runs, social monitors and the M12 hash-chained audit log (DB triggers + `audit_verify_chain`); web libs for RBAC matrix, Argon2id passwords/lockout, TOTP, secret encryption, audit writer, case references. See [docs/SECURITY.md](docs/SECURITY.md).
- Next (Phase 1): run `infra/setup-windows.ps1` (as Admin) and `npm run db:migrate`; Auth.js login + MFA enrolment/challenge pages using the libs; admin user management; case/candidate/ingestion UI and API routes; BullMQ analysis jobs calling the engine.
- Awaiting client: role set and permission matrix, password policy values, native-speaker review of the Kreol seed lexicon (`services/engine/app/lexicons/crs.json`).
