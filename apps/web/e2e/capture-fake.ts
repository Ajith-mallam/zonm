// Test helper for the capture suite: create a CaptureJob and execute it with a
// fake Apify client that answers in each platform's real output format (no
// network, no cost). Everything after the scraper call (evidence storage,
// document import, candidate handles, auto-analysis via the real queue) is the
// production code path.
//   npx tsx --env-file=.env e2e/capture-fake.ts <caseId> <email> <url> <use> <postsJson>
//   use: "questioned" | "known:<pseudonym>"     postsJson: [{"id","text","author","at"}]
import { parseSocialUrl } from "../src/lib/capture/platforms";
import { executeCapture } from "../src/lib/capture/run";
import { prisma } from "../src/lib/db";

type Post = { id: string; text: string; author: string; at: string };
const [caseId, email, url, use, postsJson] = process.argv.slice(2);
const posts = JSON.parse(postsJson) as Post[];
const target = parseSocialUrl(url);

/** Shape a post the way each scraper returns it (fields verified live). */
function item(p: Post): Record<string, unknown> {
  switch (target.platform) {
    case "FACEBOOK":
      return { postId: p.id, url: `https://www.facebook.com/${p.author}/posts/${p.id}`, text: p.text, user: { name: p.author }, time: p.at, facebookUrl: `https://www.facebook.com/${p.author}` };
    case "INSTAGRAM":
      return { id: p.id, shortCode: `C${p.id}`, url: `https://www.instagram.com/p/C${p.id}/`, caption: p.text, ownerUsername: p.author, ownerFullName: p.author, timestamp: p.at };
    case "TIKTOK":
      return { id: p.id, text: p.text, createTimeISO: p.at, webVideoUrl: `https://www.tiktok.com/@${p.author}/video/${p.id}`, authorMeta: { name: p.author, nickName: p.author } };
    case "X":
      return { id: p.id, url: `https://x.com/${p.author}/status/${p.id}`, fullText: p.text, createdAt: new Date(p.at).toUTCString(), isRetweet: false, author: { userName: p.author, name: p.author } };
    default:
      throw new Error(`no fake for ${target.platform}`);
  }
}

const fake = {
  actor: () => ({
    get: async () => null,
    call: async () => ({ id: "fake-run-1", status: "SUCCEEDED", defaultDatasetId: "fake-dataset", usageTotalUsd: 0.006 }),
  }),
  dataset: () => ({ listItems: async () => ({ items: posts.map(item) }) }),
  user: () => ({ get: async () => null }),
};

(async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  let candidateId: string | null = null;
  if (use.startsWith("known:")) {
    candidateId = (await prisma.candidate.findFirstOrThrow({ where: { caseId, pseudonym: use.slice(6) } })).id;
  }
  const job = await prisma.captureJob.create({
    data: {
      caseId,
      platform: target.platform,
      url: target.url,
      kind: target.kind,
      maxPosts: target.kind === "POST" ? 1 : 10,
      role: candidateId ? "KNOWN" : "QUESTIONED",
      candidateId,
      autoAnalyse: !candidateId,
      requestedById: user.id,
    },
  });
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
