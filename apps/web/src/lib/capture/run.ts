// Execute a CaptureJob (called by the worker): fetch one public post, or the
// latest N posts of a profile, through the platform's Apify scraper with a
// hard cost cap; keep the scraper's raw records as one encrypted, hashed
// evidence file; import each post's text as a document (questioned, or known
// writing of a candidate); optionally analyse new questioned posts.
import type { Prisma } from "@prisma/client";
import { ApifyClient } from "apify-client";
import { randomBytes } from "node:crypto";
import { createRun, DEFAULT_SETTINGS } from "../analysis";
import { recordAudit } from "../audit";
import { prisma } from "../db";
import { enqueue, QUEUES } from "../queue";
import { writeEvidence } from "../storage";
import { countWords, sha256Hex } from "../text";
import { ADAPTERS, itemError, parseSocialUrl, pickRequestedPost, type CapturedPost, type PlatformAdapter } from "./platforms";

/** Upper limit for one capture, whatever the price list says. */
const MAX_COST_USD = 1;

type MinimalApify = Pick<ApifyClient, "actor" | "dataset" | "user">;

export class CaptureError extends Error {}

type Pricing = { pricingModel?: string; minimalMaxTotalChargeUsd?: number; pricingPerEvent?: { actorChargeEvents?: Record<string, { eventPriceUsd?: number; eventTieredPricingUsd?: Record<string, { tieredEventPriceUsd: number }> }> } };

/**
 * Cost cap from the actor's own pay-per-event price list: start fee plus the
 * per-item price for the posts requested (with headroom for skipped items),
 * never below the actor's required minimum, never above MAX_COST_USD.
 */
export async function costCap(client: MinimalApify, a: PlatformAdapter, items: number): Promise<number> {
  try {
    const [actor, me] = await Promise.all([client.actor(a.actor).get(), client.user("me").get()]);
    const infos = ((actor as unknown as { pricingInfos?: Pricing[] })?.pricingInfos ?? []) as Pricing[];
    const p = infos[infos.length - 1];
    const minimum = p?.minimalMaxTotalChargeUsd ?? 0;
    const events = p?.pricingPerEvent?.actorChargeEvents;
    if (p?.pricingModel !== "PAY_PER_EVENT" || !events) return Math.max(minimum, 0.1);
    const tier = (me as unknown as { plan?: { id?: string } })?.plan?.id ?? "FREE";
    const price = (name: string) => {
      const ev = events[name];
      if (!ev) return 0;
      if (typeof ev.eventPriceUsd === "number") return ev.eventPriceUsd;
      const tiers = ev.eventTieredPricingUsd ?? {};
      return tiers[tier]?.tieredEventPriceUsd ?? Math.max(0, ...Object.values(tiers).map((t) => t.tieredEventPriceUsd));
    };
    const perItem = Math.max(...a.itemEvents.map(price));
    const expected = price("actor-start") + perItem * (items + 5);
    return Math.min(MAX_COST_USD, Math.max(minimum, Math.ceil(expected * 1000) / 1000));
  } catch {
    return 0.5;
  }
}

export async function executeCapture(jobId: string, deps: { client?: MinimalApify } = {}): Promise<void> {
  const job = await prisma.captureJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "QUEUED") return;
  await prisma.captureJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date() } });

  try {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!deps.client && !token) throw new CaptureError("Social media capture is not set up yet: add APIFY_TOKEN to apps/web/.env and restart the worker.");
    const client = deps.client ?? new ApifyClient({ token });
    const target = parseSocialUrl(job.url);
    const adapter = ADAPTERS[target.platform];
    const want = target.kind === "POST" ? 1 : job.maxPosts;

    const run = await client.actor(adapter.actor).call(adapter.input(target, want), { maxTotalChargeUsd: await costCap(client, adapter, want), waitSecs: 300 });
    await prisma.captureJob.update({ where: { id: jobId }, data: { providerRunId: run.id, costUsd: run.usageTotalUsd ?? null } });
    if (run.status !== "SUCCEEDED") throw new CaptureError(`The ${adapter.label} capture finished with status ${run.status}.`);
    const { items: rawItems } = await client.dataset(run.defaultDatasetId).listItems({ limit: want + 20 });
    const items = rawItems as Record<string, unknown>[];
    const errors = items.map(itemError).filter(Boolean);
    const valid = items.filter((it) => !itemError(it));
    if (!valid.length) throw new CaptureError(errors[0] ? `${adapter.label} returned no posts: ${errors[0]}` : `No posts found. The ${target.kind === "POST" ? "post" : "account"} may be private, deleted or not public.`);

    // Select the posts: the requested one, or the newest N of the account.
    let picked: { raw: Record<string, unknown>; post: CapturedPost }[];
    if (target.kind === "POST") {
      const one = pickRequestedPost(valid, target);
      if (!one) throw new CaptureError("The post was not found. It may be private, deleted, or not a public post.");
      picked = [{ raw: one, post: adapter.normalise(one) }];
    } else {
      picked = valid
        .map((raw) => ({ raw, post: adapter.normalise(raw) }))
        .filter((p) => !p.post.isRepost)
        .sort((a, b) => (b.post.postedAt?.getTime() ?? 0) - (a.post.postedAt?.getTime() ?? 0))
        .slice(0, want);
    }
    const withText = picked.filter((p) => p.post.text);
    if (!withText.length) throw new CaptureError(`The ${picked.length === 1 ? "post has" : "posts have"} no text to analyse (photo or video only).`);

    // Posts already captured in this case (same platform and post id) are skipped.
    const ids = withText.map((p) => p.post.postId).filter((x): x is string => !!x);
    const already = new Set(
      (await prisma.document.findMany({ where: { caseId: job.caseId, platform: target.platform, externalId: { in: ids } }, select: { externalId: true } })).map((d) => d.externalId),
    );
    const fresh = withText.filter((p) => !p.post.postId || !already.has(p.post.postId));

    // Keep the scraper's raw records as the evidential original (one file per capture).
    const raw = Buffer.from(
      JSON.stringify({ capturedAt: new Date().toISOString(), requestedUrl: target.url, platform: target.platform, kind: target.kind, actor: adapter.actor, providerRunId: run.id, items }, null, 2),
      "utf8",
    );
    const fileId = randomBytes(12).toString("hex");
    const fileSha = sha256Hex(raw);
    const storagePath = await writeEvidence(job.caseId, fileId, raw);
    const hashes = new Map((await prisma.document.findMany({ where: { caseId: job.caseId }, select: { id: true, sha256: true }, orderBy: { createdAt: "asc" } })).reverse().map((d) => [d.sha256, d.id]));
    const slug = (target.handle ?? target.key).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);

    const docIds = await prisma.$transaction(async (tx) => {
      await tx.sourceFile.create({
        data: {
          id: fileId,
          caseId: job.caseId,
          filename: `${target.platform.toLowerCase()}-${target.kind === "POST" ? "post" : "profile"}-${slug}.json`,
          mimeType: "application/json",
          sizeBytes: raw.length,
          sha256: fileSha,
          storagePath,
          scanStatus: "NOT_SCANNED",
          uploadedById: job.requestedById,
        },
      });
      const created: string[] = [];
      for (const [i, { post }] of fresh.entries()) {
        const sha = sha256Hex(post.text);
        const words = countWords(post.text);
        const d = await tx.document.create({
          data: {
            caseId: job.caseId,
            role: job.role,
            candidateId: job.role === "KNOWN" ? job.candidateId : null,
            sourceFileId: fileId,
            sourceType: "SOCIAL_CAPTURE",
            title: `${adapter.label} post${post.author ? ` by ${post.author}` : ""}`,
            originalText: post.text,
            sha256: sha,
            wordCount: words,
            authorLabel: post.author,
            authoredAt: post.postedAt,
            platform: target.platform,
            sourceUrl: post.url,
            externalId: post.postId,
            duplicateOfId: hashes.get(sha) ?? null,
            metadata: { captureJobId: jobId, position: i + 1, actor: adapter.actor, providerRunId: run.id, authorName: post.authorName, authorUrl: post.authorUrl } as Prisma.InputJsonValue,
            createdById: job.requestedById,
            versions: { create: { version: 1, change: "ORIGINAL", text: post.text, sha256: sha, wordCount: words, createdById: job.requestedById } },
          },
        });
        created.push(d.id);
      }
      // Collecting a candidate's own profile: record the account as one of their handles.
      if (job.role === "KNOWN" && job.candidateId && target.kind === "PROFILE" && target.handle) {
        await tx.candidateHandle.upsert({
          where: { candidateId_platform_handle: { candidateId: job.candidateId, platform: target.platform, handle: target.handle } },
          create: { candidateId: job.candidateId, platform: target.platform, handle: target.handle, profileUrl: target.url },
          update: {},
        });
      }
      await recordAudit(tx, {
        action: "capture.complete",
        entityType: "CaptureJob",
        entityId: jobId,
        caseId: job.caseId,
        userAgent: "worker",
        details: { platform: target.platform, kind: target.kind, found: withText.length, imported: created.length, skipped: withText.length - fresh.length, sourceFileId: fileId, fileSha256: fileSha, providerRunId: run.id },
      });
      return created;
    }, { timeout: 60_000 });

    // Optionally analyse the new questioned posts against every candidate with known writing.
    let analysisRunId: string | null = null;
    if (job.autoAnalyse && job.role === "QUESTIONED" && docIds.length) {
      const withWriting = await prisma.document.groupBy({ by: ["candidateId"], where: { caseId: job.caseId, role: "KNOWN", excluded: false, candidateId: { not: null } } });
      const candidateIds = withWriting.map((r) => r.candidateId!).filter(Boolean);
      if (candidateIds.length) {
        const ar = await prisma.$transaction(async (tx) => {
          const ar = await createRun(tx, { caseId: job.caseId, questionedIds: docIds, candidateIds, settings: DEFAULT_SETTINGS, requestedById: job.requestedById });
          await recordAudit(tx, { action: "analysis.run.request", entityType: "AnalysisRun", entityId: ar.id, caseId: job.caseId, userAgent: "worker", details: { captureJobId: jobId, candidates: candidateIds.length } });
          return ar;
        });
        await enqueue(QUEUES.analysis, "analyze", { runId: ar.id }, ar.id);
        analysisRunId = ar.id;
      }
    }
    await prisma.captureJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        documentId: docIds[0] ?? null,
        sourceFileId: fileId,
        analysisRunId,
        postsFound: withText.length,
        postsImported: docIds.length,
        postsSkipped: withText.length - fresh.length,
        finishedAt: new Date(),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.captureJob.update({ where: { id: jobId }, data: { status: "FAILED", error: message.slice(0, 1000), finishedAt: new Date() } });
    await recordAudit(prisma, { action: "capture.failed", entityType: "CaptureJob", entityId: jobId, caseId: job.caseId, userAgent: "worker", details: { reason: e instanceof CaptureError ? message : "unexpected error" } });
  }
}
