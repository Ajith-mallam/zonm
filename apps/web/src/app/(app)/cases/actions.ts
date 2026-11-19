"use server";
import { CasePriority } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { currentRequestContext } from "@/lib/auth/request-context";
import { requireSession } from "@/lib/auth/session";
import { allocateCaseReference } from "@/lib/cases";
import { prisma } from "@/lib/db";
import type { ActionResult } from "@/lib/form-state";
import { can } from "@/lib/rbac";

const createSchema = z.object({
  title: z.string().trim().min(3, "Enter a title of at least 3 characters.").max(200),
  description: z.string().trim().max(5000).optional().transform((v) => v || null),
  priority: z.enum(CasePriority),
  leadId: z.string().optional().transform((v) => v || null),
});

export async function createCaseAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { user, actor } = await requireSession();
  if (!can(actor, "case.create")) return { error: "You do not have permission to create cases." };
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { errors: parsed.error.issues.map((i) => i.message) };
  const { title, description, priority, leadId } = parsed.data;

  if (leadId) {
    const lead = await prisma.user.findUnique({ where: { id: leadId } });
    if (!lead || lead.status !== "ACTIVE" || !["SUPERVISOR", "ANALYST"].includes(lead.role)) {
      return { error: "The case lead must be an active supervisor or analyst." };
    }
  }
  const ctx = await currentRequestContext();
  const created = await prisma.$transaction(async (tx) => {
    const reference = await allocateCaseReference(tx);
    const c = await tx.case.create({ data: { reference, title, description, priority, createdById: user.id, leadId } });
    if (leadId) await tx.caseMember.create({ data: { caseId: c.id, userId: leadId, role: "LEAD", addedById: user.id } });
    await tx.caseStatusChange.create({ data: { caseId: c.id, toStatus: "OPEN", changedById: user.id, reason: "Case created" } });
    // Audit records identifiers only. Titles and descriptions can be sensitive,
    // and auditors may not have access to the case itself.
    await recordAudit(tx, {
      action: "case.create",
      actor: user,
      entityType: "Case",
      entityId: c.id,
      caseId: c.id,
      ...ctx,
      details: { reference, priority, leadId },
    });
    return c;
  });
  redirect(`/cases/${created.id}`);
}
