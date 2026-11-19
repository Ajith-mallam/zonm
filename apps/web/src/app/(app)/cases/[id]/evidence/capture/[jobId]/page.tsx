import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Alert, Badge, Card } from "@/components/ui";
import type { EngineResult } from "@/lib/analysis";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { GRADE_ICON, GRADE_LABEL, GRADE_TONE, RUN_STATUS_LABEL } from "@/lib/run-display";

const STATUS = { QUEUED: "Waiting to start…", RUNNING: "Fetching the post from Facebook…", SUCCEEDED: "Captured", FAILED: "Failed" } as const;

export default async function CapturePage({ params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await params;
  await getCaseAccess(id);
  const job = await prisma.captureJob.findFirst({ where: { id: jobId, caseId: id } });
  if (!job) notFound();
  const [doc, run, candidates] = await Promise.all([
    job.documentId ? prisma.document.findUnique({ where: { id: job.documentId }, include: { sourceFile: { select: { id: true, sha256: true } } } }) : null,
    job.analysisRunId ? prisma.analysisRun.findUnique({ where: { id: job.analysisRunId } }) : null,
    prisma.candidate.findMany({ where: { caseId: id }, select: { id: true, pseudonym: true } }),
  ]);
  const pseud = new Map(candidates.map((c) => [c.id, c.pseudonym]));
  const res = run?.result as EngineResult | null;
  const active = job.status === "QUEUED" || job.status === "RUNNING" || run?.status === "QUEUED" || run?.status === "RUNNING";

  return (
    <div className="max-w-3xl space-y-6">
      <AutoRefresh active={active} ms={2000} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Facebook post check</h2>
        <Link href={`/cases/${id}/evidence`} className="text-sm underline">Back to evidence</Link>
      </div>
      <Card className="text-sm">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone={job.status === "SUCCEEDED" ? "green" : job.status === "FAILED" ? "red" : "blue"}>{STATUS[job.status]}</Badge>
          {job.costUsd != null && <span className="text-xs text-black/50 dark:text-white/50">capture cost ${job.costUsd.toFixed(4)}</span>}
        </div>
        <a href={job.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-blue-700 underline dark:text-blue-300">{job.url}</a>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">Requested {fmtDateTime(job.createdAt)}</p>
      </Card>
      {job.status === "FAILED" && <Alert>{job.error}</Alert>}

      {doc && (
        <Card>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="amber">Questioned</Badge>
            <span className="font-medium">{doc.authorLabel ?? "Unknown author"}</span>
            <span className="text-black/50 dark:text-white/50">{fmtDateTime(doc.authoredAt)} · {doc.wordCount} words</span>
            {doc.duplicateOfId && <Badge tone="amber">Already in case</Badge>}
          </div>
          <p className="whitespace-pre-wrap text-sm" data-testid="post-text">{doc.originalText}</p>
          <p className="mt-3 text-xs text-black/50 dark:text-white/50">
            Stored as evidence: the raw post data is kept encrypted with SHA-256 <span className="font-mono">{doc.sourceFile?.sha256.slice(0, 16)}…</span>.{" "}
            <Link className="underline" href={`/cases/${id}/evidence/${doc.id}`}>Open the document</Link>
          </p>
        </Card>
      )}

      {job.status === "SUCCEEDED" && job.autoAnalyse && !run && (
        <Alert tone="info">The post was not analysed because no candidate has known writing yet. Add candidates and their writing, then run an analysis.</Alert>
      )}
      {run && (
        <Card>
          <h3 className="mb-2 font-semibold">Authorship check</h3>
          {res ? (
            <div className="space-y-2 text-sm">
              <div className="text-3xl font-semibold" data-testid="capture-verdict">{pseud.get(res.confidence.top_candidate) ?? "Unknown"}</div>
              <Badge tone={GRADE_TONE[res.confidence.grade]}>
                <span aria-hidden className="mr-1">{GRADE_ICON[res.confidence.grade]}</span>
                {GRADE_LABEL[res.confidence.grade]} confidence
              </Badge>
              <p className="text-black/60 dark:text-white/60">Most likely author among the {res.candidates.length} candidates compared. A single short post gives limited evidence.</p>
              <Link className="underline" href={`/cases/${id}/analysis/${run.id}`}>Full results</Link>
            </div>
          ) : (
            <p className="text-sm">{run.status === "FAILED" || run.status === "CANCELLED" ? `Analysis ${RUN_STATUS_LABEL[run.status].toLowerCase()}: ${run.error}` : "Analysing…"}</p>
          )}
        </Card>
      )}
    </div>
  );
}
