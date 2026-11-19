"use server";
import { Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { currentRequestContext } from "@/lib/auth/request-context";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { hashPassword } from "@/lib/security/password";
import { createUser, generateTemporaryPassword, UserInputError } from "@/lib/users";

export type AdminState = { error?: string; created?: { email: string; temporaryPassword: string } } | undefined;

async function requireAdmin() {
  const s = await requireSession();
  if (!can(s.actor, "user.manage")) redirect("/");
  return { ...s, ctx: await currentRequestContext() };
}

const createSchema = z.object({
  email: z.string().max(320),
  name: z.string().max(200),
  role: z.enum(Role),
});

export async function createUserAction(_: AdminState, form: FormData): Promise<AdminState> {
  const { user: admin, ctx } = await requireAdmin();
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the form fields." };
  try {
    const created = await prisma.$transaction((tx) => createUser(tx, parsed.data, admin, ctx));
    revalidatePath("/admin/users");
    return { created: { email: created.user.email, temporaryPassword: created.temporaryPassword } };
  } catch (e) {
    if (e instanceof UserInputError) return { error: e.message };
    throw e;
  }
}

const idSchema = z.object({ userId: z.string().min(1) });

/** Every action below targets another user; acting on yourself is refused. */
async function target(form: FormData) {
  const s = await requireAdmin();
  const { userId } = idSchema.parse(Object.fromEntries(form));
  if (userId === s.user.id) throw new Error("Administrators cannot change their own account here.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return { ...s, target: user };
}

const revokeAll = (userId: string) =>
  prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

export async function setStatusAction(form: FormData) {
  const { user: admin, target: u, ctx } = await target(form);
  const status = form.get("status") === "ACTIVE" ? "ACTIVE" : "DISABLED";
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { status } });
    if (status === "DISABLED") await tx.userSession.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit(tx, { action: status === "ACTIVE" ? "user.enable" : "user.disable", actor: admin, entityType: "User", entityId: u.id, ...ctx, details: { email: u.email } });
  });
  revalidatePath("/admin/users");
}

export async function setRoleAction(form: FormData) {
  const { user: admin, target: u, ctx } = await target(form);
  const role = z.enum(Role).parse(form.get("role"));
  if (role === u.role) return;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { role } });
    await recordAudit(tx, { action: "user.role.change", actor: admin, entityType: "User", entityId: u.id, ...ctx, details: { email: u.email, from: u.role, to: role } });
  });
  await revokeAll(u.id); // new permissions take effect at next sign-in
  revalidatePath("/admin/users");
}

export async function unlockAction(form: FormData) {
  const { user: admin, target: u, ctx } = await target(form);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { lockedUntil: null, failedLoginCount: 0 } });
    await recordAudit(tx, { action: "user.unlock", actor: admin, entityType: "User", entityId: u.id, ...ctx, details: { email: u.email } });
  });
  revalidatePath("/admin/users");
}

export async function resetMfaAction(form: FormData) {
  const { user: admin, target: u, ctx } = await target(form);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaLastUsedStep: null } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: u.id } });
    await tx.userSession.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit(tx, { action: "user.mfa.reset", actor: admin, entityType: "User", entityId: u.id, ...ctx, details: { email: u.email } });
  });
  revalidatePath("/admin/users");
}

export async function resetPasswordAction(_: AdminState, form: FormData): Promise<AdminState> {
  const { user: admin, target: u, ctx } = await target(form);
  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);
  await prisma.$transaction(async (tx) => {
    await tx.passwordHistory.create({ data: { userId: u.id, passwordHash: u.passwordHash } });
    await tx.user.update({
      where: { id: u.id },
      data: { passwordHash: hash, mustChangePassword: true, passwordChangedAt: new Date(), lockedUntil: null, failedLoginCount: 0 },
    });
    await tx.userSession.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit(tx, { action: "user.password.reset", actor: admin, entityType: "User", entityId: u.id, ...ctx, details: { email: u.email } });
  });
  revalidatePath("/admin/users");
  return { created: { email: u.email, temporaryPassword } };
}
