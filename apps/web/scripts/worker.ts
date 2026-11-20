// Background worker: runs queued analysis and social-capture jobs.
//   npm run worker
// Needs Redis (REDIS_URL), the database and the engine (ENGINE_URL).
// Several workers may run at once; BullMQ gives each job to one worker.
import { Worker } from "bullmq";
import { executeRun } from "../src/lib/analysis";
import { recordAudit } from "../src/lib/audit";
import { executeCapture } from "../src/lib/capture/run";
import { prisma } from "../src/lib/db";
import { QUEUES, redisConnection } from "../src/lib/queue";

/**
 * A job still RUNNING after this long was abandoned by a crashed worker.
 * Longer than any job can legitimately take (engine timeout 10 min; scrapes
 * are aborted after 10 min), so a sweep never touches a job another worker is
 * still processing.
 */
const STALE_MINUTES = 20;

async function sweepAbandoned() {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000);
  const runs = await prisma.analysisRun.findMany({ where: { status: "RUNNING", startedAt: { lt: cutoff } }, select: { id: true, caseId: true } });
  const caps = await prisma.captureJob.findMany({ where: { status: "RUNNING", startedAt: { lt: cutoff } }, select: { id: true, caseId: true } });
  for (const r of runs) {
    const done = await prisma.analysisRun.updateMany({ where: { id: r.id, status: "RUNNING" }, data: { status: "FAILED", error: "The worker stopped while this run was in progress.", finishedAt: new Date() } });
    if (done.count) await recordAudit(prisma, { action: "analysis.run.failed", entityType: "AnalysisRun", entityId: r.id, caseId: r.caseId, userAgent: "worker", details: { reason: "abandoned", staleMinutes: STALE_MINUTES } });
  }
  for (const c of caps) {
    const done = await prisma.captureJob.updateMany({ where: { id: c.id, status: "RUNNING" }, data: { status: "FAILED", error: "The worker stopped while this collection was in progress.", finishedAt: new Date() } });
    if (done.count) await recordAudit(prisma, { action: "capture.failed", entityType: "CaptureJob", entityId: c.id, caseId: c.caseId, userAgent: "worker", details: { reason: "abandoned", staleMinutes: STALE_MINUTES } });
  }
  if (runs.length || caps.length) console.log(`[worker] marked ${runs.length} run(s) and ${caps.length} collection(s) abandoned for over ${STALE_MINUTES} min as failed`);
}

async function main() {
  // Sweep first, before this worker takes any job of its own.
  await sweepAbandoned();

  const analysis = new Worker<{ runId: string }>(QUEUES.analysis, async (job) => executeRun(job.data.runId), { connection: redisConnection(), concurrency: 2 });
  analysis.on("ready", () => console.log(`[worker] listening on ${QUEUES.analysis}`));
  analysis.on("completed", (job) => console.log(`[worker] analysis ${job.data.runId} done`));
  analysis.on("failed", (job, err) => console.error(`[worker] analysis ${job?.data.runId} error: ${err.message}`));

  const capture = new Worker<{ jobId: string }>(QUEUES.capture, async (job) => executeCapture(job.data.jobId), { connection: redisConnection(), concurrency: 2 });
  capture.on("ready", () => console.log(`[worker] listening on ${QUEUES.capture}`));
  capture.on("failed", (job, err) => console.error(`[worker] capture ${job?.data.jobId} error: ${err.message}`));

  const stop = async () => {
    await Promise.all([analysis.close(), capture.close()]);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error("[worker] failed to start:", e);
  process.exit(1);
});
