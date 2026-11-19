// Server-side session validation, run on every authenticated render and action.
// The JWT only identifies a UserSession row. The row decides whether the
// session is still valid, so revocation takes effect immediately.
import type { User, UserSession } from "@prisma/client";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { recordAudit } from "../audit";
import { prisma } from "../db";
import type { Actor } from "../rbac";
import { isPasswordExpired } from "../security/password";
import { SESSION_POLICY } from "./policy";

export type SessionUser = Pick<
  User,
  "id" | "email" | "name" | "role" | "status" | "mfaEnabledAt" | "mustChangePassword" | "passwordChangedAt"
>;

export type CurrentSession = {
  session: UserSession;
  user: SessionUser;
  actor: Actor;
  mfaVerified: boolean;
  passwordChangeRequired: boolean;
};

const userSelect = {
  id: true, email: true, name: true, role: true, status: true,
  mfaEnabledAt: true, mustChangePassword: true, passwordChangedAt: true,
} as const;

/** The current valid session, or null. Cached per request. */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const jwt = await auth();
  if (!jwt?.sid) return null;
  const row = await prisma.userSession.findUnique({ where: { id: jwt.sid }, include: { user: { select: userSelect } } });
  if (!row || row.userId !== jwt.user?.id) return null;

  const now = Date.now();
  const idleExpired = now - row.lastSeenAt.getTime() > SESSION_POLICY.idleMinutes * 60_000;
  if (row.revokedAt || row.expiresAt.getTime() <= now || row.user.status !== "ACTIVE" || idleExpired) {
    if (!row.revokedAt && idleExpired) {
      await prisma.userSession.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      await recordAudit(prisma, {
        action: "auth.session.idle_timeout",
        actor: row.user,
        entityType: "UserSession",
        entityId: row.id,
      });
    }
    return null;
  }
  if (now - row.lastSeenAt.getTime() > SESSION_POLICY.touchEverySeconds * 1000) {
    await prisma.userSession.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
  }
  const { user, ...session } = row;
  return {
    session,
    user,
    actor: { id: user.id, role: user.role, status: user.status },
    mfaVerified: !!row.mfaVerifiedAt,
    passwordChangeRequired: user.mustChangePassword || isPasswordExpired(user.passwordChangedAt),
  };
});

type Stage = "mfa" | "password" | "full";

/**
 * Require a signed-in user who has passed every gate up to ``stage``:
 *  - "mfa": signed in with a password (used by the MFA pages themselves)
 *  - "password": MFA verified (used by the forced password change page)
 *  - "full": MFA verified and no password change pending (everything else)
 */
export async function requireSession(stage: Stage = "full"): Promise<CurrentSession> {
  const s = await getCurrentSession();
  if (!s) redirect("/login?expired=1");
  if (stage === "mfa") return s;
  if (!s.mfaVerified) redirect(s.user.mfaEnabledAt ? "/mfa" : "/mfa/setup");
  if (stage === "password") return s;
  if (s.passwordChangeRequired) redirect("/account/password");
  return s;
}
