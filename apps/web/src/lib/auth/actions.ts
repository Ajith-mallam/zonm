"use server";
// M1 server actions: sign-in, MFA enrolment and challenge, password change, sign-out.
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { recordAudit } from "../audit";
import { prisma } from "../db";
import { decryptSecret } from "../security/crypto";
import {
  checkPasswordPolicy, generateRecoveryCodes, hashPassword, hashRecoveryCode, isLocked, isReused,
  PASSWORD_POLICY, verifyPassword,
} from "../security/password";
import { verifyTotp } from "../security/totp";
import { registerFailure } from "./login";
import { currentRequestContext } from "./request-context";
import { getCurrentSession, requireSession } from "./session";

export type FormState = { error?: string; errors?: string[]; recoveryCodes?: string[] } | undefined;

const GENERIC_LOGIN_ERROR = "Sign-in failed. Check your e-mail and password, or try again later.";

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      redirectTo: "/",
    });
  } catch (e) {
    if (e instanceof AuthError) return { error: GENERIC_LOGIN_ERROR };
    throw e; // includes the NEXT_REDIRECT thrown on success
  }
}

async function endSession(reason: string) {
  const s = await getCurrentSession();
  if (s) {
    await prisma.userSession.update({ where: { id: s.session.id }, data: { revokedAt: new Date() } });
    await recordAudit(prisma, {
      action: "auth.logout",
      actor: s.user,
      entityType: "UserSession",
      entityId: s.session.id,
      ...(await currentRequestContext()),
      details: { reason },
    });
  }
  await signOut({ redirectTo: reason === "user" ? "/login" : `/login?reason=${reason}` });
}

export async function signOutAction() {
  await endSession("user");
}

const codeSchema = z.string().trim().min(6).max(32);

/** Confirm TOTP enrolment with a first code; returns recovery codes to show once. */
export async function confirmMfaEnrolment(_: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession("mfa");
  const ctx = await currentRequestContext();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: s.user.id } });
  if (user.mfaEnabledAt) redirect("/mfa");
  if (!user.mfaSecretEnc) return { error: "Enrolment expired. Reload the page." };
  const code = codeSchema.safeParse(form.get("code"));
  const step = code.success ? verifyTotp(decryptSecret(user.mfaSecretEnc, user.id), code.data) : null;
  if (step === null) {
    await recordAudit(prisma, { action: "auth.mfa.enrol.failure", actor: user, entityType: "User", entityId: user.id, ...ctx });
    return { error: "That code is not valid. Check the time on your phone and try again." };
  }
  const { codes, hashes } = generateRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date(), mfaLastUsedStep: BigInt(step) } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.mfaRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash })) });
    await tx.userSession.update({ where: { id: s.session.id }, data: { mfaVerifiedAt: new Date() } });
    await recordAudit(tx, { action: "auth.mfa.enrolled", actor: user, entityType: "User", entityId: user.id, ...ctx });
  });
  return { recoveryCodes: codes };
}

/** MFA challenge after password sign-in: a TOTP code or a recovery code. */
export async function verifyMfaAction(_: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession("mfa");
  const ctx = await currentRequestContext();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: s.user.id } });
  if (!user.mfaEnabledAt || !user.mfaSecretEnc) redirect("/mfa/setup");
  if (isLocked(user)) await endSession("locked");

  const parsed = codeSchema.safeParse(form.get("code"));
  const input = parsed.success ? parsed.data : "";
  let method: "totp" | "recovery" | null = null;

  const step = verifyTotp(decryptSecret(user.mfaSecretEnc, user.id), input, { lastUsedStep: user.mfaLastUsedStep });
  if (step !== null) {
    // Conditional update: a concurrent request cannot reuse the same step.
    const won = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: BigInt(step) } }] },
      data: { mfaLastUsedStep: BigInt(step) },
    });
    if (won.count === 1) method = "totp";
  } else if (/^[0-9a-f\s-]{16,}$/i.test(input)) {
    const used = await prisma.mfaRecoveryCode.updateMany({
      where: { userId: user.id, codeHash: hashRecoveryCode(input), usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count === 1) method = "recovery";
  }

  if (!method) {
    await recordAudit(prisma, { action: "auth.mfa.failure", actor: user, entityType: "User", entityId: user.id, ...ctx });
    if (await registerFailure(user.id, ctx, "mfa")) await endSession("locked");
    return { error: "That code is not valid." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
    await tx.userSession.update({ where: { id: s.session.id }, data: { mfaVerifiedAt: new Date() } });
    const remaining = method === "recovery" ? await tx.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } }) : undefined;
    await recordAudit(tx, {
      action: "auth.mfa.success",
      actor: user,
      entityType: "UserSession",
      entityId: s.session.id,
      ...ctx,
      details: { method, ...(remaining !== undefined && { recoveryCodesRemaining: remaining }) },
    });
  });
  redirect("/");
}

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession("password");
  const ctx = await currentRequestContext();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: s.user.id },
    include: { passwordHistory: { orderBy: { createdAt: "desc" }, take: PASSWORD_POLICY.historyCount } },
  });

  if (!(await verifyPassword(user.passwordHash, current))) {
    await recordAudit(prisma, { action: "auth.password.change.failure", actor: user, entityType: "User", entityId: user.id, ...ctx, details: { reason: "bad_current" } });
    if (await registerFailure(user.id, ctx, "password")) await endSession("locked");
    return { error: "Your current password is not correct." };
  }
  if (next !== confirm) return { error: "The new passwords do not match." };
  const policy = checkPasswordPolicy(next, user);
  if (!policy.ok) return { errors: policy.errors };
  if (await isReused(next, [user.passwordHash, ...user.passwordHistory.map((h) => h.passwordHash)])) {
    return { error: `Choose a password you have not used for your last ${PASSWORD_POLICY.historyCount} changes.` };
  }

  const hash = await hashPassword(next);
  await prisma.$transaction(async (tx) => {
    await tx.passwordHistory.create({ data: { userId: user.id, passwordHash: user.passwordHash } });
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, passwordChangedAt: new Date(), mustChangePassword: false, failedLoginCount: 0 },
    });
    // Sign out every other session.
    await tx.userSession.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: s.session.id } },
      data: { revokedAt: new Date() },
    });
    await recordAudit(tx, { action: "auth.password.changed", actor: user, entityType: "User", entityId: user.id, ...ctx });
  });
  redirect("/");
}
