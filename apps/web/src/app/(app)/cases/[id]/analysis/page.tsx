import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { SubmitButton } from "@/components/forms";
import { SufficiencyMeter } from "@/components/sufficiency";
import { Badge, Card, Input, Label, Table } from "@/components/ui";
import { DEFAULT_SETTINGS, METHOD_LABEL, METHODS, type EngineResult } from "@/lib/analysis";
import { knownWriting, noWriting } from "@/lib/candidate-data";
import { getCaseAccess } from "@/lib/case-access";
import { failAbandonedJobs, jobRunner } from "@/lib/jobs";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { GRADE_ICON, GRADE_LABEL, GRADE_TONE, RUN_STATUS_LABEL, RUN_STATUS_TONE } from "@/lib/run-display";
import { snippet } from "@/lib/text";
import { startRunAction } from "./actions";

const nf = new Intl.NumberFormat("en-GB");

/** Server actions on this page may run a job inline (JOB_RUNNER=inline): allow up to 5 minutes. */
export const maxDuration = 300;

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getCaseAccess(id);
  // No long-lived worker with the inline runner: fail jobs whose invocation died here.
  if (jobRunner() === "inline") await failAbandonedJobs();
  const [runs, candidates, writing, questioned] = await Promise.all([
    prisma.analysisRun.findMany({ where: { caseId: id }, orderBy: { queuedAt: "desc" }, take: 50, include: { _count: { select: { inputs: true } } } }),
    prisma.candidate.findMany({ where: { caseId: id }, orderBy: { pseudonym: "asc" }, select: { id: true, pseudonym: true } }),
    knownWriting(id),
    prisma.document.findMany({
      where: { caseId: id, role: "QUESTIONED", excluded: false },
      orderBy: [{ authoredAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true, title: true, wordCount: true, authorLabel: true, originalText: true },
    }),
  ]);
  const pseud = new Map(candidates.map((c) => [c.id, c.pseudonym]));
  const people = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...new Set(runs.map((r) => r.requestedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  const active = runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  const questionedWords = questioned.reduce((n, d) => n + d.wordCount, 0);

  return (
    <div className="space-y-6">
      <AutoRefresh active={active} ms={2000} />
      <section>
        <h2 className="mb-3 font-semibold">Runs</h2>
        {runs.length === 0 ? (
          <Card><p className="text-sm text-black/60 dark:text-white/60">No analyses yet.</p></Card>
        ) : (
          <Table>
            <thead><tr><th>Started</th><th>Status</th><th>Most likely author</th><th>Confidence</th><th>Inputs</th><th>By</th></tr></thead>
            <tbody>
              {runs.map((r) => {
                const res = r.result as EngineResult | null;
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs">
                      <Link href={`/cases/${id}/analysis/${r.id}`} className="text-blue-700 underline dark:text-blue-300">{fmtDateTime(r.queuedAt)}</Link>
                    </td>
                    <td>
                      <Badge tone={RUN_STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}{r.status === "RUNNING" ? ` ${r.progress}%` : ""}</Badge>
                    </td>
                    <td>{res ? (pseud.get(res.confidence.top_candidate) ?? "Deleted candidate") : "—"}</td>
                    <td>{res ? <Badge tone={GRADE_TONE[res.confidence.grade]}>{GRADE_ICON[res.confidence.grade]} {GRADE_LABEL[res.confidence.grade]}</Badge> : "—"}</td>
                    <td>{r._count.inputs} docs</td>
                    <td className="text-xs">{people.get(r.requestedById) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>

      {a.can("analysis.run") && (
        <Card>
          <h2 className="mb-1 font-semibold">New analysis</h2>
          <p className="mb-4 text-sm text-black/60 dark:text-white/60">
            Compares the questioned writing with each candidate&apos;s known writing. Each run records the exact document versions, their SHA-256 hashes, the settings and the engine version.
          </p>
          {candidates.length === 0 || questioned.length === 0 ? (
            <p className="text-sm">
              You need questioned documents and at least one candidate with known writing. Add them on the{" "}
              <Link className="underline" href={`/cases/${id}/evidence`}>Evidence</Link> and <Link className="underline" href={`/cases/${id}/candidates`}>Candidates</Link> tabs.
            </p>
          ) : (
            <ActionForm action={startRunAction.bind(null, id)} className="space-y-5">
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Candidates to compare</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {candidates.map((c) => {
                    const s = writing.get(c.id) ?? noWriting;
                    return (
                      <label key={c.id} className="flex items-start gap-2 rounded-md border border-black/10 p-2 dark:border-white/10">
                        <input type="checkbox" name="candidate" value={c.id} defaultChecked={s.words > 0} disabled={s.words === 0} className="mt-1" />
                        <span className="flex-1">
                          <span className="text-sm font-medium">{c.pseudonym}</span>
                          <SufficiencyMeter s={s} compact />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-sm font-medium">Questioned writing</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="questionedScope" value="all" defaultChecked /> All {questioned.length} questioned documents ({nf.format(questionedWords)} words)
                </label>
                <details className="mt-1">
                  <summary className="cursor-pointer text-sm">
                    <label className="inline-flex items-center gap-2"><input type="radio" name="questionedScope" value="selected" /> Only selected documents…</label>
                  </summary>
                  <div className="mt-2 max-h-64 space-y-1 overflow-auto rounded-md border border-black/10 p-2 dark:border-white/10">
                    {questioned.map((d) => (
                      <label key={d.id} className="flex items-start gap-2 text-xs">
                        <input type="checkbox" name="questioned" value={d.id} className="mt-0.5" />
                        <span><span className="font-medium">{d.title ?? "Untitled"}</span> · {d.wordCount} words · {snippet(d.originalText, 80)}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </fieldset>

              <details>
                <summary className="cursor-pointer text-sm font-medium">Settings (defaults suit most cases)</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <div><Label htmlFor="mfw">Most frequent words</Label><Input id="mfw" name="mfw" type="number" defaultValue={DEFAULT_SETTINGS.mfw} min={10} max={5000} /></div>
                  <div><Label htmlFor="chunk_size">Chunk size (words)</Label><Input id="chunk_size" name="chunk_size" type="number" defaultValue={DEFAULT_SETTINGS.chunk_size} min={50} max={20000} /></div>
                  <div><Label htmlFor="char_ngram_min">Character n-gram from</Label><Input id="char_ngram_min" name="char_ngram_min" type="number" defaultValue={DEFAULT_SETTINGS.char_ngram_min} min={1} max={8} /></div>
                  <div><Label htmlFor="char_ngram_max">to</Label><Input id="char_ngram_max" name="char_ngram_max" type="number" defaultValue={DEFAULT_SETTINGS.char_ngram_max} min={1} max={8} /></div>
                </div>
                <fieldset className="mt-3">
                  <legend className="mb-1 text-sm">Methods</legend>
                  <div className="flex flex-wrap gap-4 text-sm">
                    {METHODS.map((m) => (
                      <label key={m} className="flex items-center gap-1.5"><input type="checkbox" name={`w_${m}`} defaultChecked /> {METHOD_LABEL[m]}</label>
                    ))}
                  </div>
                </fieldset>
              </details>
              <SubmitButton pendingText="Starting…">Run analysis</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}
