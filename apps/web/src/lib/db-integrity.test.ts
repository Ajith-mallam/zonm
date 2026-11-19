// Applies the real migrations to an in-process PostgreSQL (PGlite, WASM) and
// checks the database-level controls: the hash-chained append-only audit log
// (M12) and immutable evidence (F4.8). PGlite is single-connection, so
// concurrent appends across connections still need a test against a real server.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../prisma/migrations");
const GENESIS = "0".repeat(64);
const SHA = "a".repeat(64);

let db: PGlite;

async function audit(action: string, details: object = {}) {
  // Client-supplied seq / prevHash / hash must be ignored by the trigger.
  const r = await db.query<{ seq: number; prevHash: string; hash: string }>(
    `INSERT INTO "AuditEvent"(action, "actorId", details, seq, "prevHash", hash)
     VALUES ($1, 'u1', $2, 999, 'forged', 'forged') RETURNING seq, "prevHash", hash`,
    [action, JSON.stringify(details)],
  );
  return r.rows[0];
}

const problems = async (from = 1, to: number | null = null) =>
  (await db.query<{ seq: number; problem: string }>(`SELECT * FROM audit_verify_chain($1, $2)`, [from, to])).rows;

/** Simulate a privileged attacker who bypasses the triggers. */
const tamper = (sql: string) =>
  db.exec(`ALTER TABLE "AuditEvent" DISABLE TRIGGER USER; ${sql}; ALTER TABLE "AuditEvent" ENABLE TRIGGER USER;`);

beforeAll(async () => {
  db = new PGlite();
  const dirs = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const d of dirs) await db.exec(readFileSync(path.join(MIGRATIONS, d, "migration.sql"), "utf8"));
  await db.exec(`
    INSERT INTO "User"(id, email, name, role, "passwordHash", "updatedAt") VALUES ('u1', 'a@b.sc', 'A', 'ADMIN', 'h', now());
    INSERT INTO "Case"(id, reference, title, "createdById", "updatedAt") VALUES ('c1', 'ZN-2026-0001', 'T', 'u1', now());`);
}, 60_000);

describe("audit chain", () => {
  it("anchors, links and hashes events in the database", async () => {
    const a = await audit("auth.login.success", { ip: "10.0.0.1" });
    const b = await audit("case.create", { ref: "ZN-2026-0001", n: null });
    expect(Number(a.seq)).toBe(1);
    expect(a.prevHash).toBe(GENESIS);
    expect(Number(b.seq)).toBe(2);
    expect(b.prevHash).toBe(a.hash);
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps seq contiguous for multi-row inserts", async () => {
    await db.exec(`INSERT INTO "AuditEvent"(action) VALUES ('m1'), ('m2'), ('m3')`);
    const seqs = (await db.query<{ seq: number }>(`SELECT seq FROM "AuditEvent" ORDER BY seq`)).rows.map((r) => Number(r.seq));
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it("verifies an intact chain and sub-ranges", async () => {
    expect(await problems()).toEqual([]);
    expect(await problems(3, 4)).toEqual([]);
  });

  it.each(["UPDATE \"AuditEvent\" SET action = 'x' WHERE seq = 2", "DELETE FROM \"AuditEvent\" WHERE seq = 2", "TRUNCATE \"AuditEvent\""])(
    "rejects %s",
    async (sql) => {
      await expect(db.exec(sql)).rejects.toThrow(/append-only/);
    },
  );

  it("detects an edited event", async () => {
    await tamper(`UPDATE "AuditEvent" SET details = '{"ref":"ZN-2026-9999"}' WHERE seq = 2`);
    const p = await problems();
    expect(p).toHaveLength(1);
    expect(Number(p[0].seq)).toBe(2);
    expect(p[0].problem).toMatch(/hash does not match/);
  });

  it("detects a deleted event", async () => {
    await tamper(`DELETE FROM "AuditEvent" WHERE seq = 4`);
    const p = (await problems()).map((x) => x.problem);
    expect(p.some((x) => /gap/.test(x))).toBe(true);
    expect(p.some((x) => /prevHash/.test(x))).toBe(true);
  });
});

describe("evidence immutability and constraints", () => {
  const insertDoc = (id: string, role: string, sha = SHA) =>
    db.exec(`INSERT INTO "Document"(id, "caseId", role, "sourceType", "originalText", sha256, "wordCount", "createdById")
             VALUES ('${id}', 'c1', '${role}', 'PASTE', 'hello', '${sha}', 1, 'u1')`);

  it("protects document originals but allows exclusion flags", async () => {
    await insertDoc("d1", "QUESTIONED");
    await expect(db.exec(`UPDATE "Document" SET "originalText" = 'changed' WHERE id = 'd1'`)).rejects.toThrow(/immutable/);
    await db.exec(`UPDATE "Document" SET excluded = true, "excludedReason" = 'quoted text' WHERE id = 'd1'`);
  });

  it("makes document versions append-only", async () => {
    await db.exec(`INSERT INTO "DocumentVersion"(id, "documentId", version, change, text, sha256, "createdById")
                   VALUES ('v1', 'd1', 1, 'ORIGINAL', 'hello', '${SHA}', 'u1')`);
    await expect(db.exec(`UPDATE "DocumentVersion" SET text = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`DELETE FROM "DocumentVersion"`)).rejects.toThrow(/append-only/);
  });

  it("requires a candidate for KNOWN documents and a well-formed hash", async () => {
    await expect(insertDoc("d2", "KNOWN")).rejects.toThrow(/document_known_has_candidate/);
    await expect(insertDoc("d3", "QUESTIONED", "BAD")).rejects.toThrow(/document_sha256_format/);
  });

  it("limits social capture polling to 5-15 minutes", async () => {
    await expect(
      db.exec(`INSERT INTO "SocialMonitor"(id, "caseId", platform, target, "intervalMinutes", "createdById")
               VALUES ('m1', 'c1', 'FACEBOOK', 't', 1, 'u1')`),
    ).rejects.toThrow(/social_monitor_interval/);
  });

  it("allocates case references atomically per year", async () => {
    const next = async () =>
      (await db.query<{ last: number }>(
        `INSERT INTO "CaseCounter"(year, last) VALUES (2026, 1)
         ON CONFLICT (year) DO UPDATE SET last = "CaseCounter".last + 1 RETURNING last`,
      )).rows[0].last;
    expect([await next(), await next(), await next()]).toEqual([1, 2, 3]);
  });
});
