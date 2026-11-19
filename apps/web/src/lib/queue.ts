// BullMQ queues on Redis (REDIS_URL). The web app only enqueues; jobs run in
// the worker process (scripts/worker.ts, `npm run worker`).
import { Queue, type ConnectionOptions } from "bullmq";

export const QUEUES = { analysis: "zonm-analysis", capture: "zonm-capture" } as const;

export function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null, // required by BullMQ workers
  };
}

const globalForQueues = globalThis as unknown as { zonmQueues?: Record<string, Queue> };

export function queue(name: (typeof QUEUES)[keyof typeof QUEUES]): Queue {
  globalForQueues.zonmQueues ??= {};
  globalForQueues.zonmQueues[name] ??= new Queue(name, {
    connection: { ...redisConnection(), enableOfflineQueue: false },
    defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 1000 },
  });
  return globalForQueues.zonmQueues[name];
}

export class QueueUnavailableError extends Error {
  constructor() {
    super("The job queue (Redis) is not reachable, so the job could not be started. Start Redis and try again.");
  }
}

/** Enqueue, turning a Redis outage into a clear error instead of a hang. */
export async function enqueue(name: (typeof QUEUES)[keyof typeof QUEUES], jobName: string, data: object, jobId: string) {
  try {
    const q = queue(name);
    await Promise.race([q.waitUntilReady(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
    return await q.add(jobName, data, { jobId });
  } catch {
    throw new QueueUnavailableError();
  }
}
