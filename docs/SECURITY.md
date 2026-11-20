# ZONM NET — Security controls (implementation notes)

These notes record how the security requirements are implemented, along with the deployment steps the code depends on.

## Audit log (M12, F12.1, F12.3)

- `AuditEvent` is written by the application and chained by the database. A `BEFORE INSERT` trigger takes a transaction-scoped advisory lock and then sets `seq`, `at` (`clock_timestamp()`), `prevHash` and `hash`. Values the client supplies for these columns are overwritten.
- `hash = sha256(jsonb_build_array(prevHash, seq, at_utc_iso, actorId, actorEmail, action, entityType, entityId, caseId, ip, userAgent, details)::text)`. The first event's `prevHash` is 64 zeros.
- Triggers reject `UPDATE`, `DELETE` and `TRUNCATE`.
- `audit_verify_chain(from, to)` recomputes every hash in a range and returns any gaps, broken links or altered events. An empty result means the range is intact. The web tier calls it through `verifyAuditChain()` in `apps/web/src/lib/audit.ts`.
- Write each audit event in the same transaction as the change it records.

### Required database role separation (production)

Triggers protect against application bugs and SQL injection through the app role. They do not protect against the table owner, who can disable triggers. Production must use two roles:

```sql
-- Owns the schema; used only by `prisma migrate deploy` during releases.
CREATE ROLE zonm_migrator LOGIN PASSWORD '...';
-- Used by the running app and workers.
CREATE ROLE zonm_app LOGIN PASSWORD '...';

GRANT USAGE ON SCHEMA public TO zonm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zonm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zonm_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent" FROM zonm_app;
REVOKE UPDATE, DELETE ON "DocumentVersion" FROM zonm_app;
```

To detect tampering by a database superuser, periodically export the chain head (`seq`, `hash`) to a place the DBA cannot write, such as a signed report or a separate system (planned for M13 integrity checks).

## Evidence immutability (F4.8)

- `Document.originalText`, `sha256`, `caseId`, source and creator columns cannot be updated (trigger). Only the exclusion flag and descriptive metadata can change.
- `DocumentVersion` rows are append-only. Redactions and partial exclusions create a new version.
- `SourceFile` identity (`sha256`, `storagePath`, `sizeBytes`, `caseId`) cannot be updated.
- Each analysis run records the exact `DocumentVersion` ids and hashes it used (`AnalysisRunInput`), along with the engine version, lexicon versions, full settings and the settings hash (F6.9).

## Evidence files (M4)

- Uploads are stored byte-for-byte, encrypted with AES-256-GCM (`STORAGE_ENCRYPTION_KEY`) and bound to their SourceFile id as associated data. A file is written once through a hard link and can never be overwritten.
- The SHA-256 of the original bytes is recorded at upload. Every download and every import re-hashes the decrypted file and refuses on mismatch. A mismatch is logged as `evidence.integrity_failure`.
- Downloads are always served as `application/octet-stream` attachments with `nosniff`, so uploaded content is never rendered by the browser.
- Uploads are checked for type by extension and file signature (a renamed file is refused), limited to 25 MB, and same-origin checked. Antivirus scanning is not implemented yet (`scanStatus = NOT_SCANNED`; open client item: which AV engine).
- Each imported text records its own SHA-256. Exclusions are flags; redactions and partial exclusions create new versions while version 1 keeps the original text.
- The key must be backed up separately from the storage directory. Losing it makes the evidence unreadable.

## Client IP addresses in the audit log

The IP recorded with each audit event comes from `X-Forwarded-For` only when `TRUSTED_PROXY_HOPS` is set. Behind one Nginx proxy, set it to 1 and use `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. The app then takes the right-most entry, the address Nginx itself saw. Entries further left are written by the client and are never trusted. With 0 (the default), forwarding headers are ignored and the IP is left blank rather than recorded from a forgeable header.

## Authentication (M1)

| Control | Implementation | Default |
|---|---|---|
| Password hashing | Argon2id via `@node-rs/argon2` | 19 MiB memory, t=2, p=1 (OWASP) |
| Password policy | `checkPasswordPolicy` | ≥12 chars, 3 of 4 character classes, no name/e-mail, deny-list, no 4× repeats |
| Reuse | `PasswordHistory` | last 5 passwords |
| Expiry | `isPasswordExpired` | 90 days |
| Lockout | `afterFailure` | 5 failures → 15-minute lock |
| Account enumeration | `dummyPasswordHash` | unknown e-mails still run one Argon2 verify |
| MFA | RFC 6238 TOTP (`lib/security/totp.ts`) | SHA-1, 6 digits, 30 s, ±1 step |
| MFA replay | `User.mfaLastUsedStep` | a code cannot be reused within its window |
| MFA secret at rest | AES-256-GCM, AAD = user id | key in `MFA_ENCRYPTION_KEY` |
| Recovery codes | 10 single-use codes, SHA-256 stored | |
| Sessions | `UserSession` row referenced from the JWT and checked on every request | revocable |

The policy values are defaults and still need the client's security policy (open item).

**Test-mode switches.** `AUTH_MFA_REQUIRED=false` makes sign-in password-only (every session counts as MFA-verified, the MFA pages redirect into the app, and a warning banner is shown). `AUTH_FORCE_PASSWORD_CHANGE=false` skips the temporary/expired password change. Both default to on and are for local testing only. `AUTH_TEST_MODE_BANNER=false` hides the warning banner shown while MFA is off. A deployment checklist must confirm that neither is set to `false`. Login audit events record `mfaRequired`, so periods in test mode are visible in the audit log.

## Roles (M1)

The permission matrix is in `apps/web/src/lib/rbac.ts`. Every case page and action loads the case through `getCaseAccess`, which answers 404 when the user has no access, so case existence isn't disclosed. Case status also limits actions: closed cases accept only notes and the lead's reopen/archive decision, and archived cases are read-only. Closing, archiving and reopening need the lead or a supervisor. Audit entries for cases record identifiers and field names, never titles, notes or reasons.

## Candidate identity (M3)

- The real identity sits in `CandidateIdentity`, separate from the pseudonymous `Candidate`. Pages never send it to the browser by default.
- Reading it needs `candidate.identity.read` (case lead, analysts and reviewers on the team, and supervisors). The user must state a purpose. Each reveal writes a `candidate.identity.read` audit event with that purpose.
- Writing it needs `candidate.identity.write`, which supervisors alone hold. A legal basis is mandatory. Supervisors edit an existing identity only after revealing it, so every edit follows an audited read.
- Audit events record the candidate id and which optional fields were given, never the name, date of birth or identifiers.
- A candidate with documents or monitors attached cannot be deleted. Case permissions are the intersection of the user's system role cap and their role on the case team. Supervisors have oversight of every case. Administrators manage users and settings but have no access to case evidence. The role set (ADMIN, SUPERVISOR, ANALYST, REVIEWER, AUDITOR) is a proposal and needs the client's confirmation.
