"use server";
// M3 candidate actions. The real identity (CandidateIdentity) is restricted:
// reading it needs candidate.identity.read plus a stated purpose and is audited.
// Writing it needs candidate.identity.write. Identity values never go into the
// audit log; only the candidate id, the field names and the purpose do.
import { Platform, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { currentRequestContext } from "@/lib/auth/request-context";
import { CaseActionError, requireCasePermission } from "@/lib/case-access";
import { normaliseHandle } from "@/lib/candidates";
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

async function candidateIn(caseId: string, candidateId: string) {
  const c = await prisma.candidate.findFirst({ where: { id: candidateId, caseId } });
  if (!c) fail("Candidate not found.");
  return c!;
}

// ───────────────────────────────────────────────────────── candidates

const candidateSchema = z.object({
  pseudonym: z.string().trim().min(1, "Enter a pseudonym.").max(80),
  notes: z.string().trim().max(5000).optional().transform((v) => v || null),
});

export async function createCandidateAction(caseId: string, _: ActionResult, form: FormData) {
  let createdId: string | undefined;
  const r = await run(caseId, async () => {
    const a = await requireCasePermission(caseId, "candidate.write");
    const d = parse(candidateSchema, form);
    if (await prisma.candidate.findFirst({ where: { caseId, pseudonym: { equals: d.pseudonym, mode: "insensitive" } } })) {
      fail(`"${d.pseudonym}" is already used in this case.`);
    }
    const ctx = await currentRequestContext();
    createdId = await prisma.$transaction(async (tx) => {
      const c = await tx.candidate.create({ data: { caseId, pseudonym: d.pseudonym, notes: d.notes, createdById: a.user.id } });
      await recordAudit(tx, { action: "candidate.create", actor: a.user, entityType: "Candidate", entityId: c.id, caseId, ...ctx });
      return c.id;
    });
  });
  if (createdId) redirect(`/cases/${caseId}/candidates/${createdId}`);
  return r;
}

export async function updateCandidateAction(caseId: string, candidateId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "candidate.write");
    const c = await candidateIn(caseId, candidateId);
    const d = parse(candidateSchema, form);
    if (
      d.pseudonym.toLowerCase() !== c.pseudonym.toLowerCase() &&
      (await prisma.candidate.findFirst({ where: { caseId, pseudonym: { equals: d.pseudonym, mode: "insensitive" } } }))
    ) {
      fail(`"${d.pseudonym}" is already used in this case.`);
    }
    const fields = (["pseudonym", "notes"] as const).filter((k) => d[k] !== c[k]);
    if (!fields.length) return;
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      await tx.candidate.update({ where: { id: c.id }, data: d });
      await recordAudit(tx, { action: "candidate.update", actor: a.user, entityType: "Candidate", entityId: c.id, caseId, ...ctx, details: { fields } });
    });
  });
}

export async function deleteCandidateAction(caseId: string, candidateId: string) {
  const r = await run(caseId, async () => {
    const a = await requireCasePermission(caseId, "candidate.write");
    const c = await candidateIn(caseId, candidateId);
    const [docs, monitors, captures] = await Promise.all([
      prisma.document.count({ where: { candidateId: c.id } }),
      prisma.socialMonitor.count({ where: { candidateId: c.id } }),
      prisma.captureJob.count({ where: { candidateId: c.id, status: { in: ["QUEUED", "RUNNING"] } } }),
    ]);
    if (docs || monitors) fail("This candidate has evidence or monitors attached and cannot be deleted.");
    if (captures) fail("Posts are still being collected for this candidate. Wait for the collection to finish.");
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      await tx.candidate.delete({ where: { id: c.id } }); // handles and identity cascade
      await recordAudit(tx, { action: "candidate.delete", actor: a.user, entityType: "Candidate", entityId: c.id, caseId, ...ctx });
    });
  });
  if (r?.ok) redirect(`/cases/${caseId}/candidates`);
  return r;
}

// ─────────────────────────────────────────────────────────── handles

const handleSchema = z.object({
  platform: z.enum(Platform),
  handle: z.string().trim().min(1, "Enter the handle, number or address.").max(200),
  profileUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null)
    .refine((v) => !v || /^https?:\/\//i.test(v), "The profile URL must start with http:// or https://."),
});

export async function addHandleAction(caseId: string, candidateId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "candidate.write");
    const c = await candidateIn(caseId, candidateId);
    const d = parse(handleSchema, form);
    const handle = normaliseHandle(d.platform, d.handle);
    if (!handle) fail("Enter the handle, number or address.");
    if (await prisma.candidateHandle.findUnique({ where: { candidateId_platform_handle: { candidateId: c.id, platform: d.platform, handle } } })) {
      fail("That handle is already recorded.");
    }
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      const h = await tx.candidateHandle.create({ data: { candidateId: c.id, platform: d.platform, handle, profileUrl: d.profileUrl } });
      await recordAudit(tx, { action: "candidate.handle.add", actor: a.user, entityType: "CandidateHandle", entityId: h.id, caseId, ...ctx, details: { candidateId: c.id, platform: d.platform } });
    });
  });
}

export async function removeHandleAction(caseId: string, candidateId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "candidate.write");
    const c = await candidateIn(caseId, candidateId);
    const { handleId } = parse(z.object({ handleId: z.string().min(1) }), form);
    const h = await prisma.candidateHandle.findFirst({ where: { id: handleId, candidateId: c.id } });
    if (!h) return;
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      await tx.candidateHandle.delete({ where: { id: h.id } });
      await recordAudit(tx, { action: "candidate.handle.remove", actor: a.user, entityType: "CandidateHandle", entityId: h.id, caseId, ...ctx, details: { candidateId: c.id, platform: h.platform } });
    });
  });
}

// ──────────────────────────────────────────────── restricted identity

export type RevealedIdentity = {
  realName: string;
  dateOfBirth: string | null;
  identifiers: string;
  legalBasis: string;
  legalReference: string | null;
  recordedBy: string;
  recordedAt: string;
};
export type RevealResult = (NonNullable<ActionResult> & { identity?: RevealedIdentity | null }) | undefined;

const purposeSchema = z.object({ purpose: z.string().trim().min(5, "State why you need to see the identity.").max(300) });

/** Reveal the real identity to the current user. Audited with the stated purpose. */
export async function revealIdentityAction(caseId: string, candidateId: string, _: RevealResult, form: FormData): Promise<RevealResult> {
  return (await formAction(async () => {
    const a = await requireCasePermission(caseId, "candidate.identity.read");
    const c = await candidateIn(caseId, candidateId);
    const { purpose } = parse(purposeSchema, form);
    const id = await prisma.candidateIdentity.findUnique({ where: { candidateId: c.id } });
    await recordAudit(prisma, {
      action: "candidate.identity.read",
      actor: a.user,
      entityType: "Candidate",
      entityId: c.id,
      caseId,
      ...(await currentRequestContext()),
      details: { purpose, identityOnFile: !!id },
    });
    if (!id) return { ok: true, identity: null } as RevealResult;
    const recordedBy = await prisma.user.findUnique({ where: { id: id.recordedById }, select: { name: true } });
    return {
      ok: true,
      identity: {
        realName: id.realName,
        dateOfBirth: id.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        identifiers: typeof id.identifiers === "object" && id.identifiers && "text" in id.identifiers ? String(id.identifiers.text) : "",
        legalBasis: id.legalBasis,
        legalReference: id.legalReference,
        recordedBy: recordedBy?.name ?? "Unknown",
        recordedAt: id.updatedAt.toISOString(),
      },
    } as RevealResult;
  }, [CaseActionError])) as RevealResult;
}

const identitySchema = z.object({
  realName: z.string().trim().min(2, "Enter the person's full name.").max(200),
  dateOfBirth: z.string().optional(),
  identifiers: z.string().trim().max(2000).optional().transform((v) => v || ""),
  legalBasis: z.string().trim().min(5, "State the legal basis for processing this identity.").max(500),
  legalReference: z.string().trim().max(200).optional().transform((v) => v || null),
});

export async function saveIdentityAction(caseId: string, candidateId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "candidate.identity.write");
    const c = await candidateIn(caseId, candidateId);
    const d = parse(identitySchema, form);
    const data = {
      realName: d.realName,
      dateOfBirth: parseDateInput(d.dateOfBirth ?? null),
      // An empty field clears stored identifiers (undefined would leave them unchanged).
      identifiers: d.identifiers ? { text: d.identifiers } : Prisma.DbNull,
      legalBasis: d.legalBasis,
      legalReference: d.legalReference,
      recordedById: a.user.id,
    };
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      const existing = await tx.candidateIdentity.findUnique({ where: { candidateId: c.id } });
      await tx.candidateIdentity.upsert({ where: { candidateId: c.id }, create: { candidateId: c.id, ...data }, update: data });
      await recordAudit(tx, {
        action: existing ? "candidate.identity.update" : "candidate.identity.create",
        actor: a.user,
        entityType: "Candidate",
        entityId: c.id,
        caseId,
        ...ctx,
        details: { legalReferenceGiven: !!d.legalReference, dateOfBirthGiven: !!data.dateOfBirth, identifiersGiven: !!d.identifiers },
      });
    });
  });
}
