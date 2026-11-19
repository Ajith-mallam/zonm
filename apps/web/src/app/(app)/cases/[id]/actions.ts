"use server";
// M2 case actions. Each one checks the case permission (and the case status)
// via requireCasePermission, changes data and writes its audit record in a single
// transaction. Audit details carry identifiers and field names, not case content.
import { CaseMemberRole, CasePriority, CaseStatus, TaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { currentRequestContext } from "@/lib/auth/request-context";
import { CaseActionError, requireCasePermission } from "@/lib/case-access";
import { reasonRequired, statusChangeAllowed } from "@/lib/cases";
import { prisma } from "@/lib/db";
import { formAction, type ActionResult } from "@/lib/form-state";
import { parseDateInput } from "@/lib/format";

const fail = (msg: string): never => {
  throw new CaseActionError(msg);
};
const parse = <T,>(schema: z.ZodType<T>, form: FormData): T => {
  const r = schema.safeParse(Object.fromEntries(form));
  if (!r.success) fail(r.error.issues.map((i) => i.message).join(" "));
  return r.data as T;
};
const run = (caseId: string, fn: () => Promise<void | ActionResult>) =>
  formAction(async () => {
    const r = await fn();
    revalidatePath(`/cases/${caseId}`, "layout");
    return r;
  }, [CaseActionError]);

// ───────────────────────────────────────────────────────── details & status

const detailsSchema = z.object({
  title: z.string().trim().min(3, "Enter a title of at least 3 characters.").max(200),
  description: z.string().trim().max(5000).transform((v) => v || null),
  priority: z.enum(CasePriority),
});

export async function updateCaseAction(caseId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "case.update");
    const d = parse(detailsSchema, form);
    const changed = (Object.keys(d) as (keyof typeof d)[]).filter((k) => d[k] !== a.case[k]);
    if (!changed.length) return;
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      await tx.case.update({ where: { id: caseId }, data: d });
      await recordAudit(tx, { action: "case.update", actor: a.user, entityType: "Case", entityId: caseId, caseId, ...ctx, details: { fields: changed } });
    });
  });
}

const statusSchema = z.object({ to: z.enum(CaseStatus), reason: z.string().trim().max(2000).transform((v) => v || null) });

export async function changeStatusAction(caseId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "case.status.change");
    const { to, reason } = parse(statusSchema, form);
    const from = a.case.status;
    if (!statusChangeAllowed(a.perms, from, to)) fail("You cannot make that status change.");
    if (reasonRequired(from, to) && !reason) fail("Give a reason for this status change.");
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      // Conditional on the current status, so two concurrent changes cannot both apply.
      const r = await tx.case.updateMany({
        where: { id: caseId, status: from },
        data: { status: to, closedAt: to === "CLOSED" ? new Date() : to === "OPEN" ? null : undefined },
      });
      if (r.count !== 1) fail("The case changed while you were working. Reload and try again.");
      await tx.caseStatusChange.create({ data: { caseId, fromStatus: from, toStatus: to, reason, changedById: a.user.id } });
      await recordAudit(tx, {
        action: "case.status.change",
        actor: a.user,
        entityType: "Case",
        entityId: caseId,
        caseId,
        ...ctx,
        details: { from, to, reasonGiven: !!reason },
      });
    });
  });
}

// ──────────────────────────────────────────────────────────────────── team

const memberSchema = z.object({ userId: z.string().min(1, "Choose a user."), role: z.enum(CaseMemberRole) });

/** Make ``userId`` the only LEAD: demote any other lead and set Case.leadId. */
async function assignLead(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], caseId: string, userId: string) {
  await tx.caseMember.updateMany({ where: { caseId, role: "LEAD", userId: { not: userId } }, data: { role: "ANALYST" } });
  await tx.case.update({ where: { id: caseId }, data: { leadId: userId } });
}

async function eligibleUser(userId: string, role: CaseMemberRole) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || u.status !== "ACTIVE") fail("That user is not active.");
  if (u!.role === "ADMIN") fail("Administrators cannot be case team members.");
  if (role === "LEAD" && !["SUPERVISOR", "ANALYST"].includes(u!.role)) fail("The case lead must be a supervisor or analyst.");
  return u!;
}

export async function addMemberAction(caseId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "case.team.manage");
    const { userId, role } = parse(memberSchema, form);
    const u = await eligibleUser(userId, role);
    if (await prisma.caseMember.findUnique({ where: { caseId_userId: { caseId, userId } } })) fail(`${u.name} is already on the team.`);
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      await tx.caseMember.create({ data: { caseId, userId, role, addedById: a.user.id } });
      if (role === "LEAD") await assignLead(tx, caseId, userId);
      await recordAudit(tx, { action: "case.member.add", actor: a.user, entityType: "User", entityId: userId, caseId, ...ctx, details: { role } });
    });
  });
}

export async function setMemberRoleAction(caseId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "case.team.manage");
    const { userId, role } = parse(memberSchema, form);
    const m = await prisma.caseMember.findUnique({ where: { caseId_userId: { caseId, userId } } });
    if (!m) fail("That user is not on the team.");
    if (m!.role === role) return;
    await eligibleUser(userId, role);
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      await tx.caseMember.update({ where: { id: m!.id }, data: { role } });
      if (role === "LEAD") await assignLead(tx, caseId, userId);
      else if (m!.role === "LEAD") await tx.case.update({ where: { id: caseId }, data: { leadId: null } });
      await recordAudit(tx, { action: "case.member.role", actor: a.user, entityType: "User", entityId: userId, caseId, ...ctx, details: { from: m!.role, to: role } });
    });
  });
}

export async function removeMemberAction(caseId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "case.team.manage");
    const { userId } = parse(z.object({ userId: z.string().min(1) }), form);
    const m = await prisma.caseMember.findUnique({ where: { caseId_userId: { caseId, userId } } });
    if (!m) return;
    if (userId === a.user.id && a.actor.role !== "SUPERVISOR") fail("You cannot remove yourself. Ask a supervisor.");
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      await tx.caseMember.delete({ where: { id: m.id } });
      if (m.role === "LEAD") await tx.case.update({ where: { id: caseId }, data: { leadId: null } });
      await tx.caseTask.updateMany({ where: { caseId, assigneeId: userId, status: { not: "DONE" } }, data: { assigneeId: null } });
      await recordAudit(tx, { action: "case.member.remove", actor: a.user, entityType: "User", entityId: userId, caseId, ...ctx, details: { role: m.role } });
    });
  });
}

// ─────────────────────────────────────────────────────────────────── notes

const noteSchema = z.object({ body: z.string().trim().min(1, "Write a note first.").max(10000) });

export async function addNoteAction(caseId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "case.note.write");
    const { body } = parse(noteSchema, form);
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      const n = await tx.caseNote.create({ data: { caseId, authorId: a.user.id, body } });
      await recordAudit(tx, { action: "case.note.add", actor: a.user, entityType: "CaseNote", entityId: n.id, caseId, ...ctx, details: { length: body.length } });
    });
  });
}

// ─────────────────────────────────────────────────────────────────── tasks

const taskSchema = z.object({
  title: z.string().trim().min(2, "Enter a task title.").max(200),
  description: z.string().trim().max(5000).optional().transform((v) => v || null),
  assigneeId: z.string().optional().transform((v) => v || null),
  dueAt: z.string().optional(),
});

async function assertAssignable(caseId: string, assigneeId: string | null) {
  if (!assigneeId) return;
  const m = await prisma.caseMember.findUnique({ where: { caseId_userId: { caseId, userId: assigneeId } } });
  if (!m) fail("Tasks can only be assigned to team members.");
}

export async function createTaskAction(caseId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "case.task.write");
    const t = parse(taskSchema, form);
    await assertAssignable(caseId, t.assigneeId);
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      const task = await tx.caseTask.create({
        data: { caseId, title: t.title, description: t.description, assigneeId: t.assigneeId, dueAt: parseDateInput(t.dueAt ?? null), createdById: a.user.id },
      });
      await recordAudit(tx, { action: "case.task.create", actor: a.user, entityType: "CaseTask", entityId: task.id, caseId, ...ctx, details: { assigneeId: t.assigneeId } });
    });
  });
}

const taskUpdateSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(TaskStatus),
  assigneeId: z.string().optional().transform((v) => v || null),
});

export async function updateTaskAction(caseId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "case.task.write");
    const u = parse(taskUpdateSchema, form);
    const task = await prisma.caseTask.findFirst({ where: { id: u.taskId, caseId } });
    if (!task) fail("Task not found.");
    const changes = { ...(u.status !== task!.status && { status: u.status }), ...(u.assigneeId !== task!.assigneeId && { assigneeId: u.assigneeId }) };
    if (!Object.keys(changes).length) return;
    await assertAssignable(caseId, u.assigneeId);
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      await tx.caseTask.update({ where: { id: task!.id }, data: changes });
      await recordAudit(tx, { action: "case.task.update", actor: a.user, entityType: "CaseTask", entityId: task!.id, caseId, ...ctx, details: changes });
    });
  });
}
