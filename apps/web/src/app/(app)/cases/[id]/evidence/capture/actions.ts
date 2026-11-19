"use server";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { currentRequestContext } from "@/lib/auth/request-context";
import { CaptureInputError, parseFacebookPostUrl } from "@/lib/capture/facebook";
import { CaseActionError, requireCasePermission } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { formAction, type ActionResult } from "@/lib/form-state";
import { enqueue, QUEUES, QueueUnavailableError } from "@/lib/queue";

export async function startCaptureAction(caseId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  let jobId: string | undefined;
  const r = await formAction(async () => {
    const a = await requireCasePermission(caseId, "document.upload");
    const ref = parseFacebookPostUrl(String(form.get("url") ?? ""));
    const autoAnalyse = form.get("autoAnalyse") === "on";
    if (autoAnalyse && !a.perms.has("analysis.run")) throw new CaseActionError("You can capture posts but not run analyses on this case.");
    const ctx = await currentRequestContext();
    const job = await prisma.$transaction(async (tx) => {
      const job = await tx.captureJob.create({ data: { caseId, platform: "FACEBOOK", url: ref.url, autoAnalyse, requestedById: a.user.id } });
      // The post URL is a public reference, not case content, so it is recorded.
      await recordAudit(tx, { action: "capture.request", actor: a.user, entityType: "CaptureJob", entityId: job.id, caseId, ...ctx, details: { platform: "FACEBOOK", url: ref.url, autoAnalyse } });
      return job;
    });
    try {
      await enqueue(QUEUES.capture, "capture", { jobId: job.id }, job.id);
    } catch (e) {
      await prisma.captureJob.update({ where: { id: job.id }, data: { status: "FAILED", error: (e as Error).message, finishedAt: new Date() } });
      throw e;
    }
    jobId = job.id;
  }, [CaseActionError, CaptureInputError, QueueUnavailableError]);
  if (jobId) redirect(`/cases/${caseId}/evidence/capture/${jobId}`);
  return r;
}
