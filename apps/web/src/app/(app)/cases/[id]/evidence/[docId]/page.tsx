import { DocumentRole } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, Input, Label, Select, Table, Textarea } from "@/components/ui";
import { PLATFORM_LABEL } from "@/lib/candidates";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { createVersionAction, reassignAction, setExcludedAction } from "../actions";

const CHANGE_LABEL = { ORIGINAL: "Original", REDACTION: "Redaction", PARTIAL_EXCLUSION: "Partial exclusion", CORRECTION: "Correction" } as const;
const nf = new Intl.NumberFormat("en-GB");

export default async function DocumentPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const a = await getCaseAccess(id);
  const d = await prisma.document.findFirst({
    where: { id: docId, caseId: id },
    include: {
      versions: { orderBy: { version: "desc" } },
      sourceFile: { select: { id: true, filename: true, sha256: true } },
      candidate: { select: { id: true, pseudonym: true } },
      duplicateOf: { select: { id: true, title: true } },
    },
  });
  if (!d) notFound();
  const current = d.versions[0];
  const [candidates, people] = await Promise.all([
    prisma.candidate.findMany({ where: { caseId: id }, orderBy: { pseudonym: "asc" }, select: { id: true, pseudonym: true } }),
    prisma.user.findMany({ where: { id: { in: [...new Set([d.createdById, ...d.versions.map((v) => v.createdById)])] } }, select: { id: true, name: true } }),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const meta = d.metadata && typeof d.metadata === "object" && !Array.isArray(d.metadata) ? (d.metadata as Record<string, unknown>) : {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="break-all text-lg font-semibold">{d.title ?? "Untitled document"}</h2>
        <Link href={`/cases/${id}/evidence`} className="text-sm underline">All evidence</Link>
      </div>
      {d.excluded && <Alert tone="warning">Excluded from analysis: {d.excludedReason}</Alert>}
      {d.duplicateOf && (
        <Alert tone="info">
          Same text as <Link className="underline" href={`/cases/${id}/evidence/${d.duplicateOf.id}`}>{d.duplicateOf.title ?? "another document"}</Link>.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            {d.role === "QUESTIONED" ? <Badge tone="amber">Questioned</Badge> : <Badge tone="blue">Known: {d.candidate?.pseudonym}</Badge>}
            <span className="text-black/60 dark:text-white/60">
              Version {current.version} ({CHANGE_LABEL[current.change]}) · {nf.format(current.wordCount)} words
            </span>
          </div>
          <p className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded bg-black/[0.03] p-3 text-sm dark:bg-white/5" data-testid="current-text">{current.text}</p>
        </Card>

        <Card className="h-fit text-sm">
          <h3 className="mb-3 font-semibold">Provenance</h3>
          <dl className="space-y-2">
            <div><dt className="text-xs text-black/50 dark:text-white/50">Author in source</dt><dd>{d.authorLabel ?? "—"}</dd></div>
            <div><dt className="text-xs text-black/50 dark:text-white/50">Written</dt><dd>{fmtDateTime(d.authoredAt)}</dd></div>
            <div><dt className="text-xs text-black/50 dark:text-white/50">Platform / format</dt><dd>{d.platform ? PLATFORM_LABEL[d.platform] : "—"} · {d.sourceType}</dd></div>
            {d.sourceUrl && <div><dt className="text-xs text-black/50 dark:text-white/50">Source URL</dt><dd className="break-all"><a className="underline" href={d.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{d.sourceUrl}</a></dd></div>}
            <div>
              <dt className="text-xs text-black/50 dark:text-white/50">Source file</dt>
              <dd className="break-all">
                {d.sourceFile ? <a className="underline" href={`/api/cases/${id}/files/${d.sourceFile.id}`}>{d.sourceFile.filename}</a> : "Entered directly"}
                {typeof meta.position === "number" && <span className="text-black/50"> (item #{meta.position})</span>}
              </dd>
            </div>
            <div><dt className="text-xs text-black/50 dark:text-white/50">SHA-256 of original text</dt><dd className="break-all font-mono text-xs" data-testid="original-sha">{d.sha256}</dd></div>
            {d.sourceFile && <div><dt className="text-xs text-black/50 dark:text-white/50">SHA-256 of source file</dt><dd className="break-all font-mono text-xs">{d.sourceFile.sha256}</dd></div>}
            <div><dt className="text-xs text-black/50 dark:text-white/50">Added</dt><dd>{fmtDateTime(d.createdAt)} by {name.get(d.createdById) ?? "—"}</dd></div>
          </dl>
        </Card>
      </div>

      <section>
        <h3 className="mb-2 font-semibold">Versions</h3>
        <p className="mb-2 text-xs text-black/50 dark:text-white/50">The original (version 1) is never changed. Analyses use the latest version.</p>
        <Table>
          <thead><tr><th>Version</th><th>Change</th><th>Reason</th><th>Words</th><th>SHA-256</th><th>By</th></tr></thead>
          <tbody>
            {d.versions.map((v) => (
              <tr key={v.id} className="align-top">
                <td>{v.version}</td>
                <td>{CHANGE_LABEL[v.change]}</td>
                <td className="max-w-xs whitespace-pre-wrap text-xs">{v.reason ?? "—"}</td>
                <td>{nf.format(v.wordCount)}</td>
                <td className="font-mono text-xs" title={v.sha256}>{v.sha256.slice(0, 16)}…</td>
                <td className="text-xs">{name.get(v.createdById) ?? "—"}<div className="text-black/50">{fmtDateTime(v.createdAt)}</div></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {a.can("document.version.create") && (
          <Card>
            <h3 className="mb-1 font-semibold">Create a new version</h3>
            <p className="mb-3 text-xs text-black/60 dark:text-white/60">Edit the text below (for example, remove quoted or forwarded text, or redact a phone number). The original stays unchanged.</p>
            <ActionForm action={createVersionAction.bind(null, id, d.id)} className="space-y-3" success="New version saved.">
              <Textarea name="text" defaultValue={current.text} rows={8} aria-label="New version text" className="font-mono text-xs" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="change">Type of change</Label>
                  <Select id="change" name="change" defaultValue="PARTIAL_EXCLUSION">
                    <option value="PARTIAL_EXCLUSION">Partial exclusion (not the author&apos;s words)</option>
                    <option value="REDACTION">Redaction (sensitive data)</option>
                    <option value="CORRECTION">Correction (extraction error)</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="reason">Reason</Label>
                  <Input id="reason" name="reason" required minLength={3} maxLength={1000} />
                </div>
              </div>
              <SubmitButton pendingText="Saving…">Save new version</SubmitButton>
            </ActionForm>
          </Card>
        )}

        <div className="space-y-6">
          {a.can("document.exclude") && (
            <Card>
              <h3 className="mb-3 font-semibold">{d.excluded ? "Include in analysis" : "Exclude from analysis"}</h3>
              <ActionForm action={setExcludedAction.bind(null, id, d.id)} className="space-y-3">
                <input type="hidden" name="exclude" value={d.excluded ? "false" : "true"} />
                {!d.excluded && (
                  <div>
                    <Label htmlFor="exreason">Reason</Label>
                    <Input id="exreason" name="reason" required maxLength={500} placeholder="e.g. written by someone else, automated message" />
                  </div>
                )}
                <SubmitButton variant={d.excluded ? "secondary" : "danger"} pendingText="Saving…">{d.excluded ? "Include again" : "Exclude"}</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {a.can("document.version.create") && (
            <Card>
              <h3 className="mb-3 font-semibold">Role</h3>
              <ActionForm action={reassignAction.bind(null, id, d.id)} className="flex flex-wrap items-end gap-3">
                <div>
                  <Label htmlFor="role">Role</Label>
                  <Select id="role" name="role" defaultValue={d.role} className="w-40">
                    <option value={DocumentRole.QUESTIONED}>Questioned</option>
                    <option value={DocumentRole.KNOWN}>Known writing</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="candidateId">Candidate (for known)</Label>
                  <Select id="candidateId" name="candidateId" defaultValue={d.candidateId ?? ""} className="w-44">
                    <option value="">—</option>
                    {candidates.map((c) => <option key={c.id} value={c.id}>{c.pseudonym}</option>)}
                  </Select>
                </div>
                <SubmitButton pendingText="Saving…">Update</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
