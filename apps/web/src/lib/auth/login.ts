// M1 credential check with lockout, timing equalisation and audit.
import { recordAudit } from "../audit";
import { prisma } from "../db";
import { dummyPasswordHash, isLocked, LOCKOUT_POLICY, verifyPassword } from "../security/password";
import { SESSION_POLICY } from "./policy";
import type { RequestContext } from "./request-context";

export type AuthenticatedUser = { id: string; email: string; name: string; sessionId: string };

/**
 * Count a failed attempt (password or MFA) atomically and lock the account
 * once the threshold is reached. Returns true if this attempt locked it.
 */
export async function registerFailure(userId: string, ctx: RequestContext, kind: "password" | "mfa"): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { id: true, email: true, failedLoginCount: true },
    });
    if (u.failedLoginCount < LOCKOUT_POLICY.maxFailures) return false;
    const lockedUntil = new Date(Date.now() + LOCKOUT_POLICY.lockMinutes * 60_000);
    await tx.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil } });
    await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit(tx, {
      action: "auth.lockout",
      actor: u,
      entityType: "User",
      entityId: u.id,
      ...ctx,
      details: { trigger: kind, lockedUntil: lockedUntil.toISOString(), minutes: LOCKOUT_POLICY.lockMinutes },
    });
    return true;
  });
}

export async function authenticate(
  emailRaw: string,
  password: string,
  ctx: RequestContext,
): Promise<AuthenticatedUser | null> {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  const fail = (reason: string) =>
    recordAudit(prisma, {
      action: "auth.login.failure",
      actor: user ? { id: user.id, email: user.email } : null,
      entityType: user ? "User" : undefined,
      entityId: user?.id,
      ...ctx,
      details: { email, reason },
    });

  if (!user) {
    await verifyPassword(await dummyPasswordHash(), password); // same cost as a real check
    await fail("unknown_user");
    return null;
  }
  if (user.status !== "ACTIVE") {
    await verifyPassword(await dummyPasswordHash(), password);
    await fail("disabled");
    return null;
  }
  if (isLocked(user)) {
    await fail("locked");
    return null;
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    await fail("bad_password");
    await registerFailure(user.id, ctx, "password");
    return null;
  }

  const now = new Date();
  const session = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    const s = await tx.userSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(now.getTime() + SESSION_POLICY.absoluteHours * 3600_000),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
    await recordAudit(tx, {
      action: "auth.login.success",
      actor: user,
      entityType: "UserSession",
      entityId: s.id,
      ...ctx,
      details: { mfaRequired: true, mfaEnrolled: !!user.mfaEnabledAt },
    });
    return s;
  });
  return { id: user.id, email: user.email, name: user.name, sessionId: session.id };
}
