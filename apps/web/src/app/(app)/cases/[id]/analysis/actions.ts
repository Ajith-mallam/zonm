"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { DEFAULT_SETTINGS, METHODS, RunInputError, createRun, type RunSettings } from "@/lib/analysis";
import { currentRequestContext } from "@/lib/auth/request-context";
import { CaseActionError, requireCasePermission } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { formAction, type ActionResult } from "@/lib/form-state";
import { dispatchJob, removeQueuedJob } from "@/lib/jobs";
import { QueueUnavailableError } from "@/lib/queue";

function int(form: FormData, name: string, def: number, min: number, max: number): number {
  const raw = form.get(name);
  if (raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new CaseActionError(`${name.replace(/_/g, " ")} must be a whole number from ${min} to ${max}.`);
  return n;
}

function settingsFrom(form: FormData): RunSettings {
  const nMin = int(form, "char_ngram_min", DEFAULT_SETTINGS.char_ngram_min, 1, 8);
  const nMax = int(form, "char_ngram_max", DEFAULT_SETTINGS.char_ngram_max, 1, 8);
  if (nMin > nMax) throw new CaseActionError("The smallest n-gram size cannot be larger than the largest.");
  const weights = Object.fromEntries(METHODS.map((m) => [m, form.get(`w_${m}`) === "on" ? 1 : 0])) as RunSettings["weights"];
  if (!Object.values(weights).some(Boolean)) throw new CaseActionError("Choose at least one method.");
  return {
    ...DEFAULT_SETTINGS,
    mfw: int(form, "mfw", DEFAULT_SETTINGS.mfw, 10, 5000),
    chunk_size: int(form, "chunk_size", DEFAULT_SETTINGS.chunk_size, 50, 20000),
    char_ngram_min: nMin,
    char_ngram_max: nMax,
    weights,
  };
}

export async function startRunAction(caseId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  let runId: string | undefined;
  const r = await formAction(async () => {
    const a = await requireCasePermission(caseId, "analysis.run");
    const candidateIds = form.getAll("candidate").map(String);
    const questionedIds = form.get("questionedScope") === "selected" ? form.getAll("questioned").map(String) : ("all" as const);
    if (questionedIds !== "all" && !questionedIds.length) throw new CaseActionError("Choose at least one questioned document, or use all of them.");
    const settings = settingsFrom(form);
    const ctx = await currentRequestContext();
    const run = await prisma.$transaction(async (tx) => {
      const run = await createRun(tx, { caseId, questionedIds, candidateIds, settings, requestedById: a.user.id });
      const inputs = await tx.analysisRunInput.count({ where: { runId: run.id } });
      await recordAudit(tx, {
        action: "analysis.run.request",
        actor: a.user,
        entityType: "AnalysisRun",
        entityId: run.id,
        caseId,
        ...ctx,
        details: { candidates: candidateIds.length, inputs, settingsSha256: run.settingsSha256 },
      });
      return run;
    });
    try {
      await dispatchJob("analysis", run.id);
    } catch (e) {
      await prisma.analysisRun.update({ where: { id: run.id }, data: { status: "FAILED", error: (e as Error).message, finishedAt: new Date() } });
      throw e;
    }
    runId = run.id;
  }, [CaseActionError, RunInputError, QueueUnavailableError]);
  if (runId) redirect(`/cases/${caseId}/analysis/${runId}`);
  return r;
}

export async function cancelRunAction(caseId: string, runId: string): Promise<ActionResult> {
  return formAction(async () => {
    const a = await requireCasePermission(caseId, "analysis.cancel");
    const run = await prisma.analysisRun.findFirst({ where: { id: runId, caseId } });
    if (!run) throw new CaseActionError("Run not found.");
    if (run.status !== "QUEUED" && run.status !== "RUNNING") return;
    const ctx = await currentRequestContext();
    await prisma.$transaction(async (tx) => {
      // A queued run is cancelled at once; a running one is stopped by the worker within a second.
      await tx.analysisRun.update({
        where: { id: runId },
        data: run.status === "QUEUED" ? { cancelRequestedAt: new Date(), status: "CANCELLED", finishedAt: new Date(), error: "Cancelled by user." } : { cancelRequestedAt: new Date() },
      });
      await recordAudit(tx, { action: "analysis.run.cancel", actor: a.user, entityType: "AnalysisRun", entityId: runId, caseId, ...ctx, details: { statusAtCancel: run.status } });
    });
    if (run.status === "QUEUED") await removeQueuedJob("analysis", runId);
    revalidatePath(`/cases/${caseId}/analysis/${runId}`);
  }, [CaseActionError]);
}
