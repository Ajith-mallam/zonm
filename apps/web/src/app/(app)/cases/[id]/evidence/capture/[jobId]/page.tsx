import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Alert, Badge, Card } from "@/components/ui";
import type { EngineResult } from "@/lib/analysis";
import { ADAPTERS } from "@/lib/capture/platforms";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { GRADE_ICON, GRADE_LABEL, GRADE_TONE, RUN_STATUS_LABEL } from "@/lib/run-display";

export default async function CapturePage({ params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await params;
  await getCaseAccess(id);
  const job = await prisma.captureJob.findFirst({ where: { id: jobId, caseId: id } });
  if (!job) notFound();
  const label = ADAPTERS[job.platform]?.label ?? job.platform;
  const profile = job.kind === "PROFILE";
  const [docs, run, candidates, file] = await Promise.all([
    job.sourceFileId
      ? prisma.document.findMany({ where: { sourceFileId: job.sourceFileId }, orderBy: [{ authoredAt: { sort: "desc", nulls: "last" } }] })
      : Promise.resolve([]),
    job.analysisRunId ? prisma.analysisRun.findUnique({ where: { id: job.analysisRunId } }) : null,
    prisma.candidate.findMany({ where: { caseId: id }, select: { id: true, pseudonym: true } }),
    job.sourceFileId ? prisma.sourceFile.findUnique({ where: { id: job.sourceFileId }, select: { id: true, filename: true, sha256: true } }) : null,
  ]);
  const pseud = new Map(candidates.map((c) => [c.id, c.pseudonym]));
  const res = run?.result as EngineResult | null;
  const active = job.status === "QUEUED" || job.status === "RUNNING" || run?.status === "QUEUED" || run?.status === "RUNNING";
  const use = job.role === "KNOWN" ? `known writing of ${job.candidateId ? (pseud.get(job.candidateId) ?? "a candidate") : "a candidate"}` : "questioned writing";
  const words = docs.reduce((n, d) => n + d.wordCount, 0);

  return (
    <div className="max-w-3xl space-y-6">
      <AutoRefresh active={active} ms={2000} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{label} {profile ? "profile" : "post"}</h2>
        <Link href={`/cases/${id}/evidence`} className="text-sm underline">Back to evidence</Link>
      </div>

      <Card className="text-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone={job.status === "SUCCEEDED" ? "green" : job.status === "FAILED" ? "red" : "blue"}>
            {job.status === "QUEUED" ? "Waiting to start…" : job.status === "RUNNING" ? `Collecting from ${label}…` : job.status === "SUCCEEDED" ? "Collected" : "Failed"}
          </Badge>
          <span className="text-black/60 dark:text-white/60">{profile ? `latest ${job.maxPosts} posts` : "single post"} · imported as {use}</span>
        </div>
        <a href={job.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-blue-700 underline dark:text-blue-300">{job.url}</a>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
          Requested {fmtDateTime(job.createdAt)}
          {job.costUsd != null && job.costUsd > 0 && <> · cost ${job.costUsd.toFixed(4)}</>}
        </p>
        {job.status === "RUNNING" && profile && <p className="mt-2 text-xs text-black/60 dark:text-white/60">Collecting a profile usually takes 15–60 seconds.</p>}
      </Card>
      {job.status === "FAILED" && <Alert>{job.error}</Alert>}

      {job.status === "SUCCEEDED" && (
        <Alert tone={job.postsImported ? "success" : "info"}>
          <span data-testid="capture-summary">
            {job.postsImported} new {job.postsImported === 1 ? "post" : "posts"} imported ({words} words)
            {job.postsSkipped ? `, ${job.postsSkipped} already in this case` : ""}.
          </span>{" "}
          {file && <>Raw data kept as evidence: <a className="underline" href={`/api/cases/${id}/files/${file.id}`}>{file.filename}</a> (SHA-256 <span className="font-mono">{file.sha256.slice(0, 12)}…</span>).</>}
        </Alert>
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
              <p className="text-black/60 dark:text-white/60">
                Most likely author of these {docs.length} {docs.length === 1 ? "post" : "posts"} among the {res.candidates.length} candidates compared.
                {res.questioned.word_count < 200 && " Short texts give limited evidence."}
              </p>
              <Link className="underline" href={`/cases/${id}/analysis/${run.id}`}>Full results</Link>
            </div>
          ) : (
            <p className="text-sm">{run.status === "FAILED" || run.status === "CANCELLED" ? `Analysis ${RUN_STATUS_LABEL[run.status].toLowerCase()}: ${run.error}` : "Analysing…"}</p>
          )}
        </Card>
      )}
      {job.status === "SUCCEEDED" && job.autoAnalyse && !run && job.postsImported! > 0 && (
        <Alert tone="info">Not analysed: no candidate has known writing yet. Add candidates and their writing, then run an analysis.</Alert>
      )}

      {docs.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">Posts</h3>
          <div className="space-y-2">
            {docs.map((d) => (
              <Card key={d.id} className="p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-black/60 dark:text-white/60">
                  <span className="font-medium text-black/80 dark:text-white/80">{d.authorLabel ?? "Unknown author"}</span>
                  <span>{fmtDateTime(d.authoredAt)}</span>
                  <span>{d.wordCount} words</span>
                  {d.duplicateOfId && <Badge tone="amber">Same text already in case</Badge>}
                  <Link className="underline" href={`/cases/${id}/evidence/${d.id}`}>Document</Link>
                  {d.sourceUrl && <a className="underline" href={d.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">Original</a>}
                </div>
                <p className="max-h-40 overflow-auto whitespace-pre-wrap text-sm" data-testid="post-text">{d.originalText}</p>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
