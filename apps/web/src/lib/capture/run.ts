// Execute a CaptureJob (called by the worker): fetch one public post through
// Apify with a hard cost cap, keep the raw post data as encrypted, hashed
// evidence, import the text as questioned writing and optionally analyse it.
import { ApifyClient } from "apify-client";
import { randomBytes } from "node:crypto";
import { createRun, DEFAULT_SETTINGS } from "../analysis";
import { recordAudit } from "../audit";
import { prisma } from "../db";
import { enqueue, QUEUES } from "../queue";
import { writeEvidence } from "../storage";
import { countWords, sha256Hex } from "../text";
import { normaliseFacebookItem, parseFacebookPostUrl, pickRequestedPost } from "./facebook";

export const FACEBOOK_ACTOR = "apify/facebook-posts-scraper";
/** Never spend more than this on one post, whatever the actor's pricing says. */
const MAX_COST_USD = 0.05;

type MinimalApify = Pick<ApifyClient, "actor" | "dataset" | "user">;

export class CaptureError extends Error {}

/** Cost cap from the actor's pay-per-event price table (poc-apify approach). */
async function costCap(client: MinimalApify): Promise<number> {
  try {
    const [actor, me] = await Promise.all([client.actor(FACEBOOK_ACTOR).get(), client.user("me").get()]);
    const infos = (actor as unknown as { pricingInfos?: { pricingModel?: string; pricingPerEvent?: { actorChargeEvents?: Record<string, { eventPriceUsd?: number; eventTieredPricingUsd?: Record<string, { tieredEventPriceUsd: number }> }> } }[] })?.pricingInfos ?? [];
    const current = infos[infos.length - 1];
    const events = current?.pricingPerEvent?.actorChargeEvents;
    if (current?.pricingModel !== "PAY_PER_EVENT" || !events) return MAX_COST_USD;
    const tier = (me as unknown as { plan?: { id?: string } })?.plan?.id ?? "FREE";
    const price = (ev?: { eventPriceUsd?: number; eventTieredPricingUsd?: Record<string, { tieredEventPriceUsd: number }> }) =>
      !ev ? 0 : typeof ev.eventPriceUsd === "number" ? ev.eventPriceUsd : (ev.eventTieredPricingUsd?.[tier]?.tieredEventPriceUsd ?? Math.max(0, ...Object.values(ev.eventTieredPricingUsd ?? {}).map((t) => t.tieredEventPriceUsd)));
    const expected = price(events["actor-start"]) + price(events.post) * 3; // the actor may return a few neighbours
    return Math.min(MAX_COST_USD, Math.ceil(expected * 1000 + 1e-9) / 1000);
  } catch {
    return MAX_COST_USD;
  }
}

export async function executeCapture(jobId: string, deps: { client?: MinimalApify } = {}): Promise<void> {
  const job = await prisma.captureJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "QUEUED") return;
  await prisma.captureJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date() } });
  const audit = (action: string, details: object) =>
    recordAudit(prisma, { action, entityType: "CaptureJob", entityId: jobId, caseId: job.caseId, userAgent: "worker", details });

  try {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!deps.client && !token) throw new CaptureError("Social media capture is not set up yet: add APIFY_TOKEN to apps/web/.env and restart the worker.");
    const client = deps.client ?? new ApifyClient({ token });
    const ref = parseFacebookPostUrl(job.url);

    const cap = await costCap(client);
    const run = await client.actor(FACEBOOK_ACTOR).call({ startUrls: [{ url: ref.url }], resultsLimit: 1 }, { maxTotalChargeUsd: cap, waitSecs: 300 });
    await prisma.captureJob.update({ where: { id: jobId }, data: { providerRunId: run.id, costUsd: run.usageTotalUsd ?? null } });
    if (run.status !== "SUCCEEDED") throw new CaptureError(`The capture service finished with status ${run.status}.`);
    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 5 });
    const item = pickRequestedPost(items as Record<string, unknown>[], ref);
    if (!item) throw new CaptureError("The post was not found. It may be private, deleted, or not a public post.");
    const post = normaliseFacebookItem(item);
    if (!post.text) throw new CaptureError("The post has no text to analyse (it may be only a photo or video).");

    // Keep the provider's raw record as the evidential original.
    const raw = Buffer.from(JSON.stringify({ capturedAt: new Date().toISOString(), requestedUrl: ref.url, actor: FACEBOOK_ACTOR, providerRunId: run.id, item }, null, 2), "utf8");
    const fileId = randomBytes(12).toString("hex");
    const fileSha = sha256Hex(raw);
    const storagePath = await writeEvidence(job.caseId, fileId, raw);
    const textSha = sha256Hex(post.text);
    const words = countWords(post.text);
    const duplicateOf = await prisma.document.findFirst({ where: { caseId: job.caseId, sha256: textSha }, orderBy: { createdAt: "asc" }, select: { id: true } });

    const doc = await prisma.$transaction(async (tx) => {
      await tx.sourceFile.create({
        data: { id: fileId, caseId: job.caseId, filename: `facebook-post-${post.postId ?? ref.key}.json`, mimeType: "application/json", sizeBytes: raw.length, sha256: fileSha, storagePath, scanStatus: "NOT_SCANNED", uploadedById: job.requestedById },
      });
      const d = await tx.document.create({
        data: {
          caseId: job.caseId,
          role: "QUESTIONED",
          sourceFileId: fileId,
          sourceType: "SOCIAL_CAPTURE",
          title: `Facebook post${post.author ? ` by ${post.author}` : ""}`,
          originalText: post.text,
          sha256: textSha,
          wordCount: words,
          authorLabel: post.author,
          authoredAt: post.postedAt,
          platform: "FACEBOOK",
          sourceUrl: post.url ?? ref.url,
          externalId: post.postId,
          duplicateOfId: duplicateOf?.id ?? null,
          metadata: { captureJobId: jobId, actor: FACEBOOK_ACTOR, providerRunId: run.id, authorUrl: post.authorUrl },
          createdById: job.requestedById,
          versions: { create: { version: 1, change: "ORIGINAL", text: post.text, sha256: textSha, wordCount: words, createdById: job.requestedById } },
        },
      });
      await recordAudit(tx, {
        action: "capture.complete",
        entityType: "CaptureJob",
        entityId: jobId,
        caseId: job.caseId,
        userAgent: "worker",
        details: { documentId: d.id, sourceFileId: fileId, fileSha256: fileSha, textSha256: textSha, providerRunId: run.id, costUsd: run.usageTotalUsd ?? null },
      });
      return d;
    });

    // Optionally analyse the post against every candidate with known writing.
    let analysisRunId: string | null = null;
    if (job.autoAnalyse) {
      const withWriting = await prisma.document.groupBy({ by: ["candidateId"], where: { caseId: job.caseId, role: "KNOWN", excluded: false, candidateId: { not: null } } });
      const candidateIds = withWriting.map((r) => r.candidateId!).filter(Boolean);
      if (candidateIds.length) {
        const ar = await prisma.$transaction(async (tx) => {
          const ar = await createRun(tx, { caseId: job.caseId, questionedIds: [doc.id], candidateIds, settings: DEFAULT_SETTINGS, requestedById: job.requestedById });
          await recordAudit(tx, { action: "analysis.run.request", entityType: "AnalysisRun", entityId: ar.id, caseId: job.caseId, userAgent: "worker", details: { captureJobId: jobId, candidates: candidateIds.length } });
          return ar;
        });
        await enqueue(QUEUES.analysis, "analyze", { runId: ar.id }, ar.id);
        analysisRunId = ar.id;
      }
    }
    await prisma.captureJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", documentId: doc.id, sourceFileId: fileId, analysisRunId, finishedAt: new Date() } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.captureJob.update({ where: { id: jobId }, data: { status: "FAILED", error: message.slice(0, 1000), finishedAt: new Date() } });
    await audit("capture.failed", { reason: e instanceof CaptureError ? message : "unexpected error" });
  }
}
