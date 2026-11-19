// Case access (M1 case access lists, applied to M2+). Every case page and
// action goes through getCaseAccess or requireCasePermission.
import type { Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireSession, type CurrentSession } from "./auth/session";
import { allowedInStatus } from "./cases";
export { caseVisibilityWhere } from "./cases";
import { prisma } from "./db";
import { casePermissions, type CasePermission } from "./rbac";

export type CaseAccess = CurrentSession & {
  case: Prisma.CaseGetPayload<{ include: { lead: { select: { id: true; name: true } } } }>;
  membership: Prisma.CaseMemberGetPayload<object>["role"] | null;
  /** Permissions from role and team membership, ignoring case status. */
  perms: ReadonlySet<CasePermission>;
  /** True if the permission is held and the case status still allows it. */
  can: (p: CasePermission) => boolean;
};

/**
 * Load a case the current user can read. Answers 404 (not 403) when the user
 * has no access, so case existence is not disclosed. Cached per request.
 */
export const getCaseAccess = cache(async (caseId: string): Promise<CaseAccess> => {
  const s = await requireSession();
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: { lead: { select: { id: true, name: true } }, members: { where: { userId: s.actor.id }, select: { role: true } } },
  });
  if (!c) notFound();
  const membership = c.members[0]?.role ?? null;
  const perms = new Set(casePermissions(s.actor, membership));
  if (!perms.has("case.read")) notFound();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip the membership include
  const { members: _members, ...rest } = c;
  return { ...s, case: rest, membership, perms, can: (p) => perms.has(p) && allowedInStatus(c.status, p) };
});

export class CaseActionError extends Error {}

/** For server actions: the access record, or throw if the permission is missing. */
export async function requireCasePermission(caseId: string, perm: CasePermission): Promise<CaseAccess> {
  const a = await getCaseAccess(caseId);
  if (!a.perms.has(perm)) throw new CaseActionError("You do not have permission to do that on this case.");
  if (!a.can(perm)) throw new CaseActionError(`This case is ${a.case.status.toLowerCase()}, so that change is not allowed.`);
  return a;
}
