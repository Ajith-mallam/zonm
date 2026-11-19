// M12 audit log. The database assigns sequence, timestamp and hashes (see the
// integrity migration). Write audit events in the same transaction as the change
// they describe, so a change is never committed without its audit record.
import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "./db";

export type AuditInput = {
  action: string; // dotted verb, e.g. "case.create", "auth.login.failure"
  actor?: { id: string; email?: string | null } | null;
  entityType?: string;
  entityId?: string;
  caseId?: string;
  ip?: string | null;
  userAgent?: string | null;
  details?: Prisma.InputJsonValue;
};

export async function recordAudit(db: Db, e: AuditInput) {
  return db.auditEvent.create({
    data: {
      action: e.action,
      actorId: e.actor?.id ?? null,
      actorEmail: e.actor?.email ?? null,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      caseId: e.caseId ?? null,
      ip: e.ip ?? null,
      userAgent: e.userAgent ?? null,
      details: e.details ?? {},
    },
    select: { seq: true, hash: true, at: true },
  });
}

export type ChainProblem = { seq: bigint; problem: string };

export type ChainReport = {
  intact: boolean;
  checkedFrom: bigint;
  checkedTo: bigint | null;
  head: { seq: bigint; hash: string; at: Date } | null;
  problems: ChainProblem[];
  verifiedAt: Date;
};

/** F12.3 integrity check: recompute every hash in the range inside the DB. */
export async function verifyAuditChain(from = 1n, to: bigint | null = null): Promise<ChainReport> {
  const problems = await prisma.$queryRaw<ChainProblem[]>`
    SELECT seq, problem FROM audit_verify_chain(${from}::bigint, ${to}::bigint)`;
  const head = await prisma.auditEvent.findFirst({
    orderBy: { seq: "desc" },
    select: { seq: true, hash: true, at: true },
  });
  return { intact: problems.length === 0, checkedFrom: from, checkedTo: to, head, problems, verifiedAt: new Date() };
}
