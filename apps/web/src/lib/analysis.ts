// Analysis runs (Phase 1 item 9). A run freezes exactly what it analyses: the
// latest version of each selected document, with its SHA-256, plus the full
// settings. The worker re-verifies those hashes before calling the engine, and
// stores the engine's complete result and run record (F6.9).
import type { AnalysisRun, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { recordAudit } from "./audit";
import { CORPUS_THRESHOLDS } from "./candidates";
import { prisma, type Tx } from "./db";
import { sha256Hex } from "./text";

export const METHODS = ["burrows_delta", "eder_delta", "cosine_delta", "char_ngram_cosine", "style_marker"] as const;
export type Method = (typeof METHODS)[number];

export const METHOD_LABEL: Record<Method, string> = {
  burrows_delta: "Burrows' Delta",
  eder_delta: "Eder's Delta",
  cosine_delta: "Cosine Delta",
  char_ngram_cosine: "Character n-grams",
  style_marker: "Style markers",
};

export type RunSettings = {
  mfw: number;
  chunk_size: number;
  char_ngram_min: number;
  char_ngram_max: number;
  char_ngram_top: number;
  culling: number;
  weights: Record<Method, number>;
  min_questioned_words: number;
  min_candidate_words: number;
};

export const DEFAULT_SETTINGS: RunSettings = {
  mfw: 200,
  chunk_size: 500,
  char_ngram_min: 3,
  char_ngram_max: 3,
  char_ngram_top: 1000,
  culling: 0,
  weights: { burrows_delta: 1, eder_delta: 1, cosine_delta: 1, char_ngram_cosine: 1, style_marker: 1 },
  min_questioned_words: 200,
  min_candidate_words: CORPUS_THRESHOLDS.minimum,
};

// ─────────────────────────────────────────────────────── engine result types

export type LanguageComposition = {
  word_count: number;
  counts: Record<string, number>;
  proportions: { crs: number; en: number; fr: number };
  dominant_language: string | null;
  cmi: number;
};

export type EngineResult = {
  engine_version: string;
  lexicon_versions: Record<string, string>;
  settings: Record<string, unknown>;
  settings_sha256: string;
  input_hashes: unknown;
  questioned: { word_count: number; chunks: number; language: LanguageComposition };
  candidates: {
    id: string;
    rank: number;
    ensemble_score: number;
    relative_support: number;
    distances: Partial<Record<Method, number>>;
    word_count: number;
    chunks: number;
    language: LanguageComposition;
  }[];
  methods: Partial<Record<Method, { weight: number; top_candidate: string }>>;
  features: { mfw: string[]; char_ngram_count: number; style_markers: string[] };
  confidence: {
    grade: "strong" | "moderate" | "limited" | "inconclusive";
    top_candidate: string;
    factors: { method_agreement?: number; ensemble_margin?: number; chunk_stability?: number | null; points?: number };
    reasons: string[];
    calibrated: boolean;
  };
  caveats: string[];
  warnings: string[];
};

// ──────────────────────────────────────────────────────────── creating runs

export class RunInputError extends Error {}

/**
 * Create a QUEUED run for the given documents and candidates. Uses each
 * document's latest version; excluded documents are skipped.
 */
export async function createRun(
  tx: Tx,
  args: { caseId: string; questionedIds: string[] | "all"; candidateIds: string[]; settings: RunSettings; requestedById: string },
): Promise<AnalysisRun> {
  if (args.candidateIds.length < 1) throw new RunInputError("Choose at least one candidate.");
  const docs = await tx.document.findMany({
    where: {
      caseId: args.caseId,
      excluded: false,
      OR: [
        { role: "QUESTIONED", ...(args.questionedIds === "all" ? {} : { id: { in: args.questionedIds } }) },
        { role: "KNOWN", candidateId: { in: args.candidateIds } },
      ],
    },
    select: { id: true, role: true, candidateId: true, versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, sha256: true, wordCount: true } } },
  });
  const questioned = docs.filter((d) => d.role === "QUESTIONED");
  if (!questioned.length) throw new RunInputError("There are no questioned documents to analyse.");
  const missing = args.candidateIds.filter((c) => !docs.some((d) => d.role === "KNOWN" && d.candidateId === c));
  if (missing.length) throw new RunInputError("Every selected candidate needs at least one known-writing document.");

  const run = await tx.analysisRun.create({
    data: {
      caseId: args.caseId,
      status: "QUEUED",
      settings: args.settings as unknown as Prisma.InputJsonValue,
      settingsSha256: createHash("sha256").update(JSON.stringify(args.settings)).digest("hex"),
      requestedById: args.requestedById,
    },
  });
  await tx.analysisRunInput.createMany({
    data: docs.map((d) => ({ runId: run.id, documentVersionId: d.versions[0].id, role: d.role, candidateId: d.candidateId, sha256: d.versions[0].sha256 })),
  });
  return run;
}

// ─────────────────────────────────────────────────────────── executing runs

export class RunCancelled extends Error {}

const ENGINE_TIMEOUT_MS = 10 * 60_000;

/**
 * Execute a run (called by the worker). Re-verifies every input hash, calls
 * the engine, polls for cancellation while it waits, and records the outcome.
 */
export async function executeRun(runId: string): Promise<void> {
  const run = await prisma.analysisRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "QUEUED") return; // already handled (e.g. cancelled while queued)
  const started = Date.now();
  await prisma.analysisRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date(), progress: 10 } });

  const finish = async (data: Prisma.AnalysisRunUpdateInput, action: string, details: Prisma.InputJsonValue) => {
    await prisma.$transaction(async (tx) => {
      await tx.analysisRun.update({ where: { id: runId }, data: { ...data, finishedAt: new Date() } });
      await recordAudit(tx, { action, entityType: "AnalysisRun", entityId: runId, caseId: run.caseId, userAgent: "worker", details });
    });
  };

  const controller = new AbortController();
  const cancelWatch = setInterval(async () => {
    const r = await prisma.analysisRun.findUnique({ where: { id: runId }, select: { cancelRequestedAt: true } }).catch(() => null);
    if (r?.cancelRequestedAt) controller.abort(new RunCancelled());
  }, 1000);

  try {
    const inputs = await prisma.analysisRunInput.findMany({
      where: { runId },
      include: { documentVersion: { select: { id: true, text: true, sha256: true } } },
    });
    for (const i of inputs) {
      // Integrity: the text must still match the hash frozen when the run was created.
      if (sha256Hex(i.documentVersion.text) !== i.sha256 || i.documentVersion.sha256 !== i.sha256) {
        throw new Error(`Integrity check failed for document version ${i.documentVersionId}.`);
      }
    }
    await prisma.analysisRun.update({ where: { id: runId }, data: { progress: 30 } });

    const byCandidate = new Map<string, { id: string; text: string }[]>();
    for (const i of inputs.filter((x) => x.role === "KNOWN" && x.candidateId)) {
      const list = byCandidate.get(i.candidateId!) ?? [];
      list.push({ id: i.documentVersionId, text: i.documentVersion.text });
      byCandidate.set(i.candidateId!, list);
    }
    const body = {
      questioned: inputs.filter((x) => x.role === "QUESTIONED").map((x) => ({ id: x.documentVersionId, text: x.documentVersion.text })),
      candidates: [...byCandidate].map(([id, documents]) => ({ id, documents })),
      settings: run.settings,
    };

    const timeout = setTimeout(() => controller.abort(new Error("The engine did not answer within 10 minutes.")), ENGINE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${process.env.ENGINE_URL ?? "http://127.0.0.1:8000"}/v1/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = payload && typeof payload === "object" && "detail" in payload ? JSON.stringify(payload.detail) : `HTTP ${res.status}`;
      throw new Error(`The engine rejected the request: ${detail}`);
    }
    const result = payload as EngineResult;
    await finish(
      {
        status: "SUCCEEDED",
        progress: 100,
        result: result as unknown as Prisma.InputJsonValue,
        engineVersion: result.engine_version,
        lexiconVersions: result.lexicon_versions,
        settingsSha256: result.settings_sha256,
      },
      "analysis.run.complete",
      { status: "SUCCEEDED", grade: result.confidence.grade, topCandidateId: result.confidence.top_candidate, engineVersion: result.engine_version, durationMs: Date.now() - started },
    );
  } catch (e) {
    const cancelled = e instanceof RunCancelled || controller.signal.reason instanceof RunCancelled;
    const message = cancelled ? "Cancelled by user." : e instanceof Error ? (e.cause instanceof Error ? `${e.message} (${e.cause.message})` : e.message) : String(e);
    await finish(
      { status: cancelled ? "CANCELLED" : "FAILED", error: message.slice(0, 2000) },
      cancelled ? "analysis.run.cancelled" : "analysis.run.failed",
      { status: cancelled ? "CANCELLED" : "FAILED", durationMs: Date.now() - started },
    );
  } finally {
    clearInterval(cancelWatch);
  }
}
