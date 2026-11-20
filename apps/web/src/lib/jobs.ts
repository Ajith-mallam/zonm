// How background jobs (analysis runs, social media captures) are run.
//   JOB_RUNNER=queue (default): BullMQ on Redis, executed by `npm run worker`.
//   JOB_RUNNER=inline: no Redis or worker; the job runs right after the HTTP
//     response with Next's after(), inside the same serverless invocation
//     (for hosts such as Vercel). Bounded by the route's maxDuration.
import { recordAudit } from "./audit";
import { prisma } from "./db";

export type JobKind = "analysis" | "capture";

export function jobRunner(): "queue" | "inline" {
  return process.env.JOB_RUNNER === "inline" ? "inline" : "queue";
}

async function execute(kind: JobKind, id: string) {
  if (kind === "analysis") {
    const { executeRun } = await import("./analysis");
    await executeRun(id);
  } else {
    const { executeCapture } = await import("./capture/run");
    await executeCapture(id);
  }
}

/**
 * Start a job. From a request (server action), the inline runner schedules it
 * after the response. From inside a running job (`inBackground`), it runs it
 * directly, because there is no request to attach to.
 */
export async function dispatchJob(kind: JobKind, id: string, opts: { inBackground?: boolean } = {}): Promise<void> {
  if (jobRunner() === "queue") {
    const { enqueue, QUEUES } = await import("./queue");
    await enqueue(QUEUES[kind], kind === "analysis" ? "analyze" : "capture", kind === "analysis" ? { runId: id } : { jobId: id }, id);
    return;
  }
  if (opts.inBackground) {
    await execute(kind, id);
    return;
  }
  const { after } = await import("next/server");
  after(async () => {
    try {
      await execute(kind, id);
    } catch (e) {
      console.error(`[jobs] ${kind} ${id} crashed:`, e);
    }
  });
}

/** Remove a queued job that was cancelled (queue runner only). */
export async function removeQueuedJob(kind: JobKind, id: string): Promise<void> {
  if (jobRunner() !== "queue") return;
  const { queue, QUEUES } = await import("./queue");
  await queue(QUEUES[kind]).remove(id).catch(() => undefined);
}

/**
 * Fail jobs left RUNNING (or QUEUED, inline only) longer than any job can
 * take: their worker or serverless invocation died. Each one is audited.
 * The worker calls this at start-up; with the inline runner, pages that show
 * jobs call it (there is no long-lived process to do it).
 */
export async function failAbandonedJobs(staleMinutes = jobRunner() === "inline" ? 10 : 20): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const statuses = jobRunner() === "inline" ? (["QUEUED", "RUNNING"] as const) : (["RUNNING"] as const);
  const runs = await prisma.analysisRun.findMany({
    where: { status: { in: [...statuses] }, OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, queuedAt: { lt: cutoff } }] },
    select: { id: true, caseId: true },
  });
  const caps = await prisma.captureJob.findMany({
    where: { status: { in: [...statuses] }, OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, createdAt: { lt: cutoff } }] },
    select: { id: true, caseId: true },
  });
  let n = 0;
  for (const r of runs) {
    const done = await prisma.analysisRun.updateMany({ where: { id: r.id, status: { in: [...statuses] } }, data: { status: "FAILED", error: "The job stopped before it finished.", finishedAt: new Date() } });
    if (done.count) {
      n++;
      await recordAudit(prisma, { action: "analysis.run.failed", entityType: "AnalysisRun", entityId: r.id, caseId: r.caseId, userAgent: "jobs", details: { reason: "abandoned", staleMinutes } });
    }
  }
  for (const c of caps) {
    const done = await prisma.captureJob.updateMany({ where: { id: c.id, status: { in: [...statuses] } }, data: { status: "FAILED", error: "The collection stopped before it finished.", finishedAt: new Date() } });
    if (done.count) {
      n++;
      await recordAudit(prisma, { action: "capture.failed", entityType: "CaptureJob", entityId: c.id, caseId: c.caseId, userAgent: "jobs", details: { reason: "abandoned", staleMinutes } });
    }
  }
  return n;
}
