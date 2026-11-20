# ZONM NET: dev deployment on Vercel

This is a test deployment for trying the system. It holds demo data only. Do not put real case evidence here: Vercel, Neon and Apify store and process data outside Seychelles.

| Part | Where | URL / name |
|---|---|---|
| Web app | Vercel project `zonm-web` (root `apps/web`) | https://zonm-web.vercel.app |
| Engine | Vercel project `zonm-engine` (root `services/engine`) | https://zonm-engine.vercel.app |
| Database | Neon (Vercel Marketplace) `neon-indigo-apple`, US East | connected to `zonm-web` |
| Evidence files | Vercel Blob `zonm_blob` (private), US East | connected to `zonm-web` |
| Background jobs | inside the web app (`JOB_RUNNER=inline`, Next `after()`) | no Redis, no worker |

Sign in with any demo account (`supervisor@`, `lead@`, `analyst@`, `reviewer@` or `auditor@demo.zonm.local`) or the admin account. **Passwords are never written in this repository** (it is public): the dev-site password is kept in the git-ignored `apps/web/.env.vercel-dev` and shared directly with testers. MFA is off.

## Settings

Secrets (`AUTH_SECRET`, `MFA_ENCRYPTION_KEY`, `STORAGE_ENCRYPTION_KEY`, `ENGINE_TOKEN`) are stored in Vercel and backed up in the git-ignored `apps/web/.env.vercel-dev`, together with the non-secret settings. **Keep a copy of `STORAGE_ENCRYPTION_KEY`**: without it the evidence files in Blob cannot be decrypted. Neon and Blob variables (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`) are managed by the store connections.

Non-secret web settings: `STORAGE_DRIVER=blob`, `JOB_RUNNER=inline`, `ENGINE_URL=https://zonm-engine.vercel.app`, `AUTH_MFA_REQUIRED=false`, `AUTH_FORCE_PASSWORD_CHANGE=false`, `AUTH_TEST_MODE_BANNER=false`, `AUTH_TRUST_HOST=true`, `MAX_UPLOAD_MB=4` (Vercel's request limit is 4.5 MB), `CAPTURE_MAX_WAIT_SECS=240`, `TRUSTED_PROXY_HOPS=1`. The engine has `ENGINE_TOKEN`.

`vercel env pull` returns placeholders for secret values. Scripts that act like the deployment load `.env.vercel-pulled` (database and blob credentials) and then `.env.vercel-dev`.

## Redeploying after code changes

```
cd services/engine && npx vercel deploy --prod      # engine (if changed)
cd apps/web && npx vercel deploy --prod             # web app
```

Schema changes: run `npx prisma migrate deploy` with `DATABASE_URL` and `DATABASE_URL_UNPOOLED` set to the Neon values from `.env.vercel-pulled` (not the local `.env`), before deploying the web app.

## Limits on Vercel

- **Uploads:** 4 MB per file. Bigger files need direct-to-Blob uploads (not built).
- **Background jobs** run inside the request's function, which may last up to 300 s. Collections stop waiting after 240 s. Jobs whose function was cut off are marked failed when someone opens the Analysis or Evidence pages.
- **Engine:** runtime libraries only (FastAPI, Pydantic, NumPy). The Phase 2 libraries in `requirements-ml.txt` would exceed Vercel's Python size limit.
- **Region:** functions run in Washington (iad1); Neon and Blob are in US East.

## Verified on 2026-11-20

All six E2E suites passed against https://zonm-web.vercel.app (sign-in, cases, candidates, Blob-backed evidence including the tamper check, analysis through inline jobs and the Vercel engine, social collection). A real Apify collection (X profile) completed through the deployed site in 8 s, and its raw evidence downloaded from Blob with a matching SHA-256.
