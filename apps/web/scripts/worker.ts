// Background worker: runs queued analysis and social-capture jobs.
//   npm run worker
// Needs Redis (REDIS_URL), the database and the engine (ENGINE_URL).
// Several workers may run at once; BullMQ gives each job to one worker.
import { Worker } from "bullmq";
import { executeRun } from "../src/lib/analysis";
import { executeCapture } from "../src/lib/capture/run";
import { prisma } from "../src/lib/db";
import { failAbandonedJobs } from "../src/lib/jobs";
import { QUEUES, redisConnection } from "../src/lib/queue";

async function main() {
  // Fail jobs abandoned by a crashed worker (RUNNING for over 20 minutes,
  // longer than any job can take) before this worker takes any job itself.
  const swept = await failAbandonedJobs(20);
  if (swept) console.log(`[worker] marked ${swept} abandoned job(s) as failed`);

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
