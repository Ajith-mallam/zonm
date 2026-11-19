// Background worker: runs queued jobs (analysis now, social capture next).
//   npm run worker
// Needs Redis (REDIS_URL), the database and the engine (ENGINE_URL).
import { Worker } from "bullmq";
import { executeRun } from "../src/lib/analysis";
import { prisma } from "../src/lib/db";
import { QUEUES, redisConnection } from "../src/lib/queue";

const analysis = new Worker<{ runId: string }>(
  QUEUES.analysis,
  async (job) => {
    await executeRun(job.data.runId);
  },
  { connection: redisConnection(), concurrency: 2 },
);

analysis.on("ready", () => console.log(`[worker] listening on ${QUEUES.analysis}`));
analysis.on("completed", (job) => console.log(`[worker] analysis ${job.data.runId} done`));
analysis.on("failed", (job, err) => console.error(`[worker] analysis ${job?.data.runId} error: ${err.message}`));

// Runs left RUNNING by a crashed worker are marked failed at start-up.
prisma.analysisRun
  .updateMany({ where: { status: "RUNNING" }, data: { status: "FAILED", error: "The worker stopped while this run was in progress.", finishedAt: new Date() } })
  .then((r) => r.count && console.log(`[worker] marked ${r.count} interrupted run(s) as failed`));

const stop = async () => {
  await analysis.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
