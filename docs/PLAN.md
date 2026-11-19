# ZONM NET — Build Plan

Module references (M1–M17, F-numbers) follow the client specification.

## Architecture

```
Browser ──► Next.js (apps/web)
              │  Auth.js + TOTP MFA, RBAC + case access checks on every request
              │  Prisma ──► PostgreSQL 16 (cases, candidates, documents, runs, reports, audit chain)
              │  BullMQ ──► Redis ──► workers:
              │                       • analysis jobs ──► Python engine (services/engine, HTTP)
              │                       • social capture jobs ──► Apify (FB / IG / TikTok public posts)
              │                       • notifications, retention, integrity checks
              ▼
           File store (original uploads, encrypted at rest)
```

Principles:
- **The engine is stateless.** It receives texts and settings and returns results. Persistence, access control and audit stay in the web tier.
- **Reproducibility.** Every run stores the engine version, full settings and input SHA-256 hashes (F6.9).
- **Originals are immutable.** Exclusions and redactions create new working versions (F4.8).
- **Audit is append-only and hash-chained** (F12.1, F12.3), enforced in the database as well as the app.

## Agreed scope constraints

- Social capture covers **public** Facebook, Instagram, TikTok and X posts only, via Apify scraping (X added at the client's request, 2026-11-19). This breaches platform terms of service, and scraper accounts can be blocked.
- Capture polls every **5–15 minutes** (configurable), not every 30 seconds. The UI refreshes every 30 seconds.
- WhatsApp is ingested only from **chat exports**. No live capture exists.
- Kreol language ID accuracy depends on a client-supplied or co-built corpus (F5.5).
- The "none of the candidates" verdict depends on an impostor reference corpus (F7.5).
- Data residency in Seychelles requires hosting there. Apify processes captured posts outside Seychelles.

## Phase 1 — Core evidence workflow

1. Foundation: monorepo, Prisma schema, Postgres/Redis, engine skeleton ✅ (scaffold, schema + migrations)
2. M1: Auth.js credentials login, password policy, lockout, TOTP MFA, roles + permission matrix, case access lists ✅ (case access lists are enforced as M2 pages are built)
3. M12: append-only, hash-chained audit log (DB-level protection) and the integrity verification endpoint ✅
4. M2: cases (reference numbers, status workflow, team, notes, tasks) ✅
5. M3: candidates (pseudonym, restricted real identity, legal basis, handles), corpus sufficiency indicator ✅
6. M4: upload (TXT/DOCX/PDF/CSV/JSON/WhatsApp), auto-split, SHA-256 hashing, metadata, extraction preview, de-dup, exclusions and versions ✅ (no antivirus or OCR yet)
7. M5 (engine): normalisation, tokenisation, function-word lexicons, word-level language ID, CMI, chunking ✅ (seed lexicons, pending client corpus)
8. M6 (engine): features, Burrows/Eder/Cosine Delta, char n-gram cosine, style-marker distance, ensemble, confidence grade ✅ (grade thresholds uncalibrated until M9)
9. Analysis jobs via BullMQ, with progress, cancellation and run records ✅
10. M10: verdict panel, score charts, language composition ✅
11. Social capture: author name/ID on the new-case form, Apify monitor jobs, auto-ingest and auto-scan (reuses the poc-apify approach) (🟡 on-demand collection done for Facebook, Instagram, TikTok and X: profile = latest 10 posts, or a single post; scheduled monitors pending)

## Phase 2 — Forensic depth

M7 (SVM/LogReg, General Impostors, pairwise verification, model registry), M8 (XAI), M9 (validation, sensitivity), M10 (PCA/t-SNE/dendrogram, run comparison), M11 (reports, PDF/DOCX, reviewer sign-off).

## Phase 3 — Hardening and administration

M13 (lexicon/corpus/retention admin, backups, health), M14 (REST API, OAuth/API keys, webhooks, SSO), M15 (help, glossary, demo workspace), M17 security controls, penetration test.

## Open items for the client

- Hosting location (a Seychelles data centre or on-premise)
- Kreol training corpus and impostor reference corpus (source and licensing)
- Directory/SSO system, antivirus engine, existing case management system
- Written acceptance of the social-capture constraints above
