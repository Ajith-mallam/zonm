"use server";
// M4 evidence actions: import an uploaded file's units as documents, exclude or
// include a document, create a new working version, reassign role/candidate.
// Originals are never changed (DB triggers enforce it); every action is audited
// with identifiers and counts only.
import { DocumentRole, Platform, VersionChange } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { currentRequestContext } from "@/lib/auth/request-context";
import { CaseActionError, requireCasePermission } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { caseTextHashes, extractOptionsFrom, extractSourceFile, IntegrityError } from "@/lib/evidence";
import { formAction, type ActionResult } from "@/lib/form-state";
import { changedSpan, parseTarget, planImport, type Target } from "@/lib/ingest/plan";
import { ExtractionError } from "@/lib/ingest/types";
import { countWords, sha256Hex } from "@/lib/text";

const fail = (msg: string): never => {
  throw new CaseActionError(msg);
};
const EXPECTED = [CaseActionError, ExtractionError, IntegrityError];

// ─────────────────────────────────────────────────────────────── import

export async function importAction(caseId: string, fileId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  let created = 0;
  const r = await formAction(async () => {
    const a = await requireCasePermission(caseId, "document.upload");
    const file = await prisma.sourceFile.findFirst({ where: { id: fileId, caseId } });
    if (!file) fail("Upload not found.");
    const opts = extractOptionsFrom((k) => form.get(k) as string | null);
    const ex = await extractSourceFile(file!, opts);

    // Targets: one for the whole file, or one per author (a_<i> = author, t_<i> = target).
    const perAuthor = new Map<string, Target>();
    for (const [k, v] of form.entries()) {
      const m = /^a_(\d+)$/.exec(k);
      if (m) perAuthor.set(String(v), parseTarget(form.get(`t_${m[1]}`) as string | null));
    }
    const single = parseTarget(form.get("target") as string | null);
    const targetFor = (author: string) => (ex.hasAuthors ? (perAuthor.get(author) ?? { kind: "skip" as const }) : single);

    const candidates = new Set((await prisma.candidate.findMany({ where: { caseId }, select: { id: true } })).map((c) => c.id));
    const includeDuplicates = form.get("includeDuplicates") === "on";
    const plan = planImport(ex.units, targetFor, await caseTextHashes(caseId)).filter((p) => p.wordCount > 0);
    for (const p of plan) if (p.candidateId && !candidates.has(p.candidateId)) fail("A selected candidate does not belong to this case.");
    const toCreate = includeDuplicates ? plan : plan.filter((p) => !p.duplicateOfId && !p.duplicateInFile);
    if (!toCreate.length) fail(plan.length ? "Everything selected is already in this case (duplicates)." : "Nothing selected to import. Choose a role for at least one author.");

    const platformRaw = form.get("platform");
    const platform = ex.platform ?? (Object.values(Platform).includes(platformRaw as Platform) ? (platformRaw as Platform) : null);
    const split = ex.units.length > 1;
    const ctx = await currentRequestContext();

    await prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < toCreate.length; i += 500) {
          const batch = toCreate.slice(i, i + 500);
          const docs = await tx.document.createManyAndReturn({
            data: batch.map((p) => ({
              caseId,
              role: p.role,
              candidateId: p.candidateId,
              sourceFileId: file!.id,
              sourceType: ex.sourceType,
              title: split ? `${file!.filename} #${p.position}` : file!.filename,
              originalText: p.text,
              sha256: p.sha256,
              wordCount: p.wordCount,
              authorLabel: p.authorLabel ?? null,
              authoredAt: p.authoredAt ?? null,
              platform,
              sourceUrl: p.sourceUrl ?? null,
              externalId: p.externalId ?? null,
              duplicateOfId: p.duplicateOfId,
              metadata: { position: p.position, extraction: { ...opts, ...ex.used } },
              createdById: a.user.id,
            })),
            select: { id: true, originalText: true, sha256: true, wordCount: true },
          });
          await tx.documentVersion.createMany({
            data: docs.map((d) => ({ documentId: d.id, version: 1, change: "ORIGINAL" as const, text: d.originalText, sha256: d.sha256, wordCount: d.wordCount, createdById: a.user.id })),
          });
        }
        const byTarget: Record<string, number> = {};
        for (const p of toCreate) {
          const k = p.role === "QUESTIONED" ? "questioned" : `known:${p.candidateId}`;
          byTarget[k] = (byTarget[k] ?? 0) + 1;
        }
        await recordAudit(tx, {
          action: "document.import",
          actor: a.user,
          entityType: "SourceFile",
          entityId: file!.id,
          caseId,
          ...ctx,
          details: { documents: toCreate.length, duplicatesSkipped: plan.length - toCreate.length, byTarget, sourceType: ex.sourceType },
        });
      },
      { timeout: 120_000 },
    );
    created = toCreate.length;
  }, EXPECTED);
  if (created) {
    revalidatePath(`/cases/${caseId}`, "layout");
    redirect(`/cases/${caseId}/evidence?imported=${created}`);
  }
  return r;
}

// ───────────────────────────────────────────────────── document changes

async function docIn(caseId: string, documentId: string) {
  const d = await prisma.document.findFirst({ where: { id: documentId, caseId } });
  if (!d) fail("Document not found.");
  return d!;
}

const run = (caseId: string, fn: () => Promise<void>) =>
  formAction(async () => {
    await fn();
    revalidatePath(`/cases/${caseId}`, "layout");
  }, EXPECTED);

const excludeSchema = z.object({
  exclude: z.enum(["true", "false"]),
  reason: z.string().trim().max(500).optional().transform((v) => v || null),
});

export async function setExcludedAction(caseId: string, documentId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "document.exclude");
    const d = await docIn(caseId, documentId);
    const p = excludeSchema.safeParse(Object.fromEntries(form));
    if (!p.success) fail("Invalid request.");
    const exclude = p.data!.exclude === "true";
    if (exclude && !p.data!.reason) fail("Give a reason for excluding this document.");
    if (d.excluded === exclude) return;
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: d.id }, data: { excluded: exclude, excludedReason: exclude ? p.data!.reason : null } });
      await recordAudit(tx, { action: exclude ? "document.exclude" : "document.include", actor: a.user, entityType: "Document", entityId: d.id, caseId, ...ctx });
    });
  });
}

const versionSchema = z.object({
  text: z.string().max(2_000_000),
  change: z.enum([VersionChange.REDACTION, VersionChange.PARTIAL_EXCLUSION, VersionChange.CORRECTION]),
  reason: z.string().trim().min(3, "Give a reason for this change.").max(1000),
});

export async function createVersionAction(caseId: string, documentId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "document.version.create");
    const d = await docIn(caseId, documentId);
    const p = versionSchema.safeParse(Object.fromEntries(form));
    if (!p.success) fail(p.error!.issues.map((i) => i.message).join(" "));
    const text = p.data!.text.replace(/\r\n?/g, "\n").trim();
    if (!text) fail("The new version is empty. Exclude the document instead.");
    const latest = await prisma.documentVersion.findFirst({ where: { documentId: d.id }, orderBy: { version: "desc" } });
    if (!latest) fail("Document has no versions.");
    const span = changedSpan(latest!.text, text);
    if (!span) fail("The text has not changed.");
    const words = countWords(text);
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      const v = await tx.documentVersion.create({
        data: {
          documentId: d.id,
          version: latest!.version + 1,
          change: p.data!.change,
          text,
          sha256: sha256Hex(text),
          wordCount: words,
          spans: [{ ...span!, reason: p.data!.reason }],
          reason: p.data!.reason,
          createdById: a.user.id,
        },
      });
      await tx.document.update({ where: { id: d.id }, data: { wordCount: words } });
      await recordAudit(tx, {
        action: "document.version.create",
        actor: a.user,
        entityType: "Document",
        entityId: d.id,
        caseId,
        ...ctx,
        details: { version: v.version, change: v.change, sha256: v.sha256, removedChars: span!.end - span!.start, insertedChars: span!.insertedLength },
      });
    });
  });
}

const reassignSchema = z.object({ role: z.enum(DocumentRole), candidateId: z.string().optional().transform((v) => v || null) });

export async function reassignAction(caseId: string, documentId: string, _: ActionResult, form: FormData) {
  return run(caseId, async () => {
    const a = await requireCasePermission(caseId, "document.version.create");
    const d = await docIn(caseId, documentId);
    const p = reassignSchema.safeParse(Object.fromEntries(form));
    if (!p.success) fail("Invalid request.");
    const { role } = p.data!;
    const candidateId = role === "KNOWN" ? p.data!.candidateId : null;
    if (role === "KNOWN" && !candidateId) fail("Choose the candidate this known writing belongs to.");
    if (candidateId && !(await prisma.candidate.findFirst({ where: { id: candidateId, caseId } }))) fail("Candidate not found.");
    if (role === d.role && candidateId === d.candidateId) return;
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: d.id }, data: { role, candidateId } });
      await recordAudit(tx, {
        action: "document.reassign",
        actor: a.user,
        entityType: "Document",
        entityId: d.id,
        caseId,
        ...ctx,
        details: { from: { role: d.role, candidateId: d.candidateId }, to: { role, candidateId } },
      });
    });
  });
}
