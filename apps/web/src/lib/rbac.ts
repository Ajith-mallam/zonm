// M1 role-based access control. Two layers:
//  1. Global permissions come from the user's system role.
//  2. Case permissions are the intersection of what the system role allows and
//     what the user's role on that case allows. Supervisors have oversight of
//     every case without membership. Administrators manage users and the system
//     but get no case access from their role (separation of duties).
// The matrix is a proposal pending the client's confirmation.
import type { CaseMemberRole, Role } from "@prisma/client";

export const GLOBAL_PERMISSIONS = [
  "user.manage",
  "system.settings",
  "audit.read",
  "audit.verify",
  "case.create",
  "case.list.all",
] as const;

export const CASE_PERMISSIONS = [
  "case.read",
  "case.update",
  "case.status.change",
  "case.team.manage",
  "case.note.write",
  "case.task.write",
  "candidate.write",
  "candidate.identity.read",
  "candidate.identity.write",
  "document.upload",
  "document.version.create",
  "document.exclude",
  "analysis.run",
  "analysis.cancel",
  "result.review",
  "monitor.manage",
] as const;

export type GlobalPermission = (typeof GLOBAL_PERMISSIONS)[number];
export type CasePermission = (typeof CASE_PERMISSIONS)[number];

const ALL_CASE = new Set<CasePermission>(CASE_PERMISSIONS);
const ANALYST_WORK: CasePermission[] = [
  "case.read", "case.update", "case.status.change", "case.note.write", "case.task.write",
  "candidate.write", "candidate.identity.read", "document.upload", "document.version.create",
  "document.exclude", "analysis.run", "analysis.cancel", "monitor.manage",
];
const REVIEW_WORK: CasePermission[] = [
  "case.read", "case.note.write", "case.status.change", "candidate.identity.read", "result.review",
];

export const ROLE_GLOBAL: Record<Role, ReadonlySet<GlobalPermission>> = {
  ADMIN: new Set(["user.manage", "system.settings", "audit.read", "audit.verify"]),
  SUPERVISOR: new Set(["case.create", "case.list.all", "audit.read"]),
  ANALYST: new Set([]),
  REVIEWER: new Set([]),
  AUDITOR: new Set(["audit.read", "audit.verify"]),
};

/** The most a system role can ever do on a case. */
export const ROLE_CASE_CAP: Record<Role, ReadonlySet<CasePermission>> = {
  ADMIN: new Set([]),
  SUPERVISOR: ALL_CASE,
  // case.team.manage only takes effect when the analyst is the case LEAD.
  ANALYST: new Set([...ANALYST_WORK, "case.team.manage"]),
  REVIEWER: new Set(REVIEW_WORK),
  AUDITOR: new Set(["case.read"]),
};

/** What a role on a specific case grants. */
export const MEMBER_CASE: Record<CaseMemberRole, ReadonlySet<CasePermission>> = {
  LEAD: ALL_CASE,
  ANALYST: new Set(ANALYST_WORK),
  REVIEWER: new Set(REVIEW_WORK),
  OBSERVER: new Set(["case.read"]),
};

export type Actor = { id: string; role: Role; status?: "ACTIVE" | "DISABLED" };

export function can(actor: Actor, perm: GlobalPermission): boolean {
  return actor.status !== "DISABLED" && ROLE_GLOBAL[actor.role].has(perm);
}

/**
 * Case permission check. ``membership`` is the actor's CaseMember role on this
 * case, or null if they are not on the team.
 */
export function canOnCase(actor: Actor, membership: CaseMemberRole | null, perm: CasePermission): boolean {
  if (actor.status === "DISABLED") return false;
  const cap = ROLE_CASE_CAP[actor.role];
  if (!cap.has(perm)) return false;
  if (actor.role === "SUPERVISOR") return true; // oversight of all cases
  return membership !== null && MEMBER_CASE[membership].has(perm);
}

export function casePermissions(actor: Actor, membership: CaseMemberRole | null): CasePermission[] {
  return CASE_PERMISSIONS.filter((p) => canOnCase(actor, membership, p));
}
