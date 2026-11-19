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
- Postgres, Redis and Docker are installed by `infra/setup-windows.ps1`, which must be run as Administrator. Until then, `cd infra/devdb && npm install && npm start` runs PostgreSQL 16 as a normal user (embedded binaries, data in `infra/devdb/data`). Dev DB: `postgresql://zonm:zonm_dev_password@localhost:5432/zonm`. Redis is not available yet.
- `apps/web/.env` (git-ignored) holds dev secrets. Create users with `npm run user:create -- --email <e> --name "<n>" [--role ADMIN]`; it prints a one-time temporary password.
- Port 3000 is taken by another app on this machine; run the web app on 3100 (`npx next start -p 3100` or `npx next dev -p 3100`).
- Run vitest from an upper-case drive path (`H:\zonm-net\apps\web`). From `h:\...`, Windows loads vitest twice and every suite fails with "failed to find the current suite".

## Tests
- Engine: `services/engine/.venv/Scripts/python -m pytest -q` (from `services/engine`)
- Web: `npm test` (from `H:\zonm-net\apps\web`). `src/lib/db-integrity.test.ts` applies the real migrations to PGlite (in-process Postgres), so DB triggers are tested without a server.

## Status
- Done: scaffold; engine M5 (normalisation, tokeniser, Kreol/EN/FR word-level language ID, CMI) and M6 (Burrows/Eder/Cosine Delta, char n-gram, style markers, ensemble, provisional confidence grade, run record) at `/v1/preprocess` and `/v1/analyze`; Prisma schema + migrations for M1–M4, runs, social monitors and the M12 hash-chained audit log (DB triggers + `audit_verify_chain`); web libs for RBAC matrix, Argon2id passwords/lockout, TOTP, secret encryption, audit writer, case references; M1 Auth.js credentials login with lockout, mandatory TOTP enrolment/challenge with recovery codes, revocable DB sessions (30 min idle / 8 h absolute), forced password change, admin user management (create, role, disable, unlock, reset password/MFA); M12 audit viewer and `GET /api/audit/verify`; M2 cases: list/search/filter, create with ZN-YYYY-NNNN reference, team (one lead), notes (append-only), tasks, status workflow with reasons, activity (status history + case audit trail). See [docs/SECURITY.md](docs/SECURITY.md).
- Next (Phase 1): M3 candidates; M4 ingestion; BullMQ analysis jobs calling the engine (needs Redis).
- Case code rules: every case page/action goes through `getCaseAccess` / `requireCasePermission` (`src/lib/case-access.ts`); no access answers 404. Audit details hold ids and field names, never case content (auditors may lack case access). After an action that changes auth state, call `revalidatePath("/", "layout")`, or the client router replays stale gate redirects.
- Awaiting client: role set and permission matrix, password policy values, native-speaker review of the Kreol seed lexicon (`services/engine/app/lexicons/crs.json`).
