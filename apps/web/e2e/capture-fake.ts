// Test helper for the capture suite: create a CaptureJob and execute it with a
// fake Apify client (no network, no cost). Everything after the provider call
// (evidence storage, document import, auto-analysis via the real queue) is the
// production code path.
//   npx tsx --env-file=.env e2e/capture-fake.ts <caseId> <requesterEmail> <postUrl> <text> [author]
import { executeCapture } from "../src/lib/capture/run";
import { prisma } from "../src/lib/db";

const [caseId, email, url, text, author = "Anonymous Page"] = process.argv.slice(2);

const item = {
  postId: "1234567890123",
  url,
  text,
  user: { name: author },
  time: "2026-11-18T09:30:00.000Z",
  facebookUrl: "https://www.facebook.com/anonymous.page",
};

const fake = {
  actor: () => ({
    get: async () => null,
    call: async () => ({ id: "fake-run-1", status: "SUCCEEDED", defaultDatasetId: "fake-dataset", usageTotalUsd: 0.006 }),
  }),
  dataset: () => ({ listItems: async () => ({ items: [{ postId: "999", url: "https://www.facebook.com/x/posts/999", text: "a neighbouring post" }, item] }) }),
  user: () => ({ get: async () => null }),
};

(async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const job = await prisma.captureJob.create({ data: { caseId, platform: "FACEBOOK", url, autoAnalyse: true, requestedById: user.id } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await executeCapture(job.id, { client: fake as any });
  console.log(job.id);
  await prisma.$disconnect();
  // The queue keeps a Redis connection open; exit explicitly.
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
