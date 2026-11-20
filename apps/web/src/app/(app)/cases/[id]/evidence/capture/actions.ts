"use server";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { currentRequestContext } from "@/lib/auth/request-context";
import { CaptureInputError, parseSocialUrl } from "@/lib/capture/platforms";
import { CaseActionError, requireCasePermission } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { formAction, type ActionResult } from "@/lib/form-state";
import { dispatchJob } from "@/lib/jobs";
import { QueueUnavailableError } from "@/lib/queue";

/** Posts fetched from a profile or page. */
const PROFILE_POSTS = 10;

export async function startCaptureAction(caseId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  let jobId: string | undefined;
  const r = await formAction(async () => {
    const a = await requireCasePermission(caseId, "document.upload");
    const target = parseSocialUrl(String(form.get("url") ?? ""));

    // What the captured posts become: questioned writing, or a candidate's known writing.
    const use = String(form.get("use") ?? "questioned");
    let candidateId: string | null = null;
    if (use.startsWith("known:")) {
      candidateId = use.slice(6);
      if (!(await prisma.candidate.findFirst({ where: { id: candidateId, caseId } }))) throw new CaseActionError("Choose a candidate from this case.");
    }
    const autoAnalyse = !candidateId && form.get("autoAnalyse") === "on";
    if (autoAnalyse && !a.perms.has("analysis.run")) throw new CaseActionError("You can collect posts but not run analyses on this case.");

    const ctx = await currentRequestContext();
    const job = await prisma.$transaction(async (tx) => {
      const job = await tx.captureJob.create({
        data: {
          caseId,
          platform: target.platform,
          url: target.url,
          kind: target.kind,
          maxPosts: target.kind === "POST" ? 1 : PROFILE_POSTS,
          role: candidateId ? "KNOWN" : "QUESTIONED",
          candidateId,
          autoAnalyse,
          requestedById: a.user.id,
        },
      });
      // The link is a public reference, not case content, so it is recorded.
      await recordAudit(tx, {
        action: "capture.request",
        actor: a.user,
        entityType: "CaptureJob",
        entityId: job.id,
        caseId,
        ...ctx,
        details: { platform: target.platform, kind: target.kind, url: target.url, use: candidateId ? "known" : "questioned", candidateId, autoAnalyse },
      });
      return job;
    });
    try {
      await dispatchJob("capture", job.id);
    } catch (e) {
      await prisma.captureJob.update({ where: { id: job.id }, data: { status: "FAILED", error: (e as Error).message, finishedAt: new Date() } });
      throw e;
    }
    jobId = job.id;
  }, [CaseActionError, CaptureInputError, QueueUnavailableError]);
  if (jobId) redirect(`/cases/${caseId}/evidence/capture/${jobId}`);
  return r;
}
