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
- **Test mode is ON locally (user request, 2026-11-19):** `apps/web/.env` sets `AUTH_MFA_REQUIRED=false` and `AUTH_FORCE_PASSWORD_CHANGE=false`, giving password-only sign-in with a yellow warning banner. Every local user's password is `Zonm@1234` (`npm run dev:set-all-passwords [-- --password X]`, local DB only). Both switches default to on; remove the two lines to restore MFA. The M1 E2E suite reports SKIP while MFA is off.
- `apps/web/.env` (git-ignored) holds dev secrets. Create users with `npm run user:create -- --email <e> --name "<n>" [--role ADMIN]`; it prints a one-time temporary password.
- Port 3000 is taken by another app on this machine; run the web app on 3100 (`npx next start -p 3100` or `npx next dev -p 3100`).
- Run vitest from an upper-case drive path (`H:\zonm-net\apps\web`). From `h:\...`, Windows loads vitest twice and every suite fails with "failed to find the current suite".

## Tests
- Engine: `services/engine/.venv/Scripts/python -m pytest -q` (from `services/engine`)
- Web: `npm test` (from `H:\zonm-net\apps\web`). `src/lib/db-integrity.test.ts` applies the real migrations to PGlite (in-process Postgres), so DB triggers are tested without a server.
- End to end: `npm run test:e2e` (or `npm run test:e2e -- m3`) drives headless Chromium through `e2e/m*-*.cjs` against the app on :3100 and the dev DB. Each suite creates its own users via `user:create`. Needs `PLAYWRIGHT_BROWSERS_PATH` (set in `.env` to `H:\playwright-browsers`). The M3 suite needs the demo data. Screenshots go to `e2e/.artifacts/`. In tests, wait for the action's POST response (`submit()` in `e2e/lib.cjs`); `networkidle` alone races.
- Demo data: `npm run db:seed-demo` (local DB only, runs once). It creates 5 users `*@demo.zonm.local` (password `Sample-Kreol-Text-2026`, MFA enrolment at first sign-in) and 4 `[DEMO]` cases. The main case has Candidates A (Kreol, ~6k words), B (EN/FR, ~2.6k) and C (code-mixed, ~450) plus questioned reviews written in B's style; the engine attributes them to B.

## Status
- Done: scaffold; engine M5 (normalisation, tokeniser, Kreol/EN/FR word-level language ID, CMI) and M6 (Burrows/Eder/Cosine Delta, char n-gram, style markers, ensemble, provisional confidence grade, run record) at `/v1/preprocess` and `/v1/analyze`; Prisma schema + migrations for M1–M4, runs, social monitors and the M12 hash-chained audit log (DB triggers + `audit_verify_chain`); web libs for RBAC matrix, Argon2id passwords/lockout, TOTP, secret encryption, audit writer, case references; M1 Auth.js credentials login with lockout, mandatory TOTP enrolment/challenge with recovery codes, revocable DB sessions (30 min idle / 8 h absolute), forced password change, admin user management (create, role, disable, unlock, reset password/MFA); M12 audit viewer and `GET /api/audit/verify`; M2 cases: list/search/filter, create with ZN-YYYY-NNNN reference, team (one lead), notes (append-only), tasks, status workflow with reasons, activity (status history + case audit trail); M3 candidates: pseudonyms, handles, known-writing sufficiency (1k minimum / 5k recommended words), restricted identity (supervisor-only write, reveal needs a stated purpose and is audited, values never in the audit log); M4 evidence: upload (TXT/DOCX/PDF/CSV/JSON/WhatsApp export, 25 MB) stored encrypted and SHA-256 hashed, import preview with per-author mapping and duplicate detection, exclusions and append-only versions, verified downloads. See [docs/SECURITY.md](docs/SECURITY.md).
- Next (Phase 1): analysis runs (BullMQ, needs Redis) calling the engine with each document's latest version, then the M10 verdict panel; social capture via Apify.
- Evidence code: extraction is pure (`src/lib/ingest/`, unit-tested); files go through `writeEvidence`/`readVerified` (`src/lib/storage.ts`, `src/lib/evidence.ts`). `STORAGE_ENCRYPTION_KEY` in `.env` encrypts files in `apps/web/storage/` (git-ignored); losing the key loses the evidence. `Document.wordCount` is the current version's count.
- Forms: use `ActionForm` (`src/components/action-form.tsx`). It submits via onSubmit, because React 19 otherwise clears every field after a failed validation.
- Case code rules: every case page/action goes through `getCaseAccess` / `requireCasePermission` (`src/lib/case-access.ts`); no access answers 404. Audit details hold ids and field names, never case content (auditors may lack case access). After an action that changes auth state, call `revalidatePath("/", "layout")`, or the client router replays stale gate redirects.
- Awaiting client: role set and permission matrix, password policy values, native-speaker review of the Kreol seed lexicon (`services/engine/app/lexicons/crs.json`).
