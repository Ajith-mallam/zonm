import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { LanguageBar, LanguageLegend, SupportBars } from "@/components/charts";
import { SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, Table } from "@/components/ui";
import { METHOD_LABEL, METHODS, type EngineResult, type Method } from "@/lib/analysis";
import { corpusSufficiency, SUFFICIENCY_LABEL, SUFFICIENCY_TONE } from "@/lib/candidates";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { GRADE_ICON, GRADE_LABEL, GRADE_TONE, RUN_STATUS_LABEL, RUN_STATUS_TONE } from "@/lib/run-display";
import { cancelRunAction } from "../actions";

const nf = new Intl.NumberFormat("en-GB");
const pct = (v: number) => `${Math.round(v * 100)}%`;
const GRADE_TEXT = {
  strong: "The evidence points clearly to this candidate.",
  moderate: "The evidence favours this candidate.",
  limited: "The evidence leans towards this candidate but is not conclusive.",
  inconclusive: "The evidence does not single out a candidate.",
};

export default async function RunPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const a = await getCaseAccess(id);
  const run = await prisma.analysisRun.findFirst({
    where: { id: runId, caseId: id },
    include: { inputs: { include: { documentVersion: { select: { version: true, wordCount: true, document: { select: { id: true, title: true } } } } } } },
  });
  if (!run) notFound();
  const [candidates, requester] = await Promise.all([
    prisma.candidate.findMany({ where: { caseId: id }, select: { id: true, pseudonym: true } }),
    prisma.user.findUnique({ where: { id: run.requestedById }, select: { name: true } }),
  ]);
  const pseud = new Map(candidates.map((c) => [c.id, c.pseudonym]));
  const name = (cid: string) => pseud.get(cid) ?? "Deleted candidate";
  const res = run.result as EngineResult | null;
  const active = run.status === "QUEUED" || run.status === "RUNNING";
  const duration = run.startedAt && run.finishedAt ? ((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000).toFixed(1) : null;
  const top = res?.candidates[0];
  const methods = res ? METHODS.filter((m) => res.methods[m]) : [];

  return (
    <div className="space-y-6">
      <AutoRefresh active={active} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Analysis of {fmtDateTime(run.queuedAt)}</h2>
        <Link href={`/cases/${id}/analysis`} className="text-sm underline">All analyses</Link>
      </div>

      {active && (
        <Card>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span><Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge> {run.status === "QUEUED" ? "Waiting for the worker…" : "Analysing…"}</span>
            <span className="tabular-nums">{run.progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-[var(--viz-track)]" role="progressbar" aria-valuenow={run.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-[var(--viz-1)] transition-all" style={{ width: `${Math.max(run.progress, 3)}%` }} />
          </div>
          {a.can("analysis.cancel") && (
            <ActionForm action={cancelRunAction.bind(null, id, run.id)} className="mt-3">
              <SubmitButton variant="secondary" pendingText="Cancelling…">Cancel run</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}
      {(run.status === "FAILED" || run.status === "CANCELLED") && <Alert tone={run.status === "FAILED" ? "error" : "info"}>{RUN_STATUS_LABEL[run.status]}: {run.error}</Alert>}

      {res && top && (
        <>
          <Card>
            <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
              <div>
                <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">Most likely author among the candidates</div>
                <div className="mt-1 text-5xl font-semibold" data-testid="verdict">{name(res.confidence.top_candidate)}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone={GRADE_TONE[res.confidence.grade]}>
                    <span aria-hidden className="mr-1">{GRADE_ICON[res.confidence.grade]}</span>
                    {GRADE_LABEL[res.confidence.grade]} confidence
                  </Badge>
                  <span className="text-sm text-black/60 dark:text-white/60">{pct(top.relative_support)} relative support</span>
                </div>
                <p className="mt-2 text-sm">{GRADE_TEXT[res.confidence.grade]}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-black/70 dark:text-white/70">
                  {res.confidence.reasons.map((r) => <li key={r}>{r.replace(/\b(c[a-z0-9]{20,})\b/g, (m) => name(m))}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium">Relative support</h3>
                <SupportBars label="Relative support by candidate" rows={res.candidates.map((c) => ({ name: name(c.id), value: c.relative_support, highlight: c.rank === 1 }))} />
                <p className="mt-3 text-xs text-black/50 dark:text-white/50">
                  How the combined evidence divides between the candidates compared. It is not a probability that the candidate wrote the text.
                </p>
              </div>
            </div>
          </Card>

          <Alert tone="warning">
            <ul className="list-disc pl-5">
              {res.caveats.map((c) => <li key={c}>{c}</li>)}
              {!res.confidence.calibrated && <li>The confidence grade is provisional: its thresholds have not yet been calibrated on validation data (M9).</li>}
              {res.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </Alert>

          <section>
            <h3 className="mb-2 font-semibold">Scores by method</h3>
            <p className="mb-2 text-xs text-black/50 dark:text-white/50">Distances: lower means closer to the questioned writing. ✓ marks each method&apos;s closest candidate.</p>
            <Table>
              <thead>
                <tr>
                  <th>Rank</th><th>Candidate</th><th>Ensemble score</th><th>Support</th>
                  {methods.map((m) => <th key={m}>{METHOD_LABEL[m as Method]}</th>)}
                  <th>Known writing</th>
                </tr>
              </thead>
              <tbody>
                {res.candidates.map((c) => {
                  const s = corpusSufficiency(c.word_count, 0);
                  return (
                    <tr key={c.id}>
                      <td>{c.rank}</td>
                      <td className="font-medium">{name(c.id)}</td>
                      <td className="tabular-nums">{c.ensemble_score.toFixed(2)}</td>
                      <td className="tabular-nums">{pct(c.relative_support)}</td>
                      {methods.map((m) => (
                        <td key={m} className="tabular-nums">
                          {c.distances[m]?.toFixed(3) ?? "—"} {res.methods[m]?.top_candidate === c.id && <span title="Closest under this method">✓</span>}
                        </td>
                      ))}
                      <td className="whitespace-nowrap"><Badge tone={SUFFICIENCY_TONE[s.level]}>{SUFFICIENCY_LABEL[s.level]}</Badge> <span className="text-xs">{nf.format(c.word_count)} words</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Language composition</h3>
              <LanguageLegend />
            </div>
            <Card className="space-y-3">
              <LanguageBar name="Questioned" comp={res.questioned.language} />
              {res.candidates.map((c) => <LanguageBar key={c.id} name={name(c.id)} comp={c.language} />)}
              <p className="text-xs text-black/50 dark:text-white/50">
                Share of words identified as Kreol Seselwa, English or French. CMI is the code-mixing index (0 = a single language). Kreol identification uses a seed lexicon pending the client corpus.
              </p>
            </Card>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer">Show as a table</summary>
              <Table>
                <thead><tr><th>Text</th><th>Words</th><th>Kreol</th><th>English</th><th>French</th><th>CMI</th></tr></thead>
                <tbody>
                  {[{ n: "Questioned", l: res.questioned.language }, ...res.candidates.map((c) => ({ n: name(c.id), l: c.language }))].map(({ n, l }) => (
                    <tr key={n}><td>{n}</td><td>{nf.format(l.word_count)}</td><td>{pct(l.proportions.crs)}</td><td>{pct(l.proportions.en)}</td><td>{pct(l.proportions.fr)}</td><td>{l.cmi.toFixed(1)}</td></tr>
                  ))}
                </tbody>
              </Table>
            </details>
          </section>
        </>
      )}

      <section>
        <h3 className="mb-2 font-semibold">Run record</h3>
        <Card className="text-sm">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div><dt className="text-xs text-black/50 dark:text-white/50">Status</dt><dd><Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge></dd></div>
            <div><dt className="text-xs text-black/50 dark:text-white/50">Requested</dt><dd>{fmtDateTime(run.queuedAt)} by {requester?.name ?? "—"}</dd></div>
            <div><dt className="text-xs text-black/50 dark:text-white/50">Duration</dt><dd>{duration ? `${duration} s` : "—"}</dd></div>
            <div><dt className="text-xs text-black/50 dark:text-white/50">Engine</dt><dd>{run.engineVersion ?? "—"}</dd></div>
            <div><dt className="text-xs text-black/50 dark:text-white/50">Lexicons</dt><dd className="text-xs">{run.lexiconVersions ? Object.entries(run.lexiconVersions as Record<string, string>).map(([k, v]) => `${k} ${v}`).join(", ") : "—"}</dd></div>
            <div><dt className="text-xs text-black/50 dark:text-white/50">Settings SHA-256</dt><dd className="break-all font-mono text-xs">{run.settingsSha256}</dd></div>
          </dl>
          {res && <p className="mt-3 text-xs text-black/60 dark:text-white/60">{res.features.mfw.length} most-frequent words, {res.features.char_ngram_count} character n-grams and {res.features.style_markers.length} style markers were used.</p>}
          <details className="mt-3">
            <summary className="cursor-pointer">Settings</summary>
            <pre className="mt-2 overflow-auto rounded bg-black/5 p-2 text-xs dark:bg-white/10">{JSON.stringify(res?.settings ?? run.settings, null, 2)}</pre>
          </details>
          <details className="mt-2">
            <summary className="cursor-pointer">Inputs ({run.inputs.length} document versions)</summary>
            <Table>
              <thead><tr><th>Document</th><th>Role</th><th>Version</th><th>Words</th><th>SHA-256</th></tr></thead>
              <tbody>
                {run.inputs.map((i) => (
                  <tr key={i.documentVersionId}>
                    <td><Link className="underline" href={`/cases/${id}/evidence/${i.documentVersion.document.id}`}>{i.documentVersion.document.title ?? "Untitled"}</Link></td>
                    <td>{i.role === "QUESTIONED" ? "Questioned" : `Known: ${i.candidateId ? name(i.candidateId) : "—"}`}</td>
                    <td>{i.documentVersion.version}</td>
                    <td>{i.documentVersion.wordCount}</td>
                    <td className="font-mono text-xs" title={i.sha256}>{i.sha256.slice(0, 16)}…</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
        </Card>
      </section>
    </div>
  );
}
