// M2 case rules. Pure functions, unit-tested; the database helpers are at the end.
import type { CaseMemberRole, CasePriority, CaseStatus, Prisma } from "@prisma/client";
import type { Tx } from "./db";
import { ROLE_CASE_CAP, type Actor, type CasePermission } from "./rbac";

export function formatCaseReference(year: number, n: number): string {
  return `ZN-${year}-${String(n).padStart(4, "0")}`;
}

/** Allowed status transitions. Reopening a closed case goes back to OPEN. */
export const CASE_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  OPEN: ["IN_ANALYSIS", "CLOSED"],
  IN_ANALYSIS: ["OPEN", "UNDER_REVIEW", "CLOSED"],
  UNDER_REVIEW: ["IN_ANALYSIS", "CLOSED"],
  CLOSED: ["OPEN", "ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

/**
 * Closing, archiving and reopening are decisions for the case lead or a
 * supervisor (case.team.manage). Day-to-day moves (start analysis, send for
 * review, return from review) need case.status.change.
 */
export function statusChangeAllowed(perms: ReadonlySet<CasePermission>, from: CaseStatus, to: CaseStatus): boolean {
  if (!canTransition(from, to) || !perms.has("case.status.change")) return false;
  const decisive = to === "CLOSED" || to === "ARCHIVED" || from === "CLOSED";
  return !decisive || perms.has("case.team.manage");
}

/** Transitions that must carry a written reason. */
export function reasonRequired(from: CaseStatus, to: CaseStatus): boolean {
  return to === "CLOSED" || to === "ARCHIVED" || from === "CLOSED" || (from === "UNDER_REVIEW" && to === "IN_ANALYSIS");
}

/**
 * What a case's status still allows. Archived cases are read-only. Closed
 * cases accept notes and the status change that reopens or archives them.
 */
export function allowedInStatus(status: CaseStatus, perm: CasePermission): boolean {
  if (perm === "case.read" || perm === "candidate.identity.read") return true;
  if (status === "ARCHIVED") return false;
  if (status === "CLOSED") return perm === "case.status.change" || perm === "case.note.write" || perm === "case.team.manage";
  return true;
}

export const STATUS_LABEL: Record<CaseStatus, string> = {
  OPEN: "Open",
  IN_ANALYSIS: "In analysis",
  UNDER_REVIEW: "Under review",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

export const STATUS_TONE: Record<CaseStatus, "blue" | "amber" | "green" | "neutral" | "red"> = {
  OPEN: "blue",
  IN_ANALYSIS: "amber",
  UNDER_REVIEW: "amber",
  CLOSED: "green",
  ARCHIVED: "neutral",
};

export const PRIORITY_LABEL: Record<CasePriority, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };

export const MEMBER_ROLE_LABEL: Record<CaseMemberRole, string> = {
  LEAD: "Lead",
  ANALYST: "Analyst",
  REVIEWER: "Reviewer",
  OBSERVER: "Observer",
};

/**
 * Allocate the next case reference (ZN-YYYY-NNNN) atomically. The upsert takes
 * a row lock on the year's counter, so concurrent creations never collide.
 * Call inside the transaction that creates the case so a rollback releases the
 * number together with the case.
 */
export async function allocateCaseReference(tx: Tx, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const [row] = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "CaseCounter" (year, last) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last = "CaseCounter".last + 1
    RETURNING last`;
  return formatCaseReference(year, row.last);
}

/** Prisma filter for the cases an actor may see in lists. */
export function caseVisibilityWhere(actor: Actor): Prisma.CaseWhereInput {
  if (actor.status === "DISABLED" || !ROLE_CASE_CAP[actor.role].has("case.read")) return { id: { in: [] } };
  if (actor.role === "SUPERVISOR") return {};
  return { members: { some: { userId: actor.id } } };
}
